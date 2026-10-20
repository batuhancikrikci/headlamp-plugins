/**
 * Shared read-only renderers for the pieces of the Gateway API that several kinds have in common:
 * listeners, parent references, backends and hostnames.
 */
import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { GatewayApiDataValue } from '../../data/GatewayApiData';
import {
  BackendRef,
  KubeJson,
  Listener,
  ListenerStatus,
  ObjectReference,
} from '../../resources/types';
import { listenerHealth } from '../../utils/conditions';
import { allowedRouteKinds, backendShares, describeAllowedNamespaces } from '../../utils/describe';
import { asArray, asRecord, isPlainObject } from '../../utils/objects';
import { CheckedRef } from '../../utils/referenceGrants';
import {
  resolveBackendRef,
  ResolvedBackendRef,
  ResolvedParentRef,
  resolveSecretRef,
  routeParentRefs,
  uniqueRouteBackends,
} from '../../utils/refs';
import { RefLink } from './RefLink';
import { Dash, HealthChip } from './Status';
import { grantStateAt } from './StatusSections';

/** Monospaced inline text for hostnames, paths and similar literals. */
export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.875em' }}>
      {children}
    </Box>
  );
}

/** Hostnames as chips; "Any" when the list is empty. */
export function Hostnames({ hostnames, max = 3 }: { hostnames?: string[]; max?: number }) {
  const list = asArray<string>(hostnames).filter(h => typeof h === 'string' && h !== '');
  if (list.length === 0) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        Any
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
      {list.slice(0, max).map(hostname => (
        <Chip key={hostname} size="small" variant="outlined" label={<Mono>{hostname}</Mono>} />
      ))}
      {list.length > max && (
        <Tooltip title={list.slice(max).join(', ')}>
          <Chip size="small" label={`+${list.length - max}`} />
        </Tooltip>
      )}
    </Stack>
  );
}

/** Key/value pairs (labels, annotations, options) as chips. */
export function KeyValueChips({ values }: { values?: Record<string, string> }) {
  const entries = Object.entries(asRecord<Record<string, string>>(values));
  if (entries.length === 0) return <Dash />;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {entries.map(([key, value]) => (
        <Chip key={key} size="small" variant="outlined" label={<Mono>{`${key}=${value}`}</Mono>} />
      ))}
    </Stack>
  );
}

function parentSuffix(ref: ResolvedParentRef): string {
  return `${ref.sectionName ? ` / ${ref.sectionName}` : ''}${
    ref.port !== undefined ? ` :${ref.port}` : ''
  }`;
}

/** The parents of a route as links, for table cells. */
export function ParentLinks({ route, max = 3 }: { route: KubeJson; max?: number }) {
  const refs = routeParentRefs(route);
  if (refs.length === 0) return <Dash />;
  return (
    <Stack spacing={0.25}>
      {refs.slice(0, max).map((ref, index) => (
        <RefLink
          key={index}
          target={ref}
          fromNamespace={route.metadata?.namespace}
          showKind={ref.kind !== 'Gateway'}
          suffix={parentSuffix(ref)}
        />
      ))}
      {refs.length > max && (
        <Typography variant="caption" color="text.secondary">
          +{refs.length - max} more
        </Typography>
      )}
    </Stack>
  );
}

export function parentsText(route: KubeJson): string {
  return routeParentRefs(route)
    .map(ref => `${ref.namespace}/${ref.name}${parentSuffix(ref)}`)
    .join(', ');
}

/** The distinct backends of a route as links, for table cells. */
export function BackendLinks({
  route,
  checked,
  max = 3,
}: {
  route: KubeJson;
  checked?: CheckedRef[];
  max?: number;
}) {
  const backends = uniqueRouteBackends(route);
  if (backends.length === 0) return <Dash />;
  const denied = (backend: ResolvedBackendRef) =>
    checked?.find(
      ref =>
        ref.to.name === backend.name &&
        ref.to.namespace === backend.namespace &&
        ref.to.kind === backend.kind
    );
  return (
    <Stack spacing={0.25}>
      {backends.slice(0, max).map((backend, index) => {
        const check = denied(backend);
        return (
          <RefLink
            key={index}
            target={backend}
            fromNamespace={route.metadata?.namespace}
            showKind={backend.kind !== 'Service'}
            suffix={backend.port !== undefined ? `:${backend.port}` : ''}
            grantState={check?.state}
            grantName={check?.grantName}
          />
        );
      })}
      {backends.length > max && (
        <Typography variant="caption" color="text.secondary">
          +{backends.length - max} more
        </Typography>
      )}
    </Stack>
  );
}

