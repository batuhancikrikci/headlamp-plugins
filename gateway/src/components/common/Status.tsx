import { Icon } from '@iconify/react';
import {
  DateLabel,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, AlertTitle, Box, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Condition } from '../../resources/types';
import { Health, HealthLevel, Problem, reasonHint } from '../../utils/conditions';
import { asArray } from '../../utils/objects';

type LabelStatus = 'success' | 'warning' | 'error' | '';

const LEVEL_STATUS: Record<HealthLevel, LabelStatus> = {
  healthy: 'success',
  warning: 'warning',
  error: 'error',
  pending: '',
  none: '',
};

const LEVEL_ICON: Record<HealthLevel, string> = {
  healthy: 'mdi:check-circle-outline',
  warning: 'mdi:alert-outline',
  error: 'mdi:alert-circle-outline',
  pending: 'mdi:clock-outline',
  none: 'mdi:minus-circle-outline',
};

/** Sort order for health columns: problems first. */
export const HEALTH_ORDER: Record<HealthLevel, number> = {
  error: 0,
  warning: 1,
  pending: 2,
  healthy: 3,
  none: 4,
};

function ProblemLines({ problems }: { problems: Problem[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2, maxWidth: 420 }}>
      {problems.slice(0, 6).map((problem, index) => (
        <li key={index}>
          <strong>
            {problem.scope ? `${problem.scope}: ` : ''}
            {problem.type}
            {problem.reason ? ` (${problem.reason})` : ''}
          </strong>
          {problem.message ? ` — ${problem.message}` : ''}
        </li>
      ))}
      {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
    </Box>
  );
}

/** Compact health indicator for tables and headers; the tooltip lists the problems. */
export function HealthChip({ health }: { health: Health }) {
  if (health.level === 'none') {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        {health.label || '—'}
      </Typography>
    );
  }
  const label = (
    <StatusLabel status={LEVEL_STATUS[health.level]}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Icon icon={LEVEL_ICON[health.level]} aria-hidden />
        {health.label}
      </Box>
    </StatusLabel>
  );
  if (health.problems.length === 0) return label;
  return (
    <Tooltip title={<ProblemLines problems={health.problems} />} arrow>
      <Box component="span" sx={{ display: 'inline-block' }}>
        {label}
      </Box>
    </Tooltip>
  );
}

function conditionStatus(condition: Condition): LabelStatus {
  const negative = ['Conflicted', 'OverlappingTLSConfig', 'PartiallyInvalid'].includes(
    condition.type
  );
  if (condition.status === 'Unknown') return '';
  const good = negative ? condition.status === 'False' : condition.status === 'True';
  return good ? 'success' : negative && condition.type !== 'Conflicted' ? 'warning' : 'error';
}

/** One small label per condition; the tooltip carries reason and message. */
export function ConditionChips({ conditions }: { conditions?: Condition[] }) {
  const list = asArray<Condition>(conditions).filter(c => !!c?.type);
  if (list.length === 0) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        No conditions reported
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {list.map(condition => (
        <Tooltip
          key={condition.type}
          arrow
          title={
            <Box sx={{ maxWidth: 380 }}>
              <strong>
                {condition.type}: {condition.status}
                {condition.reason ? ` (${condition.reason})` : ''}
              </strong>
              {condition.message && <Box>{condition.message}</Box>}
            </Box>
          }
        >
          <Box component="span" sx={{ display: 'inline-block' }}>
            <StatusLabel status={conditionStatus(condition)}>
              {condition.type}
              {condition.status === 'Unknown' ? ': Unknown' : ''}
            </StatusLabel>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

/** Full conditions table with reasons, messages and plain-language hints. */
export function ConditionsTable({
  conditions,
  generation,
  emptyMessage = 'No conditions have been reported yet.',
}: {
  conditions?: Condition[];
  generation?: number;
  emptyMessage?: string;
}) {
  const list = asArray<Condition>(conditions).filter(c => !!c?.type);
  return (
    <SimpleTable
      data={list}
      emptyMessage={emptyMessage}
      columns={[
        {
          label: 'Condition',
          getter: (condition: Condition) => (
            <StatusLabel status={conditionStatus(condition)}>{condition.type}</StatusLabel>
          ),
        },
        { label: 'Status', getter: (condition: Condition) => condition.status },
        {
          label: 'Reason',
          getter: (condition: Condition) => {
            const stale =
              generation !== undefined &&
              condition.observedGeneration !== undefined &&
              condition.observedGeneration < generation;
            return (
              <>
                {condition.reason || '—'}
                {stale && (
                  <Tooltip title="Observed before the latest change to this object">
                    <Box component="span" sx={{ ml: 0.5, verticalAlign: 'middle' }}>
                      <Icon icon="mdi:history" aria-label="Stale" />
                    </Box>
                  </Tooltip>
                )}
              </>
            );
          },
        },
        {
          label: 'Message',
          gridTemplate: 3,
          getter: (condition: Condition) => {
            const hint = condition.status !== 'True' ? reasonHint(condition.reason) : undefined;
            return (
              <>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                  {condition.message || '—'}
                </Typography>
                {hint && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {hint}
                  </Typography>
                )}
              </>
            );
          },
        },
        {
          label: 'Last transition',
          getter: (condition: Condition) =>
            condition.lastTransitionTime ? (
              <DateLabel date={condition.lastTransitionTime} format="mini" />
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}

/** "Conditions" section for kinds that report conditions on the object itself. */
export function ConditionsSection({
  conditions,
  generation,
}: {
  conditions?: Condition[];
  generation?: number;
}) {
  return (
    <SectionBox title="Conditions">
      <ConditionsTable conditions={conditions} generation={generation} />
    </SectionBox>
  );
}

/** Alert listing what needs attention on an object; renders nothing when it is healthy. */
export function ProblemsAlert({ health }: { health: Health }) {
  const problems = health.problems.filter(p => p.level !== 'pending');
  if (problems.length === 0) return null;
  const severity = problems.some(p => p.level === 'error') ? 'error' : 'warning';
  return (
    <Alert severity={severity} sx={{ mb: 2 }}>
      <AlertTitle>
        {severity === 'error' ? 'This resource needs attention' : 'This resource is degraded'}
      </AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {problems.map((problem, index) => {
          const hint = reasonHint(problem.reason);
          return (
            <li key={index}>
              <strong>
                {problem.scope ? `${problem.scope}: ` : ''}
                {problem.type}
                {problem.reason ? ` (${problem.reason})` : ''}
              </strong>
              {problem.message ? ` — ${problem.message}` : ''}
              {hint && (
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
                  {hint}
                </Typography>
              )}
            </li>
          );
        })}
      </Box>
    </Alert>
  );
}

/** Placeholder for optional values that are not set. */
export function Dash() {
  return (
    <Typography component="span" variant="body2" color="text.secondary">
      —
    </Typography>
  );
}

/** Renders a list of short values as chips-like inline items, or a dash when empty. */
export function InlineList({ items, max = 4 }: { items: React.ReactNode[]; max?: number }) {
  if (items.length === 0) return <Dash />;
  const visible = items.slice(0, max);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
      {visible.map((item, index) => (
        <Box key={index} component="span">
          {item}
          {index < visible.length - 1 ? ',' : ''}
        </Box>
      ))}
      {items.length > max && (
        <Typography component="span" variant="body2" color="text.secondary">
          +{items.length - max} more
        </Typography>
      )}
    </Box>
  );
}
