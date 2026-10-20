/**
 * Generic wizard layout: a stepper, one step at a time and Back / Next navigation. All steps edit
 * the same resource through the form context, so the YAML tab always shows the complete result
 * and the wizard can be left for the YAML editor (and re-entered) at any point.
 */
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Typography,
} from '@mui/material';
import React from 'react';
import { asArray } from '../../utils/objects';
import { ValidationIssue } from '../../utils/validation';
import { useForm } from './form/FormContext';

export interface WizardStep {
  id: string;
  label: string;
  description?: React.ReactNode;
  content: React.ReactNode;
  /** Decides which validation paths belong to this step. */
  owns: (path: string) => boolean;
  optional?: boolean;
}

function IssueLines({ issues }: { issues: ValidationIssue[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`}>{issue.message}</li>
      ))}
    </Box>
  );
}

export function WizardShell({
  steps,
  summary,
  onReview,
  onRevealErrors,
  reviewLabel,
}: {
  steps: WizardStep[];
  /** Content of the final "Summary" step. */
  summary: React.ReactNode;
  onReview: () => void;
  onRevealErrors: () => void;
  reviewLabel: string;
}) {
  const { issues } = useForm();
  const [active, setActive] = React.useState(0);
  const [blocked, setBlocked] = React.useState(false);

  const errors = issues.filter(issue => issue.severity === 'error');
  const errorsOf = (step: WizardStep) => errors.filter(issue => step.owns(issue.path));
  const summaryIndex = steps.length;
  const isSummary = active === summaryIndex;
  const step = isSummary ? undefined : steps[active];
  const stepErrors = step ? errorsOf(step) : [];

  const go = (index: number) => {
    setBlocked(false);
    setActive(Math.max(0, Math.min(index, summaryIndex)));
  };

  const next = () => {
    if (stepErrors.length > 0) {
      // Show the errors on the fields and stay on the step.
      setBlocked(true);
      onRevealErrors();
      return;
    }
    go(active + 1);
  };

  return (
    <Box>
      <Stepper nonLinear activeStep={active} alternativeLabel sx={{ mb: 3 }}>
        {steps.map((s, index) => {
          const count = errorsOf(s).length;
          return (
            <Step key={s.id} completed={index < active && count === 0}>
              <StepButton
                onClick={() => go(index)}
                optional={
                  s.optional ? <Typography variant="caption">Optional</Typography> : undefined
                }
              >
                {s.label}
              </StepButton>
            </Step>
          );
        })}
        <Step key="summary" completed={false}>
          <StepButton onClick={() => go(summaryIndex)}>Summary</StepButton>
        </Step>
      </Stepper>

      {step?.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {step.description}
        </Typography>
      )}

      <Box sx={{ minHeight: 260 }}>{isSummary ? summary : step?.content}</Box>

      {blocked && stepErrors.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Complete this step before continuing:
          </Typography>
          <IssueLines issues={stepErrors} />
        </Alert>
      )}
      {isSummary && errors.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {errors.length === 1 ? 'One field still needs' : `${errors.length} fields still need`}{' '}
            attention:
          </Typography>
          <IssueLines issues={errors} />
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        <Button
          disabled={active === 0}
          onClick={() => go(active - 1)}
          startIcon={<Icon icon="mdi:chevron-left" />}
        >
          Back
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {isSummary ? (
          <Button
            variant="contained"
            onClick={onReview}
            endIcon={<Icon icon="mdi:chevron-right" />}
          >
            {reviewLabel}
          </Button>
        ) : (
          <Button variant="contained" onClick={next} endIcon={<Icon icon="mdi:chevron-right" />}>
            Next
          </Button>
        )}
      </Stack>
    </Box>
  );
}

/** Label / value rows for the summary step. */
export function SummaryList({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' },
          rowGap: 1.5,
          columnGap: 2,
        }}
      >
        {rows.map(row => (
          <React.Fragment key={row.label}>
            <Typography variant="body2" color="text.secondary">
              {row.label}
            </Typography>
            <Box sx={{ minWidth: 0, typography: 'body2' }}>{row.value}</Box>
          </React.Fragment>
        ))}
      </Box>
    </Paper>
  );
}

/**
 * Renders one titled card per item of a list, without add / remove controls: used by wizard
 * steps that configure one aspect of items created in an earlier step.
 */
export function ItemCards<T = Record<string, unknown>>({
  path,
  title,
  filter,
  empty,
  children,
}: {
  path: string;
  title: (item: T, index: number) => React.ReactNode;
  filter?: (item: T) => boolean;
  /** Shown when no item passes the filter. */
  empty: React.ReactNode;
  children: (itemPath: string, item: T, index: number) => React.ReactNode;
}) {
  const { get } = useForm();
  const items = asArray<T>(get(path))
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !filter || filter(item));

  if (items.length === 0) return <>{empty}</>;
  return (
    <Stack spacing={2}>
      {items.map(({ item, index }) => (
        <Paper key={index} variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2">{title(item, index)}</Typography>
          </Box>
          <Box sx={{ p: 2 }}>{children(`${path}.${index}`, item, index)}</Box>
        </Paper>
      ))}
    </Stack>
  );
}
