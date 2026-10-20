import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import {
  buildTopology,
  connectedIds,
  filterTopology,
  layoutTopology,
  problemNodeIds,
  Topology,
  TopologyInput,
} from './topology';

const V1 = `${GATEWAY_GROUP}/v1`;
const ok = (type: string) => ({ type, status: 'True' as const, reason: type });

const gatewayClass: KubeJson = {
  apiVersion: V1,
  kind: 'GatewayClass',
  metadata: { name: 'eg' },
  spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
  status: { conditions: [ok('Accepted')] },
};

const gateway: KubeJson = {
  apiVersion: V1,
  kind: 'Gateway',
  metadata: { name: 'eg', namespace: 'infra' },
  spec: {
    gatewayClassName: 'eg',
    listeners: [
      { name: 'http', protocol: 'HTTP', port: 80, allowedRoutes: { namespaces: { from: 'All' } } },
      { name: 'internal', protocol: 'HTTP', port: 8080 },
    ],
  },
  status: {
    addresses: [{ value: '203.0.113.10' }],
    conditions: [ok('Accepted'), ok('Programmed')],
    listeners: [
      { name: 'http', attachedRoutes: 1, conditions: [ok('Accepted'), ok('Programmed')] },
      { name: 'internal', attachedRoutes: 0, conditions: [ok('Accepted'), ok('Programmed')] },
    ],
  },
};

function route(
  name: string,
  namespace: string,
  spec: Record<string, unknown>,
  accepted = true
): KubeJson {
  return {
    apiVersion: V1,
    kind: 'HTTPRoute',
    metadata: { name, namespace },
    spec,
    status: accepted
      ? {
          parents: [
            {
              parentRef: (spec.parentRefs as Array<Record<string, unknown>>)[0],
              controllerName: 'c',
              conditions: [ok('Accepted'), ok('ResolvedRefs')],
            },
          ],
        }
      : undefined,
  };
}

const web = route('web', 'apps', {
  parentRefs: [{ name: 'eg', namespace: 'infra' }],
  rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
});

const service = (name: string, namespace: string, port: number): KubeJson => ({
  kind: 'Service',
  metadata: { name, namespace },
  spec: { ports: [{ port }] },
});

const base: TopologyInput = {
  classes: [gatewayClass],
  gateways: [gateway],
  listenerSets: [],
  routes: [web],
  grants: [],
  services: [service('web', 'apps', 8080)],
};

function summary(topology: Topology) {
  return {
    nodes: topology.nodes.map(n => `${n.column}:${n.label}:${n.level}`),
    edges: topology.edges.map(e => {
      const label = (id: string) => topology.nodes.find(n => n.id === id)!.label;
      return `${label(e.source)}->${label(e.target)}:${e.state}`;
    }),
  };
}

