import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this text to confirm. */
  typeToConfirm?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Confirmation dialog that runs an async action and shows its error inline. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  typeToConfirm,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setError(null);
      setTyped('');
      setBusy(false);
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = !!typeToConfirm && typed !== typeToConfirm;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{message}</DialogContentText>
        {typeToConfirm && (
          <TextField
            sx={{ mt: 2 }}
            fullWidth
            size="small"
            label={t('Type {{name}} to confirm', { name: typeToConfirm })}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={confirm}
          color={danger ? 'error' : 'primary'}
          variant="contained"
          disabled={busy || blocked}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
