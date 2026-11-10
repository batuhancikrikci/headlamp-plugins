/**
 * Pure helpers of the storage dashboard: volumes that are released or failed, the default storage
 * class, claims and capacity per storage class and how full the mounted volumes are (from the
 * kubelet's volume stats in Prometheus).
 */
import { Issue, parseMemory } from '../overview/clusterHealth';
import { PvcJson } from '../overview/namespaceHealth';
import type { InstantSample } from '../overview/prometheus';

export interface PvJson {
  metadata?: { name?: string; uid?: string; creationTimestamp?: string };
  spec?: {
    capacity?: { storage?: string };
    storageClassName?: string;
    persistentVolumeReclaimPolicy?: string;
    claimRef?: { namespace?: string; name?: string };
  };
  status?: { phase?: string; message?: string };
}

export interface StorageClassJson {
  metadata?: { name?: string; annotations?: Record<string, string> };
  provisioner?: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
}

const DEFAULT_ANNOTATIONS = [
  'storageclass.kubernetes.io/is-default-class',
  'storageclass.beta.kubernetes.io/is-default-class',
];

export function isDefaultClass(sc: StorageClassJson): boolean {
  return DEFAULT_ANNOTATIONS.some(a => sc.metadata?.annotations?.[a] === 'true');
}

/** Released volumes keep their data until removed by hand; failed ones could not be reclaimed. */
export function pvIssues(pv: PvJson): Issue[] {
  const name = pv.metadata?.name ?? '';
  const base = {
    kind: 'PersistentVolume',
    name,
    link: { route: 'persistentVolume', params: { name } },
  };
  const claim = pv.spec?.claimRef
    ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}`
    : undefined;
  if (pv.status?.phase === 'Failed') {
    return [
      {
        ...base,
        level: 'error',
        title: 'Reclaim failed',
        detail: pv.status.message || 'The volume could not be reclaimed.',
      },
    ];
  }
  if (pv.status?.phase === 'Released') {
    return [
      {
        ...base,
        level: 'warning',
        title: 'Released',
        detail: `Its claim${claim ? ` ${claim}` : ''} was deleted and the volume keeps its data (${
          pv.spec?.persistentVolumeReclaimPolicy || 'Retain'
        }). Delete it, or clear its claim reference to reuse it.`,
      },
    ];
  }
  return [];
}

/** No default storage class, or more than one. */
export function defaultClassIssues(classes: StorageClassJson[]): Issue[] {
  if (classes.length === 0) return [];
  const defaults = classes.filter(isDefaultClass);
  if (defaults.length === 1) return [];
  return [
    {
      kind: 'StorageClass',
      name:
        defaults.length === 0 ? 'Default class' : defaults.map(d => d.metadata?.name).join(', '),
      level: 'warning',
      title: defaults.length === 0 ? 'No default storage class' : 'Several default storage classes',
      detail:
        defaults.length === 0
          ? 'Claims without a storageClassName stay pending until one class is marked default.'
          : 'Claims without a storageClassName get the most recently created default class.',
    },
  ];
}

export interface ClassRow {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  bindingMode: string;
  expansion: boolean;
  isDefault: boolean;
  claims: number;
  pending: number;
  /** Bytes requested by the claims. */
  requested: number;
  volumes: number;
  /** Bytes of the volumes' capacity. */
  capacity: number;
}

/** One row per storage class, and one for claims and volumes without a class. */
export function classRows(
  classes: StorageClassJson[],
  claims: PvcJson[],
  volumes: PvJson[]
): ClassRow[] {
  const rows = new Map<string, ClassRow>();
  const row = (name: string, sc?: StorageClassJson) => {
    let existing = rows.get(name);
    if (!existing) {
      existing = {
        name,
        provisioner: sc?.provisioner ?? '—',
        reclaimPolicy: sc ? sc.reclaimPolicy || 'Delete' : '—',
        bindingMode: sc ? sc.volumeBindingMode || 'Immediate' : '—',
        expansion: !!sc?.allowVolumeExpansion,
        isDefault: sc ? isDefaultClass(sc) : false,
        claims: 0,
        pending: 0,
        requested: 0,
        volumes: 0,
        capacity: 0,
      };
      rows.set(name, existing);
    }
    return existing;
  };
  for (const sc of classes) row(sc.metadata?.name ?? '', sc);
  for (const claim of claims) {
    const r = row(claim.spec?.storageClassName || '(no class)');
    r.claims += 1;
    if (claim.status?.phase === 'Pending') r.pending += 1;
    r.requested += parseMemory(claim.spec?.resources?.requests?.storage);
  }
  for (const pv of volumes) {
    const r = row(pv.spec?.storageClassName || '(no class)');
    r.volumes += 1;
    r.capacity += parseMemory(pv.spec?.capacity?.storage);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      b.claims - a.claims ||
      a.name.localeCompare(b.name)
  );
}

export function volumePhases(volumes: PvJson[]): Record<string, number> {
  const phases: Record<string, number> = {};
  for (const pv of volumes) {
    const phase = pv.status?.phase || 'Unknown';
    phases[phase] = (phases[phase] ?? 0) + 1;
  }
  return phases;
}

/** PromQL of the used and total bytes of every mounted claim, from the kubelet's volume stats. */
export const VOLUME_QUERIES = {
  used: 'max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)',
  capacity: 'max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes)',
};

export interface VolumeFill {
  namespace: string;
  claim: string;
  used: number;
  capacity: number;
  ratio: number;
}

/** Fill of each mounted claim, fullest first. */
export function volumeFill(used: InstantSample[], capacity: InstantSample[]): VolumeFill[] {
  const key = (s: InstantSample) => `${s.metric.namespace}/${s.metric.persistentvolumeclaim}`;
  const totals = new Map(capacity.map(s => [key(s), Number(s.value[1])]));
  const rows: VolumeFill[] = [];
  for (const sample of used) {
    const total = totals.get(key(sample));
    const value = Number(sample.value[1]);
    if (!total || !Number.isFinite(value)) continue;
    rows.push({
      namespace: sample.metric.namespace ?? '',
      claim: sample.metric.persistentvolumeclaim ?? '',
      used: value,
      capacity: total,
      ratio: value / total,
    });
  }
  return rows.sort((a, b) => b.ratio - a.ratio);
}

/** Claims at 80% (warning) or 90% (error) of their volume. */
export function fillIssues(rows: VolumeFill[]): Issue[] {
  return rows
    .filter(r => r.ratio >= 0.8)
    .map(r => ({
      kind: 'PersistentVolumeClaim',
      name: r.claim,
      namespace: r.namespace,
      link: { route: 'persistentVolumeClaim', params: { namespace: r.namespace, name: r.claim } },
      level: r.ratio >= 0.9 ? ('error' as const) : ('warning' as const),
      title: `Volume ${Math.round(r.ratio * 100)}% full`,
      detail: 'Expand the claim (when its storage class allows it) or free space.',
    }));
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