describe('buildTopology', () => {
  it('connects class, gateway, listeners, route and backend', () => {
    expect(summary(buildTopology(base))).toEqual({
      nodes: [
        'class:eg:healthy',
        'gateway:eg:healthy',
        'listener:http:healthy',
        'listener:internal:healthy',
        'route:web:healthy',
        'backend:web:none',
      ],
      // The route is in another namespace: only the listener that allows all namespaces takes it.
      edges: ['eg->eg:ok', 'eg->http:ok', 'eg->internal:ok', 'http->web:ok', 'web->web:ok'],
    });
  });

  it('draws broken links when no listener accepts the route', () => {
    const rejected = route(
      'rejected',
      'apps',
      {
        parentRefs: [{ name: 'eg', namespace: 'infra', sectionName: 'internal' }],
        rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
      },
      false
    );
    const topology = buildTopology({ ...base, routes: [rejected] });
    expect(summary(topology).edges).toContain('internal->rejected:error');
    const node = topology.nodes.find(n => n.label === 'rejected')!;
    expect(node.notes.join(' ')).toMatch(/No selected listener accepts this route/);
  });

  it('flags routes whose parent does not exist', () => {
    const orphan = route('orphan', 'apps', { parentRefs: [{ name: 'gone' }], rules: [] }, false);
    const topology = buildTopology({ ...base, routes: [orphan] });
    const node = topology.nodes.find(n => n.label === 'orphan')!;
    expect(node.level).toBe('error');
    expect(node.notes).toContain('Parent Gateway apps/gone was not found');
    expect(topology.edges.some(e => e.target === node.id)).toBe(false);
  });

  it('shows a missing GatewayClass as a broken node', () => {
    const topology = buildTopology({ ...base, classes: [] });
    expect(summary(topology).nodes[0]).toBe('class:eg:error');
    expect(summary(topology).edges[0]).toBe('eg->eg:error');
    // Listeners are still drawn.
    expect(topology.nodes.filter(n => n.column === 'listener')).toHaveLength(2);
  });

  it('flags missing Services, wrong ports and references without a grant', () => {
    const broken = route('broken', 'apps', {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [
        {
          backendRefs: [
            { name: 'gone', port: 80 },
            { name: 'web', port: 9999 },
            { name: 'api', namespace: 'backends', port: 80 },
          ],
        },
      ],
    });
    const topology = buildTopology({
      ...base,
      routes: [broken],
      services: [...base.services!, service('api', 'backends', 80)],
    });
    const result = summary(topology);
    expect(result.nodes).toContain('backend:gone:error');
    expect(result.nodes).toContain('backend:web:error');
    expect(result.nodes).toContain('backend:api:none');
    expect(result.edges).toContain('broken->gone:error');
    expect(result.edges).toContain('broken->web:error');
    // The Service exists but lives in another namespace without a ReferenceGrant.
    expect(result.edges).toContain('broken->api:error');
    const edge = topology.edges.find(e => e.target.includes('backends'))!;
    expect(edge.note).toMatch(/No ReferenceGrant/);
  });

  it('does not judge backends when Services and grants are unknown', () => {
    const cross = route('cross', 'apps', {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [{ backendRefs: [{ name: 'api', namespace: 'backends', port: 80 }] }],
    });
    const topology = buildTopology({ ...base, routes: [cross], services: null, grants: null });
    expect(summary(topology).edges).toContain('cross->api:ok');
  });

  it('merges a backend used by several routes and marks mirrors as dashed', () => {
    const mirror = route('mirror', 'apps', {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [
        {
          filters: [
            { type: 'RequestMirror', requestMirror: { backendRef: { name: 'web', port: 8080 } } },
          ],
          backendRefs: [{ name: 'web', port: 8080 }],
        },
      ],
    });
    const topology = buildTopology({ ...base, routes: [web, mirror] });
    expect(topology.nodes.filter(n => n.column === 'backend')).toHaveLength(1);
    // The mirror and the regular backend collapse into one solid edge.
    const edge = topology.edges.find(e => e.source.includes('mirror'))!;
    expect(edge.dashed).toBeFalsy();
  });

  it('adds the listeners of a ListenerSet to its Gateway', () => {
    const listenerSet: KubeJson = {
      apiVersion: V1,
      kind: 'ListenerSet',
      metadata: { name: 'team', namespace: 'apps' },
      spec: {
        parentRef: { name: 'eg', namespace: 'infra' },
        listeners: [{ name: 'team-http', protocol: 'HTTP', port: 8081 }],
      },
    };
    const viaSet = route('via-set', 'apps', {
      parentRefs: [{ name: 'team', kind: 'ListenerSet', group: GATEWAY_GROUP }],
      rules: [],
    });
    const topology = buildTopology({ ...base, listenerSets: [listenerSet], routes: [viaSet] });
    const result = summary(topology);
    expect(result.nodes).toContain('listener:team-http:pending');
    expect(result.edges).toContain('eg->team-http:pending');
    expect(result.edges.some(e => e.startsWith('team-http->via-set'))).toBe(true);
  });

  it('keeps related objects of other namespaces when filtering by namespace', () => {
    const other = route('other', 'shop', {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [],
    });
    const input = { ...base, routes: [web, other] };
    // Looking at "apps": its route plus the Gateway (in "infra") it attaches to.
    const apps = buildTopology({ ...input, namespaces: ['apps'] });
    expect(apps.nodes.map(n => n.label)).toContain('eg');
    expect(apps.nodes.map(n => n.label)).toContain('web');
    expect(apps.nodes.map(n => n.label)).not.toContain('other');
    // Looking at "infra": the Gateway plus every route attached to it.
    const infra = buildTopology({ ...input, namespaces: ['infra'] });
    expect(infra.nodes.filter(n => n.column === 'route').map(n => n.label)).toEqual([
      'web',
      'other',
    ]);
    // Unrelated namespace: nothing.
    expect(buildTopology({ ...input, namespaces: ['nothing'] }).nodes).toEqual([]);
  });

  it('survives malformed objects', () => {
    const topology = buildTopology({
      ...base,
      gateways: [
        { kind: 'Gateway', metadata: { name: 'x', namespace: 'y' }, spec: { listeners: 'no' } },
      ],
      routes: [
        { kind: 'HTTPRoute', metadata: { name: 'r', namespace: 'y' }, spec: { rules: [null] } },
      ],
    });
    expect(topology.nodes.map(n => n.label)).toEqual(['eg', 'x', 'r']);
  });
});

