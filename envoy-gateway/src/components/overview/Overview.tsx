import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { AuthVisible, Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import * as yaml from 'js-yaml';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { ResourceEditor } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { Backend } from '../../resources/backend';
import { BackendTrafficPolicy } from '../../resources/backendTrafficPolicy';
import { ClientTrafficPolicy } from '../../resources/clientTrafficPolicy';
import { EnvoyExtensionPolicy } from '../../resources/envoyExtensionPolicy';
import { EnvoyPatchPolicy } from '../../resources/envoyPatchPolicy';
import { EnvoyProxy } from '../../resources/envoyProxy';
import { HTTPRouteFilter } from '../../resources/httpRouteFilter';
import { crdByKind, CRDInfo, listRouteName } from '../../resources/registry';
import { SecurityPolicy } from '../../resources/securityPolicy';
import {
  API_GROUP,
  GATEWAY_API_GROUP,
  KubeJson,
  ObjectJson,
  PolicyStatus,
} from '../../resources/types';
import { Health, summarizeStatus } from '../../utils/conditions';
import { envoyProxyHealth, envoyProxyReferences } from '../../utils/envoyProxyStatus';
import {
  collectIssues,
  componentHealth,
  ComponentStatus,
  componentStatus,
  envoyGatewayClasses,
  EnvoyGatewayConfig,
  gatewaysOfClasses,
  isProgrammed,
  Issue,
  NamespaceCoverage,
  routesOfGateways,
  securityCoverage,
  summarizeConfig,
} from '../../utils/overview';
import { newResource } from '../../utils/templates';
import {
  Availability,
  isAvailable,
  servedApiVersion,
  useEnvoyGatewayDiscovery,
} from '../../utils/versionDiscovery';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { StatusSummaryFromStatus } from '../common/SharedComponents';
import { EDITING } from '../editing';

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info';

const HEALTH_TONE: Record<Health, Tone | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: 'neutral',
};

export const CRD_ICONS: Record<string, string> = {
  EnvoyProxy: 'mdi:server-network',
  ClientTrafficPolicy: 'mdi:account-arrow-right-outline',
  BackendTrafficPolicy: 'mdi:arrow-decision-outline',
  SecurityPolicy: 'mdi:shield-lock-outline',
  EnvoyExtensionPolicy: 'mdi:puzzle-outline',
  EnvoyPatchPolicy: 'mdi:code-json',
  Backend: 'mdi:database-arrow-right-outline',
  HTTPRouteFilter: 'mdi:filter-outline',
};

/**
 * Resource inventory: four groups of two kinds each, so the boxes line up as an even grid.
 * Route filters sit next to SecurityPolicy because both are attached to routes; the two
 * extension policies modify the generated Envoy configuration.
 */
const INVENTORY_GROUPS: Array<{ id: string; label: string; icon: string; kinds: string[] }> = [
  {
    id: 'infra',
    label: 'Infrastructure',
    icon: 'mdi:server-network',
    kinds: ['EnvoyProxy', 'Backend'],
  },
  {
    id: 'traffic',
    label: 'Traffic',
    icon: 'mdi:swap-horizontal',
    kinds: ['ClientTrafficPolicy', 'BackendTrafficPolicy'],
  },
  {
    id: 'routing',
    label: 'Security & Routing',
    icon: 'mdi:shield-lock-outline',
    kinds: ['SecurityPolicy', 'HTTPRouteFilter'],
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: 'mdi:puzzle-outline',
    kinds: ['EnvoyExtensionPolicy', 'EnvoyPatchPolicy'],
  },
];

