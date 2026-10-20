import { Icon } from '@iconify/react';
import { AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
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
import {
  ComponentStatus,
  ConfigFeature,
  configFeatures,
  InstallStatus,
} from '../../api/ciliumInstall';
import { Availability, isAvailable, servedApiVersion } from '../../api/discovery';
import { ResourceEditor } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { ErrorState } from '../../common/States';
import { useCiliumConfig, useCiliumInstall } from '../../hooks/useCiliumInstall';
import { useCiliumList, useNodes, useServices } from '../../hooks/useClusterData';
import { ciliumIcon } from '../../icons/ciliumIcon';
import {
  CiliumBGPClusterConfig,
  CiliumBGPNodeConfig,
  CiliumBGPPeerConfig,
} from '../../resources/bgp';
import { CiliumEgressGatewayPolicy, CiliumLoadBalancerIPPool } from '../../resources/network';
import { CiliumClusterwideNetworkPolicy, CiliumNetworkPolicy } from '../../resources/networkPolicy';
import {
  crd,
  CRDInfo,
  crdsOfGroup,
  groupById,
  GroupId,
  GroupInfo,
  GROUPS,
} from '../../resources/registry';
import { CiliumEndpoint, CiliumIdentity, CiliumNode } from '../../resources/runtime';
import { Health, KubeJson } from '../../resources/types';
import { newResource } from '../../utils/templates';
import { CRDGate } from '../common/CRDGate';
import { SetupWizard } from '../common/form/EditActions';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { groupURL, listURL } from '../common/Views';
import { BGP_SETUP, EDITING, LB_SETUP } from '../editing';
import {
  bgpStats,
  collectIssues,
  endpointStats,
  Issue,
  NamespaceCoverage,
  namespaceCoverage,
  poolStats,
} from './overview';

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info';

const HEALTH_TONE: Record<Health, Tone | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: 'neutral',
};

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
  icon: React.ComponentProps<typeof Icon>['icon'];
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

function componentHealth(component: ComponentStatus): Health {
  if (component.total === 0) return component.info.optional ? 'unknown' : 'error';
  if (component.ready === component.total) return 'success';
  return component.ready === 0 ? 'error' : 'warning';
}

export function Header({ install, issues }: { install?: InstallStatus; issues: Issue[] }) {
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
      <IconBadge icon={ciliumIcon} tone="primary" size={56} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Cilium
          </Typography>
          {install?.version && <Chip label={install.version} size="small" color="primary" />}
        </Box>
        <Typography variant="body2" color="text.secondary" component="div">
          {install?.namespace ? (
            <>
              {t('Running in namespace')}{' '}
              <ResourceRefLink kind="Namespace" name={install.namespace} />
            </>
          ) : (
            t('eBPF-based networking, security and observability')
          )}
        </Typography>
      </Box>
      <Chip
        icon={
          <Icon icon={issues.length === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'} width={18} />
        }
        label={status}
        color={tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Paper>
  );
}

export function ComponentCard({ component }: { component: ComponentStatus }) {
  const { t } = useText();
  const health = componentHealth(component);
  const tone = HEALTH_TONE[health];
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <IconBadge icon={component.info.icon} tone={tone} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {t(component.info.label)}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {component.total === 0
              ? t('Not found')
              : t('{{ready}}/{{total}} ready', {
                  ready: component.ready,
                  total: component.total,
                })}
          </Typography>
        </Box>
      </Box>
      <Bar value={component.ready} total={component.total} tone={tone} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
        {[
          component.versions[0],
          component.restarts > 0 ? t('{{count}} restart(s)', { count: component.restarts }) : '',
        ]
          .filter(Boolean)
          .join(' · ') || ' '}
      </Typography>
    </Paper>
  );
}

function Components({ install, error }: { install?: InstallStatus; error: unknown }) {
  const { t } = useText();
  if (error) return <ErrorState error={error} what={t('the Cilium pods')} />;
  if (!install) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (!install.found) {
    return (
      <Alert severity="info">
        {t(
          'The Cilium CRDs are installed, but no agent or operator pod with the usual labels (k8s-app=cilium, io.cilium/app=operator) is visible to your user.'
        )}
      </Alert>
    );
  }
  // Optional components are only shown when they are deployed.
  const components = Object.values(install.components).filter(c => c.total > 0 || !c.info.optional);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 2,
      }}
    >
      {components.map(component => (
        <ComponentCard key={component.info.id} component={component} />
      ))}
    </Box>
  );
}

