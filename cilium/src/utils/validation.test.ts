import { describe, expect, it } from 'vitest';
import { KubeJson } from '../resources/types';
import { newResource } from './templates';
import {
  isValidASN,
  isValidFQDNName,
  isValidFQDNPattern,
  isValidPolicyPort,
  validatePolicyRule,
  validateResource,
} from './validation';

/** Messages with their placeholders filled in, for readable assertions. */
function messages(json: KubeJson): string[] {
  return validateResource(json).map(e =>
    e.key.replace(/{{\s*(\w+)\s*}}/g, (_, name) => String(e.params?.[name] ?? ''))
  );
}

function resource(kind: string, spec: object, extra: Partial<KubeJson> = {}): KubeJson {
  const base = newResource(kind, 'cilium.io/v2');
  return { ...base, metadata: { ...base.metadata, name: 'test' }, spec, ...extra };
}

describe('field validators', () => {
  it('validates policy ports, ASNs and DNS names', () => {
    for (const ok of ['80', '0', '65535', 'http', 'dns-tcp'])
      expect(isValidPolicyPort(ok)).toBe(true);
    for (const bad of ['', '65536', '-1', 'has space', undefined])
      expect(isValidPolicyPort(bad)).toBe(false);
    expect(isValidASN(65000)).toBe(true);
    expect(isValidASN(4294967295)).toBe(true);
    expect(isValidASN(0)).toBe(false);
    expect(isValidASN(4294967296)).toBe(false);
    expect(isValidFQDNName('api.example.com')).toBe(true);
    expect(isValidFQDNName('*.example.com')).toBe(false);
    expect(isValidFQDNPattern('*.example.com')).toBe(true);
    expect(isValidFQDNPattern('bad pattern')).toBe(false);
  });
});

describe('metadata', () => {
  it('requires a valid name and a namespace for namespaced kinds', () => {
    expect(messages(newResource('CiliumCIDRGroup', 'cilium.io/v2'))).toContain(
      'A name is required'
    );
    const bad = resource('CiliumNetworkPolicy', { endpointSelector: {} });
    bad.metadata = { name: 'Not_Valid' };
    const found = messages(bad);
    expect(found.some(m => m.startsWith('The name must consist'))).toBe(true);
    expect(found).toContain('A namespace is required');
    // Cluster-scoped kinds do not need a namespace.
    expect(messages(resource('CiliumCIDRGroup', { externalCIDRs: ['10.0.0.0/8'] }))).toEqual([]);
  });
});

describe('network policies', () => {
  it('accepts a typical policy', () => {
    expect(
      messages(
        resource('CiliumNetworkPolicy', {
          endpointSelector: { matchLabels: { app: 'api' } },
          ingress: [
            {
              fromEndpoints: [{ matchLabels: { app: 'web' } }],
              toPorts: [
                {
                  ports: [{ port: '8080', protocol: 'TCP' }],
                  rules: { http: [{ method: 'GET' }] },
                },
              ],
            },
          ],
          egress: [
            {
              toFQDNs: [{ matchName: 'api.example.com' }],
              toPorts: [{ ports: [{ port: '443' }] }],
            },
            { toCIDRSet: [{ cidr: '10.0.0.0/8', except: ['10.96.0.0/12'] }] },
          ],
        })
      )
    ).toEqual([]);
  });

  it('requires a subject and restricts node selectors to clusterwide policies', () => {
    expect(validatePolicyRule({}, false).map(e => e.key)).toContain(
      '{{prefix}}An endpoint selector is required'
    );
    expect(validatePolicyRule({ nodeSelector: {} }, false).map(e => e.key)).toContain(
      '{{prefix}}Node selectors are only allowed in clusterwide policies'
    );
    expect(validatePolicyRule({ nodeSelector: {} }, true)).toEqual([]);
    expect(validatePolicyRule({ nodeSelector: {}, endpointSelector: {} }, true)).toHaveLength(1);
    expect(messages(resource('CiliumNetworkPolicy', undefined as unknown as object))).toContain(
      'The policy needs a rule (spec)'
    );
  });

  it('reports rule problems with their location', () => {
    const found = messages(
      resource('CiliumNetworkPolicy', {
        endpointSelector: {},
        ingress: [{ fromCIDR: ['10.0.0.0/33'], toPorts: [{ ports: [{ port: '99999' }] }] }],
        ingressDeny: [{ toPorts: [{ ports: [{ port: '80' }], rules: { http: [{}] } }] }],
        egress: [
          { toFQDNs: [{ matchName: 'example.com' }], toEntities: ['world'] },
          { toCIDRSet: [{ cidr: '10.0.0.0/8', except: ['192.168.0.0/16'] }] },
          { toEntities: ['internet'], toPorts: [{ ports: [{ port: '80', endPort: 70 }] }] },
        ],
      })
    );
    expect(found).toContain('ingress rule #1: "10.0.0.0/33" is not a valid CIDR');
    expect(found).toContain('ingress rule #1: "99999" is not a valid port (number or named port)');
    expect(found).toContain('ingress deny rule #1: deny rules cannot have L7 rules');
    expect(found).toContain(
      'egress rule #1: FQDN destinations cannot be combined with other destinations in the same rule'
    );
    expect(found).toContain(
      'egress rule #2: the exception 192.168.0.0/16 is not inside 10.0.0.0/8'
    );
    expect(found).toContain('egress rule #3: "internet" is not a known entity');
    expect(found).toContain('egress rule #3: the end port must be greater than the start port 80');
  });

  it('validates every entry of specs', () => {
    const found = messages(
      resource('CiliumClusterwideNetworkPolicy', undefined as unknown as object, {
        specs: [{ endpointSelector: {} }, {}],
      })
    );
    expect(found).toEqual(['Rule set #2: Select either endpoints or nodes']);
  });
});