/** Soft background and matching foreground for an icon badge. */
function toneSx(tone: Tone | 'neutral') {
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
  icon: string;
  tone: Tone | 'neutral';
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
export function Panel({
  title,
  icon,
  action,
  children,
}: React.PropsWithChildren<{ title: string; icon: string; action?: React.ReactNode }>) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          <Icon icon={icon} width={20} />
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
function Bar({ value, total, tone }: { value: number; total: number; tone: Tone | 'neutral' }) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <Box
      role="progressbar"
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

export function Header({
  version,
  namespace,
  apiVersions,
  issues,
  installed,
}: {
  version?: string;
  namespace?: string;
  apiVersions: string[];
  issues: Issue[];
  installed: boolean;
}) {
  const { t } = useText();
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const tone: Tone = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success';
  const status =
    issues.length === 0
      ? t('Healthy')
      : [
          errors ? t('{{count}} error(s)', { count: errors }) : '',
          warnings ? t('{{count}} warning(s)', { count: warnings }) : '',
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
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Envoy Gateway
          </Typography>
          {version && <Chip label={version} size="small" color="primary" />}
          {apiVersions.map(v => (
            <Chip key={v} label={v} size="small" variant="outlined" />
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary" component="div">
          {namespace ? (
            <>
              {t('Running in namespace')}{' '}
              <ResourceRefLink group="" kind="Namespace" name={namespace} hideKind />
            </>
          ) : (
            t('Gateway data plane configuration, traffic and security policies and extensions.')
          )}
        </Typography>
      </Box>
      {installed && (
        <Chip
          icon={
            <Icon icon={issues.length === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'} width={18} />
          }
          label={status}
          color={tone}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      )}
    </Paper>
  );
}

const COMPONENT_INFO: Record<
  ComponentStatus['id'],
  { label: string; icon: string; optional: boolean }
> = {
  controller: { label: 'Controller', icon: 'mdi:cog-outline', optional: false },
  proxy: { label: 'Envoy proxies', icon: 'mdi:server-network', optional: true },
  ratelimit: { label: 'Rate limit service', icon: 'mdi:speedometer', optional: true },
};

export function ComponentCard({ component }: { component: ComponentStatus }) {
  const { t } = useText();
  const info = COMPONENT_INFO[component.id];
  const tone = HEALTH_TONE[componentHealth(component, info.optional)];
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <IconBadge icon={info.icon} tone={tone} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {t(info.label)}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {component.workloads === 0
              ? t('Not found')
              : t('{{ready}}/{{total}} ready', { ready: component.ready, total: component.total })}
          </Typography>
        </Box>
      </Box>
      <Bar value={component.ready} total={component.total} tone={tone} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
        {[
          component.versions.join(', '),
          component.id === 'proxy' && component.workloads > 0
            ? t('{{count}} fleet(s)', { count: component.workloads })
            : '',
        ]
          .filter(Boolean)
          .join(' · ') || ' '}
      </Typography>
    </Paper>
  );
}

export interface Stat {
  id: string;
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: string;
  tone: Tone;
  /** Route name of the list page to open. */
  route?: string;
}

export function StatCard({ stat }: { stat: Stat }) {
  const history = useHistory();
  const content = (
    <>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {stat.label}
        </Typography>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
          {stat.value}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {stat.caption}
        </Typography>
      </Box>
      <IconBadge icon={stat.icon} tone={stat.tone} />
    </>
  );
  const sx = {
    p: 2,
    borderRadius: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    width: '100%',
    boxSizing: 'border-box' as const,
    textAlign: 'left' as const,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
  };
  if (!stat.route) return <Box sx={sx}>{content}</Box>;
  const route = stat.route;
  return (
    <ButtonBase
      onClick={() => history.push(Router.createRouteURL(route))}
      sx={{
        ...sx,
        transition: 'border-color 120ms',
        '&:hover, &:focus-visible': { borderColor: 'primary.main' },
      }}
    >
      {content}
    </ButtonBase>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useText();
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">{t('Nothing needs attention')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('All Envoy Gateway components and resources look healthy.')}
          </Typography>
        </Box>
      </Box>
    );
  }
  return (
    <ScrollArea maxHeight={340}>
      {issues.map(issue => {
        const error = issue.severity === 'error';
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
            <Tooltip title={error ? t('Error') : t('Warning')}>
              <Box
                sx={{ color: error ? 'error.main' : 'warning.main', display: 'flex', mt: '2px' }}
              >
                <Icon icon={error ? 'mdi:alert-circle' : 'mdi:alert'} width={20} />
              </Box>
            </Tooltip>
            <Box sx={{ minWidth: 0 }}>
              {issue.kind ? (
                <ResourceRefLink
                  kind={issue.kind}
                  group={issue.group}
                  name={issue.name}
                  namespace={issue.namespace}
                />
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

/** Share of routes covered by a SecurityPolicy, overall and per namespace. */
export function Coverage({ coverage }: { coverage: NamespaceCoverage[] }) {
  const { t } = useText();
  const routes = coverage.reduce((n, c) => n + c.routes, 0);
  const covered = coverage.reduce((n, c) => n + c.protected, 0);
  const full = coverage.filter(c => c.protected === c.routes).length;
  const none = coverage.filter(c => c.protected === 0).length;
  const partial = coverage.length - full - none;
  // Namespaces without any protected route first: those are the gaps.
  const rows = [...coverage].sort(
    (a, b) =>
      a.protected / a.routes - b.protected / b.routes || a.namespace.localeCompare(b.namespace)
  );
  if (coverage.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No routes are attached to Envoy Gateway managed Gateways yet.')}
      </Typography>
    );
  }
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
          {routes ? Math.round((covered / routes) * 100) : 0}%
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('{{covered}} of {{total}} routes have a SecurityPolicy', { covered, total: routes })}
        </Typography>
      </Box>
      <Bar value={covered} total={routes} tone="success" />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5, mb: 1.5 }}>
        <LegendDot color="success.main" label={t('Fully covered')} value={full} />
        <LegendDot color="info.main" label={t('Partially')} value={partial} />
        <LegendDot color="warning.main" label={t('No policy')} value={none} />
      </Box>
      <ScrollArea maxHeight={236}>
        {rows.map(row => {
          const tone: Tone =
            row.protected === 0 ? 'warning' : row.protected === row.routes ? 'success' : 'info';
          return (
            <Box
              key={row.namespace}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 90px 52px',
                alignItems: 'center',
                columnGap: 1.5,
                py: 0.75,
              }}
            >
              <Typography variant="body2" noWrap component="div">
                <ResourceRefLink group="" kind="Namespace" name={row.namespace} hideKind />
              </Typography>
              <Bar value={row.protected} total={row.routes} tone={tone} />
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                {row.protected}/{row.routes}
              </Typography>
            </Box>
          );
        })}
      </ScrollArea>
    </>
  );
}

/** Settings and feature switches of the Envoy Gateway configuration. */
export function FeatureSummary({ config }: { config: EnvoyGatewayConfig }) {
  const { t } = useText();
  const enabled = config.features.filter(f => f.enabled);
  const disabled = config.features.filter(f => !f.enabled);
  const chips = (list: EnvoyGatewayConfig['features'], on: boolean) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {list.map(feature => (
        <Chip
          key={feature.id}
          size="small"
          variant="outlined"
          color={on ? 'success' : 'default'}
          icon={<Icon icon={on ? 'mdi:check' : 'mdi:minus'} width={14} />}
          label={t(feature.label)}
          sx={on ? undefined : { opacity: 0.65 }}
        />
      ))}
    </Box>
  );
  return (
    <>
      {/* Each setting takes the width of its own value, so long values (e.g. a custom
          controller name) are shown in full; a value wider than the panel wraps. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 5, rowGap: 1.5, mb: 2 }}>
        {config.settings.map(setting => (
          <Box key={setting.id} sx={{ minWidth: 120, maxWidth: '100%' }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {t(setting.label)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {setting.value}
            </Typography>
          </Box>
        ))}
      </Box>
      {enabled.length > 0 && chips(enabled, true)}
      {disabled.length > 0 && <Box sx={{ mt: 1 }}>{chips(disabled, false)}</Box>}
    </>
  );
}

export function ActionCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
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
        boxSizing: 'border-box',
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
        <Icon icon="mdi:chevron-right" width={22} />
      </Box>
    </ButtonBase>
  );
}

/** Opens the wizard (or form) of a kind in the create dialog. */
function CreateAction({
  kind,
  title,
  description,
}: {
  kind: string;
  title: string;
  description: string;
}) {
  const { t } = useText();
  const info = crdByKind(kind)!;
  const editing = EDITING[kind];
  const Form = editing?.Wizard || editing?.Form;
  const [item, setItem] = React.useState<KubeJson | null>(null);
  if (!Form) return null;
  return (
    <AuthVisible item={info.cls} authVerb="create">
      <ActionCard
        icon={CRD_ICONS[kind]}
        title={title}
        description={description}
        onClick={() => setItem(newResource(kind, servedApiVersion(info.plural, getCluster())))}
      />
      {item && (
        <ResourceEditor
          open
          onClose={() => setItem(null)}
          title={t('Create {{kind}}', { kind })}
          initialItem={item}
          mode="create"
          Form={Form}
          wizard={!!editing.Wizard}
        />
      )}
    </AuthVisible>
  );
}

function GuidedSetup({ availability }: { availability: Availability }) {
  const { t } = useText();
  const has = (kind: string) => isAvailable(availability, crdByKind(kind)!.plural);
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {has('SecurityPolicy') && (
        <CreateAction
          kind="SecurityPolicy"
          title={t('Security policy wizard')}
          description={t('Protect a Gateway or route with JWT, OIDC, API keys, CORS or IP rules.')}
        />
      )}
      {has('BackendTrafficPolicy') && (
        <CreateAction
          kind="BackendTrafficPolicy"
          title={t('Backend traffic wizard')}
          description={t('Add rate limits, retries, health checks or sticky sessions to a route.')}
        />
      )}
      {has('ClientTrafficPolicy') && (
        <CreateAction
          kind="ClientTrafficPolicy"
          title={t('Client traffic policy')}
          description={t('Tune TLS, HTTP versions, timeouts and client IP detection of a Gateway.')}
        />
      )}
      {has('Backend') && (
        <CreateAction
          kind="Backend"
          title={t('External backend')}
          description={t('Route to a hostname, IP or Unix socket outside the cluster.')}
        />
      )}
    </Box>
  );
}

/** Gateway classes handled by Envoy Gateway, with their parameters and Gateways. */
export function GatewayClassList({
  classes,
  gateways,
}: {
  classes: ObjectJson[];
  gateways: ObjectJson[];
}) {
  const { t } = useText();
  if (classes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No GatewayClass is managed by Envoy Gateway yet.')}
      </Typography>
    );
  }
  return (
    <ScrollArea maxHeight={300}>
      {classes.map(gc => {
        const name = gc.metadata?.name || '';
        const own = gateways.filter(g => g.spec?.gatewayClassName === name);
        const programmed = own.filter(isProgrammed).length;
        const ref = gc.spec?.parametersRef;
        return (
          <Box
            key={name}
            sx={{
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
              <Box sx={{ fontWeight: 600 }}>
                <ResourceRefLink
                  group={GATEWAY_API_GROUP}
                  kind="GatewayClass"
                  name={name}
                  hideKind
                />
              </Box>
              <StatusSummaryFromStatus status={gc.status as PolicyStatus} />
              <Box sx={{ flexGrow: 1 }} />
              {ref && (
                <ResourceRefLink
                  group={ref.group}
                  kind={ref.kind}
                  name={ref.name}
                  namespace={ref.namespace}
                />
              )}
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 1.5,
                alignItems: 'center',
              }}
            >
              <Bar
                value={programmed}
                total={own.length}
                tone={
                  own.length === 0 ? 'neutral' : programmed === own.length ? 'success' : 'warning'
                }
              />
              <Typography variant="caption" color="text.secondary">
                {own.length === 0
                  ? t('No Gateways')
                  : t('{{programmed}}/{{total}} Gateways programmed', {
                      programmed,
                      total: own.length,
                    })}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </ScrollArea>
  );
}

/** One row of the resource inventory: kind and count, linking to its list. */
function InventoryRow({
  info,
  available,
  count,
}: {
  info: CRDInfo;
  available: boolean;
  count: React.ReactNode;
}) {
  const { t } = useText();
  const history = useHistory();
  return (
    <Tooltip
      title={available ? t(info.description) : t('This CRD is not installed')}
      placement="left"
    >
      <span>
        <ButtonBase
          disabled={!available}
          onClick={() => history.push(Router.createRouteURL(listRouteName(info.plural)))}
          sx={{
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            py: 0.6,
            borderRadius: 1,
            textAlign: 'left',
            opacity: available ? 1 : 0.5,
            '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ color: 'text.secondary', display: 'flex' }}>
            <Icon icon={CRD_ICONS[info.kind]} width={18} />
          </Box>
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {t(info.labelPlural)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {available ? count : '—'}
          </Typography>
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

function Inventory({
  availability,
  counts,
}: {
  availability: Availability;
  counts: Record<string, React.ReactNode>;
}) {
  const { t } = useText();
  return (
    <Box
      sx={{
        display: 'grid',
        // Equal columns over the full width: 4 groups, 2 per row, or stacked on narrow screens.
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${INVENTORY_GROUPS.length}, minmax(0, 1fr))`,
        },
        gap: 1.5,
        alignItems: 'stretch',
      }}
    >
      {INVENTORY_GROUPS.map(group => (
        <Paper key={group.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, px: 1, py: 0.5 }}>
            <Box sx={{ color: 'primary.main', display: 'flex' }}>
              <Icon icon={group.icon} width={20} />
            </Box>
            <Typography variant="subtitle2" noWrap>
              {t(group.label)}
            </Typography>
          </Box>
          {group.kinds.map(kind => {
            const info = crdByKind(kind)!;
            return (
              <InventoryRow
                key={kind}
                info={info}
                available={isAvailable(availability, info.plural)}
                count={counts[kind]}
              />
            );
          })}
        </Paper>
      ))}
    </Box>
  );
}

interface JsonList {
  /** Loaded objects ([] while loading or when the list failed). */
  list: ObjectJson[];
  loaded: boolean;
  error: unknown;
}

/** Lists a resource class as plain JSON. A failing list (missing CRD, 403) counts as loaded. */
function useJsonList(cls: KubeObjectClass, options?: Record<string, unknown>): JsonList {
  const [items, error] = cls.useList(options);
  const list = React.useMemo(
    () =>
      ((items as Array<{ jsonData: ObjectJson }> | null) || []).map(i => ({
        kind: cls.kind,
        ...i.jsonData,
      })),
    [items, cls]
  );
  return { list, loaded: items !== null || !!error, error };
}

function builtin(kind: string): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

const CONFIG_MAP = 'envoy-gateway-config';
const CONFIG_KEY = 'envoy-gateway.yaml';

/** Reads and summarizes the envoy-gateway-config ConfigMap; reports the result to the parent. */
function ConfigLoader({
  namespace,
  onConfig,
}: {
  namespace: string;
  onConfig: (config: EnvoyGatewayConfig | null) => void;
}) {
  const [configMap, error] = builtin('ConfigMap').useGet(CONFIG_MAP, namespace);
  React.useEffect(() => {
    if (error) {
      onConfig(null);
      return;
    }
    if (!configMap) return;
    try {
      onConfig(summarizeConfig(yaml.load(configMap.jsonData?.data?.[CONFIG_KEY] || '')));
    } catch {
      onConfig(null);
    }
  }, [configMap, error]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const PROXY_SELECTOR =
  'app.kubernetes.io/managed-by=envoy-gateway,app.kubernetes.io/component=proxy';
const RATELIMIT_SELECTOR =
  'app.kubernetes.io/managed-by=envoy-gateway,app.kubernetes.io/component=ratelimit';

function Dashboard({ availability }: { availability: Availability }) {
  const { t } = useText();
  const controllers = useJsonList(builtin('Deployment'), {
    labelSelector: 'control-plane=envoy-gateway',
  });
  const proxyDeployments = useJsonList(builtin('Deployment'), { labelSelector: PROXY_SELECTOR });
  const proxyDaemonSets = useJsonList(builtin('DaemonSet'), { labelSelector: PROXY_SELECTOR });
  const rateLimits = useJsonList(builtin('Deployment'), { labelSelector: RATELIMIT_SELECTOR });
  const gatewayClasses = useJsonList(builtin('GatewayClass'));
  const allGateways = useJsonList(builtin('Gateway'));
  const httpRoutes = useJsonList(builtin('HTTPRoute'));
  const grpcRoutes = useJsonList(builtin('GRPCRoute'));

  const lists: Record<string, JsonList> = {
    EnvoyProxy: useJsonList(EnvoyProxy),
    ClientTrafficPolicy: useJsonList(ClientTrafficPolicy),
    BackendTrafficPolicy: useJsonList(BackendTrafficPolicy),
    SecurityPolicy: useJsonList(SecurityPolicy),
    EnvoyExtensionPolicy: useJsonList(EnvoyExtensionPolicy),
    EnvoyPatchPolicy: useJsonList(EnvoyPatchPolicy),
    Backend: useJsonList(Backend),
    HTTPRouteFilter: useJsonList(HTTPRouteFilter),
  };

  // undefined = not loaded yet, null = could not be read.
  const [config, setConfig] = React.useState<EnvoyGatewayConfig | null | undefined>(undefined);

  const controller = componentStatus('controller', controllers.list);
  const proxy = componentStatus('proxy', [...proxyDeployments.list, ...proxyDaemonSets.list]);
  const rateLimit = componentStatus('ratelimit', rateLimits.list);
  const namespace = controller.namespaces[0];

  const classes = envoyGatewayClasses(gatewayClasses.list);
  const gateways = gatewaysOfClasses(allGateways.list, classes);
  const routes = routesOfGateways([...httpRoutes.list, ...grpcRoutes.list], gateways);
  const programmed = gateways.filter(isProgrammed).length;

  const withConditions = [
    'ClientTrafficPolicy',
    'BackendTrafficPolicy',
    'SecurityPolicy',
    'EnvoyExtensionPolicy',
    'EnvoyPatchPolicy',
    'Backend',
  ].flatMap(kind => lists[kind].list);

  const issues = collectIssues({
    components: controllers.loaded ? [controller, proxy, rateLimit] : undefined,
    gatewayClasses: gatewayClasses.list,
    gateways: allGateways.list,
    routes: [...httpRoutes.list, ...grpcRoutes.list],
    resources: withConditions,
    envoyProxies: lists.EnvoyProxy.list,
    config,
  });
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const coverage = securityCoverage(routes, lists.SecurityPolicy.list);

  const accepted = (kind: string) =>
    lists[kind].list.filter(r => summarizeStatus(r.status).health === 'success').length;
  const failing = (kinds: string[]) =>
    kinds
      .flatMap(kind => lists[kind].list)
      .filter(r => summarizeStatus(r.status).health === 'error').length;
  const count = (kind: string): React.ReactNode =>
    lists[kind].loaded ? lists[kind].list.length : '…';
  const sum = (kinds: string[]): React.ReactNode =>
    kinds.every(k => lists[k].loaded) ? kinds.reduce((n, k) => n + lists[k].list.length, 0) : '…';
  const has = (kind: string) => isAvailable(availability, crdByKind(kind)!.plural);
  const proxiesInUse = lists.EnvoyProxy.list.filter(
    ep =>
      envoyProxyHealth(
        envoyProxyReferences(
          { name: ep.metadata?.name || '', namespace: ep.metadata?.namespace },
          gatewayClasses.list,
          allGateways.list
        )
      ).health === 'success'
  ).length;

  const forbidden = [controllers, gatewayClasses, allGateways, ...Object.values(lists)].some(
    l => (l.error as { status?: number } | null)?.status === 403
  );
  const trafficFailing = failing(['ClientTrafficPolicy', 'BackendTrafficPolicy']);
  const securityFailing = failing(['SecurityPolicy']);
  const extensionFailing = failing(['EnvoyExtensionPolicy', 'EnvoyPatchPolicy']);

  const stats: Stat[] = [
    {
      id: 'gateways',
      label: t('Gateways'),
      icon: 'mdi:gate',
      tone: gateways.length > 0 && programmed < gateways.length ? 'warning' : 'success',
      value: allGateways.loaded ? `${programmed}/${gateways.length}` : '…',
      caption: t('programmed · {{count}} gateway class(es)', { count: classes.length }),
    },
    {
      id: 'routes',
      label: t('Routes'),
      icon: 'mdi:routes',
      tone: 'info',
      value: httpRoutes.loaded && grpcRoutes.loaded ? routes.length : '…',
      caption: t('{{http}} HTTP · {{grpc}} gRPC', {
        http: routes.filter(r => r.kind === 'HTTPRoute').length,
        grpc: routes.filter(r => r.kind === 'GRPCRoute').length,
      }),
    },
    ...(has('SecurityPolicy')
      ? [
          {
            id: 'security',
            label: t('Security policies'),
            icon: CRD_ICONS.SecurityPolicy,
            tone: (securityFailing > 0 ? 'error' : 'primary') as Tone,
            value: count('SecurityPolicy'),
            caption:
              securityFailing > 0
                ? t('{{count}} not accepted', { count: securityFailing })
                : t('{{count}} accepted', { count: accepted('SecurityPolicy') }),
            route: listRouteName(crdByKind('SecurityPolicy')!.plural),
          },
        ]
      : []),
    {
      id: 'traffic',
      label: t('Traffic policies'),
      icon: CRD_ICONS.BackendTrafficPolicy,
      tone: trafficFailing > 0 ? 'error' : 'primary',
      value: sum(['ClientTrafficPolicy', 'BackendTrafficPolicy']),
      caption:
        trafficFailing > 0
          ? t('{{count}} not accepted', { count: trafficFailing })
          : t('{{backend}} backend · {{client}} client', {
              backend: lists.BackendTrafficPolicy.list.length,
              client: lists.ClientTrafficPolicy.list.length,
            }),
      route: listRouteName(crdByKind('BackendTrafficPolicy')!.plural),
    },
    {
      id: 'extensions',
      label: t('Extensions'),
      icon: CRD_ICONS.EnvoyExtensionPolicy,
      tone: extensionFailing > 0 ? 'error' : 'info',
      value: sum(['EnvoyExtensionPolicy', 'EnvoyPatchPolicy', 'HTTPRouteFilter']),
      caption:
        extensionFailing > 0
          ? t('{{count}} not accepted', { count: extensionFailing })
          : t('{{policies}} policies · {{filters}} route filters', {
              policies: lists.EnvoyExtensionPolicy.list.length + lists.EnvoyPatchPolicy.list.length,
              filters: lists.HTTPRouteFilter.list.length,
            }),
      route: listRouteName(crdByKind('EnvoyExtensionPolicy')!.plural),
    },
    {
      id: 'proxies',
      label: t('Proxy configurations'),
      icon: CRD_ICONS.EnvoyProxy,
      tone: 'info',
      value: count('EnvoyProxy'),
      caption: t('{{count}} in use', { count: proxiesInUse }),
      route: listRouteName(crdByKind('EnvoyProxy')!.plural),
    },
  ];

  const components = [controller, proxy, rateLimit].filter(
    c => c.workloads > 0 || !COMPONENT_INFO[c.id].optional
  );
  const apiVersions = Array.from(new Set(Object.values(availability.versions)))
    .map(v => v.replace(`${API_GROUP}/`, ''))
    .sort();
  const missing = ['EnvoyProxy', ...Object.keys(lists).filter(k => k !== 'EnvoyProxy')].filter(
    kind => !has(kind)
  );

  const twoColumns = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
    gap: 2,
    alignItems: 'stretch',
  };

  return (
    // Bottom padding keeps the last panel clear of the window edge.
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      {namespace && <ConfigLoader namespace={namespace} onConfig={setConfig} />}

      <Header
        version={controller.versions[0]}
        namespace={namespace}
        apiVersions={apiVersions}
        issues={issues}
        installed
      />

      {forbidden && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          {t(
            'Your user is not allowed to list some resources, so parts of this overview are incomplete.'
          )}
        </Alert>
      )}
      {missing.length > 0 && (
        <Alert severity="info">
          {t(
            'Not served by this cluster: {{kinds}}. They may be disabled in the Envoy Gateway configuration.',
            { kinds: missing.join(', ') }
          )}
        </Alert>
      )}

      {!controllers.loaded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : controller.workloads === 0 ? (
        <Alert severity="info">
          {t(
            'The Envoy Gateway CRDs are installed, but no controller Deployment with the label control-plane=envoy-gateway is visible to your user.'
          )}
        </Alert>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 2,
          }}
        >
          {components.map(component => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </Box>
      )}

      <Box
        sx={{
          display: 'grid',
          // Explicit columns keep the rows even (6, 3+3 or 2 per row) instead of leaving an orphan.
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            xl: `repeat(${stats.length}, minmax(0, 1fr))`,
          },
          gap: 2,
        }}
      >
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title={t('Needs attention')}
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
          <IssueList issues={issues} />
        </Panel>
        <Panel title={t('Route protection')} icon="mdi:shield-check-outline">
          {!httpRoutes.loaded || !lists.SecurityPolicy.loaded ? (
            <CircularProgress size={20} />
          ) : (
            <Coverage coverage={coverage} />
          )}
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title={t('Gateway classes')} icon="mdi:gate">
          {gatewayClasses.error && gatewayClasses.list.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('Gateway API resources could not be listed.')}
            </Typography>
          ) : !gatewayClasses.loaded ? (
            <CircularProgress size={20} />
          ) : (
            <GatewayClassList classes={classes} gateways={gateways} />
          )}
        </Panel>
        <Panel title={t('Guided setup')} icon="mdi:wizard-hat">
          <GuidedSetup availability={availability} />
        </Panel>
      </Box>

      <Panel title={t('Configuration')} icon="mdi:tune-variant">
        {!namespace ? (
          <Typography variant="body2" color="text.secondary">
            {t('The Envoy Gateway namespace is not known, so its configuration could not be read.')}
          </Typography>
        ) : config === undefined ? (
          <CircularProgress size={18} />
        ) : config === null ? (
          <Typography variant="body2" color="text.secondary">
            {t('The {{name}} ConfigMap in {{namespace}} could not be read.', {
              name: CONFIG_MAP,
              namespace,
            })}
          </Typography>
        ) : (
          <FeatureSummary config={config} />
        )}
      </Panel>

      <Panel title={t('Resources')} icon="mdi:view-grid-outline">
        <Inventory
          availability={availability}
          counts={Object.fromEntries(Object.keys(lists).map(kind => [kind, count(kind)]))}
        />
      </Panel>
    </Box>
  );
}

/** Landing page of the plugin: health, protection, problems and entry points to the wizards. */
export function EnvoyGatewayOverview() {
  const { t } = useText();
  const state = useEnvoyGatewayDiscovery();
  if (state.status === 'loading') {
    return <Loader title={t('Discovering Envoy Gateway APIs…')} />;
  }
  if (state.status === 'error') {
    return (
      <SectionBox title="Envoy Gateway">
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={state.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {t('Could not discover the Envoy Gateway API: {{error}}', { error: state.error })}
        </Alert>
      </SectionBox>
    );
  }
  if (!state.availability.groupInstalled) {
    return (
      <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2 }}>
        <Header apiVersions={[]} issues={[]} installed={false} />
        <Alert severity="warning">
          The <code>{API_GROUP}</code> API group was not found on this cluster. Install Envoy
          Gateway (for example with the gateway-helm chart) to start managing resources here.
        </Alert>
      </Box>
    );
  }
  return <Dashboard availability={state.availability} />;
}
