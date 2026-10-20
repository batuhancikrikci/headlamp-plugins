/**
 * The Model Catalog is made of KServe LocalModelCache objects. Presentation details that the
 * CRD has no field for (display name, description, license, tags) live in annotations.
 */
import { HealthSummary } from '../utils/health';
import { ModelInfo, parseModelUri } from '../utils/modelInfo';
import { parseQuantity } from '../utils/quantity';
import { ANNOTATION_PREFIX, readAnnotation } from './annotations';
import { ModelEndpoint } from './endpoint';
import { KubeJson } from './types';

export const CATALOG_ANNOTATIONS = {
  displayName: `${ANNOTATION_PREFIX}display-name`,
  description: `${ANNOTATION_PREFIX}description`,
  license: `${ANNOTATION_PREFIX}license`,
  tags: `${ANNOTATION_PREFIX}tags`,
} as const;

export type NodeCacheStatus =
  | ''
  | 'NodeNotReady'
  | 'NodeDownloadPending'
  | 'NodeDownloading'
  | 'NodeDownloaded'
  | 'NodeDownloadError';

export interface LocalModelCacheJson extends KubeJson {
  spec?: {
    sourceModelUri?: string;
    modelSize?: string | number;
    nodeGroups?: string[];
    serviceAccountName?: string;
    storage?: { key?: string; parameters?: Record<string, string> };
  };
  status?: {
    copies?: { available?: number; total?: number; failed?: number };
    nodeStatus?: Record<string, NodeCacheStatus>;
    inferenceServices?: Array<{ name: string; namespace: string }>;
    llmInferenceServices?: Array<{ name: string; namespace: string }>;
  };
}

export type ModelDownloadStatus =
  | ''
  | 'ModelDownloadPending'
  | 'ModelDownloading'
  | 'ModelDownloaded'
  | 'ModelDownloadError';

export interface LocalModelNodeJson extends KubeJson {
  spec?: {
    localModels?: Array<{
      modelName: string;
      sourceModelUri?: string;
      nodeGroup?: string;
      namespace?: string;
    }>;
  };
  status?: { modelStatus?: Record<string, ModelDownloadStatus> };
}

export interface LocalModelNodeGroupJson extends KubeJson {
  spec?: {
    storageLimit?: string | number;
    persistentVolumeSpec?: {
      storageClassName?: string;
      capacity?: Record<string, string>;
      local?: { path?: string };
      hostPath?: { path?: string };
      nodeAffinity?: {
        required?: {
          nodeSelectorTerms?: Array<{
            matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
          }>;
        };
      };
    };
    persistentVolumeClaimSpec?: { storageClassName?: string };
  };
  status?: { used?: string | number; available?: string | number };
}

export interface ClusterStorageContainerJson extends KubeJson {
  spec?: {
    container?: { name?: string; image?: string };
    supportedUriFormats?: Array<{ prefix?: string; regex?: string }>;
    supportsMultiModelDownload?: boolean;
    workloadType?: string;
  };
}

export interface NodeCopy {
  node: string;
  status: NodeCacheStatus;
  health: HealthSummary;
}

export interface EndpointRef {
  kind: 'InferenceService' | 'LLMInferenceService';
  name: string;
  namespace: string;
  endpoint?: ModelEndpoint;
}

export interface CatalogEntry {
  name: string;
  uri: string;
  model: ModelInfo;
  displayName: string;
  description?: string;
  license?: string;
  tags: string[];
  modelSize?: string;
  sizeBytes?: number;
  nodeGroups: string[];
  serviceAccountName?: string;
  copies: { available: number; total: number; failed: number };
  nodes: NodeCopy[];
  users: EndpointRef[];
  health: HealthSummary;
  createdAt?: string;
  raw: LocalModelCacheJson;
}

export function nodeCacheHealth(status: NodeCacheStatus | ModelDownloadStatus): HealthSummary {
  switch (status) {
    case 'NodeDownloaded':
    case 'ModelDownloaded':
      return { health: 'ready', reason: 'Downloaded' };
    case 'NodeDownloadError':
    case 'ModelDownloadError':
      return { health: 'failed', reason: 'Download failed' };
    case 'NodeDownloading':
    case 'ModelDownloading':
      return { health: 'progressing', reason: 'Downloading' };
    case 'NodeDownloadPending':
    case 'ModelDownloadPending':
      return { health: 'progressing', reason: 'Pending' };
    case 'NodeNotReady':
      return { health: 'unknown', reason: 'Node not ready' };
    default:
      return { health: 'unknown' };
  }
}

export function cacheHealth(copies: CatalogEntry['copies'], hasStatus: boolean): HealthSummary {
  if (copies.failed > 0) {
    return { health: 'failed', reason: `${copies.failed} of ${copies.total} copies failed` };
  }
  if (copies.total > 0 && copies.available === copies.total) {
    return { health: 'ready', reason: `Cached on ${copies.total} node(s)` };
  }
  if (copies.total > 0) {
    return { health: 'progressing', reason: `${copies.available} of ${copies.total} copies ready` };
  }
  return hasStatus
    ? { health: 'unknown', reason: 'No node in the node groups' }
    : { health: 'progressing', reason: 'Waiting for the controller' };
}

