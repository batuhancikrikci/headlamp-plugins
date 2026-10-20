import { Box, Stack } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { Condition } from '../../resources/types';
import { computeHealth } from '../../utils/conditions';
import { CodeBlock } from './CodeBlock';
import { ConditionChips, ConditionsTable, HealthChip, ProblemsAlert } from './Status';

export default {
  title: 'GatewayAPI/Status',
  decorators: [
    Story => (
      <Box sx={{ p: 3, maxWidth: 960 }}>
        <Story />
      </Box>
    ),
  ],
} as Meta;

const at = '2026-10-02T15:47:27Z';
const accepted: Condition = {
  type: 'Accepted',
  status: 'True',
  reason: 'Accepted',
  message: 'The Gateway has been scheduled by Envoy Gateway',
  lastTransitionTime: at,
};
const programmed: Condition = {
  type: 'Programmed',
  status: 'True',
  reason: 'Programmed',
  message: 'Address assigned to the Gateway, 1/1 envoy replicas available',
  lastTransitionTime: at,
};
const noAddress: Condition = {
  type: 'Programmed',
  status: 'False',
  reason: 'AddressNotAssigned',
  message: 'No addresses have been assigned to the Gateway',
  lastTransitionTime: at,
};
const pending: Condition = {
  type: 'Accepted',
  status: 'Unknown',
  reason: 'Pending',
  message: 'Waiting for controller',
  lastTransitionTime: '1970-01-01T00:00:00Z',
};

const gateway = (conditions: Condition[]) => ({ kind: 'Gateway', status: { conditions } });

const healthy = computeHealth(gateway([accepted, programmed]));
const failing = computeHealth(gateway([accepted, noAddress]));
const degraded = computeHealth(
  gateway([
    { ...accepted, reason: 'ListenersNotValid', message: 'Some listeners are invalid' },
    programmed,
  ])
);
const waiting = computeHealth(gateway([pending]));

export const HealthChips: StoryFn = () => (
  <Stack direction="row" spacing={2} alignItems="center">
    <HealthChip health={healthy} />
    <HealthChip health={degraded} />
    <HealthChip health={failing} />
    <HealthChip health={waiting} />
    <HealthChip health={computeHealth({ kind: 'ReferenceGrant' })} />
  </Stack>
);

export const Conditions: StoryFn = () => (
  <Stack spacing={2}>
    <ConditionChips conditions={[accepted, noAddress]} />
    <ConditionsTable conditions={[accepted, noAddress]} generation={2} />
  </Stack>
);

/** Loading-like state: nothing has been reported by a controller yet. */
export const ConditionsEmpty: StoryFn = () => <ConditionsTable conditions={[]} />;

/** Error state of a detail page header. */
export const ProblemsError: StoryFn = () => <ProblemsAlert health={failing} />;

export const Code: StoryFn = () => (
  <CodeBlock code="kubectl apply --server-side -f standard-install.yaml" />
);
