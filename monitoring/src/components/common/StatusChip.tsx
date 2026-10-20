import { Icon } from '@iconify/react';
import { Chip, ChipProps, Tooltip } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';

export type Tone = 'success' | 'error' | 'warning' | 'info' | 'default';

export interface StatusChipProps {
  tone: Tone;
  label: React.ReactNode;
  icon?: string;
  tooltip?: React.ReactNode;
  variant?: ChipProps['variant'];
  size?: ChipProps['size'];
}

/**
 * Theme-aware status chip. Colors come from the MUI palette so they follow
 * Headlamp's light/dark/custom themes (no hard-coded hex values).
 */
export function StatusChip({
  tone,
  label,
  icon,
  tooltip,
  variant = 'filled',
  size = 'small',
}: StatusChipProps) {
  const chip = (
    <Chip
      size={size}
      variant={variant}
      color={tone}
      label={label}
      icon={icon ? <Icon icon={icon} width="1.1em" height="1.1em" /> : undefined}
      sx={{ fontWeight: 500, '& .MuiChip-icon': { color: 'inherit' } }}
    />
  );
  return tooltip ? (
    <Tooltip title={tooltip}>
      <span>{chip}</span>
    </Tooltip>
  ) : (
    chip
  );
}

export function severityTone(severity?: string): Tone {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
    case 'error':
    case 'page':
      return 'error';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'info':
    case 'informational':
      return 'info';
    default:
      return 'default';
  }
}

const SEVERITY_ICON: Record<Tone, string> = {
  error: 'mdi:alert-circle',
  warning: 'mdi:alert',
  info: 'mdi:information',
  success: 'mdi:check-circle',
  default: 'mdi:help-circle',
};

export function SeverityChip({ severity }: { severity?: string }) {
  const { t } = useText();
  const tone = severityTone(severity);
  return <StatusChip tone={tone} icon={SEVERITY_ICON[tone]} label={severity || t('none')} />;
}

/** Prometheus alert/rule state: firing | pending | inactive. */
export function AlertStateChip({ state }: { state?: string }) {
  const { t } = useText();
  switch (state) {
    case 'firing':
      return <StatusChip tone="error" icon="mdi:bell-ring" label={t('Firing')} />;
    case 'pending':
      return <StatusChip tone="warning" icon="mdi:timer-sand" label={t('Pending')} />;
    case 'inactive':
      return (
        <StatusChip
          tone="success"
          icon="mdi:check-circle"
          label={t('Inactive')}
          variant="outlined"
        />
      );
    default:
      return <StatusChip tone="default" icon="mdi:help-circle" label={state || t('Unknown')} />;
  }
}

/** Alertmanager alert status: active | suppressed | unprocessed. */
export function AMAlertStatusChip({
  state,
  silenced,
  inhibited,
}: {
  state: string;
  silenced?: boolean;
  inhibited?: boolean;
}) {
  const { t } = useText();
  if (silenced) return <StatusChip tone="default" icon="mdi:bell-off" label={t('Silenced')} />;
  if (inhibited) return <StatusChip tone="default" icon="mdi:bell-sleep" label={t('Inhibited')} />;
  if (state === 'active')
    return <StatusChip tone="error" icon="mdi:bell-ring" label={t('Active')} />;
  return <StatusChip tone="default" label={state} />;
}

export function TargetHealthChip({ health, error }: { health?: string; error?: string }) {
  const { t } = useText();
  if (health === 'up') return <StatusChip tone="success" icon="mdi:check-circle" label={t('Up')} />;
  if (health === 'down') {
    return (
      <StatusChip
        tone="error"
        icon="mdi:alert-circle"
        label={t('Down')}
        tooltip={error || undefined}
      />
    );
  }
  return <StatusChip tone="default" icon="mdi:help-circle" label={t('Unknown')} />;
}

export function SilenceStateChip({ state }: { state?: string }) {
  const { t } = useText();
  switch (state) {
    case 'active':
      return <StatusChip tone="success" icon="mdi:bell-off" label={t('Active')} />;
    case 'pending':
      return <StatusChip tone="info" icon="mdi:timer-sand" label={t('Pending')} />;
    case 'expired':
      return <StatusChip tone="default" label={t('Expired')} variant="outlined" />;
    default:
      return <StatusChip tone="default" label={state || t('Unknown')} />;
  }
}

/** Rule evaluation health from /api/v1/rules. */
export function RuleHealthChip({ health, error }: { health?: string; error?: string }) {
  const { t } = useText();
  if (health === 'ok') return <StatusChip tone="success" label={t('OK')} variant="outlined" />;
  if (health === 'err') return <StatusChip tone="error" label={t('Error')} tooltip={error} />;
  return <StatusChip tone="default" label={t('Unknown')} variant="outlined" />;
}

/** Workload health (Prometheus/Alertmanager/ThanosRuler). */
export function WorkloadHealthChip({ health }: { health: string }) {
  const { t } = useText();
  switch (health) {
    case 'Available':
      return <StatusChip tone="success" icon="mdi:check-circle" label={t('Available')} />;
    case 'Reconciling':
      return <StatusChip tone="info" icon="mdi:sync" label={t('Reconciling')} />;
    case 'Degraded':
      return <StatusChip tone="error" icon="mdi:alert-circle" label={t('Degraded')} />;
    case 'Paused':
      return <StatusChip tone="warning" icon="mdi:pause-circle" label={t('Paused')} />;
    default:
      return <StatusChip tone="default" icon="mdi:help-circle" label={t('Unknown')} />;
  }
}