export function backendsText(route: KubeJson): string {
  return uniqueRouteBackends(route)
    .map(b => `${b.namespace}/${b.name}${b.port !== undefined ? `:${b.port}` : ''}`)
    .join(', ');
}

/** Why a Service backend cannot work, when the Services of the cluster are known. */
export function serviceProblem(
  backend: ResolvedBackendRef,
  data: GatewayApiDataValue
): string | undefined {
  if (backend.kind !== 'Service' || backend.group !== '') return undefined;
  if (!data.kinds.includes('Service') || data.error('Service')) return undefined;
  const services = data.json('Service');
  if (!services) return undefined;
  const service = services.find(
    s => s.metadata?.name === backend.name && s.metadata?.namespace === backend.namespace
  );
  if (!service) return `Service ${backend.namespace}/${backend.name} does not exist`;
  if (backend.port === undefined) return undefined;
  const ports = asArray<{ port?: number }>(asRecord(service.spec).ports);
  if (!ports.some(p => p?.port === backend.port)) {
    return `Service ${backend.name} does not expose port ${backend.port} (available: ${
      ports.map(p => p?.port).join(', ') || 'none'
    })`;
  }
  return undefined;
}

/** Backends of one rule with their traffic share, existence check and grant state. */
export function BackendRefsTable({
  backendRefs,
  basePath,
  namespace,
  checked,
  data,
}: {
  backendRefs?: BackendRef[];
  /** Path of the `backendRefs` list inside the route, used to look up grant states. */
  basePath: string;
  namespace?: string;
  checked: CheckedRef[];
  data: GatewayApiDataValue;
}) {
  const refs = asArray<BackendRef>(backendRefs).filter(isPlainObject) as unknown as BackendRef[];
  const shares = backendShares(refs);
  const rows = refs.map((ref, index) => ({
    ref,
    index,
    resolved: resolveBackendRef(ref, namespace),
  }));

  return (
    <SimpleTable
      data={rows}
      emptyMessage="No backends: matching requests are answered with an error."
      columns={[
        {
          label: 'Backend',
          gridTemplate: 2,
          getter: (row: (typeof rows)[number]) => {
            const grant = grantStateAt(checked, `${basePath}.${row.index}`);
            const problem = serviceProblem(row.resolved, data);
            return (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <RefLink
                  target={row.resolved}
                  fromNamespace={namespace}
                  showKind
                  grantState={grant?.state}
                  grantName={grant?.grantName}
                />
                {problem && (
                  <Tooltip title={problem}>
                    <Box
                      component="span"
                      sx={{ color: 'error.main', display: 'inline-flex' }}
                      role="img"
                      aria-label={problem}
                    >
                      <Icon icon="mdi:alert-circle-outline" />
                    </Box>
                  </Tooltip>
                )}
              </Stack>
            );
          },
        },
        { label: 'Port', getter: (row: (typeof rows)[number]) => row.ref.port ?? <Dash /> },
        { label: 'Weight', getter: (row: (typeof rows)[number]) => row.ref.weight ?? 1 },
        {
          label: 'Traffic share',
          getter: (row: (typeof rows)[number]) => `${shares[row.index]}%`,
        },
      ]}
    />
  );
}

/** Certificate references of a listener, with their grant state. */
function CertificateRefs({
  listener,
  path,
  namespace,
  checked,
}: {
  listener: Listener;
  path: string;
  namespace?: string;
  checked: CheckedRef[];
}) {
  const refs = asArray<ObjectReference>(listener.tls?.certificateRefs).filter(isPlainObject);
  if (refs.length === 0) return null;
  return (
    <Stack spacing={0.25}>
      {refs.map((ref, index) => {
        const grant = grantStateAt(checked, `${path}.tls.certificateRefs.${index}`);
        return (
          <RefLink
            key={index}
            target={resolveSecretRef(ref as unknown as ObjectReference, namespace)}
            fromNamespace={namespace}
            showKind
            grantState={grant?.state}
            grantName={grant?.grantName}
          />
        );
      })}
    </Stack>
  );
}

