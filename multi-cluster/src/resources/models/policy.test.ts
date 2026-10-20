import { describe, expect, it } from 'vitest';
import {
  bindingsOf,
  bindingsOfPlacement,
  clusterCompliance,
  configurationPolicyTemplate,
  isReplicatedPolicy,
  operatorPolicyTemplate,
  placementBinding,
  PolicyJson,
  remediationOf,
  replicasOf,
  rootPolicyOf,
  toPolicyGenerator,
} from './policy';

const G = 'policy.open-cluster-management.io';

const root: PolicyJson = {
  apiVersion: `${G}/v1`,
  kind: 'Policy',
  metadata: {
    name: 'require.labels',
    namespace: 'policies',
    annotations: {
      [`${G}/standards`]: 'NIST SP 800-53',
      [`${G}/categories`]: 'CM Configuration Management',
    },
  },
  spec: {
    disabled: false,
    remediationAction: 'Enforce',
    'policy-templates': [
      configurationPolicyTemplate({
        name: 'ns-labels',
        remediationAction: 'inform',
        severity: 'low',
        complianceType: 'musthave',
        objects: [
          {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: { name: 'prod', labels: { team: 'a' } },
          },
        ],
        namespaceInclude: ['prod'],
      }),
    ],
  },
  status: {
    compliant: 'NonCompliant',
    status: [
      { clustername: 'c1', clusternamespace: 'c1', compliant: 'Compliant' },
      { clustername: 'c2', clusternamespace: 'c2', compliant: 'NonCompliant' },
      { clustername: 'c3', clusternamespace: 'c3' },
    ],
  },
};

const replica: PolicyJson = {
  apiVersion: `${G}/v1`,
  kind: 'Policy',
  metadata: {
    name: 'policies.require.labels',
    namespace: 'c1',
    labels: { [`${G}/root-policy`]: 'policies.require.labels' },
  },
};

describe('root and replicated policies', () => {
  it('parses the root policy label (the first "." separates namespace and name)', () => {
    expect(isReplicatedPolicy(replica)).toBe(true);
    expect(isReplicatedPolicy(root)).toBe(false);
    expect(rootPolicyOf(replica)).toEqual({ namespace: 'policies', name: 'require.labels' });
    expect(replicasOf(root, [replica, root])).toEqual([replica]);
  });

  it('counts compliance per cluster and normalizes the remediation', () => {
    expect(clusterCompliance(root)).toEqual({
      total: 3,
      compliant: 1,
      nonCompliant: 1,
      pending: 0,
      unknown: 1,
    });
    expect(remediationOf(root)).toBe('enforce');
    expect(remediationOf({ spec: {} })).toBeUndefined();
  });
});

describe('templates', () => {
  it('builds a ConfigurationPolicy template', () => {
    expect(root.spec?.['policy-templates']?.[0].objectDefinition).toEqual({
      apiVersion: `${G}/v1`,
      kind: 'ConfigurationPolicy',
      metadata: { name: 'ns-labels' },
      spec: {
        remediationAction: 'inform',
        severity: 'low',
        namespaceSelector: { include: ['prod'] },
        'object-templates': [
          {
            complianceType: 'musthave',
            objectDefinition: {
              apiVersion: 'v1',
              kind: 'Namespace',
              metadata: { name: 'prod', labels: { team: 'a' } },
            },
          },
        ],
      },
    });
  });

  it('builds an OperatorPolicy template', () => {
    const t = operatorPolicyTemplate({
      name: 'op',
      remediationAction: 'enforce',
      complianceType: 'musthave',
      packageName: 'cert-manager',
      namespace: 'cert-manager',
      channel: 'stable',
      upgradeApproval: 'Automatic',
    });
    expect(t.objectDefinition.spec).toEqual({
      remediationAction: 'enforce',
      complianceType: 'musthave',
      subscription: { name: 'cert-manager', namespace: 'cert-manager', channel: 'stable' },
      upgradeApproval: 'Automatic',
    });
  });
});

describe('bindings', () => {
  const direct = placementBinding('b1', 'policies', 'prod', [
    { kind: 'Policy', name: 'require.labels' },
  ]);
  const viaSet = placementBinding('b2', 'policies', 'dev', [
    { kind: 'PolicySet', name: 'baseline' },
  ]);
  const set = {
    apiVersion: `${G}/v1beta1`,
    kind: 'PolicySet',
    metadata: { name: 'baseline', namespace: 'policies' },
    spec: { policies: ['require.labels'] },
  };

  it('finds direct and policy-set bindings of a policy', () => {
    expect(bindingsOf(root, [direct, viaSet], [set]).map(b => b.metadata.name)).toEqual([
      'b1',
      'b2',
    ]);
    expect(bindingsOf(root, [direct, viaSet], []).map(b => b.metadata.name)).toEqual(['b1']);
  });

  it('finds the bindings of a placement', () => {
    expect(
      bindingsOfPlacement({ metadata: { name: 'dev', namespace: 'policies' } }, [direct, viaSet])
    ).toEqual([viaSet]);
  });

  it('writes the binding shape of the CRD', () => {
    expect(direct).toMatchObject({
      placementRef: {
        apiGroup: 'cluster.open-cluster-management.io',
        kind: 'Placement',
        name: 'prod',
      },
      subjects: [{ apiGroup: G, kind: 'Policy', name: 'require.labels' }],
    });
  });
});

describe('toPolicyGenerator', () => {
  it('exports an equivalent PolicyGenerator with one manifest file per template', () => {
    const out = toPolicyGenerator(root, 'prod');
    expect(out.generator).toEqual({
      apiVersion: `${G}/v1`,
      kind: 'PolicyGenerator',
      metadata: { name: 'require.labels-generator' },
      policyDefaults: {
        namespace: 'policies',
        placement: { placementName: 'prod' },
        remediationAction: 'enforce',
        standards: ['NIST SP 800-53'],
        categories: ['CM Configuration Management'],
      },
      policies: [
        {
          name: 'require.labels',
          manifests: [
            {
              path: 'input/require.labels/ns-labels.yaml',
              name: 'ns-labels',
              complianceType: 'musthave',
              severity: 'low',
              remediationAction: 'inform',
              namespaceSelector: { include: ['prod'] },
            },
          ],
        },
      ],
    });
    expect(out.manifests).toEqual([
      {
        path: 'input/require.labels/ns-labels.yaml',
        objects: [
          {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: { name: 'prod', labels: { team: 'a' } },
          },
        ],
      },
    ]);
  });
});
