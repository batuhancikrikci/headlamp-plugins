/**
 * Detail-page sections that explain how an object relates to its parents: what the controller
 * reported per parent / ancestor, and what the spec says about whether it can attach at all.
 */
import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { GatewayApiDataValue } from '../../data/GatewayApiData';
import {
  Condition,
  KubeJson,
  PolicyAncestorStatus,
  RouteParentStatus,
} from '../../resources/types';
import { evaluateAttachment, ListenerVerdict, Tristate } from '../../utils/attachment';
import { conditionsHealth } from '../../utils/conditions';
import { asArray, asRecord } from '../../utils/objects';
import { CheckedRef, checkReferences } from '../../utils/referenceGrants';
import {
  parentRefTargets,
  parentStatusFor,
  ResolvedParentRef,
  resolveParentRef,
  routeParentRefs,
  sameRef,
} from '../../utils/refs';
import { controllerLabel } from '../../utils/templates';
import { RefLink } from './RefLink';
import { ConditionsTable, Dash, HealthChip } from './Status';

const TRISTATE: Record<Tristate, { icon: string; color: string; label: string }> = {
  yes: { icon: 'mdi:check-circle-outline', color: 'success.main', label: 'Attaches' },
  no: { icon: 'mdi:close-circle-outline', color: 'error.main', label: 'Does not attach' },
  unknown: {
    icon: 'mdi:help-circle-outline',
    color: 'text.secondary',
    label: 'Cannot be determined',
  },
};

function TristateIcon({ value }: { value: Tristate }) {
  const { icon, color, label } = TRISTATE[value];
  return (
    <Tooltip title={label}>
      <Box component="span" sx={{ color, display: 'inline-flex' }} role="img" aria-label={label}>
        <Icon icon={icon} width={18} />
      </Box>
    </Tooltip>
  );
}

/** Controller name with the friendly implementation name when it is a well-known one. */
export function ControllerName({ name }: { name?: string }) {
  if (!name) return <Dash />;
  const label = controllerLabel(name);
  return (
    <Box component="span">
      {label && <Chip size="small" label={label} sx={{ mr: 1 }} />}
      <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
        {name}
      </Typography>
    </Box>
  );
}

function ListenerVerdicts({ verdicts }: { verdicts: ListenerVerdict[] }) {
  return (
    <SimpleTable
      data={verdicts}
      columns={[
        {
          label: 'Listener',
          getter: (verdict: ListenerVerdict) => (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <TristateIcon value={verdict.attaches} />
              <span>{verdict.listener.name}</span>
            </Stack>
          ),
        },
        {
          label: 'Protocol',
          getter: (verdict: ListenerVerdict) =>
            `${verdict.listener.protocol}:${verdict.listener.port}`,
        },
        {
          label: 'Served hostnames',
          getter: (verdict: ListenerVerdict) =>
            verdict.hostnames === null ? 'Any' : verdict.hostnames.join(', ') || <Dash />,
        },
        {
          label: 'Result',
          gridTemplate: 2,
          getter: (verdict: ListenerVerdict) =>
            verdict.attaches === 'yes'
              ? 'The listener accepts this route'
              : verdict.attaches === 'unknown'
              ? 'Depends on a namespace selector that could not be evaluated'
              : verdict.reasons.join('; '),
        },
      ]}
    />
  );
}

function findParentObject(ref: ResolvedParentRef, data: GatewayApiDataValue): KubeJson | undefined {
  const candidates = [...(data.json('Gateway') || []), ...(data.json('ListenerSet') || [])];
  return candidates.find(candidate => parentRefTargets(ref, candidate));
}

/**
 * "Parents" section of a route: one block per parentRef with the reported conditions and the
 * listener-by-listener attachment analysis.
 */
