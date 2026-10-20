import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { ApiFailure } from '../../utils/apiPaths';
import { ApiFailureAlert, DryRunStatus, ReviewPanel } from './ReviewPanel';

export default {
  title: 'GatewayAPI/Review',
  decorators: [
    Story => (
      <Box sx={{ p: 3, maxWidth: 960, height: 640 }}>
        <Story />
      </Box>
    ),
  ],
} as Meta;

const invalid: ApiFailure = {
  status: 422,
  summary: 'HTTPRoute.gateway.networking.k8s.io "web" is invalid',
  causes: [
    { field: 'spec.rules[0].backendRefs[0].port', message: 'Required value' },
    { field: 'spec.hostnames[0]', message: 'Invalid value: "Bad Host": must be a valid hostname' },
  ],
};

const yaml = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: apps
spec:
  parentRefs:
    - name: eg
      namespace: infra
`;

const noop = () => undefined;

/** Loading state: the dry-run is running. */
export const DryRunLoading: StoryFn = () => (
  <DryRunStatus state={{ status: 'running' }} onRetry={noop} />
);

export const DryRunPassed: StoryFn = () => (
  <DryRunStatus state={{ status: 'passed' }} onRetry={noop} />
);

/** Error state: the API server rejected the resource. */
export const DryRunError: StoryFn = () => (
  <DryRunStatus state={{ status: 'failed', failure: invalid }} onRetry={noop} />
);

export const DryRunBlocked: StoryFn = () => (
  <DryRunStatus
    state={{ status: 'idle' }}
    onRetry={noop}
    blocked="Fix the problems listed above first."
  />
);

export const PermissionError: StoryFn = () => (
  <ApiFailureAlert
    title="The resource could not be created"
    failure={{
      status: 403,
      summary: 'httproutes.gateway.networking.k8s.io is forbidden: User "dev" cannot create',
      causes: [],
    }}
  />
);

export const CreateWithProblems: StoryFn = () => (
  <ReviewPanel
    mode="create"
    originalYaml=""
    currentYaml={yaml}
    yamlError={null}
    errors={[
      {
        path: 'spec.rules.0.backendRefs.0.name',
        message: 'Backend name is required',
        severity: 'error',
      },
    ]}
    warnings={[
      {
        path: 'spec.hostnames',
        message: 'No hostname: every hostname of the listener matches',
        severity: 'warning',
      },
    ]}
    dryRun={{ status: 'idle' }}
    onRetryDryRun={noop}
    applyFailure={null}
  />
);

export const CreateReady: StoryFn = () => (
  <ReviewPanel
    mode="create"
    originalYaml=""
    currentYaml={yaml}
    yamlError={null}
    errors={[]}
    warnings={[]}
    dryRun={{ status: 'passed' }}
    onRetryDryRun={noop}
    applyFailure={null}
  />
);
