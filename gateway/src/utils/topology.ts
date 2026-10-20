/**
 * The Gateway API topology: GatewayClass → Gateway → Listener → Route → Backend.
 *
 * `buildTopology` turns the objects of a cluster into a graph, `layoutTopology` places its nodes
 * in five columns with few edge crossings, and `connectedIds` finds the path through a node for
 * highlighting. All three are pure, so the view only has to draw the result.
 */
import { KubeJson, Listener, ListenerStatus, RouteParentStatus } from '../resources/types';
import { evaluateAttachment, NamespaceLabels } from './attachment';
import { computeHealth, conditionsHealth, HealthLevel, listenerHealth } from './conditions';
import { describeListener } from './describe';
import { asArray, asRecord, asString, isPlainObject } from './objects';
import { checkReferences } from './referenceGrants';
import {
  groupOf,
  parentRefTargets,
  parentStatusFor,
  refKey,
  ResolvedRef,
  resolveParentRef,
  routeBackends,
  routeParentRefs,
} from './refs';

export type TopologyColumn = 'class' | 'gateway' | 'listener' | 'route' | 'backend';

export const TOPOLOGY_COLUMNS: TopologyColumn[] = [
  'class',
  'gateway',
  'listener',
  'route',
  'backend',
];

export const COLUMN_LABELS: Record<TopologyColumn, string> = {
  class: 'Gateway classes',
  gateway: 'Gateways',
  listener: 'Listeners',
  route: 'Routes',
  backend: 'Backends',
};

export interface TopologyNode {
  id: string;
  column: TopologyColumn;
  /** Kind shown on the node, e.g. `HTTPRoute` or `Service`. */
  kind: string;
  label: string;
  sublabel?: string;
  namespace?: string;
  level: HealthLevel;
  /** Short explanation of the level, for the tooltip. */
  status: string;
  /** Problems worth showing on hover. */
  notes: string[];
  /** The object behind the node, when there is one to link to. */
  ref?: ResolvedRef;
}

export type EdgeState = 'ok' | 'warning' | 'error' | 'pending';

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  state: EdgeState;
  /** Dashed edges are secondary relations (request mirrors, external auth). */
  dashed?: boolean;
  note?: string;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface TopologyInput {
  classes: KubeJson[];
  gateways: KubeJson[];
  listenerSets: KubeJson[];
  routes: KubeJson[];
  /** ReferenceGrants, or `null` when unknown. */
  grants: KubeJson[] | null;
  /** Services, or `null` when unknown. */
  services: KubeJson[] | null;
  namespaceLabels?: NamespaceLabels;
  /** Namespaces to show; empty means all. Objects related to a shown object are kept as well. */
  namespaces?: string[];
}

function identity(obj: KubeJson): ResolvedRef {
  return {
    group: groupOf(obj.apiVersion),
    kind: obj.kind || '',
    namespace: obj.metadata?.namespace,
    name: obj.metadata?.name || '',
  };
}

function nodeId(obj: KubeJson): string {
  return refKey(identity(obj));
}

function listenerNodeId(owner: KubeJson, listenerName: string): string {
  return `listener|${nodeId(owner)}|${listenerName}`;
}

function inNamespaces(obj: KubeJson, namespaces: string[]): boolean {
  return namespaces.length === 0 || namespaces.includes(obj.metadata?.namespace || '');
}

function edgeStateFromLevel(level: HealthLevel): EdgeState {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'pending') return 'pending';
  return 'ok';
}

function notesOf(obj: KubeJson): string[] {
  return computeHealth(obj)
    .problems.filter(problem => problem.level !== 'pending')
    .map(
      problem =>
        `${problem.scope ? `${problem.scope}: ` : ''}${problem.type}${
          problem.reason ? ` (${problem.reason})` : ''
        }${problem.message ? ` — ${problem.message}` : ''}`
    );
}

/** The Gateway a ListenerSet attaches its listeners to. */
function gatewayOfSet(set: KubeJson, gateways: KubeJson[]): KubeJson | undefined {
  const parentRef = asRecord(asRecord(set.spec).parentRef);
  if (!parentRef.name) return undefined;
  const ref = resolveParentRef(parentRef as unknown as { name: string }, set.metadata?.namespace);
  return gateways.find(
    gateway => gateway.metadata?.name === ref.name && gateway.metadata?.namespace === ref.namespace
  );
}

