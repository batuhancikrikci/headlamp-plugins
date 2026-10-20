import { Icon, IconifyIcon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { AuthVisible, Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { agentRouterIcon } from '../../icons/agentRouterIcon';
import { AIGatewayRoute, AIGatewayRouteRuleBackendRef } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { BackendSecurityPolicy } from '../../resources/backendSecurityPolicy';
import { AI_GATEWAY_GROUP, Condition } from '../../resources/common';
import { GatewayConfig } from '../../resources/gatewayConfig';
import { MCPRoute } from '../../resources/mcpRoute';
import { formatQuota, QuotaPolicy } from '../../resources/quotaPolicy';
import { createRoute, detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { isAIServiceBackendRef } from '../../utils/crossReference';
import {
  getDiscoveredVersions,
  isAIGatewayGroupAvailable,
  WithVersionDiscovery,
} from '../../utils/versionDiscovery';
import { formatRelativeTime, PluginResourceLink, SchemaChip } from '../common/SharedComponents';
import { collectIssues, HealthCounts, healthCounts, Issue, providerMix } from './overview';

// ─── Types & building blocks ────────────────────────────────────────────────

type GatewayResource = KubeObject & { conditions: Condition[] };

interface KindSummary {
  kind: string;
  /** Sidebar name; also the key of the list / detail / create routes. */
  label: string;
  icon: IconifyIcon | string;
  items: GatewayResource[] | null;
  error: unknown;
}

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Soft background and matching foreground for an icon badge. */
function toneSx(tone: Tone) {
  return (theme: Theme) =>
    tone === 'neutral'
      ? { bgcolor: theme.palette.action.hover, color: theme.palette.text.secondary }
      : { bgcolor: alpha(theme.palette[tone].main, 0.14), color: theme.palette[tone].main };
}

function IconBadge({
  icon,
  tone,
  size = 44,
}: {
  icon: IconifyIcon | string;
  tone: Tone;
  size?: number;
}) {
  return (
    <Box
      sx={[
        {
          width: size,
          height: size,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        toneSx(tone),
      ]}
    >
      <Icon icon={icon} width={size * 0.55} height={size * 0.55} />
    </Box>
  );
}

/** Card with a titled header; the building block of the dashboard. */
function Panel({
  title,
  icon,
  action,
  children,
}: React.PropsWithChildren<{
  title: string;
  icon: IconifyIcon | string;
  action?: React.ReactNode;
}>) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          <Icon icon={icon} width={20} height={20} />
        </Box>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>{children}</Box>
    </Paper>
  );
}

/** Thin progress bar; `tone` colors the filled part. */
function Bar({
  value,
  total,
  tone,
  label,
}: {
  value: number;
  total: number;
  tone: Tone;
  label: string;
}) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <Box
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}
    >
      <Box
        sx={{
          width: `${ratio * 100}%`,
          height: '100%',
          borderRadius: 3,
          bgcolor: tone === 'neutral' ? 'text.disabled' : `${tone}.main`,
        }}
      />
    </Box>
  );
}

/** Scrollable region for long lists inside a panel. */
function ScrollArea({ maxHeight, children }: React.PropsWithChildren<{ maxHeight: number }>) {
  return (
    <Box
      // Keyboard users must be able to scroll the region.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      sx={{ maxHeight, overflowY: 'auto', pr: 1, mr: -1 }}
    >
      {children}
    </Box>
  );
}

