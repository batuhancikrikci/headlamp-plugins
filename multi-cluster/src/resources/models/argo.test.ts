import { describe, expect, it } from 'vitest';
import type { ArgoApplicationSetJson } from './argo';
import {
  appSetIsPull,
  appSetPlacements,
  appsOfAppSet,
  ArgoApplicationJson,
  argoHealth,
  buildApplicationSet,
  clusterSecretInfo,
  destinationCluster,
  gitOpsConsistency,
  isPullModel,
  refreshPatch,
  serverHost,
  syncPatch,
  withAppSetModel,
} from './argo';

const secret = (name: string, labels: Record<string, string>) =>
  clusterSecretInfo({ metadata: { name, namespace: 'argocd', labels } });

const ocmSecret = (cluster: string, server: string) =>
  secret(`${cluster}-cluster-secret`, {
    'argocd.argoproj.io/secret-type': 'cluster',
    'apps.open-cluster-management.io/acm-cluster': 'true',
    'apps.open-cluster-management.io/cluster-name': cluster,
    'apps.open-cluster-management.io/cluster-server': server,
  });

const app = (extra: Partial<ArgoApplicationJson>): ArgoApplicationJson => ({
  apiVersion: 'argoproj.io/v1alpha1',
  kind: 'Application',
  metadata: { name: 'a', namespace: 'argocd', ...(extra.metadata || {}) },
  spec: { project: 'default', destination: {}, ...(extra.spec || {}) },
});

describe('Argo CD statuses', () => {
  it('maps health codes', () => {
    expect(argoHealth('Healthy')).toBe('success');
    expect(argoHealth('Degraded')).toBe('error');
    expect(argoHealth('Progressing')).toBe('unknown');
  });
});

describe('cluster secrets and destinations', () => {
  const secrets = [ocmSecret('c1', 'api.c1.example.com'), ocmSecret('c2', 'c2-control-plane')];

  it('reads secret metadata without touching the data', () => {
    expect(secrets[0]).toEqual({
      name: 'c1-cluster-secret',
      namespace: 'argocd',
      cluster: 'c1',
      serverLabel: 'api.c1.example.com',
      ocmManaged: true,
    });
  });

  it('resolves destinations by cluster name, server host or pull annotation', () => {
    expect(
      destinationCluster(app({ spec: { project: 'p', destination: { name: 'c1' } } }), secrets)
    ).toBe('c1');
    expect(
      destinationCluster(
        app({ spec: { project: 'p', destination: { server: 'https://api.c1.example.com:6443' } } }),
        secrets
      )
    ).toBe('c1');
    const pull = app({
      metadata: {
        name: 'a',
        namespace: 'argocd',
        labels: { 'apps.open-cluster-management.io/pull-to-ocm-managed-cluster': 'true' },
        annotations: { 'apps.open-cluster-management.io/ocm-managed-cluster': 'c2' },
      },
      spec: { project: 'p', destination: { server: 'https://kubernetes.default.svc' } },
    });
    expect(isPullModel(pull)).toBe(true);
    expect(destinationCluster(pull, secrets)).toBe('c2');
    expect(
      destinationCluster(
        app({ spec: { project: 'p', destination: { server: 'https://kubernetes.default.svc' } } }),
        secrets
      )
    ).toBeUndefined();
  });

  it('strips scheme and port like the GitOps controller', () => {
    expect(serverHost('https://api.x.io:6443')).toBe('api.x.io');
  });
});

describe('gitOpsConsistency', () => {
  it('finds decided clusters without secrets, stale secrets and foreign secrets', () => {
    const secrets = [
      ocmSecret('a', 'a'),
      ocmSecret('old', 'old'),
      secret('b', {
        'argocd.argoproj.io/secret-type': 'cluster',
        'apps.open-cluster-management.io/cluster-name': 'b',
      }),
    ];
    expect(gitOpsConsistency(['a', 'b', 'c'], secrets)).toEqual({
      missing: ['b', 'c'],
      extra: ['old'],
      foreign: ['b'],
    });
  });
});

