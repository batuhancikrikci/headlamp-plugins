import { Icon } from '@iconify/react';
import {
  DateLabel,
  NameValueTable,
  SectionBox,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import {
  PolicyAncestorStatus,
  PolicyCondition,
  PolicyStatus,
  TargetRef,
  TargetSelector,
} from '../../resources/types';
import {
  conditionHealth,
  ConditionSummary,
  Health,
  statusSortValue,
  summarizeStatus,
} from '../../utils/conditions';
import { refKey } from '../../utils/targets';
import { ResourceRefLink } from './ResourceRefLink';

const HEALTH_TO_STATUS: Record<Health, 'success' | 'warning' | 'error' | ''> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: '',
};

/** Renders a status label for a single condition. */
export function StatusChip({ condition }: { condition: PolicyCondition }) {
  const health = conditionHealth(condition);
  const label =
    condition.status === 'True' ? condition.type : `${condition.type}: ${condition.status}`;
  return (
    <Tooltip title={[condition.reason, condition.message].filter(Boolean).join(' — ')}>
      <span>
        <StatusLabel status={HEALTH_TO_STATUS[health]}>{label}</StatusLabel>
      </span>
    </Tooltip>
  );
}

/**
 * Compact status used in list views and detail headers. For policies that are attached to
 * several ancestors, it shows how many of them accepted the policy.
 */
export function StatusSummary({ summary }: { summary: ConditionSummary }) {
  const { t } = useText();
  const { primary, health, acceptedCount, ancestorCount } = summary;

  if (!primary) {
    return (
      <Tooltip title={t('The controller has not reported a status yet')}>
        <span>
          <StatusLabel status="">{t('Pending')}</StatusLabel>
        </span>
      </Tooltip>
    );
  }

  let label = primary.status === 'True' ? primary.type : `${primary.type}: ${primary.status}`;
  if (ancestorCount > 1) {
    label = t('Accepted {{accepted}}/{{total}}', { accepted: acceptedCount, total: ancestorCount });
  }
  const tooltip = [primary.reason, primary.message].filter(Boolean).join(' — ');

  return (
    <Tooltip title={tooltip}>
      <span>
        <StatusLabel status={HEALTH_TO_STATUS[health]}>{label}</StatusLabel>
      </span>
    </Tooltip>
  );
}

/** Column definition for the status column of every list view. */
export function statusColumn<T extends { statusSummary: ConditionSummary }>(label: string) {
  return {
    id: 'status',
    label,
    gridTemplate: 'min-content',
    render: (item: T) => <StatusSummary summary={item.statusSummary} />,
    getValue: (item: T) => statusSortValue(item.statusSummary),
  };
}

export function StatusSummaryFromStatus({ status }: { status?: PolicyStatus }) {
  return <StatusSummary summary={summarizeStatus(status)} />;
}

/** Renders a full conditions table for detail pages. */
export function ConditionsTable({ conditions }: { conditions?: PolicyCondition[] }) {
  const { t } = useText();
  if (!conditions || conditions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No conditions reported.')}
      </Typography>
    );
  }

  return (
    <NameValueTable
      rows={conditions.map(c => ({
        name: <StatusChip condition={c} />,
        value: (
          <Box>
            {c.reason && (
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {c.reason}
              </Typography>
            )}
            {c.message && (
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {c.message}
              </Typography>
            )}
            {c.lastTransitionTime && <DateLabel date={c.lastTransitionTime} format="mini" />}
          </Box>
        ),
      }))}
    />
  );
}

