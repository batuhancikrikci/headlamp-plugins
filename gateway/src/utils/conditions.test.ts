import { describe, expect, it } from 'vitest';
import { Condition } from '../resources/types';
import {
  computeHealth,
  conditionsHealth,
  countHealth,
  evaluateConditions,
  formatParentRef,
  listenerHealth,
  reasonHint,
  tallyCondition,
} from './conditions';

function condition(
  type: string,
  status: Condition['status'],
  reason = type,
  extra = {}
): Condition {
  return { type, status, reason, message: `${type} is ${status}`, ...extra };
}

describe('evaluateConditions', () => {
  it('reports nothing when every expected condition is True', () => {
    expect(
      evaluateConditions([condition('Accepted', 'True'), condition('Programmed', 'True')], {
        expected: ['Accepted', 'Programmed'],
      })
    ).toEqual([]);
  });

  it('treats False as an error and Unknown as pending', () => {
    const problems = evaluateConditions(
      [condition('Accepted', 'False', 'InvalidParameters'), condition('Programmed', 'Unknown')],
      { expected: [] }
    );
    expect(problems.map(p => `${p.type}:${p.level}`)).toEqual([
      'Accepted:error',
      'Programmed:pending',
    ]);
  });

  it('treats the Pending reason as pending even when the status is False', () => {
    const problems = evaluateConditions([condition('Programmed', 'False', 'Pending')], {
      expected: [],
    });
    expect(problems[0].level).toBe('pending');
  });

  it('reports missing expected conditions as pending', () => {
    const problems = evaluateConditions([], { expected: ['Accepted'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ level: 'pending', type: 'Accepted' });
  });

  it('understands negative-polarity conditions', () => {
    expect(evaluateConditions([condition('Conflicted', 'False')], { expected: [] })).toEqual([]);
    expect(evaluateConditions([condition('Conflicted', 'True')], { expected: [] })[0].level).toBe(
      'error'
    );
    expect(
      evaluateConditions([condition('PartiallyInvalid', 'True')], { expected: [] })[0].level
    ).toBe('warning');
  });

  it('flags conditions that observed an older generation as stale', () => {
    const problems = evaluateConditions(
      [condition('Accepted', 'True', 'Accepted', { observedGeneration: 2 })],
      { expected: ['Accepted'], generation: 3 }
    );
    expect(problems[0]).toMatchObject({ level: 'pending', reason: 'Stale' });
  });

  it('warns when Accepted is True but listeners are not valid (Envoy Gateway)', () => {
    const problems = evaluateConditions([condition('Accepted', 'True', 'ListenersNotValid')], {
      expected: ['Accepted'],
    });
    expect(problems[0].level).toBe('warning');
  });
});

describe('computeHealth', () => {
  it('reports a programmed Gateway as healthy', () => {
    const health = computeHealth({
      kind: 'Gateway',
      metadata: { generation: 1 },
      status: {
        conditions: [condition('Accepted', 'True'), condition('Programmed', 'True')],
        listeners: [
          {
            name: 'http',
            attachedRoutes: 1,
            conditions: [condition('Programmed', 'True'), condition('ResolvedRefs', 'True')],
          },
        ],
      },
    });
    expect(health).toEqual({ level: 'healthy', label: 'Programmed', problems: [] });
  });

  it('reports a Gateway without an address as not programmed', () => {
    const health = computeHealth({
      kind: 'Gateway',
      status: {
        conditions: [
          condition('Accepted', 'True'),
          condition('Programmed', 'False', 'AddressNotAssigned'),
        ],
      },
    });
    expect(health.level).toBe('error');
    expect(health.label).toBe('Not programmed');
    expect(health.problems[0].reason).toBe('AddressNotAssigned');
  });

  it('includes listener problems in the Gateway health, scoped to the listener', () => {
    const health = computeHealth({
      kind: 'Gateway',
      status: {
        conditions: [condition('Accepted', 'True'), condition('Programmed', 'True')],
        listeners: [
          {
            name: 'https',
            attachedRoutes: 0,
            conditions: [condition('ResolvedRefs', 'False', 'InvalidCertificateRef')],
          },
        ],
      },
    });
    expect(health.level).toBe('error');
    expect(health.label).toBe('Unresolved refs');
    expect(health.problems[0].scope).toBe('Listener https');
  });

  it('reports the default "Waiting for controller" status as pending', () => {
    const health = computeHealth({
      kind: 'GatewayClass',
      status: { conditions: [condition('Accepted', 'Unknown', 'Pending')] },
    });
    expect(health.level).toBe('pending');
    expect(health.label).toBe('Pending');
  });

  it('evaluates routes per parent', () => {
    const health = computeHealth({
      kind: 'HTTPRoute',
      metadata: { namespace: 'apps' },
      spec: { parentRefs: [{ name: 'eg' }, { name: 'other' }] },
      status: {
        parents: [
          {
            parentRef: { name: 'eg' },
            controllerName: 'example.com/controller',
            conditions: [condition('Accepted', 'True'), condition('ResolvedRefs', 'True')],
          },
          {
            parentRef: { name: 'other', namespace: 'infra', sectionName: 'https' },
            controllerName: 'example.com/controller',
            conditions: [
              condition('Accepted', 'False', 'NotAllowedByListeners'),
              condition('ResolvedRefs', 'True'),
            ],
          },
        ],
      },
    });
    expect(health.level).toBe('error');
    expect(health.label).toBe('Not accepted');
    expect(health.problems).toHaveLength(1);
    expect(health.problems[0].scope).toBe('Parent infra/other/https');
  });

  it('reports a route without status as pending, and explains missing parentRefs', () => {
    expect(
      computeHealth({ kind: 'HTTPRoute', spec: { parentRefs: [{ name: 'eg' }] } })
    ).toMatchObject({ level: 'pending', label: 'Pending' });
    expect(computeHealth({ kind: 'TCPRoute', spec: {} })).toMatchObject({
      level: 'pending',
      label: 'No parents',
    });
  });

  it('evaluates policies per ancestor', () => {
    const health = computeHealth({
      kind: 'BackendTLSPolicy',
      status: {
        ancestors: [
          {
            ancestorRef: { name: 'eg' },
            controllerName: 'example.com/controller',
            conditions: [condition('Accepted', 'False', 'NoValidCACertificate')],
          },
        ],
      },
    });
    expect(health.level).toBe('error');
    expect(health.problems[0].scope).toBe('Ancestor eg');
  });

  it('has no health for kinds without status', () => {
    expect(computeHealth({ kind: 'ReferenceGrant' }).level).toBe('none');
    expect(computeHealth(null).level).toBe('none');
  });

  it('survives malformed status', () => {
    expect(computeHealth({ kind: 'Gateway', status: 'broken' }).level).toBe('pending');
    expect(computeHealth({ kind: 'HTTPRoute', status: { parents: 'nope' } }).level).toBe('pending');
  });
});

describe('listenerHealth and conditionsHealth', () => {
  it('reports a missing listener status as pending', () => {
    expect(listenerHealth(undefined).level).toBe('pending');
  });

  it('reports a conflicted listener', () => {
    const health = listenerHealth({
      name: 'http',
      attachedRoutes: 0,
      conditions: [
        condition('Accepted', 'True'),
        condition('Programmed', 'False', 'Invalid'),
        condition('Conflicted', 'True', 'HostnameConflict'),
      ],
    });
    expect(health.level).toBe('error');
    expect(health.problems.map(p => p.type)).toEqual(['Programmed', 'Conflicted']);
  });

  it('labels healthy conditions with the first expected type', () => {
    expect(conditionsHealth([condition('Accepted', 'True')], ['Accepted']).label).toBe('Accepted');
  });
});

describe('summaries', () => {
  const objects = [
    {
      kind: 'Gateway',
      status: { conditions: [condition('Accepted', 'True'), condition('Programmed', 'True')] },
    },
    {
      kind: 'Gateway',
      status: { conditions: [condition('Accepted', 'True'), condition('Programmed', 'False')] },
    },
    { kind: 'Gateway' },
    { kind: 'ReferenceGrant' },
  ];

  it('counts objects per health level', () => {
    expect(countHealth(objects)).toEqual({
      total: 4,
      healthy: 1,
      warning: 0,
      error: 1,
      pending: 1,
      none: 1,
    });
  });

  it('tallies a condition type across objects and route parents', () => {
    expect(tallyCondition(objects, 'Programmed')).toEqual({
      type: 'Programmed',
      true: 1,
      false: 1,
      unknown: 0,
    });
    const route = {
      kind: 'HTTPRoute',
      status: {
        parents: [
          {
            parentRef: { name: 'a' },
            controllerName: 'c',
            conditions: [condition('Accepted', 'True')],
          },
          {
            parentRef: { name: 'b' },
            controllerName: 'c',
            conditions: [condition('Accepted', 'False')],
          },
        ],
      },
    };
    expect(tallyCondition([route], 'Accepted')).toMatchObject({ true: 1, false: 1 });
  });
});

describe('formatting', () => {
  it('formats parent references', () => {
    expect(formatParentRef({ name: 'eg' }, 'default')).toBe('default/eg');
    expect(
      formatParentRef({ name: 'eg', namespace: 'infra', sectionName: 'https', port: 443 })
    ).toBe('infra/eg/https:443');
    expect(formatParentRef({ name: 'ls', kind: 'ListenerSet' }, 'apps')).toBe(
      'ListenerSet apps/ls'
    );
    expect(formatParentRef(undefined)).toBe('');
  });

  it('explains well-known reasons', () => {
    expect(reasonHint('RefNotPermitted')).toContain('ReferenceGrant');
    expect(reasonHint('SomethingCustom')).toBeUndefined();
    expect(reasonHint(undefined)).toBeUndefined();
  });
});
