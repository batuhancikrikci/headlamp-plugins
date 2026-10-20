import {
  buildChains,
  describeRewrite,
  gatewayHealth,
  HTTPRouteJson,
  normalizePool,
  parentsHealth,
  routePools,
} from './inference';

const v1Pool = normalizePool({
  apiVersion: 'inference.networking.k8s.io/v1',
  kind: 'InferencePool',
  metadata: {
    name: 'qwen-inference-pool',
    namespace: 'ai',
    ownerReferences: [
      {
        apiVersion: 'serving.kserve.io/v1alpha2',
        kind: 'LLMInferenceService',
        name: 'qwen',
        uid: 'u',
        controller: true,
      },
    ],
  },
  spec: {
    selector: {
      matchLabels: { 'app.kubernetes.io/name': 'qwen', 'kserve.io/component': 'workload' },
    },
    targetPorts: [{ number: 8000 }],
    endpointPickerRef: { name: 'qwen-epp-service', port: { number: 9002 } },
  },
  status: {
    parents: [
      {
        parentRef: { kind: 'Gateway', name: 'inference-gw', namespace: 'gw' },
        conditions: [
          { type: 'Accepted', status: 'True' },
          { type: 'ResolvedRefs', status: 'True' },
        ],
      },
    ],
  },
});

describe('normalizePool', () => {
  it('reads the GA shape', () => {
    expect(v1Pool).toMatchObject({
      group: 'inference.networking.k8s.io',
      selector: { 'app.kubernetes.io/name': 'qwen', 'kserve.io/component': 'workload' },
      targetPorts: [8000],
      picker: { name: 'qwen-epp-service', kind: 'Service', port: 9002, failureMode: 'FailClose' },
      health: { health: 'ready' },
      owner: { kind: 'LLMInferenceService', name: 'qwen' },
    });
  });
});

describe('health', () => {
  it('reports rejected parents', () => {
    expect(
      parentsHealth(
        [
          {
            conditions: [
              { type: 'Accepted', status: 'True' },
              { type: 'ResolvedRefs', status: 'False', reason: 'InvalidExtensionRef' },
            ],
          },
        ],
        'pool'
      )
    ).toMatchObject({ health: 'failed', reason: 'InvalidExtensionRef' });
  });

  it('uses Programmed for gateways', () => {
    expect(
      gatewayHealth({
        metadata: { name: 'gw' },
        status: {
          conditions: [
            { type: 'Accepted', status: 'True' },
            { type: 'Programmed', status: 'True' },
          ],
        },
      }).health
    ).toBe('ready');
  });
});

describe('relations', () => {
  const route: HTTPRouteJson = {
    metadata: { name: 'qwen-kserve-route', namespace: 'ai' },
    spec: {
      parentRefs: [{ name: 'inference-gw', namespace: 'gw' }],
      rules: [
        {
          backendRefs: [
            {
              group: 'inference.networking.k8s.io',
              kind: 'InferencePool',
              name: 'qwen-inference-pool',
              port: 8000,
            },
            { name: 'plain-service', port: 80 },
          ],
        },
      ],
    },
  };

  it('ignores backends of the experimental pool group', () => {
    const legacy: HTTPRouteJson = {
      metadata: { name: 'old', namespace: 'ai' },
      spec: {
        rules: [
          {
            backendRefs: [
              {
                group: 'inference.networking.x-k8s.io',
                kind: 'InferencePool',
                name: 'qwen-inference-pool',
              },
            ],
          },
        ],
      },
    };
    expect(routePools(legacy)).toEqual([]);
  });

  it('finds pool backends of routes', () => {
    expect(routePools(route)).toEqual([
      {
        namespace: 'ai',
        name: 'qwen-inference-pool',
        group: 'inference.networking.k8s.io',
        weight: undefined,
      },
    ]);
  });

  it('chains gateways, routes, objectives and rewrites to pools', () => {
    const [chain] = buildChains(
      [v1Pool],
      [route],
      [{ metadata: { name: 'other', namespace: 'gw' } }],
      [
        {
          metadata: { name: 'critical', namespace: 'ai' },
          spec: { poolRef: { name: 'qwen-inference-pool' }, priority: 10 },
        },
      ],
      [
        {
          metadata: { name: 'rw', namespace: 'ai' },
          spec: {
            poolRef: { group: 'inference.networking.k8s.io', name: 'qwen-inference-pool' },
            rules: [
              {
                matches: [{ model: { value: 'chat' } }],
                targets: [
                  { modelRewrite: 'qwen-v2', weight: 90 },
                  { modelRewrite: 'qwen-v3', weight: 10 },
                ],
              },
            ],
          },
        },
      ]
    );
    expect(chain.routes.map(r => r.metadata.name)).toEqual(['qwen-kserve-route']);
    expect(chain.gateways).toEqual([]);
    expect(chain.missingGateways).toEqual(['gw/inference-gw']);
    expect(chain.objectives.map(o => o.metadata.name)).toEqual(['critical']);
    expect(describeRewrite(chain.rewrites[0])).toEqual(['chat → qwen-v2 (90%), qwen-v3 (10%)']);
  });
});
