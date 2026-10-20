import { describe, expect, it } from 'vitest';
import { isNamespacedKind } from '../kinds';
import { familyLabel, peeringStateHealth, problemHealth } from './bgp';
import {
  blockLabel,
  egressGateways,
  envoyResourceKinds,
  poolHealth,
  poolUsage,
  redirectPortLabel,
} from './network';
import { policyFeatures, policyRules, policyValidity } from './policy';
import { addressList, endpointStateHealth, stripLabelSource } from './runtime';

describe('policy model', () => {
  it('reads rules from spec and specs', () => {
    expect(
      policyRules({ spec: { endpointSelector: {} }, specs: [{ nodeSelector: {} }] })
    ).toHaveLength(2);
    expect(policyRules({})).toEqual([]);
  });

  it('summarizes the features a policy uses', () => {
    const features = policyFeatures([
      {
        endpointSelector: {},
        ingress: [
          {
            fromEntities: ['cluster'],
            toPorts: [{ ports: [{ port: '80' }], rules: { http: [{}] } }],
          },
        ],
        egress: [
          { toFQDNs: [{ matchName: 'a.example.com' }] },
          { toCIDR: ['10.0.0.0/8'], icmps: [{ fields: [{ type: 8 }] }] },
        ],
        egressDeny: [{ toEntities: ['world'] }],
      },
      { nodeSelector: {}, ingress: [{ authentication: { mode: 'required' } }] },
    ]);
    expect(features).toEqual({
      ingressRules: 2,
      egressRules: 2,
      ingressDenyRules: 0,
      egressDenyRules: 1,
      l7: true,
      fqdn: true,
      entities: true,
      cidr: true,
      icmp: true,
      auth: true,
      hostPolicy: true,
    });
  });

  it('derives validity from the Valid condition', () => {
    expect(policyValidity([])).toMatchObject({ health: 'unknown' });
    expect(policyValidity([{ type: 'Valid', status: 'True' }])).toMatchObject({
      health: 'success',
      label: 'Valid',
    });
    expect(policyValidity([{ type: 'Valid', status: 'False', message: 'bad' }])).toEqual({
      health: 'error',
      label: 'Invalid',
      message: 'bad',
    });
  });
});

describe('runtime model', () => {
  it('lists addresses and maps endpoint states', () => {
    expect(
      addressList({ addressing: [{ ipv4: '10.0.0.1', ipv6: 'fd00::1' }, { ipv4: '10.0.0.2' }] })
    ).toEqual(['10.0.0.1', 'fd00::1', '10.0.0.2']);
    expect(endpointStateHealth('ready')).toBe('success');
    expect(endpointStateHealth('regenerating')).toBe('warning');
    expect(endpointStateHealth('not-ready')).toBe('error');
    expect(endpointStateHealth(undefined)).toBe('unknown');
    expect(stripLabelSource('k8s:app')).toBe('app');
    expect(stripLabelSource('reserved:host')).toBe('host');
  });
});

describe('BGP model', () => {
  it('treats true conditions as problems', () => {
    expect(problemHealth([])).toBe('unknown');
    expect(problemHealth([{ type: 'cilium.io/NoMatchingNode', status: 'False' }])).toBe('success');
    expect(problemHealth([{ type: 'cilium.io/MissingPeerConfigs', status: 'True' }])).toBe('error');
  });

  it('maps peering states', () => {
    expect(peeringStateHealth('established')).toBe('success');
    expect(peeringStateHealth('Active')).toBe('error');
    expect(peeringStateHealth('openconfirm')).toBe('warning');
    expect(peeringStateHealth(undefined)).toBe('unknown');
    expect(familyLabel({ afi: 'ipv4', safi: 'unicast' })).toBe('ipv4/unicast');
  });
});

describe('network model', () => {
  it('reads LB IPAM counters from condition messages', () => {
    const usage = poolUsage([
      { type: 'cilium.io/IPsTotal', status: 'Unknown', message: '10' },
      { type: 'cilium.io/IPsAvailable', status: 'Unknown', message: '0' },
      { type: 'cilium.io/IPsUsed', status: 'Unknown', message: '10' },
    ]);
    expect(usage).toEqual({
      total: 10,
      available: 0,
      used: 10,
      conflict: false,
      conflictMessage: undefined,
    });
    expect(poolHealth(usage)).toBe('warning');
    expect(poolHealth(poolUsage([]))).toBe('unknown');
    expect(
      poolHealth(poolUsage([{ type: 'cilium.io/PoolConflict', status: 'True', message: 'x' }]))
    ).toBe('error');
    expect(poolHealth({ total: 10, available: 5, used: 5, conflict: false }, true)).toBe('warning');
  });

  it('formats blocks, ports and Envoy resource kinds', () => {
    expect(blockLabel({ cidr: '10.0.0.0/24' })).toBe('10.0.0.0/24');
    expect(blockLabel({ start: '10.0.0.1', stop: '10.0.0.9' })).toBe('10.0.0.1 – 10.0.0.9');
    expect(blockLabel({ start: '10.0.0.1' })).toBe('10.0.0.1');
    expect(redirectPortLabel({ port: '53', protocol: 'UDP', name: 'dns' })).toBe('dns:53/UDP');
    expect(
      envoyResourceKinds([
        { '@type': 'type.googleapis.com/envoy.config.listener.v3.Listener' },
        { '@type': 'type.googleapis.com/envoy.config.cluster.v3.Cluster' },
        { '@type': 'type.googleapis.com/envoy.config.cluster.v3.Cluster' },
      ])
    ).toEqual({ Listener: 1, Cluster: 2 });
  });

  it('combines the single and the list form of egress gateways', () => {
    expect(
      egressGateways({
        egressGateway: { interface: 'eth0' },
        egressGateways: [{ egressIP: '1.2.3.4' }],
      })
    ).toHaveLength(2);
    expect(egressGateways(undefined)).toEqual([]);
  });
});

describe('kinds', () => {
  it('knows which kinds are namespaced', () => {
    expect(isNamespacedKind('CiliumNetworkPolicy')).toBe(true);
    expect(isNamespacedKind('CiliumEnvoyConfig')).toBe(true);
    expect(isNamespacedKind('CiliumClusterwideNetworkPolicy')).toBe(false);
    expect(isNamespacedKind('CiliumIdentity')).toBe(false);
  });
});
