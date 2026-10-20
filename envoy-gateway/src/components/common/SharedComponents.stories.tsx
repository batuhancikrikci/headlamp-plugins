import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { summarizeStatus } from '../../utils/conditions';
import {
  ConditionsTable,
  FeatureChips,
  KeyValueBlock,
  StatusSummary,
  StringArray,
} from './SharedComponents';

export default {
  title: 'EnvoyGateway/SharedComponents',
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

const accepted = {
  type: 'Accepted',
  status: 'True',
  reason: 'Accepted',
  message: 'Policy has been accepted.',
  lastTransitionTime: '2026-09-20T10:00:00Z',
};
const rejected = {
  type: 'Accepted',
  status: 'False',
  reason: 'Invalid',
  message: 'OIDC client secret "oidc-secret" not found.',
  lastTransitionTime: '2026-09-21T08:30:00Z',
};
const ref = (name: string) => ({ group: 'gateway.networking.k8s.io', kind: 'Gateway', name });

export const StatusAccepted: StoryFn = () => (
  <StatusSummary
    summary={summarizeStatus({ ancestors: [{ ancestorRef: ref('eg'), conditions: [accepted] }] })}
  />
);

/** Error state: one of two Gateways rejected the policy. */
export const StatusPartiallyRejected: StoryFn = () => (
  <StatusSummary
    summary={summarizeStatus({
      ancestors: [
        { ancestorRef: ref('public'), conditions: [accepted] },
        { ancestorRef: ref('internal'), conditions: [rejected] },
      ],
    })}
  />
);

/** Loading-like state: the controller has not reported a status yet. */
export const StatusPending: StoryFn = () => <StatusSummary summary={summarizeStatus(undefined)} />;

export const Conditions: StoryFn = () => <ConditionsTable conditions={[accepted, rejected]} />;

export const ConditionsEmpty: StoryFn = () => <ConditionsTable conditions={[]} />;

export const Features: StoryFn = () => (
  <FeatureChips
    features={[
      { id: 'jwt', label: 'JWT', icon: 'mdi:key-chain-variant' },
      { id: 'cors', label: 'CORS', icon: 'mdi:web' },
      { id: 'authz', label: 'Authorization (Deny)', icon: 'mdi:shield-check-outline' },
    ]}
  />
);

export const FeaturesEmpty: StoryFn = () => <FeatureChips features={[]} />;

export const Strings: StoryFn = () => <StringArray items={['h2', 'http/1.1', 502, 503]} />;

/** Structured view used instead of raw JSON, e.g. for container resources. */
export const StructuredValue: StoryFn = () => (
  <KeyValueBlock
    value={{
      limits: { cpu: '2000m', memory: '2Gi' },
      requests: { cpu: '200m', memory: '512Mi' },
    }}
  />
);

export const StructuredValueMixed: StoryFn = () => (
  <KeyValueBlock
    value={{
      'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb',
      ports: [80, 443],
      spec: { template: { spec: { containers: [{ name: 'envoy', image: 'envoy:v1.33' }] } } },
    }}
  />
);
