import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { WorkloadSelection } from '../../hooks/useWorkloads';
import { Condition, Labels, WorkloadBinding } from '../../types';
import { requiredLabelsFor, SelectableKind } from '../../utils/relations';
import { StatusChip } from '../common/StatusChip';

const { SectionBox, SimpleTable, Link } = CommonComponents;

/** Compact "selected by" cell for list views; warns when nothing picks the resource up. */
export function SelectedByCell({ selections }: { selections: WorkloadSelection[] }) {
  const { t } = useText();
  const selected = selections.filter(s => s.result === 'selected');
  const unknown = selections.filter(s => s.result === 'unknown');
  if (selected.length === 0 && unknown.length === 0) {
    return (
      <StatusChip
        tone="warning"
        icon="mdi:alert"
        label={t('Not selected')}
        variant="outlined"
        tooltip={t(
          'No workload selects this resource; it has no effect. Check the labels required by the Prometheus/Alertmanager selectors.'
        )}
      />
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {selected.map(s => (
        <Chip
          key={s.workload.metadata.uid}
          size="small"
          variant="outlined"
          label={s.workload.metadata.name}
        />
      ))}
      {unknown.map(s => (
        <Tooltip
          key={s.workload.metadata.uid}
          title={t('Depends on namespace labels that cannot be read')}
        >
          <Chip size="small" variant="outlined" label={`${s.workload.metadata.name}?`} />
        </Tooltip>
      ))}
    </Box>
  );
}

function bindingFor(bindings: WorkloadBinding[], ws: WorkloadSelection) {
  return bindings.find(
    b => b.name === ws.workload.metadata.name && b.namespace === ws.workload.metadata.namespace
  );
}

function BindingChip({ conditions }: { conditions?: Condition[] }) {
  const { t } = useText();
  const accepted = conditions?.find(c => c.type === 'Accepted');
  if (!accepted) return <>-</>;
  return accepted.status === 'True' ? (
    <StatusChip tone="success" label={t('Accepted')} variant="outlined" />
  ) : (
    <StatusChip tone="error" label={accepted.reason || t('Rejected')} tooltip={accepted.message} />
  );
}

/**
 * Details section: which workloads select this resource and, when they don't,
 * which labels would be needed (e.g. kube-prometheus-stack's `release` label).
 */
export function SelectedBySection({
  kind,
  selections,
  resourceLabels,
  bindings = [],
}: {
  kind: SelectableKind;
  selections: WorkloadSelection[];
  resourceLabels?: Labels;
  bindings?: WorkloadBinding[];
}) {
  const { t } = useText();
  const anySelected = selections.some(s => s.result !== 'not-selected');
  return (
    <SectionBox title={t('Selected by')}>
      {!anySelected && selections.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t(
            'No workload selects this {{kind}}, so it currently has no effect. Add the labels listed below or move it to a selected namespace.',
            { kind }
          )}
        </Alert>
      )}
      <SimpleTable
        data={selections}
        emptyMessage={t('No workloads found that could select this resource.')}
        columns={[
          {
            label: t('Workload'),
            getter: (s: WorkloadSelection) => (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  {s.workload.kind}
                </Typography>
                <Link kubeObject={s.workload}>
                  {s.workload.metadata.namespace}/{s.workload.metadata.name}
                </Link>
              </Box>
            ),
          },
          {
            label: t('Selection'),
            getter: (s: WorkloadSelection) =>
              s.result === 'selected' ? (
                <StatusChip tone="success" icon="mdi:check-circle" label={t('Selected')} />
              ) : s.result === 'unknown' ? (
                <StatusChip
                  tone="default"
                  icon="mdi:help-circle"
                  label={t('Unknown')}
                  tooltip={t('Depends on namespace labels that cannot be read')}
                />
              ) : (
                <StatusChip tone="default" label={t('Not selected')} variant="outlined" />
              ),
          },
          {
            label: t('Operator status'),
            getter: (s: WorkloadSelection) => (
              <BindingChip conditions={bindingFor(bindings, s)?.conditions} />
            ),
          },
          {
            label: t('Hint'),
            getter: (s: WorkloadSelection) => {
              if (s.result !== 'not-selected') return '-';
              const required = requiredLabelsFor(s.workload.jsonData, kind);
              if (required === null) {
                return (
                  <Typography variant="body2" color="text.secondary">
                    {t('Its selector is not set, so it selects nothing of this kind.')}
                  </Typography>
                );
              }
              const missing = Object.entries(required).filter(
                ([k, v]) => resourceLabels?.[k] !== v
              );
              if (missing.length === 0) {
                return (
                  <Typography variant="body2" color="text.secondary">
                    {t('Namespace is not selected by the workload.')}
                  </Typography>
                );
              }
              return (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('Missing labels:')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {missing.map(([k, v]) => (
                      <Chip
                        key={k}
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`${k}=${v}`}
                      />
                    ))}
                  </Box>
                </Box>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}