function tagsOf(value?: string): string[] {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Builds a catalog entry; `endpoints` resolves users and also catches URI matches. */
export function catalogEntry(
  lmc: LocalModelCacheJson,
  endpoints: ModelEndpoint[] = []
): CatalogEntry {
  const uri = lmc.spec?.sourceModelUri || '';
  const annotations = lmc.metadata.annotations || {};
  const model = parseModelUri(uri);
  const copies = {
    available: lmc.status?.copies?.available ?? 0,
    total: lmc.status?.copies?.total ?? 0,
    failed: lmc.status?.copies?.failed ?? 0,
  };
  const nodes: NodeCopy[] = Object.entries(lmc.status?.nodeStatus || {})
    .map(([node, status]) => ({ node, status, health: nodeCacheHealth(status) }))
    .sort((a, b) => a.node.localeCompare(b.node));

  const users = new Map<string, EndpointRef>();
  const add = (kind: EndpointRef['kind'], name: string, namespace: string) => {
    const key = `${kind}/${namespace}/${name}`;
    if (users.has(key)) return;
    users.set(key, {
      kind,
      name,
      namespace,
      endpoint: endpoints.find(
        e => e.kind === kind && e.name === name && e.namespace === namespace
      ),
    });
  };
  (lmc.status?.inferenceServices || []).forEach(r => add('InferenceService', r.name, r.namespace));
  (lmc.status?.llmInferenceServices || []).forEach(r =>
    add('LLMInferenceService', r.name, r.namespace)
  );
  // KServe matches on the exact URI; also count endpoints the controller has not reported yet.
  endpoints.filter(e => uri && e.modelUri === uri).forEach(e => add(e.kind, e.name, e.namespace));

  const size = lmc.spec?.modelSize;
  const sizeBytes = size !== undefined ? parseQuantity(size) : undefined;
  return {
    name: lmc.metadata.name,
    uri,
    model,
    displayName: readAnnotation(annotations, 'display-name') || model.name || lmc.metadata.name,
    description: readAnnotation(annotations, 'description'),
    license: readAnnotation(annotations, 'license'),
    tags: tagsOf(readAnnotation(annotations, 'tags')),
    modelSize: size !== undefined ? String(size) : undefined,
    sizeBytes: sizeBytes !== undefined && isFinite(sizeBytes) ? sizeBytes : undefined,
    nodeGroups: lmc.spec?.nodeGroups || [],
    serviceAccountName: lmc.spec?.serviceAccountName,
    copies,
    nodes,
    users: Array.from(users.values()),
    health: cacheHealth(copies, !!lmc.status),
    createdAt: lmc.metadata.creationTimestamp,
    raw: lmc,
  };
}

/** Free-text match over the fields a user would search for. */
export function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    entry.name,
    entry.displayName,
    entry.uri,
    entry.description,
    entry.license,
    entry.model.provider?.label,
    entry.model.family,
    entry.model.quantization,
    entry.model.variant,
    ...entry.tags,
  ]
    .filter(Boolean)
    .some(v => (v as string).toLowerCase().includes(q));
}

export interface NodeGroupUsage {
  name: string;
  limitBytes?: number;
  usedBytes?: number;
  availableBytes?: number;
  storageClass?: string;
  path?: string;
  /** Node selector expressions of the persistent volume, as text. */
  placement: string[];
}

export function nodeGroupUsage(group: LocalModelNodeGroupJson): NodeGroupUsage {
  const q = (v?: string | number) => {
    if (v === undefined) return undefined;
    const n = parseQuantity(v);
    return isFinite(n) ? n : undefined;
  };
  const pv = group.spec?.persistentVolumeSpec;
  const placement = (pv?.nodeAffinity?.required?.nodeSelectorTerms || []).flatMap(term =>
    (term.matchExpressions || []).map(e =>
      `${e.key} ${e.operator} ${(e.values || []).join(', ')}`.trim()
    )
  );
  return {
    name: group.metadata.name,
    limitBytes: q(group.spec?.storageLimit),
    usedBytes: q(group.status?.used),
    availableBytes: q(group.status?.available),
    storageClass: pv?.storageClassName || group.spec?.persistentVolumeClaimSpec?.storageClassName,
    path: pv?.local?.path || pv?.hostPath?.path,
    placement,
  };
}

/** Which storage container handles a URI (prefix or regex match), like KServe does. */
export function storageContainerFor(
  uri: string,
  containers: ClusterStorageContainerJson[]
): ClusterStorageContainerJson | undefined {
  return containers.find(c =>
    (c.spec?.supportedUriFormats || []).some(f => {
      if (f.prefix) return uri.startsWith(f.prefix);
      if (f.regex) {
        try {
          return new RegExp(f.regex).test(uri);
        } catch {
          return false;
        }
      }
      return false;
    })
  );
}
