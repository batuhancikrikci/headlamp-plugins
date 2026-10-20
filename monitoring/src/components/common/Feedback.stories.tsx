import { Button } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { EmptyState } from '../../common/States';
import type { MonitoringEndpoint } from '../../hooks/useMonitoringEndpoint';
import { MonitoringApiError } from '../../utils/monitoringApi';
import { CodeBlock } from './CodeBlock';
import { ApiErrorAlert, HelmManagedAlert } from './Feedback';
import { EndpointGate } from './InstanceBar';

export default {
  title: 'monitoring/Feedback',
} as Meta;

const baseEndpoint: MonitoringEndpoint<{ metadata: { name: string; namespace?: string } }> = {
  baseUrl: '',
  endpoint: null,
  instance: null,
  instances: [],
  select: () => {},
  source: 'none',
  loading: false,
  error: null,
  notFound: false,
};

export const Loading: StoryFn = () => (
  <EndpointGate kind="Prometheus" ep={{ ...baseEndpoint, loading: true }} />
);

export const NotFound: StoryFn = () => (
  <EndpointGate kind="Alertmanager" ep={{ ...baseEndpoint, notFound: true }} />
);

export const DiscoveryError: StoryFn = () => (
  <EndpointGate
    kind="Prometheus"
    ep={{ ...baseEndpoint, error: new MonitoringApiError('Forbidden', 403) }}
  />
);

export const Forbidden: StoryFn = () => (
  <ApiErrorAlert
    error={new MonitoringApiError('services "prometheus-operated:web" is forbidden', 403)}
    onRetry={() => {}}
  />
);

export const Unavailable: StoryFn = () => (
  <ApiErrorAlert
    error={new MonitoringApiError('no endpoints available for service', 503)}
    title="Prometheus"
  />
);

export const PromQLError: StoryFn = () => (
  <ApiErrorAlert
    error={new MonitoringApiError('parse error at char 5: unexpected identifier', 400, 'bad_data')}
  />
);

export const Empty: StoryFn = () => (
  <EmptyState
    icon="mdi:bell-off-outline"
    title="No silences"
    description="Silences temporarily mute notifications for alerts matching a set of matchers."
    action={<Button variant="contained">New silence</Button>}
  />
);

export const Helm: StoryFn = () => <HelmManagedAlert release="kube-prometheus-stack" />;

export const Code: StoryFn = () => (
  <CodeBlock
    code={'sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))'}
  />
);
