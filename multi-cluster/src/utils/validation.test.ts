import { describe, expect, it } from 'vitest';
import { KubeJson } from '../resources/models/common';
import { newResource } from './templates';
import { validateResource } from './validation';

const keys = (json: KubeJson) => validateResource(json).map(e => e.key);

describe('validateResource', () => {
  it('requires a name and, for namespaced kinds, a namespace', () => {
    const p = newResource('Placement', 'cluster.open-cluster-management.io/v1beta1');
    expect(keys(p)).toEqual(expect.arrayContaining(['Name is required', 'Namespace is required']));
  });

  it('requires DNS labels for managed cluster names', () => {
    const mc = newResource('ManagedCluster', 'cluster.open-cluster-management.io/v1');
    mc.metadata.name = 'my.cluster';
    expect(keys(mc)[0]).toMatch(/DNS label/);
    mc.metadata.name = 'my-cluster';
    expect(keys(mc)).toEqual([]);
  });

  it('checks that a binding is named after its cluster set', () => {
    const b = newResource(
      'ManagedClusterSetBinding',
      'cluster.open-cluster-management.io/v1beta2',
      'apps'
    );
    b.metadata.name = 'prod';
    b.spec = { clusterSet: 'dev' };
    expect(keys(b)).toEqual(['The binding name must equal the cluster set name ("{{set}}")']);
  });

  it('validates placement prioritizers, tolerations and selectors', () => {
    const p: KubeJson = {
      apiVersion: 'cluster.open-cluster-management.io/v1beta1',
      kind: 'Placement',
      metadata: { name: 'p', namespace: 'apps' },
      spec: {
        prioritizerPolicy: {
          configurations: [{ scoreCoordinate: { type: 'BuiltIn', builtIn: 'Nope' }, weight: 20 }],
        },
        tolerations: [{ key: 'k', operator: 'Exists', value: 'v' }],
        predicates: [
          {
            requiredClusterSelector: {
              labelSelector: { matchExpressions: [{ key: 'env', operator: 'In', values: [] }] },
            },
          },
        ],
      },
    };
    const errors = keys(p);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Prioritizer {{n}}: choose a built-in prioritizer',
        'Prioritizer {{n}}: weight must be between -10 and 10',
        'Toleration {{n}}: Exists must not have a value',
        '{{where}}: "{{key}}" with operator {{op}} needs at least one value',
      ])
    );
  });

  it('requires manifests in works and placement references in replica sets', () => {
    const mwrs = newResource(
      'ManifestWorkReplicaSet',
      'work.open-cluster-management.io/v1alpha1',
      'apps'
    );
    mwrs.metadata.name = 'r';
    expect(keys(mwrs)).toEqual(
      expect.arrayContaining([
        'Placement {{n}}: name is required',
        '{{prefix}}Add at least one manifest',
      ])
    );
  });

  it('validates subscriptions, channels and GitOps clusters', () => {
    const sub: KubeJson = {
      apiVersion: 'apps.open-cluster-management.io/v1',
      kind: 'Subscription',
      metadata: { name: 's', namespace: 'a' },
      spec: { channel: 'nope' },
    };
    expect(keys(sub)).toEqual(['Channel must be written as "namespace/name"']);
    const ch: KubeJson = {
      apiVersion: 'apps.open-cluster-management.io/v1',
      kind: 'Channel',
      metadata: { name: 'c', namespace: 'a' },
      spec: { type: 'Git', pathname: 'github.com/x' },
    };
    expect(keys(ch)).toEqual([
      'The repository URL must start with https://, http://, ssh:// or git@',
    ]);
    const g = newResource('GitOpsCluster', 'apps.open-cluster-management.io/v1beta1', 'argocd');
    g.metadata.name = 'g';
    expect(keys(g)).toEqual(['Argo CD namespace is required', 'Choose a placement']);
    g.spec.placementRef = {
      kind: 'PlacementRule',
      apiVersion: 'apps.open-cluster-management.io/v1',
      name: 'p',
    };
    g.spec.argoServer.argoNamespace = 'argocd';
    expect(keys(g)).toEqual([
      'The placement reference must have kind Placement',
      'The placement reference must use apiVersion cluster.open-cluster-management.io/v1beta1',
    ]);
  });

  it('validates add-on configs per version', () => {
    const beta: KubeJson = {
      apiVersion: 'addon.open-cluster-management.io/v1beta1',
      kind: 'ClusterManagementAddOn',
      metadata: { name: 'x' },
      spec: { defaultConfigs: [{ resource: 'addondeploymentconfigs' }] },
    };
    expect(keys(beta)).toEqual(['{{where}} {{n}}: name is required']);
    const alpha = {
      ...beta,
      apiVersion: 'addon.open-cluster-management.io/v1alpha1',
      spec: { supportedConfigs: [{ resource: 'addondeploymentconfigs' }] },
    };
    expect(keys(alpha)).toEqual([]);
  });
});

describe('policy rules of the propagator webhook', () => {
  const base = (spec: KubeJson['spec'], name = 'p', ns = 'policies'): KubeJson => ({
    apiVersion: 'policy.open-cluster-management.io/v1',
    kind: 'Policy',
    metadata: { name, namespace: ns },
    spec,
  });
  const cfg = (remediation?: string) => ({
    objectDefinition: {
      apiVersion: 'policy.open-cluster-management.io/v1',
      kind: 'ConfigurationPolicy',
      metadata: { name: 'c' },
      spec: {
        ...(remediation ? { remediationAction: remediation } : {}),
        'object-templates': [
          {
            complianceType: 'musthave',
            objectDefinition: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'x' } },
          },
        ],
      },
    },
  });

  it('requires a remediation on the policy or on each template', () => {
    expect(keys(base({ 'policy-templates': [cfg()] }))).toEqual([
      'Template {{n}}: set a remediation on the template or on the policy',
    ]);
    expect(keys(base({ remediationAction: 'inform', 'policy-templates': [cfg()] }))).toEqual([]);
    expect(keys(base({ 'policy-templates': [cfg('enforce')] }))).toEqual([]);
  });

  it('limits namespace + name to 62 characters', () => {
    expect(
      keys(
        base(
          { remediationAction: 'inform', 'policy-templates': [cfg()] },
          'a'.repeat(40),
          'b'.repeat(23)
        )
      )
    ).toEqual(['The policy namespace and name together cannot exceed 62 characters']);
  });
});
