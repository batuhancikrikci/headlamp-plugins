import { compareKubeVersions, orderVersions } from '../common/kubeVersion';
import { relevantGroupVersions, resolveResources } from './discovery';

describe('kube version ordering', () => {
  it('orders GA > beta > alpha and by number', () => {
    const sorted = ['v1alpha1', 'v1beta1', 'v1', 'v1alpha2', 'v2beta1'].sort(compareKubeVersions);
    expect(sorted).toEqual(['v1', 'v2beta1', 'v1beta1', 'v1alpha2', 'v1alpha1']);
  });

  it('puts the preferred version first', () => {
    expect(orderVersions(['v1alpha1', 'v1alpha2'], 'v1alpha1')).toEqual(['v1alpha1', 'v1alpha2']);
  });
});

describe('relevantGroupVersions', () => {
  it('keeps only Inference Hub groups, preferred version first', () => {
    const groups = relevantGroupVersions({
      groups: [
        { name: 'apps', versions: [{ groupVersion: 'apps/v1', version: 'v1' }] },
        {
          name: 'serving.kserve.io',
          versions: [
            { groupVersion: 'serving.kserve.io/v1beta1', version: 'v1beta1' },
            { groupVersion: 'serving.kserve.io/v1alpha1', version: 'v1alpha1' },
            { groupVersion: 'serving.kserve.io/v1alpha2', version: 'v1alpha2' },
          ],
          preferredVersion: { groupVersion: 'serving.kserve.io/v1beta1', version: 'v1beta1' },
        },
      ],
    });
    expect(Object.keys(groups)).toEqual(['serving.kserve.io']);
    expect(groups['serving.kserve.io']).toEqual(['v1beta1', 'v1alpha2', 'v1alpha1']);
  });
});

describe('resolveResources', () => {
  const kserveGroups = { 'serving.kserve.io': ['v1beta1', 'v1alpha2', 'v1alpha1'] };
  const kserveLists = {
    'serving.kserve.io/v1beta1': { resources: [{ name: 'inferenceservices' }] },
    'serving.kserve.io/v1alpha2': {
      resources: [{ name: 'llminferenceservices' }, { name: 'llminferenceservices/status' }],
    },
    'serving.kserve.io/v1alpha1': {
      resources: [
        { name: 'llminferenceservices' },
        { name: 'localmodelcaches' },
        { name: 'servingruntimes' },
      ],
    },
  };

  it('uses the highest priority version that serves each resource', () => {
    const result = resolveResources(kserveGroups, kserveLists);
    expect(result.inferenceservices).toEqual([
      { group: 'serving.kserve.io', version: 'v1beta1', apiVersion: 'serving.kserve.io/v1beta1' },
    ]);
    expect(result.llminferenceservices?.[0].version).toBe('v1alpha2');
    expect(result.localmodelcaches?.[0].version).toBe('v1alpha1');
    expect(result.llminferenceserviceconfigs).toBeUndefined();
  });

  it('finds a kind in every candidate group, preferred group first', () => {
    const result = resolveResources(
      {
        'inference.networking.x-k8s.io': ['v1alpha2'],
        'inference.networking.k8s.io': ['v1'],
        'llm-d.ai': ['v1alpha2'],
      },
      {
        'inference.networking.x-k8s.io/v1alpha2': {
          resources: [{ name: 'inferencepools' }, { name: 'inferenceobjectives' }],
        },
        'inference.networking.k8s.io/v1': { resources: [{ name: 'inferencepools' }] },
        'llm-d.ai/v1alpha2': { resources: [{ name: 'inferenceobjectives' }] },
      }
    );
    // Pools only come from the GA group, even when the experimental group serves them too.
    expect(result.inferencepools?.map(l => l.apiVersion)).toEqual([
      'inference.networking.k8s.io/v1',
    ]);
    expect(result.inferenceobjectives?.map(l => l.group)).toEqual([
      'llm-d.ai',
      'inference.networking.x-k8s.io',
    ]);
  });

  it('tolerates unreadable resource lists', () => {
    const result = resolveResources(kserveGroups, { 'serving.kserve.io/v1beta1': undefined });
    expect(result).toEqual({});
  });
});
