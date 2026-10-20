import { Icon } from '@iconify/react';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { classOf } from '../../resources/classes';
import { findKind } from '../../resources/registry';
import { GrantState } from '../../utils/referenceGrants';
import { ResolvedRef } from '../../utils/refs';

/** Headlamp route names of the core kinds Gateway API objects reference. */
const CORE_ROUTES: Record<string, { route: string; namespaced: boolean }> = {
  Service: { route: 'service', namespaced: true },
  Secret: { route: 'secret', namespaced: true },
  ConfigMap: { route: 'configMap', namespaced: true },
  Namespace: { route: 'namespace', namespaced: false },
};

/** Headlamp route (by name) of the detail page of a referenced object, when there is one. */
export function routeFor(ref: ResolvedRef): { route: string; namespaced: boolean } | undefined {
  const info = findKind(ref.kind, ref.group);
  if (info) return { route: classOf(info.kind).detailsRoute, namespaced: info.namespaced };
  if (ref.group === '' && CORE_ROUTES[ref.kind]) return CORE_ROUTES[ref.kind];
  return undefined;
}

const GRANT_ICONS: Record<
  Exclude<GrantState, 'same-namespace'>,
  { icon: string; color: string; title: string }
> = {
  granted: {
    icon: 'mdi:handshake-outline',
    color: 'success.main',
    title: 'Cross-namespace reference permitted by ReferenceGrant',
  },
  denied: {
    icon: 'mdi:shield-alert-outline',
    color: 'error.main',
    title:
      'Cross-namespace reference without a ReferenceGrant: the target namespace must grant access',
  },
  unknown: {
    icon: 'mdi:shield-search',
    color: 'text.secondary',
    title: 'Cross-namespace reference; ReferenceGrants could not be checked',
  },
};

/** Icon describing whether a cross-namespace reference is permitted. */
export function GrantBadge({ state, grantName }: { state?: GrantState; grantName?: string }) {
  if (!state || state === 'same-namespace') return null;
  const { icon, color, title } = GRANT_ICONS[state];
  return (
    <Tooltip title={grantName ? `${title} "${grantName}"` : title}>
      <Box
        component="span"
        sx={{ color, display: 'inline-flex', verticalAlign: 'middle', ml: 0.5 }}
        aria-label={title}
        role="img"
      >
        <Icon icon={icon} />
      </Box>
    </Tooltip>
  );
}

export interface RefLinkProps {
  target: ResolvedRef;
  /** Namespace of the object making the reference; equal namespaces are not repeated. */
  fromNamespace?: string;
  /** Shown after the name, e.g. a Service port or a listener name. */
  suffix?: string;
  /** Show the kind in front of the name. */
  showKind?: boolean;
  grantState?: GrantState;
  grantName?: string;
}

/**
 * Link to a referenced object. Known kinds link to their detail page; unknown kinds (for example
 * implementation specific backends) are shown as text.
 */
export function RefLink({
  target,
  fromNamespace,
  suffix,
  showKind,
  grantState,
  grantName,
}: RefLinkProps) {
  const route = routeFor(target);
  const showNamespace = !!target.namespace && target.namespace !== fromNamespace;
  const text = `${showNamespace ? `${target.namespace}/` : ''}${target.name || '(unnamed)'}`;

  const kindLabel = showKind && (
    <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
      {target.kind}
    </Typography>
  );

  const name =
    route && target.name ? (
      <Link
        routeName={route.route}
        params={
          route.namespaced
            ? { namespace: target.namespace || '', name: target.name }
            : { name: target.name }
        }
      >
        {text}
      </Link>
    ) : (
      <Tooltip
        title={
          target.name
            ? `${target.group ? `${target.group}/` : ''}${target.kind}`
            : 'The reference has no name'
        }
      >
        <span>{text}</span>
      </Tooltip>
    );

  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {kindLabel}
      {name}
      {suffix ? (
        <Typography component="span" variant="body2" color="text.secondary">
          {suffix}
        </Typography>
      ) : null}
      <GrantBadge state={grantState} grantName={grantName} />
    </Box>
  );
}
