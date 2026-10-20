/**
 * Overview dashboard: what is installed, how healthy it is, what needs attention, and the entry
 * points to the wizards. Built from cards on a grid, the same way as the other plugins of this
 * repository present their overview.
 */
import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { NamespacesAutocomplete } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  AlertTitle,
  Box,
  ButtonBase,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { GatewayApiData, GatewayApiDataValue, useGatewayApiData } from '../../data/GatewayApiData';
import { useAuthorization } from '../../data/useAuthorization';
import { inNamespaces, useNamespaceFilter } from '../../data/useNamespaceFilter';
import { Availability } from '../../discovery/availability';
import { CRDGate } from '../../discovery/CRDGate';
import { servedApiVersion } from '../../discovery/discovery';
import { classOf } from '../../resources/classes';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  GATEWAY_API_ICON,
  KindCategory,
  KindInfo,
  kindInfo,
  KindName,
  KINDS,
  kindsInCategory,
  ROUTE_KINDS,
} from '../../resources/registry';
import { KubeJson, ListenerStatus } from '../../resources/types';
import {
  computeHealth,
  ConditionTally,
  countHealth,
  HealthLevel,
  tallyCondition,
} from '../../utils/conditions';
import { asArray, asRecord, asString } from '../../utils/objects';
import { AttentionItem, collectAttention } from '../../utils/problems';
import { refKey, uniqueRouteBackends } from '../../utils/refs';
import { controllerLabel, newResource } from '../../utils/templates';
import { RefLink } from '../common/RefLink';
import { ResourceEditor } from '../editor/ResourceEditor';
import { ExposeServiceDialog } from '../wizards/ExposeServiceWizard';

const ALL_KINDS = KINDS.map(k => k.kind);

const CATEGORY_ICONS: Record<KindCategory, string> = {
  infrastructure: 'mdi:gate',
  routes: 'mdi:routes',
  policies: 'mdi:shield-check-outline',
};

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info';

const LEVEL_TONE: Record<HealthLevel, Tone | 'neutral'> = {
  healthy: 'success',
  warning: 'warning',
  error: 'error',
  pending: 'neutral',
  none: 'neutral',
};

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

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
      <Icon icon={icon} width={size * 0.55} height={size * 0.55} aria-hidden />
    </Box>
  );
}

/** Card with a titled header; the building block of the dashboard. */
function Panel({
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
          <Icon icon={icon} width={20} aria-hidden />
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

const cardGrid = (min: number) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  gap: 2,
});

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

