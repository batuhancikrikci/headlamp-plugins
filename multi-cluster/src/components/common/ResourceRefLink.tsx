import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { crdByKind } from '../../resources/registry';

const CORE_KINDS = ['Namespace', 'Secret', 'ConfigMap', 'ServiceAccount', 'Pod', 'Service'];

/** Resolves the class for a kind: the plugin's own kinds first, then Headlamp's core kinds. */
export function classForKind(kind: string): KubeObjectClass | null {
  const own = crdByKind(kind);
  if (own) return own.cls;
  if (!CORE_KINDS.includes(kind)) return null;
  const classes = (K8s.ResourceClasses || {}) as Record<string, KubeObjectClass>;
  return classes[kind] || null;
}

/** Creates a lightweight (non-fetched) instance, only used to build detail links. */
export function makeRefObject(kind: string, name: string, namespace?: string) {
  const cls = classForKind(kind);
  if (!cls) return null;
  const apiVersion = Array.isArray(cls.apiVersion) ? cls.apiVersion[0] : cls.apiVersion;
  const metadata: Record<string, string> = { name };
  if (namespace && cls.isNamespaced !== false) metadata.namespace = namespace;
  if (cls.isNamespaced && !namespace) return null;
  return new cls({ apiVersion, kind, metadata });
}

export interface ResourceRefLinkProps {
  kind: string;
  name: string;
  namespace?: string;
  /** Show the kind as a chip in front of the name. */
  showKind?: boolean;
  /** Show "namespace/name" instead of just the name. */
  qualified?: boolean;
  suffix?: React.ReactNode;
}

/**
 * A reference to another object: a link to its detail page when the plugin or Headlamp knows
 * the kind, plain text otherwise.
 */
export function ResourceRefLink({
  kind,
  name,
  namespace,
  showKind,
  qualified,
  suffix,
}: ResourceRefLinkProps) {
  const obj = makeRefObject(kind, name, namespace);
  const text = qualified && namespace ? `${namespace}/${name}` : name;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
      {showKind && (
        <Chip
          label={kind}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
      )}
      <Tooltip title={[kind, namespace, name].filter(Boolean).join(' / ')}>
        <span>
          {obj ? (
            <Link kubeObject={obj}>{text}</Link>
          ) : (
            <Typography component="span" variant="body2">
              {text}
            </Typography>
          )}
        </span>
      </Tooltip>
      {suffix}
    </Box>
  );
}

/** Wrapped list of references, or "-" when empty. */
export function ResourceRefList({
  refs,
  max = 12,
}: {
  refs: ResourceRefLinkProps[];
  max?: number;
}) {
  if (refs.length === 0) return <>-</>;
  const shown = refs.slice(0, max);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
      {shown.map(r => (
        <ResourceRefLink key={`${r.kind}/${r.namespace || ''}/${r.name}`} {...r} />
      ))}
      {refs.length > shown.length && (
        <Typography variant="caption" color="text.secondary">
          +{refs.length - shown.length}
        </Typography>
      )}
    </Box>
  );
}

/** Link to a managed cluster. */
export function ClusterLink({ name }: { name: string }) {
  return <ResourceRefLink kind="ManagedCluster" name={name} />;
}
