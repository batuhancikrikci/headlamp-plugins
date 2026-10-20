/**
 * Live Gateway API data for pages that relate several kinds to each other (overview, topology,
 * detail pages, pickers in the forms).
 *
 * One renderless loader is mounted per kind that is actually served by the cluster, so missing
 * CRDs never cause failing list requests. Lists are cluster-wide (limited to the namespaces the
 * user may see), because relationships routinely cross namespaces.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import React from 'react';
import { Availability } from '../discovery/availability';
import { classOf } from '../resources/classes';
import { KindName, ROUTE_KINDS } from '../resources/registry';
import { KubeJson } from '../resources/types';
import { NamespaceLabels } from '../utils/attachment';

/** Core kinds the plugin relates Gateway API objects to. */
export type CoreKind = 'Namespace' | 'Service' | 'Secret' | 'ConfigMap';

type AnyKind = KindName | CoreKind;

interface KindState {
  items: KubeObject[] | null;
  error: string | null;
}

export interface GatewayApiDataValue {
  /** Objects of a kind; `null` while loading. Kinds that are not installed yield an empty list. */
  list: (kind: AnyKind) => KubeObject[] | null;
  /** Same as `list`, as plain JSON (stable identity while the data does not change). */
  json: (kind: AnyKind) => KubeJson[] | null;
  /** Error message of the list request of a kind (e.g. missing permission). */
  error: (kind: AnyKind) => string | null;
  /** Whether any requested kind is still loading. */
  loading: boolean;
  /** Kinds requested from this provider. */
  kinds: AnyKind[];
  /** JSON of every route of every route kind requested. */
  routes: KubeJson[];
  /** Labels per namespace, or undefined when namespaces were not requested or cannot be listed. */
  namespaceLabels: NamespaceLabels;
  /** ReferenceGrants as JSON, or `null` when they cannot be evaluated (not listable). */
  grants: KubeJson[] | null;
}

const EMPTY: GatewayApiDataValue = {
  list: () => null,
  json: () => null,
  error: () => null,
  loading: true,
  kinds: [],
  routes: [],
  namespaceLabels: undefined,
  grants: null,
};

const DataContext = React.createContext<GatewayApiDataValue>(EMPTY);

function coreClass(kind: CoreKind): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

function isCoreKind(kind: AnyKind): kind is CoreKind {
  return kind === 'Namespace' || kind === 'Service' || kind === 'Secret' || kind === 'ConfigMap';
}

function signature(items: KubeObject[] | null): string {
  if (!items) return 'null';
  return items.map(item => `${item.metadata?.uid}@${item.metadata?.resourceVersion}`).join(',');
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  const e = error as { message?: string; status?: number };
  if (e.status === 403) return 'You do not have permission to list these resources.';
  return e.message || String(error);
}

/** Lists one kind and reports the result upwards. Renders nothing. */
function KindLoader({
  kind,
  cls,
  onChange,
}: {
  kind: AnyKind;
  cls: KubeObjectClass;
  onChange: (kind: AnyKind, state: KindState) => void;
}) {
  const [items, error] = cls.useList() as [KubeObject[] | null, unknown];
  const itemsSignature = signature(items);
  const message = errorText(error);
  // The signature (not the array identity) drives the update, so a re-render of the hook with an
  // equal list does not cascade into the consumers.
  const latest = React.useRef(items);
  latest.current = items;

  React.useEffect(() => {
    onChange(kind, { items: latest.current, error: message });
  }, [kind, itemsSignature, message, onChange]);

  return null;
}

export interface GatewayApiDataProps {
  availability: Availability;
  /** Gateway API kinds to load. */
  kinds: KindName[];
  /** Core kinds to load as well. */
  core?: CoreKind[];
  children: React.ReactNode;
}

export function GatewayApiData({ availability, kinds, core = [], children }: GatewayApiDataProps) {
  const [state, setState] = React.useState<Partial<Record<AnyKind, KindState>>>({});

  const onChange = React.useCallback((kind: AnyKind, next: KindState) => {
    setState(previous => ({ ...previous, [kind]: next }));
  }, []);

  const served = kinds.filter(kind => !!availability.kinds[kind]);
  const requested: AnyKind[] = [...kinds, ...core];
  const requestedKey = requested.join(',');
  const servedKey = served.join(',');

  const value = React.useMemo<GatewayApiDataValue>(() => {
    const isServed = (kind: AnyKind) => isCoreKind(kind) || served.includes(kind);
    const list = (kind: AnyKind): KubeObject[] | null => {
      if (!isServed(kind)) return [];
      const entry = state[kind];
      if (!entry) return null;
      // A failed list (e.g. forbidden) is reported through `error`; treat the data as empty.
      return entry.items ?? (entry.error ? [] : null);
    };
    const jsonCache = new Map<AnyKind, KubeJson[] | null>();
    const json = (kind: AnyKind): KubeJson[] | null => {
      if (!jsonCache.has(kind)) {
        const items = list(kind);
        jsonCache.set(kind, items ? items.map(item => item.jsonData as KubeJson) : null);
      }
      return jsonCache.get(kind)!;
    };
    const error = (kind: AnyKind) => state[kind]?.error ?? null;

    const routes = ROUTE_KINDS.filter(kind => requested.includes(kind)).flatMap(
      kind => json(kind) || []
    );

    let namespaceLabels: NamespaceLabels;
    if (requested.includes('Namespace') && !error('Namespace')) {
      const namespaces = json('Namespace');
      if (namespaces) {
        namespaceLabels = {};
        for (const namespace of namespaces) {
          const name = namespace.metadata?.name;
          if (name) namespaceLabels[name] = namespace.metadata?.labels || {};
        }
      }
    }

    // Grants are unknown while loading, when they were not requested and when listing them
    // failed. When the kind is not installed nothing can be granted: the list is simply empty.
    const grantsUsable = requested.includes('ReferenceGrant') && !error('ReferenceGrant');

    return {
      list,
      json,
      error,
      loading: requested.some(kind => list(kind) === null),
      kinds: requested,
      routes,
      namespaceLabels,
      grants: grantsUsable ? json('ReferenceGrant') : null,
    };
    // `served` and `requested` are derived from the keys below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, requestedKey, servedKey]);

  return (
    <DataContext.Provider value={value}>
      {served.map(kind => (
        <KindLoader key={kind} kind={kind} cls={classOf(kind)} onChange={onChange} />
      ))}
      {core.map(kind => (
        <KindLoader key={kind} kind={kind} cls={coreClass(kind)} onChange={onChange} />
      ))}
      {children}
    </DataContext.Provider>
  );
}

export function useGatewayApiData(): GatewayApiDataValue {
  return React.useContext(DataContext);
}
