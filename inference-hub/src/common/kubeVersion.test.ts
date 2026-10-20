import { describe, expect, it } from 'vitest';
import { bareVersion, compareKubeVersions, orderVersions } from './kubeVersion';

describe('compareKubeVersions', () => {
  it('orders GA > beta > alpha and higher numbers first', () => {
    const versions = ['v1alpha1', 'v1beta1', 'v2', 'v1', 'v1alpha2', 'v2beta1'];
    expect([...versions].sort(compareKubeVersions)).toEqual([
      'v2',
      'v1',
      'v2beta1',
      'v1beta1',
      'v1alpha2',
      'v1alpha1',
    ]);
  });

  it('accepts group versions', () => {
    expect(compareKubeVersions('g.io/v1', 'g.io/v1alpha1')).toBeLessThan(0);
  });

  it('sorts unknown formats after Kubernetes versions, alphabetically', () => {
    expect(compareKubeVersions('foo', 'v1alpha1')).toBeGreaterThan(0);
    expect(compareKubeVersions('foo', 'bar')).toBeGreaterThan(0);
  });
});

describe('orderVersions', () => {
  it('keeps the preferred version first', () => {
    expect(orderVersions(['g/v1', 'g/v1alpha1'], 'g/v1alpha1')).toEqual(['g/v1alpha1', 'g/v1']);
    expect(orderVersions(['v1alpha1', 'v1'])).toEqual(['v1', 'v1alpha1']);
  });
});

describe('bareVersion', () => {
  it('strips the group', () => {
    expect(bareVersion('cilium.io/v2')).toBe('v2');
    expect(bareVersion('v1')).toBe('v1');
  });
});
