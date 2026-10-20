import { Icon } from '@iconify/react';
import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link as MuiLink,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { CodeBlock } from '../../components/common/CodeBlock';
import { LabelChips, TagList } from '../../components/common/Selectors';
import {
  AlertStateChip,
  AMAlertStatusChip,
  RuleHealthChip,
  SeverityChip,
  SilenceStateChip,
} from '../../components/common/StatusChip';
import { detailsRouteName } from '../../resources/crds';
import { AMAlert, AMSilence, PromAlert, PromRule } from '../../types';
import { formatSeconds, timeAgo } from '../../utils/duration';
import { formatMatcher } from '../../utils/matchers';

const { NameValueTable, Link } = CommonComponents;

function Annotations({ annotations }: { annotations?: Record<string, string> }) {
  const { t } = useText();
  const entries = Object.entries(annotations || {});
  if (entries.length === 0) return <Typography variant="body2">-</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {entries.map(([k, v]) => (
        <Box key={k}>
          <Typography variant="caption" color="text.secondary">
            {k}
          </Typography>
          {/^https?:\/\//.test(v) ? (
            <Typography variant="body2">
              <MuiLink href={v} target="_blank" rel="noopener noreferrer">
                {v} <Icon icon="mdi:open-in-new" width={12} aria-label={t('Opens in a new tab')} />
              </MuiLink>
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {v}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

export function RuleSourceLink({
  source,
}: {
  source?: { namespace: string; name: string } | null;
}) {
  if (!source) return <>-</>;
  return (
    <Link
      routeName={detailsRouteName('prometheusrules')}
      params={{ namespace: source.namespace, name: source.name }}
    >
      {source.namespace}/{source.name}
    </Link>
  );
}

export function AlertDetailsDialog({
  alert,
  amAlert,
  onClose,
  onSilence,
}: {
  alert: PromAlert | null;
  amAlert?: AMAlert | null;
  onClose: () => void;
  onSilence?: (alert: PromAlert) => void;
}) {
  const { t } = useText();
  if (!alert) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="alert-details-title">
      <DialogTitle id="alert-details-title">{alert.labels.alertname}</DialogTitle>
      <DialogContent dividers>
        <NameValueTable
          rows={[
            { name: t('State'), value: <AlertStateChip state={alert.state} /> },
            { name: t('Severity'), value: <SeverityChip severity={alert.labels.severity} /> },
            {
              name: t('Notification'),
              value: amAlert ? (
                <AMAlertStatusChip
                  state={amAlert.status.state}
                  silenced={amAlert.status.silencedBy.length > 0}
                  inhibited={amAlert.status.inhibitedBy.length > 0}
                />
              ) : (
                t('Not in Alertmanager yet')
              ),
            },
            {
              name: t('Receivers'),
              value: amAlert?.receivers?.map(r => r.name).join(', ') || '-',
              hide: !amAlert,
            },
            {
              name: t('Active since'),
              value: alert.activeAt
                ? `${new Date(alert.activeAt).toLocaleString()} (${t('{{ago}} ago', {
                    ago: timeAgo(alert.activeAt),
                  })})`
                : '-',
            },
            { name: t('Value'), value: alert.value || '-' },
            { name: t('Labels'), value: <LabelChips labels={alert.labels} /> },
            { name: t('Annotations'), value: <Annotations annotations={alert.annotations} /> },
          ]}
        />
      </DialogContent>
      <DialogActions>
        {onSilence && (
          <Button startIcon={<Icon icon="mdi:bell-off" />} onClick={() => onSilence(alert)}>
            {t('Silence')}
          </Button>
        )}
        <Button onClick={onClose}>{t('Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function RuleDetailsDialog({
  rule,
  group,
  source,
  onClose,
}: {
  rule: PromRule | null;
  group?: string;
  source?: { namespace: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useText();
  if (!rule) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="rule-details-title">
      <DialogTitle id="rule-details-title">{rule.name}</DialogTitle>
      <DialogContent dividers>
        <NameValueTable
          rows={[
            { name: t('Type'), value: rule.type === 'alerting' ? t('Alerting') : t('Recording') },
            {
              name: t('State'),
              value: <AlertStateChip state={rule.state} />,
              hide: rule.type !== 'alerting',
            },
            {
              name: t('Health'),
              value: <RuleHealthChip health={rule.health} error={rule.lastError} />,
            },
            { name: t('Last error'), value: rule.lastError || '-', hide: !rule.lastError },
            { name: t('Group'), value: group || '-' },
            { name: t('Source'), value: <RuleSourceLink source={source} /> },
            { name: t('For'), value: formatSeconds(rule.duration), hide: rule.type !== 'alerting' },
            {
              name: t('Last evaluation'),
              value: rule.lastEvaluation
                ? t('{{ago}} ago', { ago: timeAgo(rule.lastEvaluation) })
                : '-',
            },
            { name: t('Evaluation time'), value: formatSeconds(rule.evaluationTime) },
            { name: t('Query'), value: <CodeBlock code={rule.query} /> },
            { name: t('Labels'), value: <LabelChips labels={rule.labels} /> },
            { name: t('Annotations'), value: <Annotations annotations={rule.annotations} /> },
            {
              name: t('Active alerts'),
              value: String(rule.alerts?.length || 0),
              hide: rule.type !== 'alerting',
            },
          ]}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SilenceDetailsDialog({
  silence,
  affected,
  onClose,
  onEdit,
  onExpire,
  onRecreate,
}: {
  silence: AMSilence | null;
  affected?: AMAlert[];
  onClose: () => void;
  onEdit: (s: AMSilence) => void;
  onExpire: (s: AMSilence) => void;
  onRecreate: (s: AMSilence) => void;
}) {
  const { t } = useText();
  if (!silence) return null;
  const live = silence.status.state !== 'expired';
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="silence-details-title">
      <DialogTitle id="silence-details-title">{t('Silence details')}</DialogTitle>
      <DialogContent dividers>
        <NameValueTable
          rows={[
            { name: t('ID'), value: <code>{silence.id}</code> },
            { name: t('State'), value: <SilenceStateChip state={silence.status.state} /> },
            { name: t('Starts'), value: new Date(silence.startsAt).toLocaleString() },
            { name: t('Ends'), value: new Date(silence.endsAt).toLocaleString() },
            { name: t('Created by'), value: silence.createdBy || '-' },
            { name: t('Comment'), value: silence.comment || '-' },
            {
              name: t('Matchers'),
              value: <TagList items={silence.matchers.map(formatMatcher)} />,
            },
            {
              name: t('Silenced alerts'),
              value: affected?.length
                ? affected.map(a => a.labels.alertname).join(', ')
                : t('None currently'),
              hide: !live,
            },
          ]}
        />
      </DialogContent>
      <DialogActions>
        {live ? (
          <>
            <Button color="error" onClick={() => onExpire(silence)}>
              {t('Expire')}
            </Button>
            <Button onClick={() => onEdit(silence)}>{t('Edit')}</Button>
          </>
        ) : (
          <Button onClick={() => onRecreate(silence)}>{t('Recreate')}</Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>{t('Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
