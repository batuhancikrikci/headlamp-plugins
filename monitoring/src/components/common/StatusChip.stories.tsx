import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import {
  AlertStateChip,
  AMAlertStatusChip,
  RuleHealthChip,
  SeverityChip,
  SilenceStateChip,
  TargetHealthChip,
  WorkloadHealthChip,
} from './StatusChip';

export default {
  title: 'monitoring/StatusChip',
} as Meta;

const Row = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>{children}</Box>
);

export const Severities: StoryFn = () => (
  <Row>
    <SeverityChip severity="critical" />
    <SeverityChip severity="warning" />
    <SeverityChip severity="info" />
    <SeverityChip severity="none" />
    <SeverityChip />
  </Row>
);

export const AlertStates: StoryFn = () => (
  <Row>
    <AlertStateChip state="firing" />
    <AlertStateChip state="pending" />
    <AlertStateChip state="inactive" />
    <AlertStateChip />
    <AMAlertStatusChip state="active" />
    <AMAlertStatusChip state="suppressed" silenced />
    <AMAlertStatusChip state="suppressed" inhibited />
  </Row>
);

export const Health: StoryFn = () => (
  <Row>
    <TargetHealthChip health="up" />
    <TargetHealthChip health="down" error="connection refused" />
    <TargetHealthChip health="unknown" />
    <RuleHealthChip health="ok" />
    <RuleHealthChip health="err" error="bad expression" />
    <SilenceStateChip state="active" />
    <SilenceStateChip state="pending" />
    <SilenceStateChip state="expired" />
  </Row>
);

export const Workloads: StoryFn = () => (
  <Row>
    <WorkloadHealthChip health="Available" />
    <WorkloadHealthChip health="Reconciling" />
    <WorkloadHealthChip health="Degraded" />
    <WorkloadHealthChip health="Paused" />
    <WorkloadHealthChip health="Unknown" />
  </Row>
);
