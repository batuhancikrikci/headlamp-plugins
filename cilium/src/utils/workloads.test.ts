import { describe, expect, it } from 'vitest';
import {
  labelOptions,
  Workload,
  workloadForSelector,
  workloadKey,
  workloadSelector,
} from './workloads';

const web: Workload = {
  kind: 'Deployment',
  name: 'web',
  namespace: 'shop',
  selector: { matchLabels: { app: 'web', tier: 'frontend' } },
};
const db: Workload = {
  kind: 'StatefulSet',
  name: 'db',
  namespace: 'data',
  selector: {
    matchLabels: { app: 'db' },
    matchExpressions: [{ key: 'role', operator: 'In', values: ['primary'] }],
  },
};

describe('workloadSelector', () => {
  it('uses the pod selector labels of the workload', () => {
    expect(workloadSelector(web, false)).toEqual({ matchLabels: { app: 'web', tier: 'frontend' } });
  });

  it('pins clusterwide policies to the namespace of the workload', () => {
    expect(workloadSelector(web, true)).toEqual({
      matchLabels: { app: 'web', tier: 'frontend', 'k8s:io.kubernetes.pod.namespace': 'shop' },
    });
  });

  it('keeps match expressions and does not share objects with the workload', () => {
    const selector = workloadSelector(db, false);
    expect(selector.matchExpressions).toEqual(db.selector.matchExpressions);
    selector.matchLabels!.extra = 'x';
    expect(db.selector.matchLabels).toEqual({ app: 'db' });
  });
});

describe('workloadForSelector', () => {
  it('finds the workload a selector came from', () => {
    expect(workloadForSelector(workloadSelector(web, false), [db, web], false)).toBe(web);
    expect(workloadForSelector(workloadSelector(db, true), [db, web], true)).toBe(db);
  });

  it('returns nothing for edited, empty or missing selectors', () => {
    expect(workloadForSelector({ matchLabels: { app: 'web' } }, [web], false)).toBeUndefined();
    expect(workloadForSelector({ matchLabels: {} }, [web], false)).toBeUndefined();
    expect(workloadForSelector(undefined, [web], false)).toBeUndefined();
  });

  it('builds distinct keys', () => {
    expect(workloadKey(web)).toBe('Deployment/shop/web');
  });
});

describe('labelOptions', () => {
  it('counts distinct labels, most common first, without derived labels', () => {
    expect(
      labelOptions([
        {
          app: 'web',
          tier: 'frontend',
          'pod-template-hash': 'abc',
          'io.kubernetes.pod.namespace': 'shop',
        },
        { app: 'web', tier: 'frontend', 'pod-template-hash': 'abc' },
        { app: 'api', tier: 'backend', 'io.cilium.k8s.policy.serviceaccount': 'api' },
      ])
    ).toEqual([
      { key: 'app', value: 'web', count: 2 },
      { key: 'tier', value: 'frontend', count: 2 },
      { key: 'app', value: 'api', count: 1 },
      { key: 'tier', value: 'backend', count: 1 },
    ]);
    expect(labelOptions([])).toEqual([]);
  });
});
