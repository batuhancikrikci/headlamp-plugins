import { describe, expect, it } from 'vitest';
import { summarizeInstall } from '../../api/ciliumInstall';
import { bgpStats, collectIssues, endpointStats, namespaceCoverage, poolStats } from './overview';

const meta = (name: string, namespace?: string) => ({
  name,
  namespace,
  uid: name,
  creationTimestamp: '2026-01-01T00:00:00Z',
});

function endpoint(
  name: string,
  namespace: string,
  state: string,
  ingress: boolean,
  egress: boolean,
  id = 1
) {
  return {
    apiVersion: 'cilium.io/v2',
    kind: 'CiliumEndpoint',
    metadata: meta(name, namespace),
    status: {
      state,
      identity: { id },
      policy: { ingress: { enforcing: ingress }, egress: { enforcing: egress } },
    },
  };
}

const endpoints = [
  endpoint('web-1', 'shop', 'ready', true, false, 100),
  endpoint('web-2', 'shop', 'ready', false, false, 100),
  endpoint('db-1', 'data', 'ready', true, true, 200),
  endpoint('job-1', 'batch', 'waiting-for-identity', false, false, 300),
];

describe('endpoint statistics', () => {
  it('counts readiness, enforcement and identities', () => {
    expect(endpointStats(endpoints)).toEqual({
      total: 4,
      ready: 3,
      notReady: 1,
      ingressEnforced: 2,
      egressEnforced: 1,
      enforced: 2,
      identities: 3,
    });
  });

  it('computes policy coverage per namespace', () => {
    expect(namespaceCoverage(endpoints)).toEqual([
      { namespace: 'batch', endpoints: 1, enforced: 0 },
      { namespace: 'data', endpoints: 1, enforced: 1 },
      { namespace: 'shop', endpoints: 2, enforced: 1 },
    ]);
  });
});

const bgpNode = (name: string, states: string[]) => ({
  apiVersion: 'cilium.io/v2',
  kind: 'CiliumBGPNodeConfig',
  metadata: meta(name),
  spec: { bgpInstances: [{ name: 'i', peers: states.map((_, i) => ({ name: `peer-${i}` })) }] },
  status: {
    bgpInstances: [
      { name: 'i', peers: states.map((peeringState, i) => ({ name: `peer-${i}`, peeringState })) },
    ],
  },
});

const pool = (
  name: string,
  conditions: Array<{ type: string; status: string; message?: string }>
) => ({
  apiVersion: 'cilium.io/v2',
  kind: 'CiliumLoadBalancerIPPool',
  metadata: meta(name),
  spec: { blocks: [{ cidr: '10.0.0.0/24' }] },
  status: { conditions },
});

describe('BGP and pool statistics', () => {
  it('counts established sessions', () => {
    expect(
      bgpStats([bgpNode('n1', ['established', 'active']), bgpNode('n2', ['Established'])])
    ).toEqual({
      nodes: 2,
      sessions: 3,
      established: 2,
    });
  });

  it('sums pool usage and pending services', () => {
    const stats = poolStats(
      [
        pool('a', [
          { type: 'cilium.io/IPsTotal', status: 'Unknown', message: '254' },
          { type: 'cilium.io/IPsAvailable', status: 'Unknown', message: '250' },
          { type: 'cilium.io/IPsUsed', status: 'Unknown', message: '4' },
          { type: 'cilium.io/PoolConflict', status: 'False' },
        ]),
        pool('b', [{ type: 'cilium.io/PoolConflict', status: 'True', message: 'overlaps with a' }]),
      ],
      [
        { metadata: { name: 'pending', namespace: 'shop' }, spec: { type: 'LoadBalancer' } },
        {
          metadata: { name: 'ok', namespace: 'shop' },
          spec: { type: 'LoadBalancer' },
          status: { loadBalancer: { ingress: [{ ip: '10.0.0.5' }] } },
        },
        { metadata: { name: 'internal', namespace: 'shop' }, spec: { type: 'ClusterIP' } },
      ]
    );
    expect(stats).toEqual({
      pools: 2,
      total: 254,
      used: 4,
      available: 250,
      conflicts: 1,
      pendingServices: 1,
    });
  });
});

