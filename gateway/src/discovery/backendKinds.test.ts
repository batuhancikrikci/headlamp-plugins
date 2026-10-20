import { describe, expect, it } from 'vitest';
import { DiscoveredGroup } from './availability';
import {
  backendKindsFrom,
  describeBackendObject,
  groupsFromAggregated,
  isKubernetesGroup,
} from './backendKinds';

const verbs = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'];

const GROUPS: DiscoveredGroup[] = [
  {
    group: 'gateway.envoyproxy.io',
    versions: [
      {
        version: 'v1alpha1',
        resources: [
          { name: 'backends', kind: 'Backend', namespaced: true, verbs },
          { name: 'backends/status', kind: 'Backend', namespaced: true, verbs: ['get'] },
          { name: 'securitypolicies', kind: 'SecurityPolicy', namespaced: true, verbs },
        ],
      },
    ],
  },
  {
    group: 'inference.networking.k8s.io',
    versions: [
      {
        version: 'v1',
        resources: [{ name: 'inferencepools', kind: 'InferencePool', namespaced: true, verbs }],
      },
    ],
  },
  {
    group: 'inference.networking.x-k8s.io',
    versions: [
      {
        version: 'v1alpha2',
        resources: [{ name: 'inferencepools', kind: 'InferencePool', namespaced: true, verbs }],
      },
    ],
  },
  {
    group: 'example.com',
    versions: [
      { version: 'v1beta1', resources: [{ name: 'backends', kind: 'Backend', verbs }] },
      { version: 'v1', resources: [{ name: 'backends', kind: 'Backend', verbs }] },
    ],
  },
  {
    group: 'cluster.example.com',
    versions: [
      {
        version: 'v1',
        resources: [{ name: 'backends', kind: 'Backend', namespaced: false, verbs }],
      },
    ],
  },
  {
    group: 'nolist.example.com',
    versions: [
      {
        version: 'v1',
        resources: [{ name: 'backends', kind: 'Backend', namespaced: true, verbs: ['get'] }],
      },
    ],
  },
];

describe('isKubernetesGroup', () => {
  it('accepts the core group and the Kubernetes project groups', () => {
    expect(isKubernetesGroup('')).toBe(true);
    expect(isKubernetesGroup('inference.networking.k8s.io')).toBe(true);
    expect(isKubernetesGroup('inference.networking.x-k8s.io')).toBe(true);
    expect(isKubernetesGroup('gateway.networking.k8s.io')).toBe(true);
  });

  it('rejects implementation groups, including look-alikes', () => {
    expect(isKubernetesGroup('gateway.envoyproxy.io')).toBe(false);
    expect(isKubernetesGroup('example.com')).toBe(false);
    expect(isKubernetesGroup('fakek8s.io')).toBe(false);
  });
});

describe('backendKindsFrom', () => {
  it('finds namespaced, listable Backend and InferencePool kinds of any group', () => {
    expect(backendKindsFrom(GROUPS)).toEqual([
      { group: 'example.com', kind: 'Backend', plural: 'backends', version: 'v1' },
      { group: 'gateway.envoyproxy.io', kind: 'Backend', plural: 'backends', version: 'v1alpha1' },
      {
        group: 'inference.networking.k8s.io',
        kind: 'InferencePool',
        plural: 'inferencepools',
        version: 'v1',
      },
      {
        group: 'inference.networking.x-k8s.io',
        kind: 'InferencePool',
        plural: 'inferencepools',
        version: 'v1alpha2',
      },
    ]);
  });

  it('skips cluster-scoped and non-listable kinds', () => {
    expect(backendKindsFrom(GROUPS.slice(4))).toEqual([]);
    expect(backendKindsFrom([])).toEqual([]);
  });
});

describe('groupsFromAggregated', () => {
  it('converts an APIGroupDiscoveryList', () => {
    const groups = groupsFromAggregated({
      kind: 'APIGroupDiscoveryList',
      items: [
        {
          metadata: { name: 'gateway.envoyproxy.io' },
          versions: [
            {
              version: 'v1alpha1',
              resources: [
                {
                  resource: 'backends',
                  responseKind: {
                    group: 'gateway.envoyproxy.io',
                    version: 'v1alpha1',
                    kind: 'Backend',
                  },
                  scope: 'Namespaced',
                  verbs,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(groups).not.toBeNull();
    expect(backendKindsFrom(groups!)).toEqual([
      { group: 'gateway.envoyproxy.io', kind: 'Backend', plural: 'backends', version: 'v1alpha1' },
    ]);
  });

  it('returns null for the legacy APIGroupList', () => {
    expect(groupsFromAggregated({ kind: 'APIGroupList', groups: [] })).toBeNull();
    expect(groupsFromAggregated(undefined)).toBeNull();
  });
});

describe('describeBackendObject', () => {
  it('lists the endpoints of a Backend', () => {
    expect(
      describeBackendObject({
        spec: {
          endpoints: [
            { fqdn: { hostname: 'api.example.com', port: 443 } },
            { ip: { address: '10.0.0.1', port: 8080 } },
            { unix: { path: '/var/run/app.sock' } },
          ],
        },
      })
    ).toBe('api.example.com:443, 10.0.0.1:8080, unix:/var/run/app.sock');
  });

  it('shows the target ports of an InferencePool', () => {
    expect(describeBackendObject({ spec: { targetPorts: [{ number: 8000 }] } })).toBe(
      'Target port 8000'
    );
    expect(describeBackendObject({ spec: { targetPortNumber: 8000 } })).toBe('Target port 8000');
  });

  it('is empty when there is nothing to show', () => {
    expect(describeBackendObject({})).toBe('');
    expect(describeBackendObject(null)).toBe('');
  });
});
