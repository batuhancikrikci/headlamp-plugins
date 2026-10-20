import { describe, expect, it } from 'vitest';
import { compareKubeVersions } from '../common/kubeVersion';
import { kindInfo, KINDS } from '../resources/registry';
import { GATEWAY_GROUP } from '../resources/types';
import {
  apiVersionFor,
  DiscoveredGroup,
  isKindAvailable,
  parseChannel,
  preferredVersion,
  resolveAvailability,
  sortKubeVersions,
} from './availability';

const verbs = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'];

function resources(...names: string[]) {
  return names.flatMap(name => [
    { name, verbs },
    { name: `${name}/status`, verbs: ['get', 'patch', 'update'] },
  ]);
}

/** Discovery of a cluster running the Gateway API v1.6 experimental channel. */
const V16_EXPERIMENTAL: DiscoveredGroup[] = [
  {
    group: GATEWAY_GROUP,
    preferredVersion: 'v1',
    versions: [
      {
        version: 'v1',
        resources: resources(
          'gatewayclasses',
          'gateways',
          'httproutes',
          'grpcroutes',
          'tlsroutes',
          'tcproutes',
          'udproutes',
          'listenersets',
          'referencegrants',
          'backendtlspolicies'
        ),
      },
      {
        version: 'v1beta1',
        resources: resources('gatewayclasses', 'gateways', 'httproutes', 'referencegrants'),
      },
      { version: 'v1alpha3', resources: resources('tlsroutes', 'backendtlspolicies') },
      { version: 'v1alpha2', resources: resources('tlsroutes', 'tcproutes', 'udproutes') },
    ],
  },
  {
    // Experimental kinds are not handled by this plugin and must simply be ignored.
    group: 'gateway.networking.x-k8s.io',
    versions: [
      {
        version: 'v1alpha1',
        resources: resources('xbackends', 'xbackendtrafficpolicies', 'xmeshes'),
      },
    ],
  },
];

describe('compareKubeVersions', () => {
  it('orders GA before beta before alpha', () => {
    expect(sortKubeVersions(['v1alpha2', 'v1', 'v1beta1'])).toEqual(['v1', 'v1beta1', 'v1alpha2']);
  });

  it('orders higher versions first within the same stability', () => {
    expect(sortKubeVersions(['v1', 'v2'])).toEqual(['v2', 'v1']);
    expect(sortKubeVersions(['v1alpha2', 'v1alpha3'])).toEqual(['v1alpha3', 'v1alpha2']);
    expect(sortKubeVersions(['v1beta1', 'v2beta1', 'v1beta2'])).toEqual([
      'v2beta1',
      'v1beta2',
      'v1beta1',
    ]);
  });

  it('sorts unparseable names last and removes duplicates', () => {
    expect(sortKubeVersions(['foo', 'v1', 'v1'])).toEqual(['v1', 'foo']);
    expect(compareKubeVersions('foo', 'bar')).toBeGreaterThan(0);
  });
});

describe('preferredVersion', () => {
  it('prefers the most stable served version', () => {
    // ReferenceGrant in v1.6: stored as v1beta1 but served (and preferred) as v1.
    expect(preferredVersion(['v1beta1', 'v1'])).toBe('v1');
    expect(preferredVersion(['v1alpha2'])).toBe('v1alpha2');
    expect(preferredVersion([])).toBeUndefined();
  });
});

describe('resolveAvailability', () => {
  it('reports nothing installed when no group is served', () => {
    const availability = resolveAvailability([]);
    expect(availability.installed).toBe(false);
    expect(availability.kinds).toEqual({});
  });

  it('resolves every v1.6 kind to its preferred version', () => {
    const availability = resolveAvailability(V16_EXPERIMENTAL);
    expect(availability.installed).toBe(true);
    expect(availability.kinds.Gateway).toEqual({
      version: 'v1',
      apiVersion: `${GATEWAY_GROUP}/v1`,
      servedVersions: ['v1', 'v1beta1'],
      verbs,
    });
    expect(availability.kinds.TLSRoute?.servedVersions).toEqual(['v1', 'v1alpha3', 'v1alpha2']);
    expect(availability.kinds.TCPRoute?.version).toBe('v1');
    // Kinds of the experimental API group are ignored.
    expect(Object.keys(availability.kinds)).toHaveLength(KINDS.length);
    expect(isKindAvailable(availability, 'ListenerSet')).toBe(true);
  });

  it('ignores subresources', () => {
    const availability = resolveAvailability([
      {
        group: GATEWAY_GROUP,
        versions: [{ version: 'v1', resources: [{ name: 'gateways/status' }] }],
      },
    ]);
    expect(availability.installed).toBe(false);
  });

  it('falls back to older versions on older bundles', () => {
    // Gateway API v1.2 standard channel plus experimental L4 routes.
    const availability = resolveAvailability([
      {
        group: GATEWAY_GROUP,
        versions: [
          { version: 'v1', resources: resources('gatewayclasses', 'gateways', 'httproutes') },
          { version: 'v1beta1', resources: resources('referencegrants') },
          { version: 'v1alpha2', resources: resources('tcproutes') },
          { version: 'v1alpha3', resources: resources('backendtlspolicies') },
        ],
      },
    ]);
    expect(availability.kinds.ReferenceGrant?.version).toBe('v1beta1');
    expect(availability.kinds.TCPRoute?.version).toBe('v1alpha2');
    expect(availability.kinds.BackendTLSPolicy?.version).toBe('v1alpha3');
    expect(isKindAvailable(availability, 'UDPRoute')).toBe(false);
  });
});

describe('apiVersionFor', () => {
  it('uses the served version, or the newest known one as a fallback', () => {
    const availability = resolveAvailability([
      {
        group: GATEWAY_GROUP,
        versions: [{ version: 'v1alpha2', resources: resources('tcproutes') }],
      },
    ]);
    expect(apiVersionFor(availability, kindInfo('TCPRoute'))).toBe(`${GATEWAY_GROUP}/v1alpha2`);
    expect(apiVersionFor(availability, kindInfo('Gateway'))).toBe(`${GATEWAY_GROUP}/v1`);
    expect(apiVersionFor(undefined, kindInfo('ListenerSet'))).toBe(`${GATEWAY_GROUP}/v1`);
  });
});

describe('parseChannel', () => {
  it('accepts only the two known channels', () => {
    expect(parseChannel('standard')).toBe('standard');
    expect(parseChannel('experimental')).toBe('experimental');
    expect(parseChannel('other')).toBeUndefined();
    expect(parseChannel(undefined)).toBeUndefined();
  });
});

describe('registry', () => {
  it('lists every kind once with a unique plural', () => {
    expect(new Set(KINDS.map(k => k.kind)).size).toBe(KINDS.length);
    expect(new Set(KINDS.map(k => k.plural)).size).toBe(KINDS.length);
  });
});