/** Builds the topology graph of the given objects. */
export function buildTopology(input: TopologyInput): Topology {
  const namespaces = input.namespaces || [];
  const nodes = new Map<string, TopologyNode>();
  const edges = new Map<string, TopologyEdge>();
  const stateOrder: EdgeState[] = ['ok', 'pending', 'warning', 'error'];
  const addEdge = (edge: Omit<TopologyEdge, 'id'>) => {
    const id = `${edge.source}=>${edge.target}`;
    const existing = edges.get(id);
    if (!existing) {
      edges.set(id, { ...edge, id });
      return;
    }
    // Several relations between the same pair collapse into one edge: the worst state wins, and
    // the edge is only dashed when every relation is a secondary one.
    const worse = stateOrder.indexOf(edge.state) > stateOrder.indexOf(existing.state);
    edges.set(id, {
      ...existing,
      state: worse ? edge.state : existing.state,
      note: worse ? edge.note ?? existing.note : existing.note ?? edge.note,
      dashed: !!existing.dashed && !!edge.dashed,
    });
  };

  const parents = [...input.gateways, ...input.listenerSets];
  const parentsOf = (route: KubeJson) =>
    routeParentRefs(route)
      .map(ref => ({ ref, parent: parents.find(candidate => parentRefTargets(ref, candidate)) }))
      .filter(entry => !!entry.parent) as Array<{
      ref: ReturnType<typeof routeParentRefs>[number];
      parent: KubeJson;
    }>;
  const owningGateway = (parent: KubeJson) =>
    parent.kind === 'Gateway' ? parent : gatewayOfSet(parent, input.gateways);

  // --- Which objects are shown -------------------------------------------------------------
  const routes = input.routes.filter(route => {
    if (inNamespaces(route, namespaces)) return true;
    // Routes from other namespaces that attach to a shown Gateway are part of its picture.
    return parentsOf(route).some(({ parent }) => {
      const gateway = owningGateway(parent);
      return (gateway && inNamespaces(gateway, namespaces)) || inNamespaces(parent, namespaces);
    });
  });
  const gateways = input.gateways.filter(gateway => {
    if (inNamespaces(gateway, namespaces)) return true;
    return routes.some(route =>
      parentsOf(route).some(({ parent }) => owningGateway(parent) === gateway)
    );
  });
  const listenerSets = input.listenerSets.filter(set => {
    const gateway = gatewayOfSet(set, input.gateways);
    return inNamespaces(set, namespaces) || (!!gateway && gateways.includes(gateway));
  });

  // --- Classes -----------------------------------------------------------------------------
  const usedClasses = new Set(gateways.map(g => asString(asRecord(g.spec).gatewayClassName)));
  for (const cls of input.classes) {
    const name = cls.metadata?.name || '';
    // With a namespace filter only the classes in use are relevant.
    if (namespaces.length > 0 && !usedClasses.has(name)) continue;
    const health = computeHealth(cls);
    nodes.set(nodeId(cls), {
      id: nodeId(cls),
      column: 'class',
      kind: 'GatewayClass',
      label: name,
      sublabel: asString(asRecord(cls.spec).controllerName),
      level: health.level,
      status: health.label,
      notes: notesOf(cls),
      ref: identity(cls),
    });
  }

  // --- Gateways and their listeners ---------------------------------------------------------
  const addListeners = (owner: KubeJson, gatewayNodeId: string | undefined, viaSet: boolean) => {
    const statuses = asArray<ListenerStatus>(asRecord(owner.status).listeners);
    for (const listener of asArray<Listener>(asRecord(owner.spec).listeners)) {
      if (!isPlainObject(listener)) continue;
      const name = asString(listener.name);
      const health = listenerHealth(
        statuses.find(status => status?.name === name),
        owner.metadata?.generation
      );
      const id = listenerNodeId(owner, name);
      nodes.set(id, {
        id,
        column: 'listener',
        kind: 'Listener',
        label: name || '(unnamed)',
        sublabel: `${describeListener(listener as unknown as Listener)}${
          viaSet ? ` · ${owner.kind} ${owner.metadata?.name}` : ''
        }`,
        namespace: owner.metadata?.namespace,
        level: health.level,
        status: health.label,
        notes: health.problems
          .filter(p => p.level !== 'pending')
          .map(
            p => `${p.type}${p.reason ? ` (${p.reason})` : ''}${p.message ? ` — ${p.message}` : ''}`
          ),
        ref: identity(owner),
      });
      if (gatewayNodeId) {
        addEdge({ source: gatewayNodeId, target: id, state: edgeStateFromLevel(health.level) });
      }
    }
  };

  for (const gateway of gateways) {
    const id = nodeId(gateway);
    const health = computeHealth(gateway);
    const className = asString(asRecord(gateway.spec).gatewayClassName);
    const addresses = asArray<{ value?: string }>(asRecord(gateway.status).addresses)
      .map(address => address?.value)
      .filter(Boolean);
    const notes = notesOf(gateway);
    const deniedCertificates = checkReferences(gateway, input.grants).filter(
      ref => ref.state === 'denied'
    );
    for (const ref of deniedCertificates) {
      notes.push(
        `${ref.purpose} ${ref.to.namespace}/${ref.to.name} is not permitted by a ReferenceGrant`
      );
    }
    nodes.set(id, {
      id,
      column: 'gateway',
      kind: 'Gateway',
      label: gateway.metadata?.name || '',
      sublabel: addresses.join(', ') || 'no address',
      namespace: gateway.metadata?.namespace,
      level: deniedCertificates.length > 0 && health.level !== 'error' ? 'error' : health.level,
      status: health.label,
      notes,
      ref: identity(gateway),
    });

    const cls = input.classes.find(candidate => candidate.metadata?.name === className);
    if (cls) {
      addEdge({
        source: nodeId(cls),
        target: id,
        state: edgeStateFromLevel(computeHealth(cls).level),
      });
    } else if (className) {
      // The class does not exist: show it as a broken node so the gap is visible.
      const missingId = `missing-class|${className}`;
      nodes.set(missingId, {
        id: missingId,
        column: 'class',
        kind: 'GatewayClass',
        label: className,
        sublabel: 'not found',
        level: 'error',
        status: 'Not found',
        notes: [`GatewayClass "${className}" does not exist`],
      });
      addEdge({ source: missingId, target: id, state: 'error' });
    }
    addListeners(gateway, id, false);
  }

  for (const set of listenerSets) {
    const gateway = gatewayOfSet(set, gateways);
    addListeners(set, gateway ? nodeId(gateway) : undefined, true);
  }

  // --- Routes ------------------------------------------------------------------------------
  for (const route of routes) {
    const id = nodeId(route);
    const health = computeHealth(route);
    const notes = notesOf(route);
    const hostnames = asArray<string>(asRecord(route.spec).hostnames).filter(Boolean);
    const refs = routeParentRefs(route);
    let level: HealthLevel = health.level;

    for (const ref of refs) {
      const parent = parents.find(candidate => parentRefTargets(ref, candidate));
      if (!parent) {
        if (ref.kind === 'Gateway' || ref.kind === 'ListenerSet') {
          notes.push(`Parent ${ref.kind} ${ref.namespace}/${ref.name} was not found`);
          level = 'error';
        }
        continue;
      }
      const verdict = evaluateAttachment(route, ref, parent, input.namespaceLabels);
      const reported = parentStatusFor<RouteParentStatus>(route, ref);
      const reportedLevel = reported
        ? conditionsHealth(
            reported.conditions,
            ['Accepted', 'ResolvedRefs'],
            route.metadata?.generation
          ).level
        : 'pending';

      const accepting = verdict.listeners.filter(l => l.attaches !== 'no');
      // Without any accepting listener the broken links are drawn to all selected listeners.
      const targets = accepting.length > 0 ? accepting : verdict.listeners;
      if (verdict.attaches === 'no') {
        notes.push(
          `${parent.kind} ${parent.metadata?.namespace}/${parent.metadata?.name}: ${
            verdict.summary || 'no listener accepts this route'
          }`
        );
      }
      for (const target of targets) {
        const listenerId = listenerNodeId(parent, target.listener.name);
        if (!nodes.has(listenerId)) continue;
        addEdge({
          source: listenerId,
          target: id,
          state:
            target.attaches === 'no'
              ? 'error'
              : reportedLevel === 'healthy'
              ? 'ok'
              : edgeStateFromLevel(reportedLevel),
          note: target.attaches === 'no' ? target.reasons.join('; ') : undefined,
        });
      }
    }

    nodes.set(id, {
      id,
      column: 'route',
      kind: route.kind || 'Route',
      label: route.metadata?.name || '',
      sublabel: hostnames.join(', ') || undefined,
      namespace: route.metadata?.namespace,
      level,
      status: health.label,
      notes,
      ref: identity(route),
    });

    // --- Backends ---------------------------------------------------------------------------
    const checked = checkReferences(route, input.grants);
    for (const backend of routeBackends(route)) {
      const backendId = `backend|${refKey(backend.ref)}`;
      const grant = checked.find(ref => ref.path === backend.path);
      const denied = grant?.state === 'denied';
      const isService = backend.ref.kind === 'Service' && backend.ref.group === '';
      const service =
        isService && input.services
          ? input.services.find(
              s =>
                s.metadata?.name === backend.ref.name &&
                s.metadata?.namespace === backend.ref.namespace
            )
          : undefined;
      const missing = isService && !!input.services && !service;
      const servicePorts = asArray<{ port?: number }>(asRecord(service?.spec).ports).map(
        p => p?.port
      );
      const wrongPort =
        !!service && backend.ref.port !== undefined && !servicePorts.includes(backend.ref.port);

      const existing = nodes.get(backendId);
      const backendNotes = existing ? [...existing.notes] : [];
      if (missing && !backendNotes.includes('The Service does not exist')) {
        backendNotes.push('The Service does not exist');
      }
      if (wrongPort) {
        const note = `Port ${backend.ref.port} is not exposed by the Service`;
        if (!backendNotes.includes(note)) backendNotes.push(note);
      }
      const ports = new Set((existing?.sublabel || '').split(', ').filter(Boolean));
      if (backend.ref.port !== undefined) ports.add(`:${backend.ref.port}`);

      nodes.set(backendId, {
        id: backendId,
        column: 'backend',
        kind: backend.ref.kind,
        label: backend.ref.name || '(unnamed)',
        sublabel: [...ports].join(', ') || undefined,
        namespace: backend.ref.namespace,
        level: backendNotes.length > 0 ? 'error' : 'none',
        status:
          backendNotes.length === 0
            ? ''
            : backendNotes.includes('The Service does not exist')
            ? 'Not found'
            : 'Port not found',
        notes: backendNotes,
        ref: backend.ref,
      });
      addEdge({
        source: id,
        target: backendId,
        state: denied || missing || wrongPort ? 'error' : 'ok',
        dashed: backend.source !== 'backendRef',
        note: denied
          ? `No ReferenceGrant in "${backend.ref.namespace}" permits this reference`
          : backend.source === 'requestMirror'
          ? 'Request mirror'
          : backend.source === 'externalAuth'
          ? 'External authorization'
          : undefined,
      });
    }
  }

  const columnOrder = (column: TopologyColumn) => TOPOLOGY_COLUMNS.indexOf(column);
  return {
    nodes: [...nodes.values()].sort(
      (a, b) =>
        columnOrder(a.column) - columnOrder(b.column) ||
        (a.namespace || '').localeCompare(b.namespace || '') ||
        a.label.localeCompare(b.label)
    ),
    edges: [...edges.values()].filter(edge => nodes.has(edge.source) && nodes.has(edge.target)),
  };
}