describe('connectedIds and filterTopology', () => {
  const second = route('second', 'infra', {
    parentRefs: [{ name: 'eg', sectionName: 'internal' }],
    rules: [{ backendRefs: [{ name: 'admin', port: 80 }] }],
  });
  const topology = buildTopology({
    ...base,
    routes: [web, second],
    services: [...base.services!, service('admin', 'infra', 80)],
  });
  const id = (label: string, column: string) =>
    topology.nodes.find(n => n.label === label && n.column === column)!.id;

  it('follows a path up and down, but not sideways', () => {
    const path = connectedIds(topology, id('web', 'route'));
    const labels = topology.nodes
      .filter(n => path.nodes.has(n.id))
      .map(n => `${n.column}:${n.label}`);
    expect(labels).toEqual(['class:eg', 'gateway:eg', 'listener:http', 'route:web', 'backend:web']);
    expect(path.edges.size).toBe(4);
  });

  it('includes every branch below a Gateway', () => {
    const path = connectedIds(topology, id('eg', 'gateway'));
    expect(path.nodes.size).toBe(topology.nodes.length);
  });

  it('filters to the paths through matching nodes', () => {
    const filtered = filterTopology(topology, node => node.label === 'admin');
    expect(filtered.nodes.map(n => `${n.column}:${n.label}`)).toEqual([
      'class:eg',
      'gateway:eg',
      'listener:internal',
      'route:second',
      'backend:admin',
    ]);
    expect(filterTopology(topology, () => false).nodes).toEqual([]);
  });
});