describe('collectIssues', () => {
  it('returns nothing for a healthy cluster', () => {
    expect(
      collectIssues({
        endpoints: [endpoints[0]],
        bgpNodeConfigs: [bgpNode('n1', ['established'])],
        pools: [
          pool('a', [
            { type: 'cilium.io/IPsTotal', status: 'Unknown', message: '10' },
            { type: 'cilium.io/IPsAvailable', status: 'Unknown', message: '5' },
          ]),
        ],
        services: [],
        nodes: [],
      })
    ).toEqual([]);
  });

  it('lists problems, errors first', () => {
    const install = summarizeInstall([
      {
        metadata: { name: 'cilium-x', namespace: 'kube-system', labels: { 'k8s-app': 'cilium' } },
        status: { phase: 'CrashLoopBackOff' },
      },
    ]);
    const issues = collectIssues({
      install,
      policies: [
        {
          apiVersion: 'cilium.io/v2',
          kind: 'CiliumNetworkPolicy',
          metadata: meta('broken', 'shop'),
          status: { conditions: [{ type: 'Valid', status: 'False', message: 'bad port' }] },
        },
      ],
      endpoints,
      bgpClusterConfigs: [
        {
          apiVersion: 'cilium.io/v2',
          kind: 'CiliumBGPClusterConfig',
          metadata: meta('bgp'),
          status: {
            conditions: [{ type: 'cilium.io/NoMatchingNode', status: 'True', message: 'no nodes' }],
          },
        },
      ],
      bgpNodeConfigs: [bgpNode('n1', ['established', 'active']), bgpNode('n2', ['idle'])],
      pools: [
        pool('conflict', [{ type: 'cilium.io/PoolConflict', status: 'True', message: 'overlap' }]),
        pool('full', [
          { type: 'cilium.io/IPsTotal', status: 'Unknown', message: '2' },
          { type: 'cilium.io/IPsAvailable', status: 'Unknown', message: '0' },
        ]),
      ],
      services: [
        { metadata: { name: 'pending', namespace: 'shop' }, spec: { type: 'LoadBalancer' } },
      ],
      egressPolicies: [
        {
          apiVersion: 'cilium.io/v2',
          kind: 'CiliumEgressGatewayPolicy',
          metadata: meta('egress'),
          spec: { egressGateway: { nodeSelector: { matchLabels: { role: 'egress' } } } },
        },
      ],
      nodes: [{ metadata: { name: 'worker', labels: { role: 'worker' } } }],
    });
    const byId = Object.fromEntries(issues.map(i => [i.id, i]));

    expect(byId['pod-kube-system-cilium-x']).toMatchObject({ severity: 'error', kind: 'Pod' });
    expect(byId['policy-shop-broken'].message).toBe('Policy is invalid: bad port');
    expect(byId['endpoint-batch-job-1'].severity).toBe('warning');
    expect(byId['bgp-CiliumBGPClusterConfig-bgp-cilium.io/NoMatchingNode'].message).toBe(
      'cilium.io/NoMatchingNode: no nodes'
    );
    expect(byId['bgp-sessions-n1']).toMatchObject({ severity: 'warning' });
    expect(byId['bgp-sessions-n1'].message).toContain(
      '1 of 2 BGP session(s) not established: peer-1'
    );
    expect(byId['bgp-sessions-n2'].severity).toBe('error');
    expect(byId['pool-conflict-conflict'].severity).toBe('error');
    expect(byId['pool-exhausted-full'].severity).toBe('warning');
    expect(byId['svc-shop-pending'].kind).toBe('Service');
    expect(byId['egress-egress'].severity).toBe('error');

    const severities = issues.map(i => i.severity);
    expect(severities.indexOf('warning')).toBeGreaterThan(severities.lastIndexOf('error'));
  });

  it('ignores pending LoadBalancer services when LB IPAM is not in use', () => {
    expect(
      collectIssues({
        pools: [],
        services: [
          { metadata: { name: 'pending', namespace: 'shop' }, spec: { type: 'LoadBalancer' } },
        ],
      })
    ).toEqual([]);
  });
});
