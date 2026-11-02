import { describe, expect, it } from 'vitest';
import {
  ApiVersions,
  endpointPool,
  PublishForm,
  publishPlan,
  routeModels,
  routesUsingEndpoint,
  serviceAddress,
  validatePublish,
} from './agentRouter';
import { KubeJson } from './types';

const versions: ApiVersions = {
  route: 'aigateway.envoyproxy.io/v1alpha1',
  serviceBackend: 'aigateway.envoyproxy.io/v1alpha1',
  envoyBackend: 'gateway.envoyproxy.io/v1alpha1',
  referenceGrant: 'gateway.networking.k8s.io/v1beta1',
};

const llm: KubeJson = {
  apiVersion: 'serving.kserve.io/v1alpha2',
  kind: 'LLMInferenceService',
  metadata: { name: 'qwen', namespace: 'llm', uid: 'u-1' },
  status: {
    router: {
      scheduler: {
        inferencePool: { group: 'inference.networking.k8s.io', name: 'qwen-inference-pool' },
      },
    },
  },
} as KubeJson;

const isvc: KubeJson = {
  apiVersion: 'serving.kserve.io/v1beta1',
  kind: 'InferenceService',
  metadata: { name: 'gemma', namespace: 'llm', uid: 'u-2' },
};

function form(overrides: Partial<PublishForm> = {}): PublishForm {
  return {
    mode: 'new',
    routeName: 'qwen',
    routeNamespace: 'llm',
    gatewayName: 'ai-gateway',
    gatewayNamespace: 'kube-gateway',
    models: ['qwen3'],
    createGrant: true,
    ...overrides,
  };
}

const existingRoute: KubeJson = {
  apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
  kind: 'AIGatewayRoute',
  metadata: { name: 'models', namespace: 'ai', resourceVersion: '42' },
  spec: {
    parentRefs: [{ name: 'gw' }],
    rules: [
      {
        matches: [{ headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: 'gpt-4o' }] }],
        backendRefs: [{ name: 'openai' }],
      },
    ],
  },
  status: { conditions: [] },
} as KubeJson;

describe('endpoint addresses', () => {
  it('reads the InferencePool of an llm-d endpoint', () => {
    expect(endpointPool(llm)).toEqual({
      group: 'inference.networking.k8s.io',
      name: 'qwen-inference-pool',
      namespace: 'llm',
    });
    expect(endpointPool(isvc)).toBeUndefined();
  });

  it('parses in-cluster URLs', () => {
    expect(
      serviceAddress('https://qwen-kserve-workload-svc.llm.svc.cluster.local:8000', '/v1')
    ).toEqual({
      scheme: 'https',
      host: 'qwen-kserve-workload-svc.llm.svc.cluster.local',
      port: 8000,
      apiPrefix: '/v1',
    });
    expect(serviceAddress('http://gemma-predictor.llm.svc', '/openai/v1')?.port).toBe(80);
    expect(serviceAddress('nonsense', '/v1')).toBeUndefined();
  });
});

