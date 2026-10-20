import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { EmptyState, ErrorState, ForbiddenState } from '../../common/States';
import {
  ConditionsTable,
  DeprecatedChip,
  FeatureChips,
  HealthLabel,
  SelectorView,
  StringArray,
  SummaryTiles,
  UsageBar,
} from './Shared';

export default {
  title: 'Cilium/Shared',
  decorators: [
    Story => (
      <BrowserRouter>
        <Box sx={{ p: 3, maxWidth: 900 }}>
          <Story />
        </Box>
      </BrowserRouter>
    ),
  ],
} as Meta;

export const HealthLabels: StoryFn = () => (
  <Box sx={{ display: 'flex', gap: 1 }}>
    <HealthLabel health="success" label="Valid" />
    <HealthLabel health="warning" label="Exhausted" tooltip="No free addresses left" />
    <HealthLabel health="error" label="Conflict" />
    <HealthLabel health="unknown" label="No status" />
    <DeprecatedChip />
  </Box>
);

export const Selectors: StoryFn = () => (
  <Box sx={{ display: 'grid', gap: 2 }}>
    <SelectorView
      selector={{
        matchLabels: { app: 'web', 'k8s:io.kubernetes.pod.namespace': 'shop' },
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['frontend', 'edge'] },
          { key: 'legacy', operator: 'DoesNotExist' },
        ],
      }}
    />
    <SelectorView selector={{}} emptyLabel="All endpoints" />
    <SelectorView selector={undefined} nilLabel="None (nothing is advertised)" />
  </Box>
);

export const PositiveConditions: StoryFn = () => (
  <ConditionsTable
    conditions={[
      {
        type: 'Valid',
        status: 'False',
        reason: 'InvalidPolicy',
        message: 'ports.port: invalid value "http-alt-port-name-too-long"',
        lastTransitionTime: '2026-09-21T08:30:00Z',
      },
    ]}
  />
);

export const ProblemConditions: StoryFn = () => (
  <ConditionsTable
    polarity="problem"
    conditions={[
      {
        type: 'cilium.io/NoMatchingNode',
        status: 'False',
        lastTransitionTime: '2026-09-20T10:00:00Z',
      },
      {
        type: 'cilium.io/MissingPeerConfigs',
        status: 'True',
        message: 'Missing CiliumBGPPeerConfig(s): [tor-peers]',
        lastTransitionTime: '2026-09-21T08:30:00Z',
      },
    ]}
  />
);

export const NoConditions: StoryFn = () => <ConditionsTable conditions={[]} />;

export const Chips: StoryFn = () => (
  <Box sx={{ display: 'grid', gap: 2 }}>
    <StringArray items={['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']} monospace />
    <StringArray items={Array.from({ length: 14 }, (_, i) => `10.${i}.0.0/16`)} max={5} monospace />
    <FeatureChips
      features={[
        { id: 'l7', label: 'L7', icon: 'mdi:layers-triple-outline' },
        { id: 'fqdn', label: 'FQDN', icon: 'mdi:web' },
        { id: 'deny', label: 'Deny', icon: 'mdi:cancel', color: 'error' },
      ]}
    />
  </Box>
);

export const Tiles: StoryFn = () => (
  <SummaryTiles
    tiles={[
      {
        id: 'agent',
        label: 'Agent',
        value: '5/6 ready',
        icon: 'mdi:hexagon-multiple',
        color: 'warning.main',
        caption: '3 restart(s)',
      },
      { id: 'policies', label: 'Network policies', value: 42, icon: 'mdi:shield-lock-outline' },
      {
        id: 'bgp',
        label: 'BGP sessions established',
        value: '4/4',
        icon: 'mdi:router-network',
        color: 'success.main',
      },
    ]}
  />
);

export const Usage: StoryFn = () => (
  <Box sx={{ display: 'grid', gap: 1, maxWidth: 320 }}>
    <UsageBar used={4} total={254} />
    <UsageBar used={220} total={254} />
    <UsageBar used={254} total={254} />
    <UsageBar />
  </Box>
);

export const Empty: StoryFn = () => (
  <EmptyState
    icon="mdi:check-circle-outline"
    title="Nothing needs attention"
    description="All Cilium components and resources the plugin can see look healthy."
  />
);

export const Forbidden: StoryFn = () => <ForbiddenState what="Cilium endpoints" />;

export const ErrorWithHint: StoryFn = () => (
  <ErrorState
    error={{ status: 403, message: 'ciliumendpoints.cilium.io is forbidden' }}
    what="Cilium endpoints"
    onRetry={() => undefined}
  />
);
