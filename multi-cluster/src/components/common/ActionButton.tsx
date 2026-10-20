import { Icon } from '@iconify/react';
import { AuthVisible, ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { useText } from '../../common/i18n';
import { errorMessage } from '../../common/States';

export interface ConfirmSpec {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
}

/**
 * A context action: optional confirmation dialog, the request, and a success / error snackbar.
 * Rendered only when the user is authorized for `authVerb` on `authItem` (RBAC-aware).
 */
export function ActionButton({
  label,
  icon,
  run,
  successMessage,
  confirm,
  authItem,
  authVerb,
  subresource,
  namespace,
  variant = 'icon',
  color,
}: {
  label: string;
  icon: string;
  run: () => Promise<unknown>;
  successMessage: string;
  confirm?: ConfirmSpec;
  /** The object (or a reference object) to check permissions on; null hides the action. */
  authItem: KubeObject | null;
  authVerb: string;
  subresource?: string;
  namespace?: string;
  variant?: 'icon' | 'button' | 'contained';
  color?: 'primary' | 'error' | 'warning' | 'success' | 'inherit';
}) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState(false);

  const execute = async () => {
    setAsking(false);
    setBusy(true);
    try {
      await run();
      enqueueSnackbar(successMessage, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(t('{{label}} failed: {{error}}', { label, error: errorMessage(err) }), {
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };
  const start = () => (confirm ? setAsking(true) : execute());
  const busyIcon = <CircularProgress size={16} />;

  return (
    <AuthVisible
      item={authItem}
      authVerb={authVerb}
      subresource={subresource}
      namespace={namespace}
    >
      {variant === 'icon' ? (
        <Tooltip title={label}>
          <span>
            <IconButton
              aria-label={label}
              onClick={start}
              disabled={busy}
              color={color === 'inherit' ? undefined : color}
            >
              {busy ? busyIcon : <Icon icon={icon} />}
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          size="small"
          variant={variant === 'contained' ? 'contained' : 'outlined'}
          color={color}
          startIcon={busy ? busyIcon : <Icon icon={icon} />}
          onClick={start}
          disabled={busy}
        >
          {label}
        </Button>
      )}
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel || label}
          onConfirm={execute}
          handleClose={() => setAsking(false)}
        />
      )}
    </AuthVisible>
  );
}
