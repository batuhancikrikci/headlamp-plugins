import { Button } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  ListState,
  LoadingState,
  NotInstalled,
  UnsupportedVersion,
} from './States';

export default {
  title: 'Common/States',
} as Meta;

export const Loading: StoryFn = () => <LoadingState />;

export const Empty: StoryFn = () => (
  <EmptyState
    icon="mdi:inbox-outline"
    title="No objects yet"
    description="Objects you create appear here."
    action={<Button variant="contained">Create</Button>}
  />
);

export const EmptyDense: StoryFn = () => <EmptyState dense title="Nothing to show" />;

export const Failed: StoryFn = () => (
  <ErrorState error={{ status: 500, message: 'Internal error' }} onRetry={() => undefined} />
);

export const ErrorForbidden: StoryFn = () => (
  <ErrorState error={{ status: 403, message: 'forbidden' }} what="widgets" />
);

export const ErrorWithCustomHint: StoryFn = () => (
  <ErrorState
    error={{ status: 503, message: 'service unavailable' }}
    hints={{ 503: 'The service is not reachable. Check that its pods are running and ready.' }}
  />
);

export const Forbidden: StoryFn = () => <ForbiddenState what="widgets" />;

export const ProductNotInstalled: StoryFn = () => <NotInstalled title="Overview" />;

export const KindNotInstalled: StoryFn = () => (
  <NotInstalled title="Widgets" kind="Widget" group="example.com" />
);

export const Unsupported: StoryFn = () => (
  <UnsupportedVersion title="Widgets" kind="Widget" served={['v1alpha1']} supported={['v1']} />
);

export const ListLoading: StoryFn = () => (
  <ListState items={null} error={null} what="widgets">
    {items => <>{items.length}</>}
  </ListState>
);

export const ListForbidden: StoryFn = () => (
  <ListState items={null} error={{ status: 403 }} what="widgets">
    {items => <>{items.length}</>}
  </ListState>
);
