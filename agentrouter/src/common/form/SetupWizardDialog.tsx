import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { PLUGIN } from '../../plugin';
import { CodeBlock } from '../CodeBlock';
import { useText } from '../i18n';
import { errorMessage } from '../States';
import { dumpAllYaml } from '../yaml';
import { applyForWizard, WizardApplyResult } from './apply';
import { KubeJson } from './types';
import { validateAll } from './validation';
import { Wizard, WizardStep } from './Wizard';

type ApplyState = 'pending' | 'applying' | 'applied' | 'failed';

const STATE_ICON: Record<ApplyState, { icon: string; color: string }> = {
  pending: { icon: 'mdi:circle-outline', color: 'text.disabled' },
  applying: { icon: 'mdi:loading', color: 'info.main' },
  applied: { icon: 'mdi:check-circle', color: 'success.main' },
  failed: { icon: 'mdi:alert-circle', color: 'error.main' },
};

/**
 * Dialog for guided flows that create several related resources. The caller owns the resources
 * and the steps that edit them; this dialog appends the review step (summary, resource table and
 * YAML preview) and applies the resources in order, stopping at the first failure.
 */
export function SetupWizardDialog({
  open,
  onClose,
  title,
  steps,
  resources,
  summary,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  steps: WizardStep[];
  /** Resources to create, in apply order. */
  resources: KubeJson[];
  summary?: React.ReactNode;
  /** Called after every resource was applied (e.g. to navigate to the new object). */
  onApplied?: (resources: KubeJson[]) => void;
}) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const [submitting, setSubmitting] = React.useState(false);
  const [results, setResults] = React.useState<
    Record<number, { state: ApplyState; error?: string; outcome?: WizardApplyResult }>
  >({});
  const errors = React.useMemo(() => validateAll(resources), [resources]);
  const failed = Object.values(results).some(r => r.state === 'failed');

  const apply = async () => {
    setSubmitting(true);
    const next: Record<number, { state: ApplyState; error?: string; outcome?: WizardApplyResult }> =
      {};
    let ok = true;
    for (let i = 0; i < resources.length; i++) {
      next[i] = { state: 'applying' };
      setResults({ ...next });
      try {
        const outcome = await applyForWizard(resources[i]);
        next[i] = { state: 'applied', outcome };
      } catch (err) {
        next[i] = { state: 'failed', error: errorMessage(err) };
        ok = false;
      }
      setResults({ ...next });
      // Later resources reference earlier ones; stop at the first failure.
      if (!ok) break;
    }
    setSubmitting(false);
    if (ok) {
      enqueueSnackbar(t('{{count}} resource(s) applied', { count: resources.length }), {
        variant: 'success',
      });
      onClose();
      onApplied?.(resources);
    }
  };

  const review: WizardStep = {
    id: 'review',
    label: t('Review'),
    description: t(
      'These resources will be applied in this order. Check the generated YAML before applying.'
    ),
    content: (
      <Box>
        {summary && <Box sx={{ mb: 2 }}>{summary}</Box>}
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell>{t('Kind')}</TableCell>
              <TableCell>{t('Name')}</TableCell>
              <TableCell>{t('Result')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {resources.map((resource, i) => {
              const result = results[i] || { state: 'pending' as ApplyState };
              const visual = STATE_ICON[result.state];
              return (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={i}>
                  <TableCell>
                    <Box sx={{ color: visual.color, display: 'flex' }}>
                      <Icon icon={visual.icon} width={20} />
                    </Box>
                  </TableCell>
                  <TableCell>{resource.kind}</TableCell>
                  <TableCell>
                    {resource.metadata?.namespace ? `${resource.metadata.namespace}/` : ''}
                    {resource.metadata?.name || '-'}
                  </TableCell>
                  <TableCell>
                    {result.state === 'applied' &&
                      (result.outcome === 'updated'
                        ? t('Updated (already existed)')
                        : result.outcome === 'skipped'
                        ? t('Already exists, left unchanged')
                        : t('Created'))}
                    {result.state === 'applying' && t('Applying…')}
                    {result.state === 'pending' && '-'}
                    {result.state === 'failed' && (
                      <Typography variant="body2" color="error.main">
                        {result.error}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {failed && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t(
              'Applying stopped at the first failure. Resources marked as applied already exist; fix the problem and apply again (applying is idempotent).'
            )}
          </Alert>
        )}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('YAML preview')}
        </Typography>
        <CodeBlock value={dumpAllYaml(resources)} maxHeight={360} />
      </Box>
    ),
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { minHeight: '75vh' } }}
      aria-labelledby={`${PLUGIN.name}-setup-wizard-title`}
    >
      <DialogTitle
        id={`${PLUGIN.name}-setup-wizard-title`}
        sx={{ display: 'flex', alignItems: 'center', pr: 1 }}
      >
        <Box sx={{ flexGrow: 1 }}>{title}</Box>
        <IconButton aria-label={t('Close')} onClick={onClose} disabled={submitting}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Wizard
          steps={[...steps, review]}
          onSubmit={apply}
          submitting={submitting}
          submitLabel={
            failed
              ? t('Apply again')
              : t('Apply {{count}} resource(s)', { count: resources.length })
          }
          allErrors={errors}
        />
      </DialogContent>
    </Dialog>
  );
}