function Header({
  availability,
  issues,
  loading,
  refresh,
}: {
  availability: Availability;
  issues: AttentionItem[];
  loading: boolean;
  refresh: () => void;
}) {
  const errors = issues.filter(issue => issue.level === 'error').length;
  const warnings = issues.length - errors;
  const tone: Tone = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success';
  const status = loading
    ? 'Loading…'
    : issues.length === 0
    ? 'Healthy'
    : [
        errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
        warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  const served = KINDS.filter(info => !!availability.kinds[info.kind]).length;

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
      <IconBadge icon={GATEWAY_API_ICON} tone="primary" size={56} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Gateway API
          </Typography>
          {availability.bundleVersion && (
            <Chip label={availability.bundleVersion} size="small" color="primary" />
          )}
          {availability.channel && (
            <Chip label={`${availability.channel} channel`} size="small" variant="outlined" />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Gateways, routes and policies of gateway.networking.k8s.io · {served} of {KINDS.length}{' '}
          kinds served
        </Typography>
      </Box>
      <Box sx={{ minWidth: 220 }}>
        <NamespacesAutocomplete />
      </Box>
      <Chip
        icon={
          <Icon
            icon={
              loading
                ? 'mdi:progress-clock'
                : issues.length === 0
                ? 'mdi:check-circle'
                : 'mdi:alert-circle'
            }
            width={18}
          />
        }
        label={status}
        color={loading ? 'default' : tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
      <Tooltip title="Re-discover installed kinds">
        <IconButton aria-label="Re-discover installed kinds" onClick={refresh}>
          <Icon icon="mdi:refresh" />
        </IconButton>
      </Tooltip>
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------
// Gateway classes
// ---------------------------------------------------------------------------------------------

function ClassCard({ cls, gateways }: { cls: KubeJson; gateways: KubeJson[] }) {
  const history = useHistory();
  const name = cls.metadata?.name || '';
  const controller = asString(asRecord(cls.spec).controllerName);
  const health = computeHealth(cls);
  const own = gateways.filter(gateway => asRecord(gateway.spec).gatewayClassName === name);
  const programmed = own.filter(gateway => computeHealth(gateway).level === 'healthy').length;
  const tone = LEVEL_TONE[health.level];

  return (
    <ButtonBase
      onClick={() =>
        history.push(Router.createRouteURL(classOf('GatewayClass').detailsRoute, { name }))
      }
      sx={{
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'block',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 120ms',
        '&:hover, &:focus-visible': { borderColor: 'primary.main' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <IconBadge icon={kindInfo('GatewayClass').icon} tone={tone} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {controllerLabel(controller) || 'Gateway class'} · {health.label}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
            {name}
          </Typography>
        </Box>
      </Box>
      <Bar
        value={programmed}
        total={own.length}
        tone={programmed === own.length ? 'success' : 'warning'}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        noWrap
        sx={{ mt: 0.75 }}
        title={controller}
      >
        {own.length === 0
          ? 'No Gateways yet'
          : `${programmed}/${own.length} Gateway${own.length === 1 ? '' : 's'} programmed`}{' '}
        · {controller}
      </Typography>
    </ButtonBase>
  );
}

// ---------------------------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------------------------

interface Stat {
  id: string;
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: string;
  tone: Tone;
  to?: string;
}

function StatCard({ stat }: { stat: Stat }) {
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
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
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
    textAlign: 'left' as const,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
  };
  if (!stat.to) return <Box sx={sx}>{content}</Box>;
  const to = stat.to;
  return (
    <ButtonBase
      onClick={() => history.push(to)}
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

function listUrl(kind: KindName): string {
  return Router.createRouteURL(classOf(kind).listRoute);
}

function healthCaption(objects: KubeJson[], healthyWord: string): { caption: string; tone: Tone } {
  const counts = countHealth(objects);
  if (counts.total === 0) return { caption: 'None yet', tone: 'primary' };
  if (counts.error > 0) return { caption: `${counts.error} failing`, tone: 'error' };
  if (counts.warning > 0) return { caption: `${counts.warning} degraded`, tone: 'warning' };
  if (counts.pending > 0) return { caption: `${counts.pending} pending`, tone: 'info' };
  return { caption: `All ${healthyWord}`, tone: 'success' };
}

// ---------------------------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------------------------

function IssueList({ issues, loading }: { issues: AttentionItem[]; loading: boolean }) {
  if (loading) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading…
      </Typography>
    );
  }
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">Nothing needs attention</Typography>
          <Typography variant="body2" color="text.secondary">
            Every resource is accepted and every reference resolves.
          </Typography>
        </Box>
      </Box>
    );
  }
  return (
    <ScrollArea maxHeight={360}>
      {issues.map((issue, index) => {
        const error = issue.level === 'error';
        return (
          <Box
            key={index}
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
                <Icon icon={error ? 'mdi:alert-circle' : 'mdi:alert'} width={20} />
              </Box>
            </Tooltip>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <RefLink
                  target={{
                    group: issue.group,
                    kind: issue.kind,
                    namespace: issue.namespace,
                    name: issue.name,
                  }}
                  showKind
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {issue.title}
                  {issue.reason ? ` (${issue.reason})` : ''}
                </Typography>
              </Box>
              {issue.detail && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                  {issue.detail}
                </Typography>
              )}
              {issue.hint && (
                <Typography variant="caption" color="text.secondary" component="div">
                  {issue.hint}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------------------------
// Health (conditions)
// ---------------------------------------------------------------------------------------------

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

function ConditionRow({ tally, description }: { tally: ConditionTally; description: string }) {
  const total = tally.true + tally.false + tally.unknown;
  const tone: Tone | 'neutral' =
    total === 0 ? 'neutral' : tally.false > 0 ? 'error' : tally.unknown > 0 ? 'warning' : 'success';
  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {tally.type}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {total === 0 ? '—' : `${tally.true}/${total}`}
        </Typography>
      </Box>
      <Bar value={tally.true} total={total} tone={tone} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    </Box>
  );
}

function HealthPanel({ objects }: { objects: KubeJson[] }) {
  const accepted = tallyCondition(objects, 'Accepted');
  const programmed = tallyCondition(objects, 'Programmed');
  const resolved = tallyCondition(objects, 'ResolvedRefs');
  const all = [accepted, programmed, resolved];
  const sum = (key: 'true' | 'false' | 'unknown') => all.reduce((n, tally) => n + tally[key], 0);
  const total = sum('true') + sum('false') + sum('unknown');

  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No conditions have been reported yet.
      </Typography>
    );
  }
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
          {Math.round((sum('true') / total) * 100)}%
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {sum('true')} of {total} conditions are True
        </Typography>
      </Box>
      <Bar value={sum('true')} total={total} tone={sum('false') > 0 ? 'warning' : 'success'} />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5, mb: 1 }}>
        <LegendDot color="success.main" label="True" value={sum('true')} />
        <LegendDot color="error.main" label="False" value={sum('false')} />
        <LegendDot color="text.disabled" label="Unknown" value={sum('unknown')} />
      </Box>
      <ConditionRow
        tally={accepted}
        description="The controller accepted the configuration (per route parent and policy ancestor)."
      />
      <ConditionRow
        tally={programmed}
        description="Gateways and listeners are configured in the data plane and ready for traffic."
      />
      <ConditionRow
        tally={resolved}
        description="Every reference (backends, certificates) resolves and is permitted."
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------------------------

function InstallationPanel({
  availability,
  classes,
}: {
  availability: Availability;
  classes: KubeJson[] | null;
}) {
  const served = KINDS.filter(info => !!availability.kinds[info.kind]);
  const missing = KINDS.filter(info => !availability.kinds[info.kind]);
  const controllers = [
    ...new Set((classes || []).map(cls => asString(asRecord(cls.spec).controllerName))),
  ].filter(Boolean);

  const settings = [
    {
      label: 'Bundle version',
      value: availability.bundleVersion || 'Unknown',
      title: availability.bundleVersion
        ? undefined
        : 'Reading the CRDs requires permission to get CustomResourceDefinitions',
    },
    { label: 'Channel', value: availability.channel || 'Unknown' },
    { label: 'Kinds served', value: `${served.length} of ${KINDS.length}` },
    {
      label: controllers.length === 1 ? 'Controller' : 'Controllers',
      value:
        controllers.length === 0
          ? 'None'
          : controllers.map(name => controllerLabel(name) || name).join(', '),
      title: controllers.join(', ') || undefined,
    },
  ];

  const chips = (list: KindInfo[], on: boolean) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {list.map(info => (
        <Tooltip
          key={info.kind}
          title={
            on
              ? `${info.description} Served as ${availability.kinds[info.kind]?.version}.`
              : 'Not installed in this cluster'
          }
        >
          <Chip
            size="small"
            variant="outlined"
            color={on ? 'success' : 'default'}
            icon={<Icon icon={on ? 'mdi:check' : 'mdi:minus'} width={14} />}
            label={info.kind}
            sx={on ? undefined : { opacity: 0.65 }}
          />
        </Tooltip>
      ))}
    </Box>
  );

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 1.5,
          mb: 2,
        }}
      >
        {settings.map(setting => (
          <Box key={setting.label} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {setting.label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600 }}
              noWrap
              title={setting.title || setting.value}
            >
              {setting.value}
            </Typography>
          </Box>
        ))}
      </Box>
      {chips(served, true)}
      {missing.length > 0 && <Box sx={{ mt: 1 }}>{chips(missing, false)}</Box>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Guided setup
// ---------------------------------------------------------------------------------------------

function ActionCard({
  icon,
  title,
  description,
  onClick,
  disabledReason,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  disabledReason?: string;
}) {
  return (
    <Tooltip title={disabledReason || ''}>
      <span>
        <ButtonBase
          onClick={onClick}
          disabled={!!disabledReason}
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
            opacity: disabledReason ? 0.55 : 1,
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
      </span>
    </Tooltip>
  );
}

/** Opens the wizard of a kind; disabled when the user is known not to be allowed to create it. */
function WizardAction({
  kind,
  title,
  description,
}: {
  kind: KindName;
  title: string;
  description: string;
}) {
  const info = kindInfo(kind);
  const namespaces = useNamespaceFilter();
  const namespace = info.namespaced ? namespaces[0] : undefined;
  const auth = useAuthorization(kind, 'create', namespace);
  // See CreateMenu: only a namespace-specific (or cluster-scoped) denial is conclusive.
  const denied = auth === 'denied' && (!info.namespaced || !!namespace);
  const [initial, setInitial] = React.useState<KubeJson | null>(null);

  return (
    <>
      <ActionCard
        icon={info.icon}
        title={title}
        description={description}
        disabledReason={
          denied ? `You do not have permission to create ${info.labelPlural}` : undefined
        }
        onClick={() =>
          setInitial(
            newResource(kind, servedApiVersion(info), {
              namespace: namespace || 'default',
              namespaced: info.namespaced,
            })
          )
        }
      />
      {initial && (
        <ResourceEditor
          open
          onClose={() => setInitial(null)}
          kind={kind}
          mode="create"
          initial={initial}
          variant="wizard"
        />
      )}
    </>
  );
}

function GuidedSetup({ availability }: { availability: Availability }) {
  const history = useHistory();
  const [exposeOpen, setExposeOpen] = React.useState(false);
  const has = (kind: KindName) => !!availability.kinds[kind];
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {has('HTTPRoute') && (
        <ActionCard
          icon="mdi:earth-arrow-right"
          title="Expose a Service"
          description="Create the route, and the Gateway and ReferenceGrant when needed, in one go."
          onClick={() => setExposeOpen(true)}
        />
      )}
      {has('Gateway') && (
        <WizardAction
          kind="Gateway"
          title="Gateway wizard"
          description="Pick a class, add listeners, choose certificates and allowed routes."
        />
      )}
      {has('HTTPRoute') && (
        <WizardAction
          kind="HTTPRoute"
          title="HTTPRoute wizard"
          description="Attach to a Gateway, match requests, add filters and backends."
        />
      )}
      <ActionCard
        icon="mdi:graph-outline"
        title="Topology"
        description="See how classes, Gateways, listeners, routes and backends connect."
        onClick={() => history.push(Router.createRouteURL('Gateway API Topology'))}
      />
      {exposeOpen && <ExposeServiceDialog open onClose={() => setExposeOpen(false)} />}
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------------------------

function InventoryRow({
  info,
  available,
  objects,
}: {
  info: KindInfo;
  available: boolean;
  objects: KubeJson[] | null;
}) {
  const history = useHistory();
  const counts = objects ? countHealth(objects) : null;
  const count = !available ? '—' : counts ? counts.total : '…';
  return (
    <Tooltip title={available ? info.description : 'This kind is not installed'} placement="left">
      <span>
        <ButtonBase
          disabled={!available}
          onClick={() => history.push(listUrl(info.kind))}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            // Fixed row height, so rows with a status chip line up with the others.
            height: 34,
            borderRadius: 1,
            textAlign: 'left',
            opacity: available ? 1 : 0.5,
            '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ color: 'text.secondary', display: 'flex' }}>
            <Icon icon={info.icon} width={18} aria-hidden />
          </Box>
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {info.labelPlural}
          </Typography>
          {available && counts && counts.error > 0 && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={`${counts.error} failing`}
              sx={{ height: 20 }}
            />
          )}
          {available && counts && counts.error === 0 && counts.warning > 0 && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${counts.warning} degraded`}
              sx={{ height: 20 }}
            />
          )}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {count}
          </Typography>
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

function InventoryGroup({
  category,
  availability,
  byKind,
}: {
  category: KindCategory;
  availability: Availability;
  byKind: Map<string, KubeJson[] | null>;
}) {
  const kinds = kindsInCategory(category);
  const served = kinds.filter(info => !!availability.kinds[info.kind]);
  const total = served.some(info => byKind.get(info.kind) === null)
    ? null
    : served.reduce((n, info) => n + (byKind.get(info.kind) || []).length, 0);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 2, height: '100%', boxSizing: 'border-box' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 0.75,
          px: 1,
          pb: 1,
          pt: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ color: 'primary.main', display: 'flex' }}>
          <Icon icon={CATEGORY_ICONS[category]} width={20} aria-hidden />
        </Box>
        <Typography variant="subtitle2" noWrap sx={{ flexGrow: 1 }}>
          {CATEGORY_LABELS[category]}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {total === null ? '…' : total}
        </Typography>
      </Box>
      {kinds.map(info => (
        <InventoryRow
          key={info.kind}
          info={info}
          available={!!availability.kinds[info.kind]}
          objects={byKind.get(info.kind) ?? null}
        />
      ))}
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

function buildStats(byKind: Map<string, KubeJson[] | null>, issues: AttentionItem[]): Stat[] {
  const list = (kind: KindName) => byKind.get(kind) || [];
  const ready = (kinds: KindName[]) => kinds.every(kind => byKind.get(kind) !== null);
  const loaded = (isReady: boolean, value: React.ReactNode) => (isReady ? value : '…');

  const gateways = list('Gateway');
  const listenerOwners = [...gateways, ...list('ListenerSet')];
  const listenerCount = listenerOwners.reduce(
    (n, owner) => n + asArray(asRecord(owner.spec).listeners).length,
    0
  );
  const attachedRoutes = listenerOwners.reduce(
    (n, owner) =>
      n +
      asArray<ListenerStatus>(asRecord(owner.status).listeners).reduce(
        (sum, listener) => sum + (listener?.attachedRoutes || 0),
        0
      ),
    0
  );

  const routes = ROUTE_KINDS.flatMap(kind => list(kind));
  const routeBreakdown = ROUTE_KINDS.map(kind => ({ kind, count: list(kind).length }))
    .filter(entry => entry.count > 0)
    .map(entry => `${entry.count} ${entry.kind.replace('Route', '')}`)
    .join(' · ');

  const backends = new Set(routes.flatMap(route => uniqueRouteBackends(route).map(refKey)));
  const brokenBackends = issues.filter(
    issue => issue.title === 'Backend not found' || issue.title === 'Backend port not found'
  ).length;

  const grants = list('ReferenceGrant').length;
  const tlsPolicies = list('BackendTLSPolicy').length;
  const deniedRefs = issues.filter(issue => issue.title === 'Reference not permitted').length;

  const gatewayHealth = healthCaption(gateways, 'programmed');
  const routeHealth = healthCaption(routes, 'accepted');

  return [
    {
      id: 'gateways',
      label: 'Gateways',
      icon: kindInfo('Gateway').icon,
      tone: gatewayHealth.tone,
      value: loaded(ready(['Gateway']), gateways.length),
      caption: gatewayHealth.caption,
      to: listUrl('Gateway'),
    },
    {
      id: 'listeners',
      label: 'Listeners',
      icon: 'mdi:ear-hearing',
      tone: 'info',
      value: loaded(ready(['Gateway', 'ListenerSet']), listenerCount),
      caption: `${attachedRoutes} attached route${attachedRoutes === 1 ? '' : 's'}`,
      to: listUrl('Gateway'),
    },
    {
      id: 'routes',
      label: 'Routes',
      icon: kindInfo('HTTPRoute').icon,
      tone: routeHealth.tone,
      value: loaded(ready(ROUTE_KINDS), routes.length),
      caption:
        routeHealth.tone === 'success' || routes.length === 0
          ? routeBreakdown || routeHealth.caption
          : routeHealth.caption,
      to: listUrl('HTTPRoute'),
    },
    {
      id: 'backends',
      label: 'Backends',
      icon: 'mdi:server-network',
      tone: brokenBackends > 0 ? 'error' : 'primary',
      value: loaded(ready(ROUTE_KINDS), backends.size),
      caption: brokenBackends > 0 ? `${brokenBackends} not found` : 'Referenced by routes',
    },
    {
      id: 'policies',
      label: 'Grants and policies',
      icon: kindInfo('ReferenceGrant').icon,
      tone: deniedRefs > 0 ? 'error' : 'primary',
      value: loaded(ready(['ReferenceGrant', 'BackendTLSPolicy']), grants + tlsPolicies),
      caption:
        deniedRefs > 0
          ? `${deniedRefs} reference${deniedRefs === 1 ? '' : 's'} not permitted`
          : `${grants} grant${grants === 1 ? '' : 's'} · ${tlsPolicies} TLS polic${
              tlsPolicies === 1 ? 'y' : 'ies'
            }`,
      to: listUrl('ReferenceGrant'),
    },
  ];
}

function forbiddenKinds(data: GatewayApiDataValue, availability: Availability): string[] {
  return KINDS.filter(info => !!availability.kinds[info.kind] && !!data.error(info.kind)).map(
    info => info.labelPlural
  );
}

function Dashboard({ availability, refresh }: { availability: Availability; refresh: () => void }) {
  const data = useGatewayApiData();
  const namespaces = useNamespaceFilter();

  const byKind = React.useMemo(() => {
    const result = new Map<string, KubeJson[] | null>();
    for (const info of KINDS) {
      const items = data.json(info.kind);
      result.set(info.kind, items ? items.filter(item => inNamespaces(item, namespaces)) : null);
    }
    return result;
  }, [data, namespaces]);

  const allObjects = React.useMemo(
    () => KINDS.flatMap(info => byKind.get(info.kind) || []),
    [byKind]
  );

  const classes = data.json('GatewayClass');
  const gateways = byKind.get('Gateway') || [];
  const issues = React.useMemo(
    () =>
      collectAttention({
        objects: allObjects,
        grants: data.grants,
        services: data.error('Service') ? null : data.json('Service'),
        gatewayClasses: classes ? classes.map(cls => cls.metadata?.name || '') : null,
      }),
    [allObjects, data, classes]
  );
  const stats = React.useMemo(() => buildStats(byKind, issues), [byKind, issues]);
  const forbidden = forbiddenKinds(data, availability);
  const errorCount = issues.filter(issue => issue.level === 'error').length;

  const twoColumns = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
    gap: 2,
    alignItems: 'stretch',
  };

  return (
    // Bottom padding keeps the last panel clear of the window edge.
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      <Header
        availability={availability}
        issues={issues}
        loading={data.loading}
        refresh={refresh}
      />

      {forbidden.length > 0 && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          Your user is not allowed to list some resources ({forbidden.join(', ')}), so parts of this
          overview are incomplete.
        </Alert>
      )}

      {classes && classes.length === 0 ? (
        <Alert severity="info">
          <AlertTitle>No GatewayClass exists yet</AlertTitle>A GatewayClass connects Gateways to the
          controller that implements them. Controllers usually create one during installation;
          otherwise create it from the Gateway Classes page.
        </Alert>
      ) : (
        classes && (
          <Box sx={cardGrid(240)}>
            {classes.map(cls => (
              <ClassCard key={cls.metadata?.name} cls={cls} gateways={gateways} />
            ))}
          </Box>
        )
      )}

      <Box sx={cardGrid(210)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title="Needs attention"
          icon="mdi:bell-alert-outline"
          action={
            !data.loading &&
            issues.length > 0 && (
              <Chip
                size="small"
                color={errorCount > 0 ? 'error' : 'warning'}
                label={issues.length}
              />
            )
          }
        >
          <IssueList issues={issues} loading={data.loading} />
        </Panel>
        <Panel title="Condition health" icon="mdi:heart-pulse">
          <HealthPanel objects={allObjects} />
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title="Installation" icon="mdi:tune-variant">
          <InstallationPanel availability={availability} classes={classes} />
        </Panel>
        <Panel title="Guided setup" icon="mdi:wizard-hat">
          <GuidedSetup availability={availability} />
        </Panel>
      </Box>

      <Panel title="Resources" icon="mdi:view-grid-outline">
        <Box
          sx={{
            display: 'grid',
            // One equal column per group, filling the panel; every card is as tall as the
            // tallest one (the group with the most kinds).
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: `repeat(${Math.min(CATEGORY_ORDER.length, 2)}, minmax(0, 1fr))`,
              md: `repeat(${CATEGORY_ORDER.length}, minmax(0, 1fr))`,
            },
            gap: 2,
            alignItems: 'stretch',
          }}
        >
          {CATEGORY_ORDER.map(category => (
            <InventoryGroup
              key={category}
              category={category}
              availability={availability}
              byKind={byKind}
            />
          ))}
        </Box>
      </Panel>
    </Box>
  );
}

/** Landing page of the plugin. */
export function Overview() {
  return (
    <CRDGate title="Gateway API">
      {(availability, refresh) => (
        <GatewayApiData availability={availability} kinds={ALL_KINDS} core={['Service']}>
          <Dashboard availability={availability} refresh={refresh} />
        </GatewayApiData>
      )}
    </CRDGate>
  );
}