describe('BGP', () => {
  it('validates cluster configs', () => {
    expect(
      messages(
        resource('CiliumBGPClusterConfig', {
          bgpInstances: [
            {
              name: 'a',
              localASN: 65000,
              peers: [
                {
                  name: 'tor',
                  peerAddress: '10.0.0.1',
                  peerASN: 65001,
                  peerConfigRef: { name: 'pc' },
                },
              ],
            },
          ],
        })
      )
    ).toEqual([]);
    const found = messages(
      resource('CiliumBGPClusterConfig', {
        bgpInstances: [
          { name: 'a', localASN: 0, peers: [{ name: 'p', peerAddress: 'nope' }, { name: 'p' }] },
          { name: 'a' },
        ],
      })
    );
    expect(found).toContain('Instance a: the local ASN must be between 1 and 4294967295');
    expect(found).toContain('Peer p: "nope" is not a valid IP address');
    expect(found).toContain('Instance a: peer name "p" is used twice');
    expect(found).toContain('Peer p: a peer address is required');
    expect(found).toContain('BGP instance name "a" is used twice');
    expect(messages(resource('CiliumBGPClusterConfig', {}))).toContain(
      'Add at least one BGP instance'
    );
  });

  it('validates peer configs and advertisements', () => {
    expect(
      messages(
        resource('CiliumBGPPeerConfig', {
          timers: { holdTimeSeconds: 9, keepAliveTimeSeconds: 9 },
          ebgpMultihop: 300,
          families: [
            { afi: 'ipv4', safi: 'unicast' },
            { afi: 'ipv4', safi: 'unicast' },
          ],
        })
      )
    ).toEqual([
      'The keepalive time must be lower than the hold time',
      'The eBGP multihop TTL must be between 1 and 255',
      'Address family ipv4/unicast is listed twice',
    ]);
    const found = messages(
      resource('CiliumBGPAdvertisement', {
        advertisements: [
          { advertisementType: 'Service' },
          { advertisementType: 'Interface' },
          {
            advertisementType: 'PodCIDR',
            attributes: { communities: { standard: ['bad'], large: ['1:2'] } },
          },
        ],
      })
    );
    expect(found).toContain('Advertisement #1: choose which service addresses to advertise');
    expect(found.some(m => m.startsWith('Advertisement #1: a service selector is required'))).toBe(
      true
    );
    expect(found).toContain('Advertisement #2: an interface name is required');
    expect(found).toContain('Advertisement #3: "bad" is not a standard community (ASN:value)');
    expect(found).toContain('Advertisement #3: "1:2" is not a large community (ASN:value:value)');
  });
});

describe('load balancing and IPAM', () => {
  it('validates LB IP pool blocks', () => {
    expect(
      messages(
        resource('CiliumLoadBalancerIPPool', {
          blocks: [
            { cidr: '192.168.10.0/24' },
            { start: '10.0.0.1', stop: '10.0.0.9' },
            { start: '10.0.0.20' },
          ],
        })
      )
    ).toEqual([]);
    const found = messages(
      resource('CiliumLoadBalancerIPPool', {
        blocks: [
          { cidr: 'x' },
          { start: '10.0.0.9', stop: '10.0.0.1' },
          {},
          { cidr: '10.0.0.0/24', start: '10.0.0.1' },
        ],
      })
    );
    expect(found).toContain('Block #1: "x" is not a valid CIDR');
    expect(found).toContain('Block #2: the stop address must not be lower than the start address');
    expect(found).toContain('Block #3 needs either a CIDR or a start address');
    expect(found).toContain('Block #4 needs either a CIDR or a start address');
    expect(messages(resource('CiliumLoadBalancerIPPool', {}))).toContain(
      'Add at least one IP block'
    );
  });

  it('validates L2 announcement policies and pod IP pools', () => {
    expect(
      messages(resource('CiliumL2AnnouncementPolicy', { interfaces: ['^eth[0-9]+'] }))
    ).toEqual(['Announce LoadBalancer IPs, external IPs or both']);
    expect(
      messages(
        resource('CiliumL2AnnouncementPolicy', { loadBalancerIPs: true, interfaces: ['eth('] })
      )
    ).toEqual(['"eth(" is not a valid interface expression']);
    expect(
      messages(resource('CiliumPodIPPool', { ipv4: { cidrs: ['10.20.0.0/16'], maskSize: 27 } }))
    ).toEqual([]);
    expect(
      messages(resource('CiliumPodIPPool', { ipv4: { cidrs: ['10.20.0.0/24'], maskSize: 16 } }))
    ).toEqual(['IPv4: the mask size /16 is larger than the pool CIDR 10.20.0.0/24']);
    expect(
      messages(resource('CiliumPodIPPool', { ipv6: { cidrs: ['10.0.0.0/8'], maskSize: 64 } }))
    ).toEqual(['IPv6: "10.0.0.0/8" is not a valid IPv6 CIDR']);
    expect(messages(resource('CiliumPodIPPool', {}))).toEqual([
      'Configure an IPv4 pool, an IPv6 pool or both',
    ]);
  });
});

