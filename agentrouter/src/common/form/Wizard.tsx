import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Step,
  StepButton,
  Stepper,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../i18n';
import { ValidationError } from './types';
import { useValidationMessage } from './validation';
import { ValidationList } from './ValidationList';

export interface WizardStep {
  id: string;
  label: string;
  description?: React.ReactNode;
  content: React.ReactNode;
  /** Errors that block leaving this step. */
  errors?: ValidationError[];
  optional?: boolean;
}

/**
 * Wizard shell: a stepper, the current step and Back / Next navigation; the last step's primary
 * button submits. All steps edit the same object(s), so a YAML tab always shows the full result.
 */
export function Wizard({
  steps,
  onSubmit,
  submitting,
  submitLabel,
  allErrors,
}: {
  steps: WizardStep[];
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  allErrors: ValidationError[];
}) {
  const { t } = useText();
  const translate = useValidationMessage();
  const [active, setActive] = React.useState(0);
  const [showErrors, setShowErrors] = React.useState(false);
  const step = steps[Math.min(active, steps.length - 1)];
  const isLast = active >= steps.length - 1;
  const stepErrors = step.errors || [];

  const goNext = () => {
    if (stepErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setActive(a => Math.min(a + 1, steps.length - 1));
  };

  return (
    <Box>
      <Stepper nonLinear activeStep={active} alternativeLabel sx={{ mb: 3 }}>
        {steps.map((s, i) => (
          <Step key={s.id} completed={i < active && !(s.errors || []).length}>
            <StepButton
              onClick={() => {
                setShowErrors(false);
                setActive(i);
              }}
              optional={
                s.optional ? <Typography variant="caption">{t('Optional')}</Typography> : undefined
              }
            >
              {s.label}
            </StepButton>
          </Step>
        ))}
      </Stepper>
      {step.description && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 2 }}>
          {step.description}
        </Typography>
      )}
      <Box sx={{ minHeight: 240 }}>{step.content}</Box>
      {showErrors && stepErrors.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {stepErrors.map(e => (
              <li key={`${e.key}-${JSON.stringify(e.params || {})}`}>{translate(e)}</li>
            ))}
          </Box>
        </Alert>
      )}
      {isLast && allErrors.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <ValidationList
            errors={allErrors}
            title={t('Complete these fields before creating:')}
            max={20}
          />
        </Box>
      )}
      <Box sx={{ display: 'flex', mt: 3, gap: 1 }}>
        <Button
          disabled={active === 0}
          onClick={() => {
            setShowErrors(false);
            setActive(a => Math.max(a - 1, 0));
          }}
          startIcon={<Icon icon="mdi:chevron-left" />}
        >
          {t('Back')}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {isLast ? (
          <Button
            variant="contained"
            onClick={onSubmit}
            disabled={submitting || allErrors.length > 0}
            startIcon={submitting ? <CircularProgress size={16} /> : <Icon icon="mdi:check" />}
          >
            {submitLabel}
          </Button>
        ) : (
          <Button variant="contained" onClick={goNext} endIcon={<Icon icon="mdi:chevron-right" />}>
            {t('Next')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/** Label / value rows for review steps. */
export function SummaryList({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' },
        rowGap: 1.5,
        columnGap: 2,
      }}
    >
      {rows.map(r => (
        <React.Fragment key={r.label}>
          <Typography variant="body2" color="text.secondary">
            {r.label}
          </Typography>
          <Box>{r.value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}