/** Renders the policy ancestors (status.ancestors) with their conditions. */
export function PolicyAncestorsTable({
  ancestors,
  defaultNamespace,
}: {
  ancestors?: PolicyAncestorStatus[];
  defaultNamespace?: string;
}) {
  const { t } = useText();
  if (!ancestors || ancestors.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No ancestors reported.')}
      </Typography>
    );
  }

  return (
    <>
      {ancestors.map(ancestor => (
        <Box
          key={refKey(ancestor.ancestorRef, ancestor.ancestorRef.sectionName)}
          sx={{ mb: 2, '&:last-child': { mb: 0 } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <ResourceRefLink
              group={ancestor.ancestorRef.group}
              kind={ancestor.ancestorRef.kind}
              name={ancestor.ancestorRef.name}
              namespace={ancestor.ancestorRef.namespace || defaultNamespace}
              sectionName={ancestor.ancestorRef.sectionName}
            />
            {ancestor.controllerName && (
              <Typography variant="caption" color="text.secondary">
                {ancestor.controllerName}
              </Typography>
            )}
          </Box>
          <ConditionsTable conditions={ancestor.conditions} />
        </Box>
      ))}
    </>
  );
}

/** Standard "Conditions" + "Policy Ancestors" detail sections. */
export function statusSections(
  status: PolicyStatus | undefined,
  namespace: string | undefined,
  t: (s: string) => string
) {
  return [
    {
      id: 'eg-conditions',
      section: (status?.conditions?.length || !status?.ancestors?.length) && (
        <SectionBox title={t('Conditions')}>
          <ConditionsTable conditions={status?.conditions} />
        </SectionBox>
      ),
    },
    {
      id: 'eg-ancestors',
      section: !!status?.ancestors?.length && (
        <SectionBox title={t('Policy Ancestors')}>
          <PolicyAncestorsTable ancestors={status.ancestors} defaultNamespace={namespace} />
        </SectionBox>
      ),
    },
  ];
}

/** Renders a list of TargetRefs as links. */
export function TargetRefsList({
  targetRefs,
  targetSelectors,
  defaultNamespace,
}: {
  targetRefs?: TargetRef[];
  targetSelectors?: TargetSelector[];
  defaultNamespace?: string;
}) {
  const { t } = useText();
  const hasRefs = !!targetRefs && targetRefs.length > 0;
  const hasSelectors = !!targetSelectors && targetSelectors.length > 0;
  if (!hasRefs && !hasSelectors) return <>-</>;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
      {(targetRefs || []).map(ref => (
        <ResourceRefLink
          key={refKey(ref, ref.sectionName)}
          group={ref.group}
          kind={ref.kind}
          name={ref.name}
          namespace={ref.namespace || defaultNamespace}
          sectionName={ref.sectionName}
        />
      ))}
      {(targetSelectors || []).map(sel => {
        const labels = Object.entries(sel.matchLabels || {}).map(([k, v]) => `${k}=${v}`);
        const exprs = (sel.matchExpressions || []).map(e =>
          `${e.key} ${e.operator} ${(e.values || []).join(',')}`.trim()
        );
        const text = [...labels, ...exprs].join(', ');
        return (
          <Tooltip key={`${sel.kind}-${text}`} title={t('Label selector')}>
            <Chip
              size="small"
              variant="outlined"
              icon={<Icon icon="mdi:tag-multiple-outline" />}
              label={`${sel.kind}: ${text || '*'}`}
              sx={{ mr: 1 }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

/** Renders an array of strings as chips (or "-" when empty). */
export function StringArray({ items }: { items?: Array<string | number> }) {
  if (!items || items.length === 0) return <>-</>;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {items.map(item => (
        <Chip key={String(item)} label={String(item)} size="small" variant="outlined" />
      ))}
    </Box>
  );
}

export interface Feature {
  id: string;
  label: string;
  icon: string;
}

/** Renders the enabled features of a resource as icon chips. */
export function FeatureChips({ features }: { features: Feature[] }) {
  const { t } = useText();
  if (features.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('None')}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {features.map(f => (
        <Chip
          key={f.id}
          size="small"
          color="primary"
          variant="outlined"
          icon={<Icon icon={f.icon} width={16} />}
          label={f.label}
        />
      ))}
    </Box>
  );
}

type Plain = string | number | boolean | null | undefined;

function isPlain(v: unknown): v is Plain {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
}

function formatPlain(v: Plain): string {
  if (v === null || v === undefined) return '-';
  return String(v);
}

/**
 * Structured, read-only view of an arbitrary object: plain fields as a "key: value" list with an
 * accent bar, nested objects as titled sub-blocks. Used instead of raw JSON dumps.
 */
export function KeyValueBlock({ value }: { value: unknown }) {
  if (isPlain(value)) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
        {formatPlain(value)}
      </Typography>
    );
  }
  if (Array.isArray(value)) {
    if (value.every(isPlain)) {
      return (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {value.map(formatPlain).join(', ') || '-'}
        </Typography>
      );
    }
    return (
      <Box>
        {value.map((item, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Box key={i} sx={{ mb: 1 }}>
            <BlockTitle>#{i + 1}</BlockTitle>
            <KeyValueBlock value={item} />
          </Box>
        ))}
      </Box>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const plain = entries.filter(([, v]) => isPlain(v) || (Array.isArray(v) && v.every(isPlain)));
  const nested = entries.filter(([k]) => !plain.some(([pk]) => pk === k));

  return (
    <Box>
      {plain.length > 0 && (
        <Box
          sx={{
            borderLeft: '2px solid',
            borderColor: 'info.main',
            pl: 1.5,
            py: 0.25,
            my: 0.5,
            display: 'grid',
            gridTemplateColumns: 'max-content minmax(0, 1fr)',
            columnGap: 3,
            rowGap: 0.5,
          }}
        >
          {plain.map(([k, v]) => (
            <React.Fragment key={k}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {k}:
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-word' }}
              >
                {Array.isArray(v) ? v.map(formatPlain).join(', ') : formatPlain(v as Plain)}
              </Typography>
            </React.Fragment>
          ))}
        </Box>
      )}
      {nested.map(([k, v]) => (
        <Box key={k} sx={{ mt: 1 }}>
          <BlockTitle>{k}</BlockTitle>
          <KeyValueBlock value={v} />
        </Box>
      ))}
    </Box>
  );
}

function BlockTitle({ children }: React.PropsWithChildren<unknown>) {
  return (
    <Typography
      variant="caption"
      component="div"
      sx={{
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'text.secondary',
        mb: 0.25,
      }}
    >
      {children}
    </Typography>
  );
}

/** Translates a boolean to Yes/No, keeping "-" for undefined values. */
export function useYesNo() {
  const { t } = useText();
  return (value?: boolean, undefinedAsNo = false): string => {
    if (value === undefined && !undefinedAsNo) return '-';
    return value ? t('Yes') : t('No');
  };
}
