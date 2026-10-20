import { PromRuleGroup, PromTarget } from '../types';
import {
  isHelmManaged,
  requiredLabelsFor,
  ruleFileOwner,
  ruleGroupsForRule,
  serviceMonitorMatchesService,
  summarizeTargets,
  targetsForResource,
  workloadSelects,
} from './relations';

const prom = (spec: Record<string, unknown>) => ({
  metadata: { name: 'kps', namespace: 'monitoring' },
  spec,
});
const sm = (namespace: string, labels: Record<string, string> = {}) => ({
  metadata: { name: 'app', namespace, labels },
});

describe('workloadSelects', () => {
  it('selects nothing when the resource selector is nil', () => {
    expect(workloadSelects(prom({}), 'ServiceMonitor', sm('monitoring'))).toBe('not-selected');
  });

  it('limits nil namespace selector to the workload namespace', () => {
    const p = prom({ serviceMonitorSelector: {} });
    expect(workloadSelects(p, 'ServiceMonitor', sm('monitoring'))).toBe('selected');
    expect(workloadSelects(p, 'ServiceMonitor', sm('apps'))).toBe('not-selected');
  });

  it('selects every namespace with an empty namespace selector', () => {
    const p = prom({ serviceMonitorSelector: {}, serviceMonitorNamespaceSelector: {} });
    expect(workloadSelects(p, 'ServiceMonitor', sm('apps'))).toBe('selected');
  });

  it('applies the kube-prometheus-stack release label selector', () => {
    const p = prom({
      serviceMonitorSelector: { matchLabels: { release: 'kps' } },
      serviceMonitorNamespaceSelector: {},
    });
    expect(workloadSelects(p, 'ServiceMonitor', sm('apps', { release: 'kps' }))).toBe('selected');
    expect(workloadSelects(p, 'ServiceMonitor', sm('apps'))).toBe('not-selected');
  });

  it('uses namespace labels for label-based namespace selectors', () => {
    const p = prom({
      ruleSelector: {},
      ruleNamespaceSelector: { matchLabels: { monitored: 'true' } },
    });
    expect(workloadSelects(p, 'PrometheusRule', sm('apps'), null)).toBe('unknown');
    expect(workloadSelects(p, 'PrometheusRule', sm('apps'), { apps: { monitored: 'true' } })).toBe(
      'selected'
    );
    expect(workloadSelects(p, 'PrometheusRule', sm('apps'), { apps: {} })).toBe('not-selected');
  });
});

describe('serviceMonitorMatchesService', () => {
  const svc = { metadata: { name: 'web', namespace: 'apps', labels: { app: 'web' } } };

  it('matches selector within the monitor namespace by default', () => {
    expect(
      serviceMonitorMatchesService(
        { metadata: { namespace: 'apps' }, spec: { selector: { matchLabels: { app: 'web' } } } },
        svc
      )
    ).toBe(true);
    expect(
      serviceMonitorMatchesService(
        { metadata: { namespace: 'mon' }, spec: { selector: { matchLabels: { app: 'web' } } } },
        svc
      )
    ).toBe(false);
  });

  it('honours namespaceSelector.matchNames and any', () => {
    expect(
      serviceMonitorMatchesService(
        {
          metadata: { namespace: 'mon' },
          spec: { selector: {}, namespaceSelector: { matchNames: ['apps'] } },
        },
        svc
      )
    ).toBe(true);
    expect(
      serviceMonitorMatchesService(
        {
          metadata: { namespace: 'mon' },
          spec: { selector: { matchLabels: { app: 'db' } }, namespaceSelector: { any: true } },
        },
        svc
      )
    ).toBe(false);
  });
});

describe('targets', () => {
  const target = (scrapePool: string, health: PromTarget['health']): PromTarget => ({
    scrapePool,
    health,
    labels: {},
    scrapeUrl: '',
    lastError: '',
    lastScrape: '',
    lastScrapeDuration: 0,
  });
  const targets = [
    target('serviceMonitor/apps/web/0', 'up'),
    target('serviceMonitor/apps/web/1', 'down'),
    target('serviceMonitor/apps/web-2/0', 'up'),
    target('probe/apps/blackbox', 'up'),
  ];

  it('matches scrape pools exactly per resource', () => {
    expect(targetsForResource(targets, 'ServiceMonitor', 'apps', 'web')).toHaveLength(2);
    expect(targetsForResource(targets, 'Probe', 'apps', 'blackbox')).toHaveLength(1);
    expect(targetsForResource(targets, 'Probe', 'apps', 'black')).toHaveLength(0);
  });

  it('summarizes health', () => {
    expect(summarizeTargets(targets)).toEqual({ up: 3, down: 1, unknown: 0, total: 4 });
  });
});

describe('rule files', () => {
  const group = (file: string): PromRuleGroup => ({ name: 'g', file, interval: 30, rules: [] });
  const groups = [
    group('/etc/prometheus/rules/prometheus-kps-rulefiles-0/apps-alerts-1234.yaml'),
    group('/etc/prometheus/rules/prometheus-kps-rulefiles-0/apps-alerts-extra-5678.yaml'),
  ];

  it('matches by uid when known', () => {
    expect(ruleGroupsForRule(groups, 'apps', 'alerts', '1234')).toHaveLength(1);
  });

  it('resolves the owning PrometheusRule', () => {
    const rules = [{ metadata: { name: 'alerts-extra', namespace: 'apps', uid: '5678' } }];
    expect(ruleFileOwner(groups[1].file, rules)).toEqual({
      name: 'alerts-extra',
      namespace: 'apps',
    });
    expect(ruleFileOwner(groups[0].file, rules)).toBeNull();
  });
});

describe('helm helpers', () => {
  it('detects Helm managed objects and required labels', () => {
    expect(
      isHelmManaged({ metadata: { labels: { 'app.kubernetes.io/managed-by': 'Helm' } } })
    ).toBe(true);
    expect(isHelmManaged({ metadata: {} })).toBe(false);
    expect(
      requiredLabelsFor(
        prom({ serviceMonitorSelector: { matchLabels: { release: 'kps' } } }),
        'ServiceMonitor'
      )
    ).toEqual({
      release: 'kps',
    });
    expect(requiredLabelsFor(prom({}), 'ServiceMonitor')).toBeNull();
  });
});