export function ParentsSection({ route, data }: { route: KubeJson; data: GatewayApiDataValue }) {
  const refs = routeParentRefs(route);
  const namespace = route.metadata?.namespace;
  const generation = route.metadata?.generation;

  // Status entries whose parentRef is no longer in the spec (or was written by another controller
  // for an implicit parent) are still worth showing.
  const reported = asArray<RouteParentStatus>(asRecord(route.status).parents);
  const orphaned = reported.filter(entry => {
    if (!entry?.parentRef) return false;
    const resolved = resolveParentRef(entry.parentRef, namespace);
    return !refs.some(
      ref =>
        sameRef(ref, resolved) &&
        (ref.sectionName || '') === (resolved.sectionName || '') &&
        (ref.port ?? null) === (resolved.port ?? null)
    );
  });

  if (refs.length === 0 && orphaned.length === 0) {
    return (
      <SectionBox title="Parents">
        <Alert severity="warning">
          This route has no parentRefs, so it is not attached to any Gateway and does not receive
          traffic.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox title="Parents">
      <Stack divider={<Divider flexItem />} spacing={2} sx={{ py: 1 }}>
        {refs.map((ref, index) => {
          const status = parentStatusFor<RouteParentStatus>(route, ref);
          const parent = ref.kind === 'Service' ? undefined : findParentObject(ref, data);
          const isGatewayParent = ['Gateway', 'ListenerSet'].includes(ref.kind);
          const verdict =
            parent && isGatewayParent
              ? evaluateAttachment(route, ref, parent, data.namespaceLabels)
              : undefined;
          const health = status
            ? conditionsHealth(status.conditions, ['Accepted', 'ResolvedRefs'], generation)
            : undefined;

          return (
            <Box key={index}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle1" component="div">
                  <RefLink
                    target={ref}
                    fromNamespace={namespace}
                    showKind
                    suffix={`${ref.sectionName ? ` / ${ref.sectionName}` : ''}${
                      ref.port !== undefined ? ` :${ref.port}` : ''
                    }`}
                  />
                </Typography>
                {health ? (
                  <HealthChip health={health} />
                ) : (
                  <Chip size="small" label="No status reported" variant="outlined" />
                )}
                {status?.controllerName && (
                  <Typography variant="caption" color="text.secondary">
                    Controller: {status.controllerName}
                  </Typography>
                )}
              </Stack>

              {status ? (
                <ConditionsTable conditions={status.conditions} generation={generation} />
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  No controller has reported a status for this parent. Either the parent does not
                  exist, it is not managed by a running controller, or the route has not been
                  processed yet.
                </Typography>
              )}

              {isGatewayParent && !data.loading && !parent && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {ref.kind} {ref.namespace}/{ref.name} was not found (or you cannot see it).
                </Alert>
              )}
              {verdict && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Attachment analysis
                  </Typography>
                  {verdict.listeners.length > 0 ? (
                    <ListenerVerdicts verdicts={verdict.listeners} />
                  ) : (
                    <Alert severity="error">{verdict.summary}</Alert>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
        {orphaned.map((entry, index) => (
          <Box key={`orphan-${index}`}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" component="div">
                <RefLink
                  target={resolveParentRef(entry.parentRef, namespace)}
                  fromNamespace={namespace}
                  showKind
                  suffix={entry.parentRef.sectionName ? ` / ${entry.parentRef.sectionName}` : ''}
                />
              </Typography>
              <Chip size="small" variant="outlined" label="Not in spec.parentRefs" />
              <Typography variant="caption" color="text.secondary">
                Controller: {entry.controllerName}
              </Typography>
            </Stack>
            <ConditionsTable conditions={entry.conditions} generation={generation} />
          </Box>
        ))}
      </Stack>
    </SectionBox>
  );
}

/** "Status" section of a policy: conditions per ancestor (the Gateways the policy applies under). */
export function AncestorsSection({ policy }: { policy: KubeJson }) {
  const ancestors = asArray<PolicyAncestorStatus>(asRecord(policy.status).ancestors);
  const namespace = policy.metadata?.namespace;
  const generation = policy.metadata?.generation;

  return (
    <SectionBox title="Status by ancestor">
      {ancestors.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No controller has reported a status yet. A policy is processed once a route that is
          attached to a Gateway uses the targeted backend.
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={2} sx={{ py: 1 }}>
          {ancestors.map((ancestor, index) => (
            <Box key={index}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ mb: 1 }}
                flexWrap="wrap"
              >
                <Typography variant="subtitle1" component="div">
                  <RefLink
                    target={resolveParentRef(ancestor.ancestorRef, namespace)}
                    fromNamespace={namespace}
                    showKind
                    suffix={
                      ancestor.ancestorRef?.sectionName
                        ? ` / ${ancestor.ancestorRef.sectionName}`
                        : ''
                    }
                  />
                </Typography>
                <HealthChip
                  health={conditionsHealth(ancestor.conditions, ['Accepted'], generation)}
                />
                <Typography variant="caption" color="text.secondary">
                  Controller: {ancestor.controllerName}
                </Typography>
              </Stack>
              <ConditionsTable conditions={ancestor.conditions} generation={generation} />
            </Box>
          ))}
        </Stack>
      )}
    </SectionBox>
  );
}

/** Conditions of an object that reports them at the top level (Gateway, GatewayClass, …). */
export function ObjectConditionsSection({ obj }: { obj: KubeJson }) {
  return (
    <SectionBox title="Conditions">
      <ConditionsTable
        conditions={asRecord(obj.status).conditions as Condition[] | undefined}
        generation={obj.metadata?.generation}
      />
    </SectionBox>
  );
}

/** Alert for cross-namespace references of an object that no ReferenceGrant permits. */
export function DeniedReferencesAlert({ obj, data }: { obj: KubeJson; data: GatewayApiDataValue }) {
  const denied = checkReferences(obj, data.grants).filter(ref => ref.state === 'denied');
  if (denied.length === 0) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      <strong>
        {denied.length === 1
          ? 'A cross-namespace reference is not permitted'
          : `${denied.length} cross-namespace references are not permitted`}
      </strong>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {denied.map(ref => (
          <li key={ref.path}>
            {ref.purpose}: {ref.to.kind} {ref.to.namespace}/{ref.to.name} — create a ReferenceGrant
            in namespace "{ref.to.namespace}" that allows {ref.from.kind} from "{ref.from.namespace}
            ".
          </li>
        ))}
      </Box>
    </Alert>
  );
}

/** Looks up the grant state of the reference at `path` in a list of checked references. */
export function grantStateAt(
  checked: CheckedRef[],
  path: string
): Pick<CheckedRef, 'state' | 'grantName'> | undefined {
  const match = checked.find(ref => ref.path === path);
  return match ? { state: match.state, grantName: match.grantName } : undefined;
}