/** Ids of the nodes and edges on a path through `nodeId`: everything upstream and downstream. */
export function connectedIds(
  topology: Topology,
  nodeId: string
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();
  const walk = (start: string, direction: 'down' | 'up') => {
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of topology.edges) {
        const from = direction === 'down' ? edge.source : edge.target;
        const to = direction === 'down' ? edge.target : edge.source;
        if (from !== current) continue;
        edges.add(edge.id);
        if (!nodes.has(to)) {
          nodes.add(to);
          queue.push(to);
        }
      }
    }
  };
  walk(nodeId, 'down');
  walk(nodeId, 'up');
  return { nodes, edges };
}

/**
 * Nodes that have a problem: failing or degraded nodes, and the node at the far end of a failing
 * or degraded edge (a route a listener rejects, a backend that is missing or not permitted).
 *
 * The node an edge starts from is not counted: a listener with one rejected route is not itself
 * a problem, and counting it would pull every other route of that listener into the result.
 */
export function problemNodeIds(topology: Topology): Set<string> {
  const ids = new Set<string>();
  for (const node of topology.nodes) {
    if (node.level === 'error' || node.level === 'warning') ids.add(node.id);
  }
  for (const edge of topology.edges) {
    if (edge.state === 'error' || edge.state === 'warning') ids.add(edge.target);
  }
  return ids;
}