/** Listeners of a Gateway or ListenerSet: configuration, TLS, allowed routes and reported status. */
export function ListenersTable({
  listeners,
  statuses,
  namespace,
  generation,
  checked,
  basePath = 'spec.listeners',
}: {
  listeners?: Listener[];
  statuses?: ListenerStatus[];
  namespace?: string;
  generation?: number;
  checked: CheckedRef[];
  basePath?: string;
}) {
  const rows = (asArray<Listener>(listeners).filter(isPlainObject) as unknown as Listener[]).map(
    (listener, index) => ({
      listener,
      index,
      status: asArray<ListenerStatus>(statuses).find(s => s?.name === listener.name),
    })
  );
  type Row = (typeof rows)[number];

  return (
    <SimpleTable
      data={rows}
      emptyMessage="No listeners are defined."
      columns={[
        {
          label: 'Name',
          getter: (row: Row) => <strong>{row.listener.name}</strong>,
        },
        {
          label: 'Protocol',
          getter: (row: Row) => `${row.listener.protocol}:${row.listener.port}`,
        },
        {
          label: 'Hostname',
          getter: (row: Row) =>
            row.listener.hostname ? (
              <Mono>{row.listener.hostname}</Mono>
            ) : (
              <Typography component="span" variant="body2" color="text.secondary">
                Any
              </Typography>
            ),
        },
        {
          label: 'TLS',
          gridTemplate: 1.5,
          getter: (row: Row) =>
            row.listener.tls ? (
              <Stack spacing={0.25}>
                <span>{row.listener.tls.mode ?? 'Terminate'}</span>
                <CertificateRefs
                  listener={row.listener}
                  path={`${basePath}.${row.index}`}
                  namespace={namespace}
                  checked={checked}
                />
              </Stack>
            ) : (
              <Dash />
            ),
        },
        {
          label: 'Allowed routes',
          gridTemplate: 1.5,
          getter: (row: Row) => (
            <Stack spacing={0.25}>
              <span>{describeAllowedNamespaces(row.listener.allowedRoutes)}</span>
              <Typography variant="caption" color="text.secondary">
                {allowedRouteKinds(row.listener).join(', ') || 'Implementation specific'}
              </Typography>
            </Stack>
          ),
        },
        {
          label: 'Attached routes',
          getter: (row: Row) => row.status?.attachedRoutes ?? <Dash />,
        },
        {
          label: 'Status',
          getter: (row: Row) => <HealthChip health={listenerHealth(row.status, generation)} />,
        },
      ]}
    />
  );
}

/** Short summary of listeners for a table cell, e.g. `HTTP:80, HTTPS:443`. */
export function listenersText(listeners?: Listener[]): string {
  return (asArray<Listener>(listeners).filter(isPlainObject) as unknown as Listener[])
    .map(listener => `${listener.protocol}:${listener.port}`)
    .join(', ');
}

export function ListenerChips({ listeners, max = 4 }: { listeners?: Listener[]; max?: number }) {
  const list = asArray<Listener>(listeners).filter(isPlainObject) as unknown as Listener[];
  if (list.length === 0) return <Dash />;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {list.slice(0, max).map((listener, index) => (
        <Tooltip
          key={index}
          title={`${listener.name}${listener.hostname ? ` — ${listener.hostname}` : ''}`}
        >
          <Chip size="small" variant="outlined" label={`${listener.protocol}:${listener.port}`} />
        </Tooltip>
      ))}
      {list.length > max && <Chip size="small" label={`+${list.length - max}`} />}
    </Stack>
  );
}

/** Sum of the routes attached to the listeners of a Gateway or ListenerSet. */
export function attachedRouteCount(obj: KubeJson): number | undefined {
  const listeners = asArray<ListenerStatus>(asRecord(obj.status).listeners);
  if (listeners.length === 0) return undefined;
  return listeners.reduce((sum, listener) => sum + (listener?.attachedRoutes || 0), 0);
}
