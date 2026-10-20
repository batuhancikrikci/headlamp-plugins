import { describe, expect, it } from 'vitest';
import type { Condition } from '../../resources/common';
import { collectIssues, healthCounts, healthOf, providerMix, ResourceLike } from './overview';

const accepted: Condition[] = [{ type: 'Accepted', status: 'True' }];
const rejected: Condition[] = [
  { type: 'Accepted', status: 'False', reason: 'Invalid', message: 'bad spec' },
];

function res(name: string, spec: Record<string, unknown> = {}, conditions = accepted) {
  return { metadata: { name, namespace: 'ai' }, spec, conditions } as unknown as ResourceLike;
}

const route = (name: string, backendRefs: Array<Record<string, unknown>>, conditions = accepted) =>
  res(name, { rules: [{ backendRefs }] }, conditions);

describe('healthOf', () => {
  it('classifies conditions', () => {
    expect(healthOf(accepted)).toBe('accepted');
    expect(healthOf(rejected)).toBe('rejected');
    expect(healthOf([{ type: 'NotAccepted', status: 'True' }])).toBe('rejected');
    expect(healthOf([])).toBe('pending');
    expect(healthOf(undefined)).toBe('pending');
  });
});

describe('healthCounts', () => {
  it('counts per state', () => {
    expect(healthCounts([res('a'), res('b', {}, rejected), res('c', {}, [])])).toEqual({
      total: 3,
      accepted: 1,
      rejected: 1,
      pending: 1,
    });
    expect(healthCounts(null).total).toBe(0);
  });
});

describe('collectIssues', () => {
  it('reports nothing for a consistent setup', () => {
    expect(
      collectIssues({
        routes: [route('r', [{ name: 'openai', modelNameOverride: 'gpt-4o' }])],
        backends: [res('openai')],
        securityPolicies: [
          res('key', { targetRefs: [{ kind: 'AIServiceBackend', name: 'openai' }] }),
        ],
        quotaPolicies: [
          res('q', {
            targetRefs: [{ kind: 'AIServiceBackend', name: 'openai' }],
            perModelQuotas: [{ modelName: 'gpt-4o' }],
          }),
        ],
      })
    ).toEqual([]);
  });

  it('reports rejected resources with the controller message, errors first', () => {
    const issues = collectIssues({
      routes: [route('r', [{ name: 'a' }])],
      backends: [res('a'), res('unused'), res('broken', {}, rejected)],
    });
    expect(issues[0]).toMatchObject({
      severity: 'error',
      kind: 'AIServiceBackend',
      name: 'broken',
      namespace: 'ai',
      message: 'bad spec',
    });
    expect(issues.filter(i => i.severity === 'warning').map(i => i.name)).toEqual([
      'unused',
      'broken',
    ]);
  });

  it('flags routes that point at a missing Service Backend, ignoring InferencePools', () => {
    const issues = collectIssues({
      routes: [
        route('r', [
          { name: 'gone' },
          { name: 'pool', group: 'inference.networking.k8s.io', kind: 'InferencePool' },
        ]),
      ],
      backends: [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('"gone"');
    expect(issues[0].severity).toBe('error');
  });

  it('resolves cross-namespace backend references', () => {
    const other = { ...res('shared'), metadata: { name: 'shared', namespace: 'platform' } };
    expect(
      collectIssues({
        routes: [route('r', [{ name: 'shared', namespace: 'platform' }])],
        backends: [other],
      })
    ).toEqual([]);
  });

  it('does not judge references while the backend list is unavailable', () => {
    expect(collectIssues({ routes: [route('r', [{ name: 'a' }])], backends: null })).toEqual([]);
    expect(collectIssues({ routes: null, backends: [res('a')] })).toEqual([]);
  });

  it('flags a second Security Policy on the same backend and missing targets', () => {
    const target = { targetRefs: [{ kind: 'AIServiceBackend', name: 'a' }] };
    const issues = collectIssues({
      backends: [res('a')],
      securityPolicies: [
        res('first', target),
        res('second', target),
        res('orphan', { targetRefs: [{ kind: 'AIServiceBackend', name: 'gone' }] }),
      ],
    });
    expect(issues.map(i => [i.severity, i.name])).toEqual([
      ['error', 'second'],
      ['warning', 'orphan'],
    ]);
    expect(issues[0].message).toContain('"first"');
  });

  it('flags model quotas that no route override matches', () => {
    const issues = collectIssues({
      routes: [route('r', [{ name: 'a', modelNameOverride: 'gpt-4o' }])],
      backends: [res('a')],
      quotaPolicies: [
        res('q', {
          targetRefs: [{ kind: 'AIServiceBackend', name: 'a' }],
          perModelQuotas: [{ modelName: 'gpt-4o' }, { modelName: 'gpt-5' }],
        }),
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('"gpt-5"');
    expect(issues[0].message).not.toContain('"gpt-4o"');
  });

  it('flags a resource without status only when its kind reports status elsewhere', () => {
    const issues = collectIssues({
      routes: [route('ok', []), route('waiting', [], [])],
      gatewayConfigs: [res('cfg', {}, [])],
    });
    expect(issues.map(i => i.name)).toEqual(['waiting']);
  });

  it('reports a single controller warning when nothing has a status', () => {
    const issues = collectIssues({ routes: [route('a', [], []), route('b', [], [])] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'controller/no-status', severity: 'warning' });
    expect(issues[0].kind).toBeUndefined();
  });
});

describe('providerMix', () => {
  it('counts backends per schema, most used first', () => {
    expect(
      providerMix([
        res('a', { schema: { name: 'OpenAI' } }),
        res('b', { schema: { name: 'Anthropic' } }),
        res('c', { schema: { name: 'OpenAI' } }),
      ])
    ).toEqual([
      ['OpenAI', 2],
      ['Anthropic', 1],
    ]);
    expect(providerMix(null)).toEqual([]);
  });
});