describe('problem filter', () => {
  it('keeps only the path through a rejected route, not its healthy siblings', () => {
    const healthy = route('healthy', 'infra', {
      parentRefs: [{ name: 'eg', sectionName: 'http' }],
      rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
    });
    // A route the listener "internal" does not accept (other namespace), plus a healthy one on
    // the same Gateway: only the broken path must remain.
    const rejected = route(
      'rejected',
      'apps',
      {
        parentRefs: [{ name: 'eg', namespace: 'infra', sectionName: 'internal' }],
        rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
      },
      false
    );
    const sibling = route('sibling', 'infra', {
      parentRefs: [{ name: 'eg', sectionName: 'internal' }],
      rules: [{ backendRefs: [{ name: 'admin', port: 80 }] }],
    });
    const topology = buildTopology({
      ...base,
      routes: [healthy, rejected, sibling],
      services: [...base.services!, service('admin', 'infra', 80), service('web', 'infra', 8080)],
    });
    const problems = problemNodeIds(topology);
    const label = (id: string) => topology.nodes.find(n => n.id === id)!.label;
    // The rejected route is a problem; the listener that rejects it is not.
    expect([...problems].map(label)).toEqual(['rejected']);

    const filtered = filterTopology(topology, node => problems.has(node.id));
    expect(filtered.nodes.map(n => `${n.column}:${n.label}`)).toEqual([
      'class:eg',
      'gateway:eg',
      'listener:internal',
      'route:rejected',
      'backend:web',
    ]);
  });

  it('counts a missing backend at the backend, not at the route', () => {
    const broken = route('broken', 'apps', {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [{ backendRefs: [{ name: 'gone', port: 80 }] }],
    });
    const topology = buildTopology({ ...base, routes: [web, broken] });
    const label = (id: string) => topology.nodes.find(n => n.id === id)!.label;
    expect([...problemNodeIds(topology)].map(label)).toEqual(['gone']);
  });

  it('finds nothing on a healthy topology', () => {
    expect(problemNodeIds(buildTopology(base)).size).toBe(0);
  });
});

describe('layoutTopology', () => {
  const options = { nodeWidth: 200, nodeHeight: 60, columnGap: 80, rowGap: 20 };

  it('places columns left to right and centers shorter columns', () => {
    const topology = buildTopology(base);
    const layout = layoutTopology(topology, options);
    expect(layout.columns.map(c => `${c.column}@${c.x}`)).toEqual([
      'class@0',
      'gateway@280',
      'listener@560',
      'route@840',
      'backend@1120',
    ]);
    expect(layout.width).toBe(5 * 200 + 4 * 80);
    // Two listeners are the tallest column.
    expect(layout.height).toBe(2 * 60 + 20);
    const gatewayNode = topology.nodes.find(n => n.column === 'gateway')!;
    expect(layout.positions[gatewayNode.id]).toEqual({ x: 280, y: 40 });
  });

  it('skips empty columns', () => {
    const topology = buildTopology({ ...base, routes: [] });
    const layout = layoutTopology(topology, options);
    expect(layout.columns.map(c => c.column)).toEqual(['class', 'gateway', 'listener']);
  });

  it('orders nodes next to what they connect to', () => {
    // Two gateways; the routes are listed in the opposite order of their gateways.
    const gatewayB: KubeJson = {
      ...gateway,
      metadata: { name: 'zz', namespace: 'infra' },
      spec: {
        gatewayClassName: 'eg',
        listeners: [
          {
            name: 'http',
            protocol: 'HTTP',
            port: 80,
            allowedRoutes: { namespaces: { from: 'All' } },
          },
        ],
      },
    };
    const toB = route('aaa', 'apps', {
      parentRefs: [{ name: 'zz', namespace: 'infra' }],
      rules: [],
    });
    const toA = route('zzz', 'apps', {
      parentRefs: [{ name: 'eg', namespace: 'infra', sectionName: 'http' }],
      rules: [],
    });
    const topology = buildTopology({ ...base, gateways: [gateway, gatewayB], routes: [toB, toA] });
    const layout = layoutTopology(topology, options);
    const y = (label: string, column: string) =>
      layout.positions[topology.nodes.find(n => n.label === label && n.column === column)!.id].y;
    // Alphabetically "aaa" would come first; it is placed below because its Gateway is below.
    expect(y('zzz', 'route')).toBeLessThan(y('aaa', 'route'));
    expect(y('eg', 'gateway')).toBeLessThan(y('zz', 'gateway'));
  });

  it('handles an empty graph', () => {
    expect(layoutTopology({ nodes: [], edges: [] }, options)).toEqual({
      positions: {},
      columns: [],
      width: 0,
      height: 0,
    });
  });
});
