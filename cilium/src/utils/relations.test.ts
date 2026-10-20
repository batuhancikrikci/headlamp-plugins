import { describe, expect, it } from 'vitest';
import {
  advertisementsForFamily,
  egressGatewayNodes,
  egressPolicySelectsPod,
  ipsFromPool,
  l2LeaseName,
  l2PolicySelectsService,
  poolSelectsService,
  redirectSelectsPod,
  redirectTargetsService,
  selectedNodes,
  serviceLabelSet,
} from './relations';

const lbService = {
  metadata: { name: 'web', namespace: 'shop', labels: { tier: 'edge' } },
  spec: { type: 'LoadBalancer' },
  status: { loadBalancer: { ingress: [{ ip: '192.168.10.20' }] } },
};
const clusterIPService = {
  metadata: { name: 'db', namespace: 'data' },
  spec: { type: 'ClusterIP' },
};
const nodes = [
  { metadata: { name: 'gw-1', labels: { role: 'egress' } } },
  { metadata: { name: 'worker-1', labels: { role: 'worker' } } },
];

describe('LB IPAM', () => {
  it('exposes service name and namespace as selector labels', () => {
    expect(serviceLabelSet(lbService)).toEqual({
      tier: 'edge',
      'io.kubernetes.service.namespace': 'shop',
      'io.kubernetes.service.name': 'web',
    });
  });

  it('matches pools to LoadBalancer services only', () => {
    expect(poolSelectsService({ blocks: [] }, lbService)).toBe(true);
    expect(poolSelectsService({ blocks: [] }, clusterIPService)).toBe(false);
    expect(
      poolSelectsService(
        { serviceSelector: { matchLabels: { 'io.kubernetes.service.namespace': 'shop' } } },
        lbService
      )
    ).toBe(true);
    expect(
      poolSelectsService({ serviceSelector: { matchLabels: { tier: 'internal' } } }, lbService)
    ).toBe(false);
  });

  it('attributes allocated IPs to the pool whose blocks contain them', () => {
    expect(ipsFromPool({ blocks: [{ cidr: '192.168.10.0/24' }] }, lbService)).toEqual([
      '192.168.10.20',
    ]);
    expect(
      ipsFromPool({ blocks: [{ start: '192.168.20.1', stop: '192.168.20.9' }] }, lbService)
    ).toEqual([]);
  });
});

describe('L2 announcements', () => {
  it('only announces services that have an address of an enabled type', () => {
    expect(l2PolicySelectsService({ loadBalancerIPs: true }, lbService)).toBe(true);
    expect(l2PolicySelectsService({ externalIPs: true }, lbService)).toBe(false);
    expect(l2PolicySelectsService({ loadBalancerIPs: true }, clusterIPService)).toBe(false);
    expect(
      l2PolicySelectsService(
        { loadBalancerIPs: true, serviceSelector: { matchLabels: { tier: 'other' } } },
        lbService
      )
    ).toBe(false);
    expect(l2LeaseName(lbService)).toBe('cilium-l2announce-shop-web');
  });
});

describe('nodes', () => {
  it('selects every node without a selector', () => {
    expect(selectedNodes(undefined, nodes)).toHaveLength(2);
    expect(
      selectedNodes({ matchLabels: { role: 'egress' } }, nodes).map(n => n.metadata.name)
    ).toEqual(['gw-1']);
  });

  it('requires a node selector on egress gateways', () => {
    expect(
      egressGatewayNodes(
        { egressGateway: { nodeSelector: { matchLabels: { role: 'egress' } } } },
        nodes
      )
    ).toHaveLength(1);
    expect(egressGatewayNodes({ egressGateway: {} }, nodes)).toHaveLength(0);
    expect(
      egressGatewayNodes(
        { egressGateways: [{ nodeSelector: { matchLabels: { role: 'worker' } } }] },
        nodes
      ).map(n => n.metadata.name)
    ).toEqual(['worker-1']);
  });
});

describe('BGP advertisements', () => {
  const ads = [
    {
      apiVersion: 'cilium.io/v2',
      kind: 'CiliumBGPAdvertisement',
      metadata: { name: 'a', labels: { advertise: 'bgp' } },
    },
    { apiVersion: 'cilium.io/v2', kind: 'CiliumBGPAdvertisement', metadata: { name: 'b' } },
  ];

  it('selects advertisements by label and nothing without a selector', () => {
    const family = { afi: 'ipv4', safi: 'unicast' };
    expect(advertisementsForFamily(family, ads)).toEqual([]);
    expect(
      advertisementsForFamily(
        { ...family, advertisements: { matchLabels: { advertise: 'bgp' } } },
        ads
      ).map(a => a.metadata.name)
    ).toEqual(['a']);
    expect(advertisementsForFamily({ ...family, advertisements: {} }, ads)).toHaveLength(2);
  });
});

describe('egress gateway policies', () => {
  const pod = { metadata: { name: 'web-1', namespace: 'shop', labels: { app: 'web' } } };

  it('matches pods by pod selector, namespace label and namespace selector', () => {
    expect(
      egressPolicySelectsPod(
        { selectors: [{ podSelector: { matchLabels: { app: 'web' } } }] },
        pod,
        {}
      )
    ).toBe(true);
    expect(
      egressPolicySelectsPod(
        { selectors: [{ podSelector: { matchLabels: { app: 'api' } } }] },
        pod,
        {}
      )
    ).toBe(false);
    expect(
      egressPolicySelectsPod(
        {
          selectors: [{ podSelector: { matchLabels: { 'io.kubernetes.pod.namespace': 'shop' } } }],
        },
        pod,
        {}
      )
    ).toBe(true);
    expect(
      egressPolicySelectsPod(
        {
          selectors: [
            {
              podSelector: {},
              namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'other' } },
            },
          ],
        },
        pod,
        {}
      )
    ).toBe(false);
    expect(egressPolicySelectsPod({ selectors: [{}] }, pod, {})).toBe(false);
  });
});

describe('local redirect policies', () => {
  const policy = {
    metadata: { namespace: 'kube-system' },
    spec: {
      redirectFrontend: { serviceMatcher: { serviceName: 'kube-dns', namespace: 'kube-system' } },
      redirectBackend: { localEndpointSelector: { matchLabels: { 'k8s-app': 'node-local-dns' } } },
    },
  };

  it('finds the frontend service and the backend pods', () => {
    expect(
      redirectTargetsService(policy, { metadata: { name: 'kube-dns', namespace: 'kube-system' } })
    ).toBe(true);
    expect(
      redirectTargetsService(policy, { metadata: { name: 'kube-dns', namespace: 'default' } })
    ).toBe(false);
    expect(
      redirectSelectsPod(policy, {
        metadata: {
          name: 'nld',
          namespace: 'kube-system',
          labels: { 'k8s-app': 'node-local-dns' },
        },
      })
    ).toBe(true);
    expect(
      redirectSelectsPod(policy, {
        metadata: { name: 'nld', namespace: 'default', labels: { 'k8s-app': 'node-local-dns' } },
      })
    ).toBe(false);
  });
});
