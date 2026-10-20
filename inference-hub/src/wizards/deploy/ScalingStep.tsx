import {
  Alert,
  Box,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { totalGpus } from './deployModel';
import { fieldError, StepProps } from './stepTypes';

export function ScalingStep({ form, update, errors }: StepProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <RadioGroup
        value={form.autoscale ? 'auto' : 'fixed'}
        onChange={e => update({ autoscale: e.target.value === 'auto' })}
      >
        <FormControlLabel value="fixed" control={<Radio />} label={t('Fixed number of replicas')} />
        <FormControlLabel
          value="auto"
          control={<Radio />}
          label={t('Autoscale between a minimum and a maximum')}
        />
      </RadioGroup>

      {form.autoscale ? (
        <>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <TextField
                fullWidth
                type="number"
                label={t('Minimum')}
                value={form.minReplicas}
                onChange={e => update({ minReplicas: Number(e.target.value) })}
                {...fieldError(errors, 'minReplicas')}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                fullWidth
                type="number"
                label={t('Maximum')}
                value={form.maxReplicas}
                onChange={e => update({ maxReplicas: Number(e.target.value) })}
                {...fieldError(errors, 'maxReplicas')}
              />
            </Grid>
          </Grid>
          <Alert severity="info">
            {form.mode === 'llm'
              ? t(
                  'LLMInferenceService autoscaling (spec.scaling) is driven by the llm-d workload variant autoscaler with HPA or KEDA; install it before relying on scaling.'
                )
              : form.isvcDeploymentMode === 'Knative'
              ? t('Knative scales on concurrency and can scale to zero when the minimum is 0.')
              : t('KServe creates an HPA for the predictor (CPU utilization by default).')}
          </Alert>
        </>
      ) : (
        <TextField
          sx={{ width: 200 }}
          type="number"
          label={t('Replicas')}
          value={form.replicas}
          onChange={e => update({ replicas: Number(e.target.value) })}
          {...fieldError(errors, 'replicas')}
        />
      )}

      <Typography variant="body2" color="text.secondary">
        {t('This deployment requests {{n}} GPU device(s) at its minimum size.', {
          n: totalGpus(form),
        })}
      </Typography>
    </Box>
  );
}
