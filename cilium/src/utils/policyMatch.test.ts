import { describe, expect, it } from 'vitest';
import {
  expectedEnforcement,
  parseIdentityLabels,
  policySelectsSubject,
  referencedCIDRGroups,
  ruleDefaultDeny,
  selectorMatchesSubject,
  subjectFromIdentityLabels,
  subjectFromPod,
} from './policyMatch';

const web = subjectFromPod(
  {
    metadata: { name: 'web-1', namespace: 'shop', labels: { app: 'web' } },
    spec: { serviceAccountName: 'web' },
  },
  { team: 'retail' }
);
const db = subjectFromPod({ metadata: { name: 'db-1', namespace: 'data', labels: { app: 'db' } } });

describe('endpoint subjects', () => {
  it('derives namespace, namespace-label and service account labels for pods', () => {
    expect(web.labels).toMatchObject({
      app: 'web',
      'io.kubernetes.pod.namespace': 'shop',
      'io.cilium.k8s.namespace.labels.team': 'retail',
      'io.cilium.k8s.policy.serviceaccount': 'web',
    });
  });

  it('parses identity labels of a CiliumEndpoint', () => {
    expect(
      parseIdentityLabels([
        'k8s:app=web',
        'k8s:io.kubernetes.pod.namespace=shop',
        'reserved:health',
        'k8s:empty=',
      ])
    ).toEqual({
      app: 'web',
      'io.kubernetes.pod.namespace': 'shop',
      'reserved:health': '',
      empty: '',
    });
    expect(
      subjectFromIdentityLabels('shop', ['k8s:app=web']).labels['io.kubernetes.pod.namespace']
    ).toBe('shop');
  });
});

describe('policy selection', () => {
  it('limits a namespaced policy to its own namespace', () => {
    const policy = {
      kind: 'CiliumNetworkPolicy',
      metadata: { name: 'p', namespace: 'shop' },
      spec: { endpointSelector: {} },
    };
    expect(policySelectsSubject(policy, web)).toBe(true);
    expect(policySelectsSubject(policy, db)).toBe(false);
  });

  it('lets a clusterwide policy select endpoints in any namespace', () => {
    const policy = {
      kind: 'CiliumClusterwideNetworkPolicy',
      metadata: { name: 'p' },
      spec: { endpointSelector: { matchLabels: { app: 'db' } } },
    };
    expect(policySelectsSubject(policy, db)).toBe(true);
    expect(policySelectsSubject(policy, web)).toBe(false);
  });

  it('supports namespace labels in clusterwide selectors', () => {
    const policy = {
      kind: 'CiliumClusterwideNetworkPolicy',
      metadata: { name: 'p' },
      spec: {
        endpointSelector: { matchLabels: { 'k8s:io.cilium.k8s.namespace.labels.team': 'retail' } },
      },
    };
    expect(policySelectsSubject(policy, web)).toBe(true);
    expect(policySelectsSubject(policy, db)).toBe(false);
  });

  it('never selects pods with host policies and evaluates every entry of specs', () => {
    expect(
      policySelectsSubject(
        {
          kind: 'CiliumClusterwideNetworkPolicy',
          metadata: { name: 'host' },
          spec: { nodeSelector: {} },
        },
        web
      )
    ).toBe(false);
    expect(
      policySelectsSubject(
        {
          kind: 'CiliumNetworkPolicy',
          metadata: { name: 'multi', namespace: 'shop' },
          specs: [
            { endpointSelector: { matchLabels: { app: 'api' } } },
            { endpointSelector: { matchLabels: { app: 'web' } } },
          ],
        },
        web
      )
    ).toBe(true);
  });

  it('scopes peer selectors of namespaced policies unless they name a namespace', () => {
    expect(selectorMatchesSubject({ matchLabels: { app: 'db' } }, 'shop', db)).toBe(false);
    expect(
      selectorMatchesSubject(
        { matchLabels: { app: 'db', 'k8s:io.kubernetes.pod.namespace': 'data' } },
        'shop',
        db
      )
    ).toBe(true);
    expect(selectorMatchesSubject({ matchLabels: { app: 'db' } }, undefined, db)).toBe(true);
    expect(selectorMatchesSubject(undefined, undefined, db)).toBe(false);
  });
});

describe('default deny', () => {
  it('follows the rule directions and enableDefaultDeny', () => {
    expect(ruleDefaultDeny({ endpointSelector: {}, ingress: [{}] })).toEqual({
      ingress: true,
      egress: false,
    });
    expect(
      ruleDefaultDeny({ endpointSelector: {}, egressDeny: [{ toEntities: ['world'] }] })
    ).toEqual({
      ingress: false,
      egress: true,
    });
    expect(
      ruleDefaultDeny({
        endpointSelector: {},
        ingress: [{}],
        enableDefaultDeny: { ingress: false },
      })
    ).toEqual({ ingress: false, egress: false });
  });

  it('combines the policies that select an endpoint', () => {
    const policies = [
      {
        kind: 'CiliumNetworkPolicy',
        metadata: { name: 'a', namespace: 'shop' },
        spec: { endpointSelector: {}, ingress: [{}] },
      },
      {
        kind: 'CiliumNetworkPolicy',
        metadata: { name: 'b', namespace: 'data' },
        spec: { endpointSelector: {}, egress: [{}] },
      },
    ];
    expect(expectedEnforcement(policies, web)).toEqual({ ingress: true, egress: false });
  });
});

describe('referencedCIDRGroups', () => {
  it('collects group references from every rule list', () => {
    expect(
      referencedCIDRGroups({
        metadata: { name: 'p' },
        spec: {
          endpointSelector: {},
          ingress: [{ fromCIDRSet: [{ cidrGroupRef: 'offices' }, { cidr: '10.0.0.0/8' }] }],
          egressDeny: [{ toCIDRSet: [{ cidrGroupRef: 'blocked' }] }],
        },
      }).sort()
    ).toEqual(['blocked', 'offices']);
  });
});
