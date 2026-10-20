import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Typography } from '@mui/material';
import React from 'react';
import { PLUGIN } from '../plugin';
import { t } from './i18n';

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <SectionBox title={PLUGIN.title}>
      <Alert
        severity="error"
        icon={<Icon icon="mdi:alert-octagon-outline" />}
        action={
          <Button color="inherit" size="small" onClick={onReset}>
            {t('Try again')}
          </Button>
        }
      >
        <Typography variant="subtitle2">{t('This view failed to render.')}</Typography>
        <Box component="pre" sx={{ m: 0, mt: 1, whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
          {error.message}
        </Box>
      </Alert>
    </SectionBox>
  );
}

interface ErrorBoundaryProps {
  /** Rendered instead of the default error page, e.g. `null` for sections on native pages. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Keeps a rendering error inside a plugin view from taking down the whole Headlamp UI. */
export class ErrorBoundary extends React.Component<
  React.PropsWithChildren<ErrorBoundaryProps>,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${PLUGIN.name}] render error`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorFallback error={this.state.error} onReset={() => this.setState({ error: null })} />
      );
    }
    return this.props.children;
  }
}

/** Wraps a route component in an error boundary. */
export function withBoundary(Component: React.ComponentType, fallback?: React.ReactNode) {
  return function BoundedRoute() {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component />
      </ErrorBoundary>
    );
  };
}