describe('ApplicationSet helpers', () => {
  const base = {
    name: 'guestbook',
    namespace: 'argocd',
    placement: 'prod',
    project: 'default',
    repoURL: 'https://github.com/argoproj/argocd-example-apps.git',
    path: 'guestbook',
    targetRevision: 'HEAD',
    destinationNamespace: 'guestbook',
    automated: true,
    prune: true,
    selfHeal: false,
    createNamespace: true,
  };

  it('builds a push-model ApplicationSet over the placement decisions', () => {
    const appset = buildApplicationSet({ ...base, model: 'push' });
    expect(appset.spec?.generators?.[0].clusterDecisionResource).toEqual({
      configMapRef: 'acm-placement',
      labelSelector: { matchLabels: { 'cluster.open-cluster-management.io/placement': 'prod' } },
      requeueAfterSeconds: 180,
    });
    expect(appset.spec?.template?.metadata).toEqual({ name: '{{name}}-guestbook' });
    expect(appset.spec?.template?.spec).toEqual({
      project: 'default',
      source: { repoURL: base.repoURL, path: 'guestbook', targetRevision: 'HEAD' },
      destination: { server: '{{server}}', namespace: 'guestbook' },
      syncPolicy: { automated: { prune: true }, syncOptions: ['CreateNamespace=true'] },
    });
    expect(appSetPlacements(appset)).toEqual([{ name: 'prod', configMapRef: 'acm-placement' }]);
    expect(appSetIsPull(appset)).toBe(false);
  });

  it('routes argocd-agent applications by destination name with the pull-integration ConfigMap', () => {
    const appset = buildApplicationSet({
      ...base,
      model: 'agent',
      configMapRef: 'ocm-placement-generator',
    });
    expect(appset.spec?.template?.spec?.destination).toEqual({
      name: '{{name}}',
      namespace: 'guestbook',
    });
    expect(appset.spec?.generators?.[0].clusterDecisionResource?.configMapRef).toBe(
      'ocm-placement-generator'
    );
    expect(appSetIsPull(appset)).toBe(false);
  });

  it('marks the template for the pull model', () => {
    const appset = buildApplicationSet({
      ...base,
      model: 'pull',
      automated: false,
      createNamespace: false,
    });
    expect(appSetIsPull(appset)).toBe(true);
    expect(appset.spec?.template?.metadata?.annotations).toEqual({
      'apps.open-cluster-management.io/ocm-managed-cluster': '{{name}}',
      'argocd.argoproj.io/skip-reconcile': 'true',
    });
    expect(appset.spec?.template?.spec?.destination.server).toBe('https://kubernetes.default.svc');
    expect(appset.spec?.template?.spec?.syncPolicy).toBeUndefined();
  });

  it('finds the applications an ApplicationSet owns', () => {
    const appset = buildApplicationSet({ ...base, model: 'push' });
    const owned = app({
      metadata: {
        name: 'c1-guestbook',
        namespace: 'argocd',
        ownerReferences: [{ kind: 'ApplicationSet', name: 'guestbook' }],
      },
    });
    expect(appsOfAppSet(appset, [owned, app({})])).toEqual([owned]);
  });
});

describe('actions', () => {
  it('builds refresh and sync patches', () => {
    expect(refreshPatch('hard')).toEqual({
      metadata: { annotations: { 'argocd.argoproj.io/refresh': 'hard' } },
    });
    expect(syncPatch({ revision: 'main', prune: true })).toEqual({
      operation: { initiatedBy: { username: 'headlamp' }, sync: { revision: 'main', prune: true } },
    });
  });
});

describe('withAppSetModel', () => {
  it('switches between push and pull without losing other template metadata', () => {
    const push: ArgoApplicationSetJson = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'ApplicationSet',
      metadata: { name: 's', namespace: 'argocd' },
      spec: {
        template: {
          metadata: { name: '{{name}}-s', labels: { team: 'a' } },
          spec: {
            project: 'default',
            source: { repoURL: 'r' },
            destination: { name: '{{name}}', namespace: 'x' },
          },
        },
      },
    };
    const pull = withAppSetModel(push, 'pull');
    expect(appSetIsPull(pull)).toBe(true);
    expect(pull.spec?.template?.metadata?.labels).toEqual({
      team: 'a',
      'apps.open-cluster-management.io/pull-to-ocm-managed-cluster': 'true',
    });
    expect(pull.spec?.template?.spec?.destination).toEqual({
      server: 'https://kubernetes.default.svc',
      namespace: 'x',
    });
    const back = withAppSetModel(pull, 'push');
    expect(back.spec?.template?.metadata).toEqual({ name: '{{name}}-s', labels: { team: 'a' } });
    expect(back.spec?.template?.spec?.destination).toEqual({
      server: '{{server}}',
      namespace: 'x',
    });
  });
});
