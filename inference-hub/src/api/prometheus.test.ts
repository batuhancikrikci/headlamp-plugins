import { RESOURCES } from '../resources/definitions';
import { clusterParams, customListPath, podProxyPath, serviceProxyPath } from './paths';
import { endpointFromService, rankPrometheusServices } from './prometheus';

function svc(namespace: string, name: string, ports: number[]) {
  return { metadata: { namespace, name }, spec: { ports: ports.map(port => ({ port })) } };
}

describe('rankPrometheusServices', () => {
  it('prefers prometheus-operated and ignores look-alikes without a query port', () => {
    const ranked = rankPrometheusServices([
      svc('monitoring', 'kube-prometheus-stack-kube-state-metrics', [8080]),
      svc('monitoring', 'kube-prometheus-stack-prometheus', [9090, 8080]),
      svc('monitoring', 'prometheus-operated', [9090]),
      svc('monitoring', 'prometheus-node-exporter', [9100]),
    ]);
    expect(ranked.map(r => r.name)).toEqual([
      'prometheus-operated',
      'kube-prometheus-stack-prometheus',
    ]);
  });

  it('prefers Thanos over Prometheus, and the Thanos query frontend over the querier', () => {
    const ranked = rankPrometheusServices([
      svc('monitoring', 'prometheus-operated', [9090]),
      svc('monitoring', 'kube-prometheus-stack-prometheus', [9090]),
      svc('thanos', 'thanos-query', [10901, 10902]),
      svc('thanos', 'thanos-query-frontend', [9090]),
      svc('thanos', 'thanos-query-grpc', [10901]),
    ]);
    expect(ranked.map(r => `${r.name}:${r.port}`)).toEqual([
      'thanos-query-frontend:9090',
      'thanos-query:10902',
      'prometheus-operated:9090',
      'kube-prometheus-stack-prometheus:9090',
    ]);
  });

  it('adds the Mimir path prefix', () => {
    const [mimir] = rankPrometheusServices([svc('mimir', 'mimir-query-frontend', [8080])]);
    expect(endpointFromService(mimir).base).toBe(
      '/api/v1/namespaces/mimir/services/mimir-query-frontend:8080/proxy/prometheus'
    );
  });
});

describe('paths', () => {
  const location = {
    group: 'serving.kserve.io',
    version: 'v1alpha2',
    apiVersion: 'serving.kserve.io/v1alpha2',
  };

  it('builds namespaced and cluster-wide list paths', () => {
    expect(customListPath(RESOURCES.llminferenceservices, location, { namespace: 'ai' })).toBe(
      '/apis/serving.kserve.io/v1alpha2/namespaces/ai/llminferenceservices'
    );
    expect(customListPath(RESOURCES.llminferenceservices, location)).toBe(
      '/apis/serving.kserve.io/v1alpha2/llminferenceservices'
    );
    // Cluster-scoped kinds ignore the namespace.
    expect(
      customListPath(RESOURCES.localmodelcaches, location, {
        namespace: 'ai',
        labelSelector: 'a=b',
      })
    ).toBe('/apis/serving.kserve.io/v1alpha2/localmodelcaches?labelSelector=a%3Db');
  });

  it('builds https proxy paths', () => {
    expect(serviceProxyPath('ai', 'qwen-kserve-workload-svc', 8000, 'https')).toBe(
      '/api/v1/namespaces/ai/services/https:qwen-kserve-workload-svc:8000/proxy'
    );
    expect(podProxyPath('ai', 'qwen-0', 8000)).toBe('/api/v1/namespaces/ai/pods/qwen-0:8000/proxy');
  });

  it('omits an empty cluster from request params', () => {
    expect(clusterParams('')).toEqual({});
    expect('cluster' in clusterParams('')).toBe(false);
    expect(clusterParams('kind', { headers: { a: 'b' } })).toEqual({
      cluster: 'kind',
      headers: { a: 'b' },
    });
  });
});