export interface Stat {
  id: string;
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: string;
  tone: Tone;
  to?: string;
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

export function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useText();
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">{t('Nothing needs attention')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('All Cilium components and resources look healthy.')}
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
                  qualified
                  showKind
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

export function Coverage({ coverage }: { coverage: NamespaceCoverage[] }) {
  const { t } = useText();
  const endpoints = coverage.reduce((n, c) => n + c.endpoints, 0);
  const enforced = coverage.reduce((n, c) => n + c.enforced, 0);
  const full = coverage.filter(c => c.enforced === c.endpoints).length;
  const none = coverage.filter(c => c.enforced === 0).length;
  const partial = coverage.length - full - none;
  // Namespaces without any enforced endpoint first: those are the gaps.
  const rows = [...coverage].sort(
    (a, b) =>
      a.enforced / a.endpoints - b.enforced / b.endpoints || a.namespace.localeCompare(b.namespace)
  );
  if (coverage.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No Cilium endpoints found.')}
      </Typography>
    );
  }
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
          {endpoints ? Math.round((enforced / endpoints) * 100) : 0}%
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('{{enforced}} of {{total}} endpoints under policy', { enforced, total: endpoints })}
        </Typography>
      </Box>
      <Bar value={enforced} total={endpoints} tone="success" />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5, mb: 1.5 }}>
        <LegendDot color="success.main" label={t('Fully covered')} value={full} />
        <LegendDot color="info.main" label={t('Partially')} value={partial} />
        <LegendDot color="warning.main" label={t('No policy')} value={none} />
      </Box>
      <ScrollArea maxHeight={236}>
        {rows.map(row => {
          const tone: Tone =
            row.enforced === 0 ? 'warning' : row.enforced === row.endpoints ? 'success' : 'info';
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
                <ResourceRefLink kind="Namespace" name={row.namespace} />
              </Typography>
              <Bar value={row.enforced} total={row.endpoints} tone={tone} />
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                {row.enforced}/{row.endpoints}
              </Typography>
            </Box>
          );
        })}
      </ScrollArea>
    </>
  );
}

function Features({ namespace }: { namespace: string }) {
  const { t } = useText();
  const config = useCiliumConfig(namespace);
  if (config === undefined) return <CircularProgress size={18} />;
  if (config === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('The cilium-config ConfigMap in {{namespace}} could not be read.', { namespace })}
      </Typography>
    );
  }
  return <FeatureSummary config={config} />;
}

