import { ChatTarget, resolveTarget, schemeOrder } from './openai';

// Only the Kubernetes API is replaced: it lists the workload service and answers the service
// proxy like an API server whose backend speaks a single protocol.
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request } }));

const target: ChatTarget = {
  id: 'llm/ai/qwen',
  kind: 'LLMInferenceService',
  namespace: 'ai',
  name: 'qwen',
  defaultModel: 'qwen',
};

function serviceList(portName: string) {
  return {
    items: [
      {
        metadata: {
          name: 'qwen-kserve-workload-svc',
          namespace: 'ai',
          labels: { 'app.kubernetes.io/component': 'llminferenceservice-workload' },
        },
        spec: { ports: [{ name: portName, port: 8000 }] },
      },
    ],
  };
}

/** A cluster whose workload port is named `portName` and whose server speaks `serverScheme`. */
function cluster(portName: string, serverScheme: 'http' | 'https') {
  request.mockImplementation(async (path: string) => {
    if (path.includes('/services?')) return serviceList(portName);
    if ((serverScheme === 'https') !== path.includes('/services/https:')) {
      throw {
        status: 503,
        message:
          ' - error trying to reach service: tls: first record does not look like a TLS handshake',
      };
    }
    if (path.endsWith('/proxy/v1/models')) return { data: [{ id: 'qwen35-122b-a10b-fp8' }] };
    throw { status: 404, message: 'Not Found' };
  });
}

const proxyCalls = () =>
  request.mock.calls.map(([path]) => path as string).filter(p => p.includes('/proxy'));

describe('resolveTarget', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('falls back to plain HTTP when the port is named "https" (regression)', async () => {
    cluster('https', 'http');
    const resolved = await resolveTarget('c1', target);
    expect(resolved.proxyBase).toBe(
      '/api/v1/namespaces/ai/services/qwen-kserve-workload-svc:8000/proxy'
    );
    expect(resolved.inClusterUrl).toBe('http://qwen-kserve-workload-svc.ai.svc:8000');
    expect(resolved.models).toEqual(['qwen35-122b-a10b-fp8']);
  });

  it('falls back to HTTPS when the port is named "http" but the server uses TLS', async () => {
    cluster('http', 'https');
    const resolved = await resolveTarget('c1', target);
    expect(resolved.proxyBase).toBe(
      '/api/v1/namespaces/ai/services/https:qwen-kserve-workload-svc:8000/proxy'
    );
    expect(resolved.inClusterUrl).toBe('https://qwen-kserve-workload-svc.ai.svc:8000');
  });

  it('tries the scheme the port name suggests first', async () => {
    cluster('http', 'http');
    await resolveTarget('c1', target);
    expect(proxyCalls()).toEqual([
      '/api/v1/namespaces/ai/services/qwen-kserve-workload-svc:8000/proxy/v1/models',
    ]);
  });

  it('reports every attempt when nothing answers', async () => {
    request.mockImplementation(async (path: string) => {
      if (path.includes('/services?')) return serviceList('http');
      throw { status: 503, message: ' - error trying to reach service: i/o timeout' };
    });
    await expect(resolveTarget('c1', target)).rejects.toThrow(
      /http \/v1\/models: .*i\/o timeout.*https \/openai\/v1\/models/
    );
    expect(proxyCalls()).toHaveLength(4);
  });
});

describe('schemeOrder', () => {
  it('puts the preferred scheme first', () => {
    expect(schemeOrder('https')).toEqual(['https', 'http']);
    expect(schemeOrder('http')).toEqual(['http', 'https']);
  });
});