describe('publishPlan', () => {
  it('routes llm-d endpoints to their InferencePool on a new route', () => {
    const plan = publishPlan(llm, { type: 'pool', pool: endpointPool(llm)! }, form(), versions);
    expect(plan.create).toEqual([]);
    expect(plan.routeIsNew).toBe(true);
    expect(plan.route).toMatchObject({
      kind: 'AIGatewayRoute',
      metadata: { name: 'qwen', namespace: 'llm' },
      spec: {
        parentRefs: [
          {
            group: 'gateway.networking.k8s.io',
            kind: 'Gateway',
            name: 'ai-gateway',
            namespace: 'kube-gateway',
          },
        ],
        rules: [
          {
            matches: [{ headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: 'qwen3' }] }],
            backendRefs: [
              {
                group: 'inference.networking.k8s.io',
                kind: 'InferencePool',
                name: 'qwen-inference-pool',
              },
            ],
          },
        ],
      },
    });
  });

  it('creates an owned Backend and AIServiceBackend for other endpoints', () => {
    const address = serviceAddress('https://gemma-predictor.llm.svc:8443', '/openai/v1')!;
    const plan = publishPlan(
      isvc,
      { type: 'service', address },
      form({ routeName: 'gemma' }),
      versions
    );
    const [backend, serviceBackend] = plan.create;
    const owner = [
      {
        apiVersion: 'serving.kserve.io/v1beta1',
        kind: 'InferenceService',
        name: 'gemma',
        uid: 'u-2',
      },
    ];
    expect(backend).toMatchObject({
      kind: 'Backend',
      metadata: { name: 'gemma', namespace: 'llm', ownerReferences: owner },
      spec: {
        endpoints: [{ fqdn: { hostname: 'gemma-predictor.llm.svc', port: 8443 } }],
        tls: { insecureSkipVerify: true },
      },
    });
    expect(serviceBackend).toMatchObject({
      kind: 'AIServiceBackend',
      metadata: { name: 'gemma', ownerReferences: owner },
      spec: {
        schema: { name: 'OpenAI', prefix: '/openai/v1' },
        backendRef: { group: 'gateway.envoyproxy.io', kind: 'Backend', name: 'gemma' },
      },
    });
    expect((plan.route.spec as any).rules[0].backendRefs).toEqual([{ name: 'gemma' }]);
  });

  it('adds a rule to an existing route in another namespace, with a ReferenceGrant', () => {
    const plan = publishPlan(
      llm,
      { type: 'pool', pool: endpointPool(llm)! },
      form({ mode: 'existing', routeName: 'models', routeNamespace: 'ai' }),
      versions,
      existingRoute
    );
    expect(plan.routeIsNew).toBe(false);
    expect(plan.route.metadata.resourceVersion).toBe('42');
    expect((plan.route as any).status).toBeUndefined();
    const rules = (plan.route.spec as any).rules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual((existingRoute.spec as any).rules[0]);
    expect(rules[1].backendRefs[0]).toMatchObject({ kind: 'InferencePool', namespace: 'llm' });
    expect(plan.grant).toBe(true);
    expect(plan.create[0]).toMatchObject({
      kind: 'ReferenceGrant',
      metadata: { name: 'ai-routes-from-ai', namespace: 'llm' },
      spec: {
        from: [{ group: 'aigateway.envoyproxy.io', kind: 'AIGatewayRoute', namespace: 'ai' }],
        to: [{ group: 'inference.networking.k8s.io', kind: 'InferencePool' }],
      },
    });
    // The input route is not modified.
    expect((existingRoute.spec as any).rules).toHaveLength(1);
  });

  it('creates no ReferenceGrant when asked not to', () => {
    const plan = publishPlan(
      llm,
      { type: 'pool', pool: endpointPool(llm)! },
      form({ routeNamespace: 'ai', createGrant: false }),
      versions
    );
    expect(plan.grant).toBe(false);
    expect(plan.create).toEqual([]);
  });
});

describe('validatePublish', () => {
  it('checks names, models and duplicates', () => {
    expect(validatePublish(form())).toEqual([]);
    expect(validatePublish(form({ routeName: 'Bad_Name', gatewayName: '', models: [] }))).toEqual([
      'Enter a valid route name.',
      'Pick the Gateway of the new route.',
      'Enter at least one model name.',
    ]);
    expect(
      validatePublish(
        form({ mode: 'existing', routeName: 'models', models: ['gpt-4o'] }),
        existingRoute
      )
    ).toEqual(['The route already has a rule for gpt-4o.']);
    expect(validatePublish(form({ models: ['a', 'a'] }))).toEqual(['Model names repeat.']);
    expect(routeModels(existingRoute)).toEqual(['gpt-4o']);
  });
});

describe('routesUsingEndpoint', () => {
  it('finds routes through the pool and through owned service backends', () => {
    const viaPool = {
      metadata: { name: 'r1', namespace: 'ai' },
      spec: {
        rules: [
          {
            matches: [{ headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: 'qwen3' }] }],
            backendRefs: [{ kind: 'InferencePool', name: 'qwen-inference-pool', namespace: 'llm' }],
          },
        ],
      },
    } as KubeJson;
    const viaBackend = {
      metadata: { name: 'r2', namespace: 'llm' },
      spec: { rules: [{ backendRefs: [{ name: 'gemma' }] }] },
    } as KubeJson;
    const backends = [
      { metadata: { name: 'gemma', namespace: 'llm', ownerReferences: [{ uid: 'u-2' }] } },
    ] as KubeJson[];
    expect(routesUsingEndpoint([viaPool, viaBackend], llm, backends)).toEqual([
      { route: viaPool, models: ['qwen3'] },
    ]);
    expect(routesUsingEndpoint([viaPool, viaBackend], isvc, backends)).toEqual([
      { route: viaBackend, models: [] },
    ]);
  });
});
