import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Step,
  StepButton,
  Stepper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { FormIssue } from './ResourceEditorDialog';

export interface WizardStep {
  /** Stable id (never derive keys from translated labels: t() is '' on first render). */
  id: string;
  label: string;
  description?: string;
  content: React.ReactNode;
  /** Issues that block leaving this step. */
  errors?: FormIssue[];
  optional?: boolean;
}

/**
 * Wizard shell: labelled stepper, current step, Back / Next and the final
 * Create button. All steps edit the same object, so the YAML tab of the
 * dialog always shows the full result.
 */
export function Wizard({
  steps,
  onSubmit,
  submitting,
  submitLabel,
  allErrors,
  onBlocked,
}: {
  steps: WizardStep[];
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  /** All validation issues, checked before submitting. */
  allErrors: FormIssue[];
  /** Called when Next/Create is blocked, so fields can highlight their errors. */
  onBlocked?: () => void;
}) {
  const { t } = useText();
  const [active, setActive] = React.useState(0);
  const [showStepErrors, setShowStepErrors] = React.useState(false);
  const index = Math.min(active, steps.length - 1);
  const step = steps[index];
  const isLast = index >= steps.length - 1;
  const stepErrors = step.errors || [];

  const go = (i: number) => {
    setShowStepErrors(false);
    setActive(i);
  };

  const goNext = () => {
    if (stepErrors.length > 0) {
      setShowStepErrors(true);
      onBlocked?.();
      return;
    }
    go(Math.min(index + 1, steps.length - 1));
  };

  return (
    <Box>
      <Stepper nonLinear activeStep={index} alternativeLabel sx={{ mb: 3 }}>
        {steps.map((s, i) => (
          <Step key={s.id} completed={i < index && !(s.errors || []).length}>
            <StepButton
              onClick={() => go(i)}
              optional={
                s.optional ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('Optional')}
                  </Typography>
                ) : undefined
              }
            >
              {s.label}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {step.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {step.description}
        </Typography>
      )}

      <Box sx={{ minHeight: 240 }}>{step.content}</Box>

      {showStepErrors && stepErrors.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {stepErrors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </Box>
        </Alert>
      )}
      {isLast && allErrors.length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }} icon={<Icon icon="mdi:clipboard-check-outline" />}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('Complete these fields before creating:')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {allErrors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', mt: 3, gap: 1 }}>
        <Button
          disabled={index === 0}
          onClick={() => go(index - 1)}
          startIcon={<Icon icon="mdi:chevron-left" />}
        >
          {t('Back')}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {isLast ? (
          <Button
            variant="contained"
            onClick={() => {
              if (allErrors.length) onBlocked?.();
              else onSubmit();
            }}
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

/** Named tabs used by the non-wizard forms (create with form / edit). */
export function FormTabs({
  tabs,
}: {
  tabs: Array<{ id: string; label: string; content: React.ReactNode }>;
}) {
  const [active, setActive] = React.useState(tabs[0]?.id);
  const current = tabs.find(tab => tab.id === active) || tabs[0];
  if (tabs.length === 1) return <>{current.content}</>;
  return (
    <Box>
      <Tabs
        value={current?.id}
        onChange={(_, v) => setActive(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map(tab => (
          <Tab key={tab.id} value={tab.id} label={tab.label} sx={{ textTransform: 'none' }} />
        ))}
      </Tabs>
      {current?.content}
    </Box>
  );
}

/** Label / value grid for the Review step. */
export function SummaryList({
  rows,
}: {
  rows: Array<{ id: string; label: string; value: React.ReactNode }>;
}) {
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
        <React.Fragment key={r.id}>
          <Typography variant="body2" color="text.secondary">
            {r.label}
          </Typography>
          <Box>{r.value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}
