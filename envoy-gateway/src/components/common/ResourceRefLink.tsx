import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { crdByKind } from '../../resources/registry';
import { API_GROUP, GATEWAY_API_GROUP } from '../../resources/types';
import { refKey } from '../../utils/targets';

/** Resolves the Headlamp resource class for a (group, kind) pair, if Headlamp knows it. */
export function classForKind(group: string | undefined, kind: string): KubeObjectClass | null {
  const rc = (K8s.ResourceClasses || {}) as Record<string, KubeObjectClass>;
  const g = group ?? '';
  if (g === API_GROUP) return crdByKind(kind)?.cls || null;
  if (g === GATEWAY_API_GROUP) {
    return ['Gateway', 'GatewayClass', 'HTTPRoute', 'GRPCRoute'].includes(kind)
      ? rc[kind] || null
      : null;
  }
  if (g === 'apps') {
    return kind === 'Deployment' ? rc.Deployment || null : null;
  }
  if (g === '' || g === 'core') {
    return ['Secret', 'ConfigMap', 'Service', 'Namespace'].includes(kind) ? rc[kind] || null : null;
  }
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
  group?: string;
  namespace?: string;
  sectionName?: string;
  port?: number;
  /** Hide the kind chip (useful when the column already implies the kind). */
  hideKind?: boolean;
  /** Extra text rendered after the link (e.g. "inherited"). */
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
  sectionName,
  port,
  hideKind,
  suffix,
}: ResourceRefLinkProps) {
  const obj = makeRefObject(group, kind, name, namespace);
  const details = [sectionName ? `#${sectionName}` : '', port ? `:${port}` : '']
    .filter(Boolean)
    .join(' ');
  const tooltip = [group || 'core', kind, namespace, name].filter(Boolean).join(' / ');

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
      {!hideKind && (
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
            <Link kubeObject={obj}>{name}</Link>
          ) : (
            <Typography component="span" variant="body2">
              {name}
            </Typography>
          )}
        </span>
      </Tooltip>
      {details && (
        <Typography component="span" variant="caption" color="text.secondary">
          {details}
        </Typography>
      )}
      {suffix}
    </Box>
  );
}

export interface RefListItem extends ResourceRefLinkProps {
  key?: string;
}

/** Renders a wrapped list of references, or "-" if empty. */
export function ResourceRefList({ refs }: { refs: RefListItem[] }) {
  if (refs.length === 0) return <>-</>;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', rowGap: 0.5 }}>
      {refs.map(r => (
        <ResourceRefLink key={r.key || refKey(r, `${r.sectionName || ''}${r.port || ''}`)} {...r} />
      ))}
    </Box>
  );
}
