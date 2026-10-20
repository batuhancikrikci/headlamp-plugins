import { describe, expect, it } from 'vitest';
import { flowSummary, policyView, portLabel, ruleView } from './policyView';

describe('ruleView', () => {
  it('describes peers, ports and L7 rules of an allow rule', () => {
    const view = ruleView(
      {
        endpointSelector: { matchLabels: { app: 'api' } },
        ingress: [
          {
            fromEndpoints: [{ matchLabels: { app: 'web' } }],
            toPorts: [
              {
                ports: [{ port: '8080', protocol: 'TCP' }],
                rules: { http: [{ method: 'GET', path: '/v1/.*' }] },
              },
            ],
          },
        ],
      },
      0
    );
    expect(view.subject).toEqual({ type: 'endpoints', selector: 'app=api', all: false });
    expect(view.defaultDeny).toEqual({ ingress: true, egress: false });
    expect(view.flows).toHaveLength(1);
    expect(view.flows[0]).toMatchObject({
      direction: 'ingress',
      action: 'allow',
      peers: [{ type: 'endpoints', label: 'app=web' }],
      ports: [{ label: 'TCP 8080' }],
      l7: [{ protocol: 'HTTP', label: 'GET /v1/.*' }],
    });
  });

  it('distinguishes the default-deny rule from an L4-only rule', () => {
    const view = ruleView(
      {
        endpointSelector: {},
        ingress: [{}],
        egress: [{ toPorts: [{ ports: [{ port: '53', protocol: 'UDP' }] }] }],
      },
      0
    );
    expect(view.subject.all).toBe(true);
    expect(view.flows[0].peers).toEqual([{ type: 'none', label: 'Nothing (default deny only)' }]);
    expect(view.flows[1].peers).toEqual([{ type: 'any', label: 'Any destination' }]);
  });

  it('covers entities, CIDR sets, FQDNs, services and deny rules', () => {
    const view = ruleView(
      {
        endpointSelector: {},
        egress: [
          { toFQDNs: [{ matchName: 'api.example.com' }, { matchPattern: '*.cdn.example.com' }] },
          {
            toEntities: ['kube-apiserver'],
            toCIDRSet: [
              { cidr: '10.0.0.0/8', except: ['10.96.0.0/12'] },
              { cidrGroupRef: 'offices' },
            ],
            toServices: [{ k8sService: { serviceName: 'db', namespace: 'data' } }],
          },
        ],
        egressDeny: [{ toEntities: ['world'] }],
      },
      2
    );
    // Deny rules are listed first because they take precedence.
    expect(view.flows.map(f => f.action)).toEqual(['deny', 'allow', 'allow']);
    expect(view.flows[1].peers.map(p => p.label)).toEqual(['api.example.com', '*.cdn.example.com']);
    expect(view.flows[2].peers).toEqual([
      { type: 'entity', label: 'kube-apiserver' },
      { type: 'cidr', label: '10.0.0.0/8', detail: 'except 10.96.0.0/12' },
      { type: 'cidrGroup', label: 'offices', ref: { kind: 'CiliumCIDRGroup', name: 'offices' } },
      {
        type: 'service',
        label: 'data/db',
        ref: { kind: 'Service', name: 'db', namespace: 'data' },
      },
    ]);
    expect(view.flows[0].id).toBe('2-egress-deny-0');
  });

  it('marks host policies and disabled default deny', () => {
    const view = ruleView(
      {
        nodeSelector: {},
        ingress: [{ fromEntities: ['cluster'] }],
        enableDefaultDeny: { ingress: false },
      },
      0
    );
    expect(view.subject.type).toBe('nodes');
    expect(view.defaultDeny.ingress).toBe(false);
  });
});

describe('helpers', () => {
  it('formats ports and summaries', () => {
    expect(portLabel({ port: '80', protocol: 'TCP' })).toBe('TCP 80');
    expect(portLabel({ port: '8000', endPort: 8080, protocol: 'TCP' })).toBe('TCP 8000-8080');
    expect(portLabel({ port: 'http' })).toBe('ANY http');
    const [view] = policyView([
      {
        endpointSelector: {},
        egress: [
          { toEntities: ['world'], toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }] }] },
        ],
      },
    ]);
    expect(flowSummary(view.flows[0])).toBe('Allow egress to world on TCP 443');
  });
});
