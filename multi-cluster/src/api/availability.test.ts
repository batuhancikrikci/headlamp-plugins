import { describe, expect, it } from 'vitest';
import { compareKubeVersions } from '../common/kubeVersion';
import {
  APIResource,
  buildAvailability,
  chooseVersion,
  chosenApiVersion,
  isHub,
  kindState,
} from './availability';
import { GROUPS, kindMeta } from './kinds';

const res = (name: string, kind: string, namespaced = true): APIResource => ({
  name,
  kind,
  namespaced,
  verbs: ['get', 'list', 'watch', 'create'],
});

/** Discovery of an OCM v1.3.1 hub (addon APIs served as v1alpha1 and v1beta1). */
function hubV13() {
  return buildAvailability(
    {
      [GROUPS.cluster]: ['v1', 'v1beta1', 'v1beta2', 'v1alpha1'],
      [GROUPS.addon]: ['v1alpha1', 'v1beta1'],
      [GROUPS.work]: ['v1', 'v1alpha1'],
    },
    {
      [`${GROUPS.cluster}/v1`]: [
        res('managedclusters', 'ManagedCluster', false),
        res('managedclusters/status', 'ManagedCluster', false),
      ],
      [`${GROUPS.cluster}/v1beta2`]: [
        res('managedclustersets', 'ManagedClusterSet', false),
        res('managedclustersetbindings', 'ManagedClusterSetBinding'),
      ],
      [`${GROUPS.cluster}/v1beta1`]: [
        res('placements', 'Placement'),
        res('placementdecisions', 'PlacementDecision'),
      ],
      [`${GROUPS.cluster}/v1alpha1`]: [res('addonplacementscores', 'AddOnPlacementScore')],
      [`${GROUPS.addon}/v1alpha1`]: [
        res('managedclusteraddons', 'ManagedClusterAddOn'),
        res('clustermanagementaddons', 'ClusterManagementAddOn', false),
        res('addontemplates', 'AddOnTemplate', false),
      ],
      [`${GROUPS.addon}/v1beta1`]: [
        res('managedclusteraddons', 'ManagedClusterAddOn'),
        res('clustermanagementaddons', 'ClusterManagementAddOn', false),
      ],
      [`${GROUPS.work}/v1`]: [res('manifestworks', 'ManifestWork')],
      [`${GROUPS.work}/v1alpha1`]: [res('manifestworkreplicasets', 'ManifestWorkReplicaSet')],
    }
  );
}

/** Discovery of an OCM v0.14.0 hub (addon APIs served as v1alpha1 only). */
function hubV014() {
  return buildAvailability(
    { [GROUPS.cluster]: ['v1', 'v1beta2'], [GROUPS.addon]: ['v1alpha1'] },
    {
      [`${GROUPS.cluster}/v1`]: [res('managedclusters', 'ManagedCluster', false)],
      [`${GROUPS.cluster}/v1beta2`]: [res('managedclustersets', 'ManagedClusterSet', false)],
      [`${GROUPS.addon}/v1alpha1`]: [
        res('clustermanagementaddons', 'ClusterManagementAddOn', false),
        res('managedclusteraddons', 'ManagedClusterAddOn'),
      ],
    }
  );
}

describe('compareKubeVersions', () => {
  it('orders GA > beta > alpha and higher numbers first', () => {
    const sorted = ['v1alpha1', 'v1beta1', 'v1', 'v1beta2', 'v2alpha1'].sort(compareKubeVersions);
    expect(sorted).toEqual(['v1', 'v1beta2', 'v1beta1', 'v2alpha1', 'v1alpha1']);
  });
});

describe('chooseVersion', () => {
  it('prefers the most stable supported version', () => {
    expect(chooseVersion(['v1alpha1', 'v1beta1'], ['v1beta1', 'v1alpha1'])).toBe('v1beta1');
  });
  it('falls back to an older supported version', () => {
    expect(chooseVersion(['v1alpha1'], ['v1beta1', 'v1alpha1'])).toBe('v1alpha1');
  });
  it('ignores served versions the plugin does not support', () => {
    expect(chooseVersion(['v2', 'v1beta2'], ['v1beta2'])).toBe('v1beta2');
    expect(chooseVersion(['v2'], ['v1beta2'])).toBeUndefined();
  });
});

describe('buildAvailability', () => {
  it('uses addon v1beta1 on OCM v1.2+ hubs', () => {
    const a = hubV13();
    expect(chosenApiVersion(a, kindMeta('ClusterManagementAddOn'))).toBe(`${GROUPS.addon}/v1beta1`);
    expect(chosenApiVersion(a, kindMeta('ManagedClusterAddOn'))).toBe(`${GROUPS.addon}/v1beta1`);
    // AddOnTemplate is only served as v1alpha1.
    expect(chosenApiVersion(a, kindMeta('AddOnTemplate'))).toBe(`${GROUPS.addon}/v1alpha1`);
  });

  it('falls back to addon v1alpha1 on OCM v0.14 hubs', () => {
    const a = hubV014();
    expect(chosenApiVersion(a, kindMeta('ClusterManagementAddOn'))).toBe(
      `${GROUPS.addon}/v1alpha1`
    );
  });

  it('reports served versions in priority order and ignores subresources', () => {
    const state = kindState(hubV13(), kindMeta('ManagedClusterAddOn'));
    expect(state).toMatchObject({ status: 'available', served: ['v1beta1', 'v1alpha1'] });
    expect(kindState(hubV13(), kindMeta('ManagedCluster'))).toMatchObject({ served: ['v1'] });
  });

  it('marks kinds that are not served as missing', () => {
    expect(kindState(hubV014(), kindMeta('Placement')).status).toBe('missing');
    expect(kindState(hubV014(), kindMeta('Subscription')).status).toBe('missing');
    expect(chosenApiVersion(hubV014(), kindMeta('Subscription'))).toBeUndefined();
  });

  it('marks kinds served only in unknown versions as unsupported', () => {
    const a = buildAvailability(
      { [GROUPS.cluster]: ['v1beta1'] },
      { [`${GROUPS.cluster}/v1beta1`]: [res('managedclustersets', 'ManagedClusterSet', false)] }
    );
    expect(kindState(a, kindMeta('ManagedClusterSet'))).toEqual({
      status: 'unsupported',
      served: ['v1beta1'],
    });
  });

  it('detects whether the cluster is a hub', () => {
    expect(isHub(hubV13())).toBe(true);
    const spoke = buildAvailability(
      { [GROUPS.cluster]: ['v1alpha1'] },
      { [`${GROUPS.cluster}/v1alpha1`]: [res('clusterclaims', 'ClusterClaim', false)] }
    );
    expect(isHub(spoke)).toBe(false);
    expect(isHub(undefined)).toBe(false);
  });
});