function EmptyText({ children }: React.PropsWithChildren<{}>) {
  return (
    <Typography variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}

function healthTone(counts: HealthCounts): Tone {
  if (counts.rejected > 0) return 'error';
  if (counts.total === 0) return 'neutral';
  return counts.accepted === counts.total ? 'success' : 'warning';
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({
  issues,
  versions,
  installed,
}: {
  issues: Issue[];
  versions: string[];
  installed: boolean;
}) {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const tone = !installed ? 'warning' : errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success';
  const status = !installed
    ? 'CRDs not installed'
    : issues.length === 0
    ? 'Healthy'
    : [
        errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
        warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        background: theme =>
          `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(
            theme.palette.primary.main,
            0
          )} 60%)`,
      }}
    >
      <IconBadge icon={agentRouterIcon} tone="primary" size={56} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Agent Router
          </Typography>
          {versions.map(v => (
            <Chip key={v} label={v} size="small" color="primary" />
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Routes, backends, policies and gateway configuration for LLM and MCP traffic.
        </Typography>
      </Box>
      <Chip
        icon={
          <Icon
            icon={installed && issues.length === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'}
            width={18}
            height={18}
          />
        }
        label={status}
        color={tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Paper>
  );
}

// ─── Resource count cards ───────────────────────────────────────────────────

function StatCard({ summary }: { summary: KindSummary }) {
  const history = useHistory();
  const { items, error, label, icon } = summary;
  const counts = healthCounts(items);
  const caption = error
    ? 'Unavailable'
    : items === null
    ? 'Loading…'
    : counts.total === 0
    ? 'None defined yet'
    : counts.accepted === counts.total
    ? 'All accepted'
    : [
        counts.rejected ? `${counts.rejected} rejected` : '',
        counts.pending ? `${counts.pending} without status` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <ButtonBase
      onClick={() => history.push(Router.createRouteURL(listRoute(label)))}
      aria-label={`Open ${label}`}
      sx={{
        p: 2,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        textAlign: 'left',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        transition: 'border-color 120ms',
        '&:hover, &:focus-visible': { borderColor: 'primary.main' },
      }}
    >
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {label}
        </Typography>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
          {error ? '—' : items === null ? '…' : counts.total}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {caption}
        </Typography>
      </Box>
      <IconBadge icon={icon} tone={error || items === null ? 'neutral' : healthTone(counts)} />
    </ButtonBase>
  );
}

// ─── Needs attention ────────────────────────────────────────────────────────

function IssueList({ issues, summaries }: { issues: Issue[]; summaries: KindSummary[] }) {
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">Nothing needs attention</Typography>
          <EmptyText>
            Every resource is accepted by the controller and all references resolve.
          </EmptyText>
        </Box>
      </Box>
    );
  }
  return (
    <ScrollArea maxHeight={340}>
      {issues.map(issue => {
        const error = issue.severity === 'error';
        const label = summaries.find(s => s.kind === issue.kind)?.label;
        return (
          <Box
            key={issue.id}
            sx={{
              display: 'flex',
              gap: 1.5,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Tooltip title={error ? 'Error' : 'Warning'}>
              <Box
                sx={{ color: error ? 'error.main' : 'warning.main', display: 'flex', mt: '2px' }}
              >
                <Icon icon={error ? 'mdi:alert-circle' : 'mdi:alert'} width={20} height={20} />
              </Box>
            </Tooltip>
            <Box sx={{ minWidth: 0 }}>
              {label ? (
                <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>
                  <PluginResourceLink
                    routeName={detailRoute(label)}
                    name={issue.name}
                    namespace={issue.namespace}
                  />
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    {' · '}
                    {issue.kind}
                    {issue.namespace ? ` · ${issue.namespace}` : ''}
                  </Box>
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {issue.name}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {issue.message}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </ScrollArea>
  );
}

// ─── Resource health ────────────────────────────────────────────────────────

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
      <Typography variant="body2" color="text.secondary">
        {label}{' '}
        <Box component="strong" sx={{ color: 'text.primary' }}>
          {value}
        </Box>
      </Typography>
    </Box>
  );
}

function ResourceHealth({ summaries }: { summaries: KindSummary[] }) {
  const rows = summaries.map(s => ({ ...s, counts: healthCounts(s.items) }));
  const sum = (field: keyof HealthCounts) => rows.reduce((n, r) => n + r.counts[field], 0);
  const total = sum('total');
  const accepted = sum('accepted');
  if (summaries.every(s => s.items === null && !s.error)) return <CircularProgress size={20} />;
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
          {total ? `${Math.round((accepted / total) * 100)}%` : '—'}
        </Typography>
        <EmptyText>
          {total ? `${accepted} of ${total} resources accepted` : 'No resources defined yet'}
        </EmptyText>
      </Box>
      <Bar value={accepted} total={total} tone="success" label="Accepted resources" />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5, mb: 1.5 }}>
        <LegendDot color="success.main" label="Accepted" value={accepted} />
        <LegendDot color="error.main" label="Rejected" value={sum('rejected')} />
        <LegendDot color="warning.main" label="No status" value={sum('pending')} />
      </Box>
      {rows.map(row => (
        <Box
          key={row.kind}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 90px 52px',
            alignItems: 'center',
            columnGap: 1.5,
            py: 0.75,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>
              <Icon icon={row.icon} width={18} height={18} />
            </Box>
            <Typography variant="body2" noWrap component="div">
              <Link routeName={listRoute(row.label)}>{row.label}</Link>
            </Typography>
          </Box>
          <Bar
            value={row.counts.accepted}
            total={row.counts.total}
            tone={healthTone(row.counts)}
            label={`${row.label} accepted`}
          />
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            {row.error ? '—' : `${row.counts.accepted}/${row.counts.total}`}
          </Typography>
        </Box>
      ))}
    </>
  );
}

// ─── Guided setup ───────────────────────────────────────────────────────────

function ActionCard({
  icon,
  title,
  description,
  sidebar,
  resourceClass,
}: {
  icon: IconifyIcon | string;
  title: string;
  description: string;
  /** Sidebar name of the kind whose create wizard is opened. */
  sidebar: string;
  resourceClass: React.ComponentProps<typeof AuthVisible>['item'];
}) {
  const history = useHistory();
  return (
    <AuthVisible item={resourceClass} authVerb="create">
      <ButtonBase
        onClick={() => history.push(Router.createRouteURL(createRoute(sidebar)))}
        sx={{
          p: 1.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          textAlign: 'left',
          width: '100%',
          transition: 'border-color 120ms, background-color 120ms',
          '&:hover, &:focus-visible': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        }}
      >
        <IconBadge icon={icon} tone="primary" size={40} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle2">{title}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {description}
          </Typography>
        </Box>
        <Box sx={{ color: 'text.disabled', display: 'flex' }}>
          <Icon icon="mdi:chevron-right" width={22} height={22} />
        </Box>
      </ButtonBase>
    </AuthVisible>
  );
}

function GuidedSetup() {
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <ActionCard
        icon="mdi:server-network"
        title="Connect a provider"
        description="Create the backend, credentials and TLS settings for an LLM provider or a self-hosted model."
        sidebar={ROUTE_NAMES.backends}
        resourceClass={AIServiceBackend}
      />
      <ActionCard
        icon="mdi:routes"
        title="Create an AI route"
        description="Send requests for a model on a Gateway to one or more backends."
        sidebar={ROUTE_NAMES.routes}
        resourceClass={AIGatewayRoute}
      />
      <ActionCard
        icon="mdi:puzzle-outline"
        title="Expose MCP servers"
        description="Publish MCP servers behind one endpoint and protect it for clients."
        sidebar={ROUTE_NAMES.mcp}
        resourceClass={MCPRoute}
      />
      <ActionCard
        icon="mdi:speedometer"
        title="Limit usage"
        description="Set token budgets per model and per client on your backends."
        sidebar={ROUTE_NAMES.quotas}
        resourceClass={QuotaPolicy}
      />
    </Box>
  );
}

// ─── Provider mix ───────────────────────────────────────────────────────────

function ProviderMix({ backends }: { backends: AIServiceBackend[] | null }) {
  if (backends === null) return <CircularProgress size={20} />;
  if (backends.length === 0) return <EmptyText>No Service Backends defined yet.</EmptyText>;
  return (
    <ScrollArea maxHeight={300}>
      {providerMix(backends).map(([schema, count]) => (
        <Box
          key={schema}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 90px 32px',
            alignItems: 'center',
            columnGap: 1.5,
            py: 0.75,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <SchemaChip schemaName={schema} />
          </Box>
          <Bar value={count} total={backends.length} tone="primary" label={`${schema} share`} />
          <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
            {count}
          </Typography>
        </Box>
      ))}
    </ScrollArea>
  );
}

// ─── Model catalog ──────────────────────────────────────────────────────────

interface ModelRow {
  model: string;
  route: AIGatewayRoute;
  backendRefs: AIGatewayRouteRuleBackendRef[];
  quota?: string;
}

function ModelCatalog({
  routes,
  quotas,
}: {
  routes: AIGatewayRoute[] | null;
  quotas: QuotaPolicy[] | null;
}) {
  // Per-model quota lookup: namespace/model -> formatted default bucket.
  const quotaByModel = new Map<string, string>();
  (quotas || []).forEach(q =>
    (q.spec?.perModelQuotas || []).forEach(pm =>
      quotaByModel.set(
        `${q.metadata.namespace}/${pm.modelName}`,
        formatQuota(pm.quota?.defaultBucket)
      )
    )
  );

  const rows: ModelRow[] = [];
  (routes || []).forEach(route =>
    route.modelRoutes.forEach(({ model, backendRefs }) =>
      rows.push({
        model,
        route,
        backendRefs,
        quota: quotaByModel.get(`${route.metadata.namespace}/${model}`),
      })
    )
  );
  rows.sort((a, b) => a.model.localeCompare(b.model));

  if (routes === null) return <CircularProgress size={20} />;
  if (rows.length === 0) {
    return (
      <EmptyText>
        No AI Route matches on a specific model yet. Models appear here when a rule matches the{' '}
        <code>x-ai-eg-model</code> header exactly.
      </EmptyText>
    );
  }
  return (
    <SimpleTable
      data={rows}
      columns={[
        {
          label: 'Model',
          getter: (r: ModelRow) => (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {r.model}
            </Typography>
          ),
        },
        {
          label: 'AI Route',
          getter: (r: ModelRow) => <Link kubeObject={r.route}>{r.route.metadata.name}</Link>,
        },
        { label: 'Namespace', getter: (r: ModelRow) => r.route.metadata.namespace },
        {
          label: 'Backends',
          getter: (r: ModelRow) => {
            const refs = r.backendRefs;
            return refs.length === 0 ? (
              '-'
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {refs.map(ref =>
                  isAIServiceBackendRef(ref) ? (
                    <PluginResourceLink
                      key={ref.name}
                      routeName={detailRoute(ROUTE_NAMES.backends)}
                      name={ref.name}
                      namespace={ref.namespace || r.route.metadata.namespace}
                    />
                  ) : (
                    <span key={ref.name}>
                      {ref.kind}/{ref.name}
                    </span>
                  )
                )}
              </Box>
            );
          },
        },
        { label: 'Model Quota', getter: (r: ModelRow) => r.quota || '-' },
      ]}
    />
  );
}

// ─── Recently created ───────────────────────────────────────────────────────

function RecentActivity({ summaries }: { summaries: KindSummary[] }) {
  const recent = summaries
    .flatMap(s => (s.items || []).map(item => ({ summary: s, item })))
    .filter(r => !!r.item.metadata.creationTimestamp)
    .sort(
      (a, b) =>
        new Date(b.item.metadata.creationTimestamp).getTime() -
        new Date(a.item.metadata.creationTimestamp).getTime()
    )
    .slice(0, 10);

  if (recent.length === 0) return <EmptyText>No Agent Router resources found.</EmptyText>;
  return (
    <ScrollArea maxHeight={300}>
      {recent.map(({ summary, item }) => (
        <Box
          key={`${summary.kind}/${item.metadata.namespace}/${item.metadata.name}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '&:last-child': { borderBottom: 'none' },
          }}
        >
          <Box sx={{ color: 'text.secondary', display: 'flex' }}>
            <Icon icon={summary.icon} width={18} height={18} />
          </Box>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" noWrap component="div">
              <Link kubeObject={item}>{item.metadata.name}</Link>
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {summary.kind}
              {item.metadata.namespace ? ` · ${item.metadata.namespace}` : ''}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {formatRelativeTime(item.metadata.creationTimestamp)}
          </Typography>
        </Box>
      ))}
    </ScrollArea>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

function DashboardContent() {
  const [routes, routesErr] = AIGatewayRoute.useList();
  const [backends, backendsErr] = AIServiceBackend.useList();
  const [securityPolicies, securityErr] = BackendSecurityPolicy.useList();
  const [mcpRoutes, mcpErr] = MCPRoute.useList();
  const [quotas, quotasErr] = QuotaPolicy.useList();
  const [configs, configsErr] = GatewayConfig.useList();

  const summaries: KindSummary[] = [
    {
      kind: 'AIGatewayRoute',
      label: ROUTE_NAMES.routes,
      icon: 'mdi:routes',
      items: routes,
      error: routesErr,
    },
    {
      kind: 'AIServiceBackend',
      label: ROUTE_NAMES.backends,
      icon: 'mdi:server-network',
      items: backends,
      error: backendsErr,
    },
    {
      kind: 'BackendSecurityPolicy',
      label: ROUTE_NAMES.security,
      icon: 'mdi:shield-key-outline',
      items: securityPolicies,
      error: securityErr,
    },
    {
      kind: 'MCPRoute',
      label: ROUTE_NAMES.mcp,
      icon: 'mdi:puzzle-outline',
      items: mcpRoutes,
      error: mcpErr,
    },
    {
      kind: 'QuotaPolicy',
      label: ROUTE_NAMES.quotas,
      icon: 'mdi:speedometer',
      items: quotas,
      error: quotasErr,
    },
    {
      kind: 'GatewayConfig',
      label: ROUTE_NAMES.config,
      icon: 'mdi:cog-outline',
      items: configs,
      error: configsErr,
    },
  ];

  const installed = isAIGatewayGroupAvailable() !== false;
  const versions = Array.from(new Set(getDiscoveredVersions().values())).sort();
  const issues = React.useMemo(
    () =>
      collectIssues({
        routes,
        backends,
        securityPolicies,
        mcpRoutes,
        quotaPolicies: quotas,
        gatewayConfigs: configs,
      }),
    [routes, backends, securityPolicies, mcpRoutes, quotas, configs]
  );
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const incomplete = installed && summaries.some(s => !!s.error && s.items === null);

  const twoColumns = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
    gap: 2,
    alignItems: 'stretch',
  };

  return (
    // Bottom padding keeps the last panel clear of the window edge.
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      <Header issues={issues} versions={versions} installed={installed} />

      {!installed && (
        <Alert severity="warning">
          The <code>{AI_GATEWAY_GROUP}</code> API group was not found on this cluster. Install the
          AI Gateway CRDs to start managing resources here.
        </Alert>
      )}
      {incomplete && (
        <Alert severity="warning">
          Some resource types could not be listed (missing permissions or CRDs), so parts of this
          overview are incomplete.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 2,
        }}
      >
        {summaries.map(s => (
          <StatCard key={s.kind} summary={s} />
        ))}
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title="Needs attention"
          icon="mdi:bell-alert-outline"
          action={
            issues.length > 0 && (
              <Chip
                size="small"
                color={errorCount > 0 ? 'error' : 'warning'}
                label={issues.length}
              />
            )
          }
        >
          <IssueList issues={issues} summaries={summaries} />
        </Panel>
        <Panel title="Resource health" icon="mdi:heart-pulse">
          <ResourceHealth summaries={summaries} />
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title="Model catalog" icon="mdi:brain">
          <ModelCatalog routes={routes} quotas={quotas} />
        </Panel>
        <Panel title="Guided setup" icon="mdi:wizard-hat">
          <GuidedSetup />
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title="Recently created" icon="mdi:history">
          <RecentActivity summaries={summaries} />
        </Panel>
        <Panel title="Provider mix" icon="mdi:cloud-outline">
          <ProviderMix backends={backends} />
        </Panel>
      </Box>
    </Box>
  );
}

export function Dashboard() {
  return (
    <WithVersionDiscovery title="Agent Router">
      <DashboardContent />
    </WithVersionDiscovery>
  );
}
