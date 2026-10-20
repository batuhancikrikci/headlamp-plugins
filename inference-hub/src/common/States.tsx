/**
 * Consistent loading, empty, error, forbidden, "not installed" and "unsupported version" states.
 */
import { Icon } from '@iconify/react';
import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, AlertTitle, Box, Button, Link as MuiLink, Typography } from '@mui/material';
import React from 'react';
import { PLUGIN } from '../plugin';
import { t } from './i18n';

export function LoadingState({ title }: { title?: string }) {
  return <Loader title={title || t('Loading…')} />;
}

export interface EmptyStateProps {
  icon?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Smaller variant for use inside cards and sections. */
  dense?: boolean;
}

export function EmptyState({
  icon = 'mdi:information-outline',
  title,
  description,
  action,
  dense,
}: EmptyStateProps) {
  return (
    <Box sx={{ textAlign: 'center', py: dense ? 3 : 6, px: 2 }}>
      <Box sx={{ color: 'text.disabled', display: 'inline-flex' }}>
        <Icon icon={icon} width={dense ? 36 : 56} />
      </Box>
      <Typography variant={dense ? 'subtitle1' : 'h6'} component="p" sx={{ mt: 1 }}>
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body2"
          color="text.secondary"
          component="div"
          sx={{ mt: 1, maxWidth: 680, mx: 'auto' }}
        >
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

/** HTTP status of an API error, if it has one. */
export function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** Readable message of an error of any shape. */
export function errorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return (error as { message?: string }).message || JSON.stringify(error);
}

/** Error alert with an actionable hint for RBAC and availability problems. */
export function ErrorState({
  error,
  title,
  what,
  hints,
  onRetry,
}: {
  error: unknown;
  title?: string;
  /** What was being loaded, used in the permission hint ("Cilium endpoints"). */
  what?: string;
  /** Hints for specific HTTP statuses; they replace the default hint of that status. */
  hints?: Record<number, string>;
  onRetry?: () => void;
}) {
  if (!error) return null;
  const status = errorStatus(error);
  const defaults: Record<number, string> = {
    401: t('Authentication failed. Check your cluster credentials.'),
    403: what
      ? t(
          'Your user is not allowed to read {{what}}. Ask a cluster administrator for get, list and watch access.',
          { what }
        )
      : t('Your user lacks the permission for this request.'),
    404: t('The API server does not serve this resource.'),
  };
  const hint = status === undefined ? undefined : hints?.[status] ?? defaults[status];
  return (
    <Alert
      severity={status === 403 ? 'warning' : 'error'}
      icon={status === 403 ? <Icon icon="mdi:shield-lock-outline" /> : undefined}
      sx={{ mb: 2 }}
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('Retry')}
          </Button>
        ) : undefined
      }
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {errorMessage(error)}
      </Typography>
      {hint && (
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
          {hint}
        </Typography>
      )}
    </Alert>
  );
}

/** Shown when the user may not list a resource. */
export function ForbiddenState({ what, dense }: { what: string; dense?: boolean }) {
  return (
    <EmptyState
      dense={dense}
      icon="mdi:shield-lock-outline"
      title={t('You are not allowed to view {{what}}', { what })}
      description={t(
        'Your Kubernetes user lacks the list permission for this resource. Ask a cluster administrator for read access (a Role or ClusterRole with get, list and watch).'
      )}
    />
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title?: string }>) {
  return title ? <SectionBox title={title}>{children}</SectionBox> : <>{children}</>;
}

function DocsLink() {
  if (!PLUGIN.docsUrl) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <MuiLink href={PLUGIN.docsUrl} target="_blank" rel="noopener noreferrer">
        {t('{{product}} documentation', { product: PLUGIN.product })}
      </MuiLink>
    </Box>
  );
}

/**
 * Shown when the product (no `kind`) or one of its kinds is not served by the current cluster.
 * `hint` replaces the plugin's default explanation; `onRetry` re-runs API discovery.
 */
export function NotInstalled({
  title,
  kind,
  group,
  hint,
  onRetry,
}: {
  /** Section title; without it the state is rendered bare (e.g. inside a card). */
  title?: string;
  kind?: string;
  group?: string;
  hint?: React.ReactNode;
  onRetry?: () => void;
}) {
  const fallbackHint = kind
    ? PLUGIN.kindHint ||
      t(
        'The {{kind}} CRD ({{group}}) is not served. It is installed by the component that owns it; the rest of the plugin keeps working without it.',
        { kind, group: group || t('unknown group') }
      )
    : PLUGIN.installHint ||
      t('The APIs of {{product}} were not found in this cluster.', { product: PLUGIN.product });
  return (
    <Section title={title}>
      <EmptyState
        icon="mdi:package-variant-remove"
        title={
          kind
            ? t('{{kind}} is not installed in this cluster', { kind })
            : t('{{product}} is not installed in this cluster', { product: PLUGIN.product })
        }
        description={
          <>
            {hint || fallbackHint}
            <DocsLink />
          </>
        }
        action={
          onRetry ? (
            <Button variant="outlined" startIcon={<Icon icon="mdi:refresh" />} onClick={onRetry}>
              {t('Check again')}
            </Button>
          ) : undefined
        }
      />
    </Section>
  );
}

/** Shown when a kind is served only in versions the plugin does not support. */
export function UnsupportedVersion({
  title,
  kind,
  served,
  supported,
}: {
  title?: string;
  kind: string;
  served: string[];
  supported: string[];
}) {
  return (
    <Section title={title}>
      <EmptyState
        icon="mdi:alert-decagram-outline"
        title={t('Unsupported {{kind}} API version', { kind })}
        description={
          <>
            {t(
              'This cluster serves {{kind}} as {{served}}, but this plugin supports {{supported}}. Objects can still be inspected with kubectl.',
              { kind, served: served.join(', '), supported: supported.join(', ') }
            )}
            {PLUGIN.testedWith && (
              <Box sx={{ mt: 1 }}>
                {t('The plugin was built for {{versions}}.', { versions: PLUGIN.testedWith })}
              </Box>
            )}
          </>
        }
      />
    </Section>
  );
}

/**
 * Resolves the usual `{items, error}` list result into one of the standard states, or calls
 * `children` with the loaded items.
 */
export function ListState<T>({
  items,
  error,
  what,
  dense,
  empty,
  children,
}: {
  items: T[] | null;
  error: unknown;
  what: string;
  dense?: boolean;
  /** Rendered instead of `children` when the list is empty. */
  empty?: React.ReactNode;
  children: (items: T[]) => React.ReactNode;
}) {
  if (error && !items) {
    return errorStatus(error) === 403 ? (
      <ForbiddenState what={what} dense={dense} />
    ) : (
      <ErrorState error={error} what={what} />
    );
  }
  if (!items) return <LoadingState />;
  if (items.length === 0 && empty) return <>{empty}</>;
  return <>{children(items)}</>;
}
