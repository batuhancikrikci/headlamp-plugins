import { dependentLinks, releasedSecretNames } from './ownership';

const ns = { namespace: 'ai' };
const secret = (name: string, namespace = 'ai') => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: { name, namespace },
});
const policy = (spec: Record<string, unknown>) => ({
  apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
  kind: 'BackendSecurityPolicy',
  metadata: { name: 'openai-auth', ...ns },
  spec,
});
const envoyBackend = (name: string) => ({
  apiVersion: 'gateway.envoyproxy.io/v1alpha1',
  kind: 'Backend',
  metadata: { name, ...ns },
});
const serviceBackend = (backend: string) => ({
  apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
  kind: 'AIServiceBackend',
  metadata: { name: 'openai', ...ns },
  spec: { backendRef: { name: backend, kind: 'Backend', group: 'gateway.envoyproxy.io' } },
});

describe('dependentLinks', () => {
  it('links the objects of the "connect a provider" wizard to their owners', () => {
    const items = [
      secret('openai-apikey'),
      envoyBackend('openai'),
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'BackendTLSPolicy',
        metadata: { name: 'openai-tls', ...ns },
        spec: { targetRefs: [{ group: 'gateway.envoyproxy.io', kind: 'Backend', name: 'openai' }] },
      },
      serviceBackend('openai'),
      policy({ type: 'APIKey', apiKey: { secretRef: { name: 'openai-apikey', namespace: 'ai' } } }),
    ];
    expect([...dependentLinks(items)]).toEqual([
      [0, 4],
      [1, 3],
      [2, 3],
    ]);
  });

  it('finds the Secret of every credential type', () => {
    const cases: Array<Record<string, unknown>> = [
      { anthropicAPIKey: { secretRef: { name: 's' } } },
      { azureAPIKey: { secretRef: { name: 's' } } },
      { awsCredentials: { credentialsFile: { secretRef: { name: 's' } } } },
      { azureCredentials: { clientSecretRef: { name: 's' } } },
      { gcpCredentials: { credentialsFile: { secretRef: { name: 's' } } } },
    ];
    for (const spec of cases) {
      expect([...dependentLinks([secret('s'), policy(spec)])]).toEqual([[0, 1]]);
    }
  });

  it('links API key Secrets to the MCPRoute that uses them', () => {
    const route = {
      apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
      kind: 'MCPRoute',
      metadata: { name: 'tools', ...ns },
      spec: {
        backendRefs: [
          { name: 'github', securityPolicy: { apiKey: { secretRef: { name: 'tools-github' } } } },
          { name: 'public' },
        ],
      },
    };
    expect([...dependentLinks([secret('tools-github'), secret('unrelated'), route])]).toEqual([
      [0, 2],
    ]);
  });

  it('ignores references to other namespaces and objects nobody refers to', () => {
    const items = [
      secret('s', 'other'),
      envoyBackend('unused'),
      policy({ apiKey: { secretRef: { name: 's', namespace: 'other' } } }),
      serviceBackend('openai'),
    ];
    expect(dependentLinks(items).size).toBe(0);
  });
});

describe('releasedSecretNames', () => {
  it('lists the Secrets an edit stops using', () => {
    const before = policy({ apiKey: { secretRef: { name: 'openai-apikey' } } });
    const after = policy({ apiKey: { secretRef: { name: 'openai-apikey-2' } } });
    expect(releasedSecretNames(before, after)).toEqual(['openai-apikey']);
    expect(releasedSecretNames(before, before)).toEqual([]);
  });

  it('works for the API key Secrets of an MCPRoute', () => {
    const route = (names: string[]) => ({
      kind: 'MCPRoute',
      metadata: { name: 'tools', ...ns },
      spec: {
        backendRefs: names.map(name => ({
          name,
          securityPolicy: { apiKey: { secretRef: { name: `tools-${name}` } } },
        })),
      },
    });
    expect(releasedSecretNames(route(['github', 'jira']), route(['github']))).toEqual([
      'tools-jira',
    ]);
  });
});
