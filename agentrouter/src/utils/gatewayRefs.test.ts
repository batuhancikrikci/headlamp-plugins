import { describe, expect, it } from 'vitest';
import { gatewayRefsFromSpec, toParentRefs } from './gatewayRefs';

describe('gateway refs', () => {
  const refs = [
    { name: 'gw', sectionName: 'https' },
    { name: 'other', namespace: 'infra', kind: 'Gateway', group: 'gateway.networking.k8s.io' },
  ];

  it('round-trips unchanged parentRefs exactly', () => {
    expect(toParentRefs(gatewayRefsFromSpec(refs), 'ai')).toEqual(refs);
  });

  it('rebuilds edited rows and keeps unknown fields', () => {
    const rows = gatewayRefsFromSpec([{ name: 'gw', port: 443 }]);
    rows[0].sectionName = 'http';
    expect(toParentRefs(rows, 'ai')).toEqual([
      {
        name: 'gw',
        port: 443,
        group: 'gateway.networking.k8s.io',
        kind: 'Gateway',
        namespace: undefined,
        sectionName: 'http',
      },
    ]);
  });
});
