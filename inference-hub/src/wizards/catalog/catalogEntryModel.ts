/**
 * "Add model" form: a LocalModelCache plus the catalog presentation annotations.
 */
import { CATALOG_ANNOTATIONS } from '../../resources/catalog';
import { KubeJson } from '../../resources/types';
import { parseQuantity } from '../../utils/quantity';
import { suggestName, validateUri } from '../deploy/deployModel';

export interface CatalogEntryForm {
  uri: string;
  name: string;
  displayName: string;
  description: string;
  license: string;
  tags: string;
  modelSize: string;
  nodeGroups: string[];
  serviceAccountName: string;
  storageKey: string;
}

export function defaultCatalogForm(): CatalogEntryForm {
  return {
    uri: '',
    name: '',
    displayName: '',
    description: '',
    license: '',
    tags: '',
    modelSize: '',
    nodeGroups: [],
    serviceAccountName: '',
    storageKey: '',
  };
}

export type CatalogErrors = Partial<Record<keyof CatalogEntryForm, string>>;

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export function validateCatalogForm(
  form: CatalogEntryForm,
  existingNames: string[] = []
): CatalogErrors {
  const e: CatalogErrors = {};
  const uriError = validateUri(form.uri);
  if (uriError) e.uri = uriError;
  if (!DNS_SUBDOMAIN.test(form.name) || form.name.length > 253) {
    e.name = 'Use lowercase letters, digits, "-" and "."';
  } else if (existingNames.includes(form.name)) {
    e.name = 'A catalog entry with this name already exists.';
  }
  const size = parseQuantity(form.modelSize);
  if (!form.modelSize.trim() || !isFinite(size) || size <= 0) {
    e.modelSize = 'Enter the size of the model files, e.g. 16Gi.';
  }
  if (form.nodeGroups.length === 0)
    e.nodeGroups = 'Pick at least one node group to cache the model on.';
  if (form.tags.length > 200) e.tags = 'Keep tags short.';
  return e;
}

/** Suggested cache size: weights plus 10% for tokenizer and config files, in whole GiB. */
export function suggestModelSize(weightsGiB?: number): string {
  return weightsGiB ? `${Math.max(1, Math.ceil(weightsGiB * 1.1))}Gi` : '';
}

export function catalogNameFor(uri: string): string {
  const path = uri.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/\/+$/, '');
  return suggestName(path.split('/').pop() || path);
}

export function buildCatalogEntry(form: CatalogEntryForm, apiVersion: string): KubeJson {
  const annotations: Record<string, string> = {};
  if (form.displayName.trim())
    annotations[CATALOG_ANNOTATIONS.displayName] = form.displayName.trim();
  if (form.description.trim())
    annotations[CATALOG_ANNOTATIONS.description] = form.description.trim();
  if (form.license.trim()) annotations[CATALOG_ANNOTATIONS.license] = form.license.trim();
  const tags = form.tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  if (tags.length) annotations[CATALOG_ANNOTATIONS.tags] = tags.join(',');

  return {
    apiVersion,
    kind: 'LocalModelCache',
    metadata: {
      name: form.name,
      labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
      ...(Object.keys(annotations).length ? { annotations } : {}),
    },
    spec: {
      sourceModelUri: form.uri.trim(),
      modelSize: form.modelSize.trim(),
      nodeGroups: form.nodeGroups,
      ...(form.serviceAccountName ? { serviceAccountName: form.serviceAccountName } : {}),
      ...(form.storageKey ? { storage: { key: form.storageKey } } : {}),
    },
  };
}