describe('egress and redirects', () => {
  it('validates egress gateway policies', () => {
    expect(
      messages(
        resource('CiliumEgressGatewayPolicy', {
          selectors: [{ podSelector: { matchLabels: { app: 'web' } } }],
          destinationCIDRs: ['0.0.0.0/0'],
          egressGateway: {
            nodeSelector: { matchLabels: { role: 'egress' } },
            egressIP: '192.168.1.5',
          },
        })
      )
    ).toEqual([]);
    const found = messages(
      resource('CiliumEgressGatewayPolicy', {
        selectors: [{}],
        destinationCIDRs: [],
        egressGateway: { nodeSelector: {}, interface: 'eth1', egressIP: 'fd00::1' },
      })
    );
    expect(found).toContain('Selector #1: a pod or namespace selector is required');
    expect(found).toContain('Add at least one destination CIDR');
    expect(found).toContain('Gateway: set either an interface or an egress IP, not both');
    expect(found).toContain('Gateway: the egress IP must be an IPv4 address');
    expect(
      messages(
        resource('CiliumEgressGatewayPolicy', {
          selectors: [{ podSelector: {} }],
          destinationCIDRs: ['0.0.0.0/0'],
        })
      )
    ).toEqual(['Gateway: a gateway node selector is required']);
  });

  it('validates local redirect policies', () => {
    const valid = resource('CiliumLocalRedirectPolicy', {
      redirectFrontend: {
        addressMatcher: { ip: '169.254.20.10', toPorts: [{ port: '53', protocol: 'UDP' }] },
      },
      redirectBackend: {
        localEndpointSelector: { matchLabels: { app: 'dns' } },
        toPorts: [{ port: '53', protocol: 'UDP' }],
      },
    });
    expect(messages(valid)).toEqual([]);
    const found = messages(
      resource('CiliumLocalRedirectPolicy', {
        redirectFrontend: {
          addressMatcher: { ip: 'x', toPorts: [{ port: '53' }, { port: '54' }] },
        },
        redirectBackend: { toPorts: [] },
      })
    );
    expect(found).toContain('Frontend: a valid IP address is required');
    expect(found).toContain('Frontend: ports need names when there is more than one');
    expect(found).toContain('Backend: an endpoint selector is required');
    expect(found).toContain('Backend: add at least one port');
  });
});

describe('other kinds', () => {
  it('validates node configs, CIDR groups and Envoy configs', () => {
    expect(
      messages(resource('CiliumNodeConfig', { nodeSelector: {}, defaults: { mtu: '1450' } }))
    ).toEqual([]);
    expect(messages(resource('CiliumNodeConfig', { nodeSelector: {} }))).toEqual([
      'Add at least one configuration override',
    ]);
    expect(
      messages(resource('CiliumCIDRGroup', { externalCIDRs: ['10.0.0.0/8', 'nope'] }))
    ).toEqual(['"nope" is not a valid CIDR (external CIDR)']);
    expect(
      messages(
        resource('CiliumEnvoyConfig', {
          services: [{ name: 'web' }],
          resources: [
            { '@type': 'type.googleapis.com/envoy.config.listener.v3.Listener', name: 'l' },
          ],
        })
      )
    ).toEqual([]);
    expect(
      messages(resource('CiliumClusterwideEnvoyConfig', { resources: [{ name: 'l' }] }))
    ).toEqual(['Envoy resource #1 needs an "@type"']);
  });

  it('only checks metadata for kinds without a validator', () => {
    expect(messages(resource('CiliumBGPPeeringPolicy', {}))).toEqual([]);
  });

  it('reports identical problems once', () => {
    const found = messages(resource('CiliumCIDRGroup', { externalCIDRs: ['nope', 'nope'] }));
    expect(found).toHaveLength(1);
  });
});