/** Keeps the nodes matching the predicate, plus everything on a path through them. */
export function filterTopology(
  topology: Topology,
  keep: (node: TopologyNode) => boolean
): Topology {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const node of topology.nodes) {
    if (!keep(node)) continue;
    const connected = connectedIds(topology, node.id);
    connected.nodes.forEach(id => nodes.add(id));
    connected.edges.forEach(id => edges.add(id));
  }
  return {
    nodes: topology.nodes.filter(node => nodes.has(node.id)),
    edges: topology.edges.filter(edge => edges.has(edge.id)),
  };
}

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
}

export interface TopologyLayout {
  positions: Record<string, { x: number; y: number }>;
  /** X offset of each column that has nodes. */
  columns: Array<{ column: TopologyColumn; x: number }>;
  width: number;
  height: number;
}

/**
 * Places the nodes in one column per layer. Within a column nodes are ordered by the average
 * position of their neighbours in the adjacent column (barycenter heuristic), which keeps related
 * nodes on similar heights and edge crossings low.
 */
export function layoutTopology(topology: Topology, options: LayoutOptions): TopologyLayout {
  const { nodeWidth, nodeHeight, columnGap, rowGap } = options;
  const columns = TOPOLOGY_COLUMNS.map(column => ({
    column,
    ids: topology.nodes.filter(node => node.column === column).map(node => node.id),
  }));

  const neighbours = new Map<string, { up: string[]; down: string[] }>();
  for (const node of topology.nodes) neighbours.set(node.id, { up: [], down: [] });
  for (const edge of topology.edges) {
    neighbours.get(edge.source)?.down.push(edge.target);
    neighbours.get(edge.target)?.up.push(edge.source);
  }

  const index = new Map<string, number>();
  const reindex = () =>
    columns.forEach(({ ids }) => ids.forEach((id, position) => index.set(id, position)));
  reindex();

  const sortBy = (ids: string[], direction: 'up' | 'down') => {
    const barycenter = (id: string) => {
      const linked = neighbours.get(id)![direction].filter(other => index.has(other));
      if (linked.length === 0) return Number.MAX_SAFE_INTEGER;
      return linked.reduce((sum, other) => sum + index.get(other)!, 0) / linked.length;
    };
    const original = new Map(ids.map((id, position) => [id, position]));
    // Stable: unconnected nodes keep their (alphabetical) order at the end.
    ids.sort((a, b) => barycenter(a) - barycenter(b) || original.get(a)! - original.get(b)!);
  };

  for (let pass = 0; pass < 2; pass++) {
    for (let c = 1; c < columns.length; c++) {
      sortBy(columns[c].ids, 'up');
      reindex();
    }
    for (let c = columns.length - 2; c >= 0; c--) {
      sortBy(columns[c].ids, 'down');
      reindex();
    }
  }

  const used = columns.filter(column => column.ids.length > 0);
  const tallest = Math.max(0, ...used.map(column => column.ids.length));
  const height = tallest === 0 ? 0 : tallest * nodeHeight + (tallest - 1) * rowGap;
  const positions: TopologyLayout['positions'] = {};
  const columnOffsets: TopologyLayout['columns'] = [];

  used.forEach((column, columnIndex) => {
    const x = columnIndex * (nodeWidth + columnGap);
    columnOffsets.push({ column: column.column, x });
    const columnHeight = column.ids.length * nodeHeight + (column.ids.length - 1) * rowGap;
    // Shorter columns are centered against the tallest one.
    const top = (height - columnHeight) / 2;
    column.ids.forEach((id, row) => {
      positions[id] = { x, y: top + row * (nodeHeight + rowGap) };
    });
  });

  return {
    positions,
    columns: columnOffsets,
    width: used.length === 0 ? 0 : used.length * nodeWidth + (used.length - 1) * columnGap,
    height,
  };
}
