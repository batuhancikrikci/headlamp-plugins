/**
 * The review step shown before anything is applied: client-side validation results, the
 * server-side dry-run and a diff of what will change.
 */
import { Icon } from '@iconify/react';
import { DiffEditor } from '@monaco-editor/react';
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { ApiFailure } from '../../utils/apiPaths';
import { ValidationIssue } from '../../utils/validation';
import { CodeBlock } from '../common/CodeBlock';

export type DryRunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'passed' }
  | { status: 'failed'; failure: ApiFailure };

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`}>
          {issue.path && (
            <Box component="code" sx={{ mr: 0.75, fontSize: '0.85em' }}>
              {issue.path}
            </Box>
          )}
          {issue.message}
        </li>
      ))}
    </Box>
  );
}

/** Explains an API failure: the summary and, when present, one line per rejected field. */
export function ApiFailureAlert({ failure, title }: { failure: ApiFailure; title: string }) {
  return (
    <Alert severity="error">
      <AlertTitle>{title}</AlertTitle>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {failure.summary}
      </Typography>
      {failure.causes.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {failure.causes.map((cause, index) => (
            <li key={index}>
              {cause.field && (
                <Box component="code" sx={{ mr: 0.75, fontSize: '0.85em' }}>
                  {cause.field}
                </Box>
              )}
              {cause.message}
            </li>
          ))}
        </Box>
      )}
      {failure.status === 403 && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Your account is not allowed to perform this change.
        </Typography>
      )}
    </Alert>
  );
}

export function DryRunStatus({
  state,
  onRetry,
  blocked,
}: {
  state: DryRunState;
  onRetry: () => void;
  /** Reason the dry-run cannot run (client-side errors), if any. */
  blocked?: string;
}) {
  if (blocked) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:server-off" />}>
        <AlertTitle>Server-side dry-run not started</AlertTitle>
        {blocked}
      </Alert>
    );
  }
  switch (state.status) {
    case 'running':
      return (
        <Alert severity="info" icon={<CircularProgress size={18} />}>
          Running a server-side dry-run…
        </Alert>
      );
    case 'passed':
      return (
        <Alert
          severity="success"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Run again
            </Button>
          }
        >
          <AlertTitle>Server-side dry-run passed</AlertTitle>
          The API server accepted the resource (schema, validation rules and admission webhooks)
          without persisting it.
        </Alert>
      );
    case 'failed':
      return (
        <Stack spacing={1}>
          <ApiFailureAlert failure={state.failure} title="Server-side dry-run failed" />
          <Box>
            <Button size="small" startIcon={<Icon icon="mdi:refresh" />} onClick={onRetry}>
              Run the dry-run again
            </Button>
          </Box>
        </Stack>
      );
    default:
      return null;
  }
}

export interface ReviewPanelProps {
  mode: 'create' | 'edit';
  /** YAML of the object as it is now on the server; empty when creating. */
  originalYaml: string;
  /** YAML that would be applied. */
  currentYaml: string;
  yamlError: string | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  dryRun: DryRunState;
  onRetryDryRun: () => void;
  applyFailure: ApiFailure | null;
}

export function ReviewPanel({
  mode,
  originalYaml,
  currentYaml,
  yamlError,
  errors,
  warnings,
  dryRun,
  onRetryDryRun,
  applyFailure,
}: ReviewPanelProps) {
  const theme = useTheme();
  const unchanged = mode === 'edit' && originalYaml === currentYaml;
  const blocked = yamlError
    ? 'Fix the YAML syntax error first.'
    : errors.length > 0
    ? 'Fix the problems listed above first.'
    : unchanged
    ? 'There are no changes to apply.'
    : undefined;

  return (
    <Stack spacing={2} sx={{ p: 3, height: '100%', boxSizing: 'border-box' }}>
      {yamlError && (
        <Alert severity="error">
          <AlertTitle>The YAML cannot be parsed</AlertTitle>
          {yamlError}
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert severity="error">
          <AlertTitle>
            {errors.length === 1
              ? '1 problem must be fixed'
              : `${errors.length} problems must be fixed`}
          </AlertTitle>
          <IssueList issues={errors} />
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>Worth a second look</AlertTitle>
          <IssueList issues={warnings} />
        </Alert>
      )}
      <DryRunStatus state={dryRun} onRetry={onRetryDryRun} blocked={blocked} />
      {applyFailure && (
        <ApiFailureAlert
          failure={applyFailure}
          title={
            mode === 'create'
              ? 'The resource could not be created'
              : 'The changes could not be saved'
          }
        />
      )}

      <Box sx={{ flexGrow: 1, minHeight: 260, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" gutterBottom>
          {mode === 'create' ? 'Resource to be created' : 'Changes to be applied'}
        </Typography>
        {mode === 'create' ? (
          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
            <CodeBlock code={currentYaml} />
          </Box>
        ) : unchanged ? (
          <Typography variant="body2" color="text.secondary">
            The resource is identical to the version on the server.
          </Typography>
        ) : (
          <Box
            sx={{
              flexGrow: 1,
              minHeight: 260,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <DiffEditor
              original={originalYaml}
              modified={currentYaml}
              language="yaml"
              theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
              height="100%"
              options={{
                readOnly: true,
                automaticLayout: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
              }}
            />
          </Box>
        )}
      </Box>
    </Stack>
  );
}
