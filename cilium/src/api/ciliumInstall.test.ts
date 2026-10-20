import { describe, expect, it } from 'vitest';
import {
  componentOf,
  configFeatures,
  imageVersion,
  isPodReady,
  PodJson,
  summarizeInstall,
} from './ciliumInstall';

function pod(
  name: string,
  labels: Record<string, string>,
  image: string,
  ready = true,
  restarts = 0
): PodJson {
  return {
    metadata: { name, namespace: 'kube-system', labels },
    spec: {
      containers: [{ name: labels['k8s-app'] === 'cilium' ? 'cilium-agent' : 'main', image }],
    },
    status: {
      phase: 'Running',
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      containerStatuses: [{ name: 'main', ready, restartCount: restarts }],
    },
  };
}

describe('pod classification', () => {
  it('recognizes the Cilium components by label', () => {
    expect(componentOf(pod('a', { 'k8s-app': 'cilium' }, 'x'))).toBe('agent');
    expect(componentOf(pod('o', { 'io.cilium/app': 'operator' }, 'x'))).toBe('operator');
    expect(componentOf(pod('e', { 'k8s-app': 'cilium-envoy' }, 'x'))).toBe('envoy');
    expect(componentOf(pod('r', { 'k8s-app': 'hubble-relay' }, 'x'))).toBe('hubbleRelay');
    expect(componentOf(pod('u', { 'k8s-app': 'hubble-ui' }, 'x'))).toBe('hubbleUI');
    expect(componentOf(pod('x', { app: 'other' }, 'x'))).toBeNull();
  });

  it('parses image versions with registries, ports and digests', () => {
    expect(imageVersion('quay.io/cilium/cilium:v1.20.2@sha256:abc')).toBe('v1.20.2');
    expect(imageVersion('registry.local:5000/cilium/cilium:v1.20.2')).toBe('v1.20.2');
    expect(imageVersion('registry.local:5000/cilium/cilium')).toBeUndefined();
    expect(imageVersion(undefined)).toBeUndefined();
  });

  it('requires the Ready condition of a running pod', () => {
    expect(isPodReady(pod('a', {}, 'x'))).toBe(true);
    expect(isPodReady(pod('a', {}, 'x', false))).toBe(false);
    expect(isPodReady({ metadata: { name: 'p' }, status: { phase: 'Pending' } })).toBe(false);
  });
});

describe('summarizeInstall', () => {
  const install = summarizeInstall([
    pod('cilium-1', { 'k8s-app': 'cilium' }, 'quay.io/cilium/cilium:v1.20.2'),
    pod('cilium-2', { 'k8s-app': 'cilium' }, 'quay.io/cilium/cilium:v1.20.1', false, 3),
    pod(
      'cilium-operator-1',
      { 'io.cilium/app': 'operator', name: 'cilium-operator' },
      'quay.io/cilium/operator-generic:v1.20.2'
    ),
    // The same pod can be returned by both label queries.
    pod(
      'cilium-operator-1',
      { 'io.cilium/app': 'operator', name: 'cilium-operator' },
      'quay.io/cilium/operator-generic:v1.20.2'
    ),
  ]);

  it('counts ready pods, restarts and versions per component', () => {
    expect(install.found).toBe(true);
    expect(install.namespace).toBe('kube-system');
    expect(install.version).toBe('v1.20.2');
    expect(install.components.agent).toMatchObject({ total: 2, ready: 1, restarts: 3 });
    expect(install.components.agent.versions).toEqual(['v1.20.2', 'v1.20.1']);
    expect(install.components.agent.notReady.map(p => p.metadata.name)).toEqual(['cilium-2']);
    expect(install.components.operator.total).toBe(1);
    expect(install.components.hubbleUI.total).toBe(0);
  });

  it('reports a missing installation', () => {
    expect(summarizeInstall([]).found).toBe(false);
  });
});

describe('configFeatures', () => {
  it('summarizes the common cilium-config settings', () => {
    const features = configFeatures({
      'cluster-name': 'prod',
      'routing-mode': 'tunnel',
      'tunnel-protocol': 'geneve',
      ipam: 'cluster-pool',
      'kube-proxy-replacement': 'true',
      'enable-bgp-control-plane': 'true',
      'enable-l2-announcements': 'false',
      'enable-ipv4-egress-gateway': 'true',
      'enable-hubble': 'true',
    });
    const byId = Object.fromEntries(features.map(f => [f.id, f]));
    expect(byId.cluster.value).toBe('prod');
    expect(byId.routing.value).toBe('Tunnel (geneve)');
    expect(byId.kpr).toMatchObject({ enabled: true, value: 'Enabled' });
    expect(byId.bgp.enabled).toBe(true);
    expect(byId.l2.enabled).toBe(false);
    expect(byId.egress.enabled).toBe(true);
    // Settings that are absent from the ConfigMap are not listed at all.
    expect(byId.wireguard).toBeUndefined();
  });

  it('describes native routing and an empty config', () => {
    expect(configFeatures({ 'routing-mode': 'native' })[0]).toMatchObject({
      id: 'routing',
      value: 'Native',
    });
    expect(configFeatures()).toEqual([]);
  });
});