/** Settings and feature switches of cilium-config. */
export function FeatureSummary({ config }: { config: Record<string, string> }) {
  const { t } = useText();
  const features = configFeatures(config);
  const settings = features.filter(f => f.enabled === undefined);
  const enabled = features.filter(f => f.enabled === true);
  const disabled = features.filter(f => f.enabled === false);
  const chips = (list: ConfigFeature[], on: boolean) => (
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
      {settings.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 1.5,
            mb: 2,
          }}
        >
          {settings.map(setting => (
            <Box key={setting.id} sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {t(setting.label)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={setting.value}>
                {setting.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
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

/** Opens the single-resource wizard of a kind. */
function WizardAction({
  kind,
  title,
  description,
  icon,
}: {
  kind: string;
  title: string;
  description: string;
  icon: string;
}) {
  const { t } = useText();
  const info = crd(kind);
  const Wizard = EDITING[kind]?.Wizard;
  const [item, setItem] = React.useState<KubeJson | null>(null);
  if (!Wizard) return null;
  return (
    <AuthVisible item={info.cls} authVerb="create">
      <ActionCard
        icon={icon}
        title={title}
        description={description}
        onClick={() => setItem(newResource(kind, servedApiVersion(info.plural, getCluster())))}
      />
      {item && (
        <ResourceEditor
          open
          onClose={() => setItem(null)}
          title={t('Create {{kind}}', { kind: info.label })}
          initialItem={item}
          mode="create"
          Form={Wizard}
          wizard
        />
      )}
    </AuthVisible>
  );
}

/** Opens a multi-resource setup wizard. */
function SetupAction({
  kind,
  wizard,
  description,
}: {
  kind: string;
  wizard: SetupWizard;
  description: string;
}) {
  const { t } = useText();
  const [open, setOpen] = React.useState(false);
  const Dialog = wizard.Dialog;
  return (
    <AuthVisible item={crd(kind).cls} authVerb="create">
      <ActionCard
        icon={wizard.icon}
        title={t(wizard.label)}
        description={description}
        onClick={() => setOpen(true)}
      />
      {open && <Dialog open onClose={() => setOpen(false)} />}
    </AuthVisible>
  );
}

function GuidedSetup({ availability }: { availability: Availability }) {
  const { t } = useText();
  const has = (kind: string) => isAvailable(availability, crd(kind).plural);
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {has('CiliumNetworkPolicy') && (
        <WizardAction
          kind="CiliumNetworkPolicy"
          title={t('Network policy wizard')}
          description={t('Pick a workload and allow only the traffic it needs.')}
          icon="mdi:shield-lock-outline"
        />
      )}
      {has('CiliumBGPClusterConfig') &&
        has('CiliumBGPPeerConfig') &&
        has('CiliumBGPAdvertisement') && (
          <SetupAction
            kind="CiliumBGPClusterConfig"
            wizard={BGP_SETUP}
            description={t('Peer with your routers and advertise pod and service prefixes.')}
          />
        )}
      {has('CiliumLoadBalancerIPPool') && (
        <SetupAction
          kind="CiliumLoadBalancerIPPool"
          wizard={LB_SETUP}
          description={t('Give LoadBalancer services addresses and announce them on the LAN.')}
        />
      )}
      {has('CiliumEgressGatewayPolicy') && (
        <WizardAction
          kind="CiliumEgressGatewayPolicy"
          title={t('Egress gateway wizard')}
          description={t('Send selected pod traffic out through a node with a stable IP.')}
          icon="mdi:exit-to-app"
        />
      )}
    </Box>
  );
}

/** One row of the resource inventory: kind and count, linking to its list. */
function InventoryRow({ info, available }: { info: CRDInfo; available: boolean }) {
  const { t } = useText();
  const history = useHistory();
  const { items, error } = useCiliumList<unknown>(info.kind);
  const count = !available ? '—' : error && !items ? '?' : items === null ? '…' : items.length;
  return (
    <Tooltip
      title={available ? t(info.description) : t('This CRD is not installed')}
      placement="left"
    >
      <span>
        <ButtonBase
          disabled={!available}
          onClick={() => history.push(listURL(info))}
          sx={{
            width: '100%',
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
            <Icon icon={info.icon} width={18} />
          </Box>
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {t(info.tabLabel)}
          </Typography>
          {info.deprecated && available && (
            <Chip size="small" color="warning" variant="outlined" label={t('Deprecated')} />
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
  group,
  availability,
  grow,
}: {
  group: GroupInfo;
  availability: Availability;
  /** Stretch to the bottom of the column, so that all columns end at the same height. */
  grow?: boolean;
}) {
  const { t } = useText();
  const history = useHistory();
  const crds = crdsOfGroup(group.id).filter(
    info => !info.deprecated || isAvailable(availability, info.plural)
  );
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flexGrow: grow ? 1 : 0 }}>
      <ButtonBase
        onClick={() => history.push(groupURL(group.id))}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 0.5,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          width: '100%',
          justifyContent: 'flex-start',
          '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ color: 'primary.main', display: 'flex' }}>
          <Icon icon={group.icon} width={20} />
        </Box>
        <Typography variant="subtitle2" noWrap>
          {t(group.label)}
        </Typography>
      </ButtonBase>
      {crds.map(info => (
        <InventoryRow
          key={info.kind}
          info={info}
          available={isAvailable(availability, info.plural)}
        />
      ))}
    </Paper>
  );
}

/**
 * Groups of the resource inventory, arranged in four columns with about the same number of rows
 * (BGP has the most kinds and gets a column of its own). Groups missing from the layout are added
 * to the last column, so a newly registered group is never hidden.
 */
const INVENTORY_LAYOUT: GroupId[][] = [
  ['policies', 'nodes'],
  ['endpoints', 'egress'],
  ['bgp'],
  ['lb', 'envoy'],
];

function inventoryColumns(): GroupInfo[][] {
  const placed = new Set(INVENTORY_LAYOUT.flat());
  const columns = INVENTORY_LAYOUT.map(ids => ids.map(groupById));
  columns[columns.length - 1].push(...GROUPS.filter(group => !placed.has(group.id)));
  return columns;
}

/** Kind counts per group, in balanced columns. */
export function ResourceInventory({ availability }: { availability: Availability }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 1.5,
      }}
    >
      {inventoryColumns().map(column => (
        <Box
          key={column.map(group => group.id).join('-')}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          {column.map((group, index) => (
            <InventoryGroup
              key={group.id}
              group={group}
              availability={availability}
              grow={index === column.length - 1}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function Dashboard({ availability }: { availability: Availability }) {
  const { t } = useText();
  const { install, error: installError } = useCiliumInstall();
  const cnps = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy');
  const ccnps = useCiliumList<CiliumClusterwideNetworkPolicy>('CiliumClusterwideNetworkPolicy');
  const endpoints = useCiliumList<CiliumEndpoint>('CiliumEndpoint');
  const identities = useCiliumList<CiliumIdentity>('CiliumIdentity');
  const ciliumNodes = useCiliumList<CiliumNode>('CiliumNode');
  const bgpClusterConfigs = useCiliumList<CiliumBGPClusterConfig>('CiliumBGPClusterConfig');
  const bgpPeerConfigs = useCiliumList<CiliumBGPPeerConfig>('CiliumBGPPeerConfig');
  const bgpNodeConfigs = useCiliumList<CiliumBGPNodeConfig>('CiliumBGPNodeConfig');
  const pools = useCiliumList<CiliumLoadBalancerIPPool>('CiliumLoadBalancerIPPool');
  const egressPolicies = useCiliumList<CiliumEgressGatewayPolicy>('CiliumEgressGatewayPolicy');
  const services = useServices();
  const nodes = useNodes();

  const json = <T extends { jsonData: unknown }>(items: T[] | null) =>
    (items || []).map(i => i.jsonData) as Array<T['jsonData']>;
  const endpointJson = React.useMemo(() => json(endpoints.items), [endpoints.items]);
  const policyJson = React.useMemo(
    () => [...json(cnps.items), ...json(ccnps.items)],
    [cnps.items, ccnps.items]
  );
  const eStats = React.useMemo(() => endpointStats(endpointJson), [endpointJson]);
  const coverage = React.useMemo(() => namespaceCoverage(endpointJson), [endpointJson]);
  const bStats = bgpStats(json(bgpNodeConfigs.items));
  const pStats = poolStats(json(pools.items), services.items || []);
  const issues = collectIssues({
    install,
    policies: policyJson,
    endpoints: endpointJson,
    ciliumNodes: json(ciliumNodes.items),
    bgpClusterConfigs: json(bgpClusterConfigs.items),
    bgpPeerConfigs: json(bgpPeerConfigs.items),
    bgpNodeConfigs: json(bgpNodeConfigs.items),
    pools: json(pools.items),
    services: services.items || undefined,
    egressPolicies: json(egressPolicies.items),
    nodes: nodes.items || undefined,
  });

  const loaded = (ready: boolean, value: React.ReactNode) => (ready ? value : '…');
  const bgpEnabled = !bgpClusterConfigs.missing && (bgpClusterConfigs.items || []).length > 0;
  const lbEnabled = !pools.missing && (pools.items || []).length > 0;
  const forbidden = [cnps, endpoints, identities].some(
    l => !!l.error && !l.items && (l.error as { status?: number }).status === 403
  );
  const errorCount = issues.filter(i => i.severity === 'error').length;

  const stats: Stat[] = [
    {
      id: 'policies',
      label: t('Network policies'),
      icon: 'mdi:shield-lock-outline',
      tone: 'primary',
      value: loaded(cnps.items !== null && ccnps.items !== null, policyJson.length),
      caption: t('{{namespaced}} namespaced · {{clusterwide}} clusterwide', {
        namespaced: (cnps.items || []).length,
        clusterwide: (ccnps.items || []).length,
      }),
      to: listURL(crd('CiliumNetworkPolicy')),
    },
    {
      id: 'endpoints',
      label: t('Endpoints'),
      icon: 'mdi:lan-connect',
      tone: eStats.notReady > 0 ? 'warning' : 'success',
      value: loaded(endpoints.items !== null, eStats.total),
      caption:
        eStats.notReady > 0 ? t('{{count}} not ready', { count: eStats.notReady }) : t('All ready'),
      to: listURL(crd('CiliumEndpoint')),
    },
    {
      id: 'identities',
      label: t('Identities'),
      icon: 'mdi:card-account-details-outline',
      tone: 'info',
      value: loaded(identities.items !== null, (identities.items || []).length),
      caption: t('{{count}} in use by endpoints', { count: eStats.identities }),
      to: listURL(crd('CiliumIdentity')),
    },
    {
      id: 'nodes',
      label: t('Cilium nodes'),
      icon: 'mdi:server-network',
      tone: 'info',
      value: loaded(ciliumNodes.items !== null, (ciliumNodes.items || []).length),
      caption: t('{{count}} Kubernetes node(s)', { count: (nodes.items || []).length }),
      to: listURL(crd('CiliumNode')),
    },
    ...(bgpEnabled
      ? [
          {
            id: 'bgp',
            label: t('BGP sessions'),
            icon: 'mdi:router-network',
            tone: (bStats.established < bStats.sessions ? 'error' : 'success') as Tone,
            value: loaded(
              bgpNodeConfigs.items !== null,
              `${bStats.established}/${bStats.sessions}`
            ),
            caption: t('established on {{count}} node(s)', { count: bStats.nodes }),
            to: listURL(crd('CiliumBGPNodeConfig')),
          },
        ]
      : []),
    ...(lbEnabled
      ? [
          {
            id: 'lb',
            label: t('LoadBalancer IPs'),
            icon: 'mdi:ip-network-outline',
            tone: (pStats.conflicts > 0 ? 'error' : 'primary') as Tone,
            value: `${pStats.used}/${pStats.total}`,
            caption:
              pStats.pendingServices > 0
                ? t('{{count}} service(s) waiting for an IP', { count: pStats.pendingServices })
                : t('used from {{count}} pool(s)', { count: pStats.pools }),
            to: listURL(crd('CiliumLoadBalancerIPPool')),
          },
        ]
      : []),
  ];

  const twoColumns = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
    gap: 2,
    alignItems: 'stretch',
  };

  return (
    // Bottom padding keeps the last panel clear of the window edge.
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      <Header install={install} issues={issues} />

      {forbidden && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          {t(
            'Your user is not allowed to list some Cilium resources, so parts of this overview are incomplete.'
          )}
        </Alert>
      )}

      <Components install={install} error={installError} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
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
        <Panel title={t('Policy coverage')} icon="mdi:shield-check-outline">
          {endpoints.error && !endpoints.items ? (
            <ErrorState error={endpoints.error} what={t('Cilium endpoints')} />
          ) : endpoints.items === null ? (
            <CircularProgress size={20} />
          ) : (
            <Coverage coverage={coverage} />
          )}
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title={t('Configuration')} icon="mdi:tune-variant">
          {install?.namespace ? (
            <Features namespace={install.namespace} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('The Cilium namespace is not known, so cilium-config could not be read.')}
            </Typography>
          )}
        </Panel>
        <Panel title={t('Guided setup')} icon="mdi:wizard-hat">
          <GuidedSetup availability={availability} />
        </Panel>
      </Box>

      <Panel title={t('Resources')} icon="mdi:view-grid-outline">
        <ResourceInventory availability={availability} />
      </Panel>
    </Box>
  );
}

/** Landing page of the plugin: health, coverage, problems and entry points to the wizards. */
export function Overview() {
  const { t } = useText();
  return (
    <CRDGate title={t('Cilium')}>
      {availability => <Dashboard availability={availability} />}
    </CRDGate>
  );
}
