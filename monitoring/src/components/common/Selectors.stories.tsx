import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import {
  LabelChips,
  MonitorNamespaceSelectorDisplay,
  SelectorDisplay,
  SelectorSummary,
  TagList,
  WorkloadNamespaceSelectorDisplay,
} from './Selectors';

export default {
  title: 'monitoring/Selectors',
} as Meta;

export const NilMeansNone: StoryFn = () => (
  <SelectorDisplay selector={undefined} nilMeaning="none" />
);
export const NilMeansAll: StoryFn = () => <SelectorDisplay selector={undefined} nilMeaning="all" />;
export const EmptySelector: StoryFn = () => <SelectorDisplay selector={{}} nilMeaning="none" />;
export const WithExpressions: StoryFn = () => (
  <SelectorDisplay
    nilMeaning="all"
    selector={{
      matchLabels: { 'app.kubernetes.io/name': 'api', release: 'kube-prometheus-stack' },
      matchExpressions: [
        { key: 'tier', operator: 'In', values: ['backend', 'worker'] },
        { key: 'legacy', operator: 'DoesNotExist' },
      ],
    }}
  />
);
export const Summary: StoryFn = () => (
  <SelectorSummary selector={{ matchLabels: { a: '1', b: '2', c: '3', d: '4' } }} />
);
export const MonitorNamespaces: StoryFn = () => (
  <>
    <MonitorNamespaceSelectorDisplay ownNamespace="apps" />
    <MonitorNamespaceSelectorDisplay selector={{ any: true }} />
    <MonitorNamespaceSelectorDisplay selector={{ matchNames: ['prod', 'staging'] }} />
  </>
);
export const WorkloadNamespaces: StoryFn = () => (
  <>
    <WorkloadNamespaceSelectorDisplay ownNamespace="monitoring" selector={undefined} />
    <WorkloadNamespaceSelectorDisplay selector={{}} />
    <WorkloadNamespaceSelectorDisplay selector={{ matchLabels: { monitored: 'true' } }} />
  </>
);
export const Tags: StoryFn = () => <TagList items={['alertname', 'job', 'namespace']} />;
export const EmptyTags: StoryFn = () => <TagList items={[]} emptyText="-" />;
export const Labels: StoryFn = () => (
  <LabelChips labels={{ release: 'kps', app: 'web' }} highlight={['release']} />
);
