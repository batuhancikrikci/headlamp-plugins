import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { crdByKind } from '../../resources/registry';
import { API_GROUP } from '../../resources/types';

const CORE_KINDS = ['Pod', 'Service', 'Node', 'Namespace', 'Secret', 'ConfigMap', 'Lease'];
const APPS_KINDS = ['Deployment', 'DaemonSet', 'StatefulSet'];

/** Headlamp's built-in resource class for a core/apps kind, if it knows it. */
export function coreClass(kind: string): KubeObjectClass | null {
  const classes = (K8s.ResourceClasses || {}) as Record<string, KubeObjectClass>;
  return classes[kind] || null;
}

/** Resolves the Headlamp resource class for a (group, kind) pair, if Headlamp knows it. */
export function classForKind(group: string | undefined, kind: string): KubeObjectClass | null {
  const g = group ?? '';
  if (g === API_GROUP) return crdByKind(kind)?.cls || null;
  if (g === 'apps') return APPS_KINDS.includes(kind) ? coreClass(kind) : null;
  if (g === '' || g === 'core') return CORE_KINDS.includes(kind) ? coreClass(kind) : null;
  if (g === 'coordination.k8s.io') return kind === 'Lease' ? coreClass(kind) : null;
  return null;
}

/** Creates a lightweight (non-fetched) instance, only used to build detail links. */
export function makeRefObject(
  group: string | undefined,
  kind: string,
  name: string,
  namespace?: string
) {
  const cls = classForKind(group, kind);
  if (!cls) return null;
  const apiVersionValue = Array.isArray(cls.apiVersion) ? cls.apiVersion[0] : cls.apiVersion;
  const metadata: Record<string, string> = { name };
  if (namespace && cls.isNamespaced !== false) metadata.namespace = namespace;
  return new cls({ apiVersion: apiVersionValue, kind, metadata });
}

export interface ResourceRefLinkProps {
  kind: string;
  name: string;
  /** API group; defaults to the core group. Use `cilium.io` for Cilium kinds. */
  group?: string;
  namespace?: string;
  /** Show the kind as a chip in front of the name. */
  showKind?: boolean;
  /** Show "namespace/name" instead of just the name. */
  qualified?: boolean;
  suffix?: React.ReactNode;
}

/**
 * Renders a reference to another Kubernetes object. When Headlamp knows the resource kind the
 * name is a link to its details page; otherwise it is rendered as plain text.
 */
export function ResourceRefLink({
  kind,
  name,
  group,
  namespace,
  showKind,
  qualified,
  suffix,
}: ResourceRefLinkProps) {
  const obj = makeRefObject(group, kind, name, namespace);
  const text = qualified && namespace ? `${namespace}/${name}` : name;
  const tooltip = [group || 'core', kind, namespace, name].filter(Boolean).join(' / ');

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
      <Tooltip title={tooltip}>
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

/** Link to a Cilium object. */
export function CiliumLink(props: Omit<ResourceRefLinkProps, 'group'>) {
  return <ResourceRefLink {...props} group={API_GROUP} />;
}

/** Renders a wrapped list of references, or "-" if empty. */
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
        <ResourceRefLink key={`${r.group || ''}/${r.kind}/${r.namespace || ''}/${r.name}`} {...r} />
      ))}
      {refs.length > shown.length && (
        <Typography variant="caption" color="text.secondary">
          +{refs.length - shown.length}
        </Typography>
      )}
    </Box>
  );
}
