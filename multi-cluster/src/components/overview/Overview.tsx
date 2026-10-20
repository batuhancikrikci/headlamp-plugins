import { Icon } from '@iconify/react';
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
import { alpha } from '@mui/material/styles';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Availability, isHub, isKindAvailable, kindState } from '../../api/discovery';
import { useText } from '../../common/i18n';
import { EmptyState, ErrorState } from '../../common/States';
import { useOcmList } from '../../hooks/useOcmList';
import { hubIcon } from '../../icons/hubIcon';
import {
  addonHealthSummary,
  ClusterManagementAddOnJson,
  ManagedClusterAddOnJson,
} from '../../resources/models/addon';
import { SubscriptionJson } from '../../resources/models/apps';
import { ArgoApplicationJson } from '../../resources/models/argo';
import {
  clusterCounts,
  CSRJson,
  ManagedClusterJson,
  ManagedClusterSetJson,
  pendingCSRsByCluster,
} from '../../resources/models/cluster';
import { Health } from '../../resources/models/common';
import {
  ClusterManagerJson,
  featureGates,
  hubVersionHint,
  operatorHealth,
} from '../../resources/models/operator';
import {
  PLACEMENT_STATE_HEALTH,
  PLACEMENT_STATE_LABEL,
  PlacementDecisionJson,
  PlacementJson,
} from '../../resources/models/placement';
import { PolicyJson } from '../../resources/models/policy';
import {
  ManifestWorkJson,
  ManifestWorkReplicaSetJson,
  workState,
} from '../../resources/models/work';
import { crd, CRDInfo, crdsOfSection, SectionInfo, SECTIONS } from '../../resources/registry';
import { CRDGate } from '../common/CRDGate';
import { ResourceRefLink } from '../common/ResourceRefLink';
import {
  Bar,
  HEALTH_TONE,
  HealthLabel,
  IconBadge,
  Panel,
  ScrollArea,
  StackedBar,
  Stat,
  StatCard,
  Tone,
  TwoColumns,
} from '../common/Shared';
import { listURL, sectionURL } from '../common/Views';
import { GUIDED_FLOWS } from '../editing';
import {
  argoCounts,
  collectIssues,
  Issue,
  kindHealthCounts,
  placementSummary,
  policyCounts,
} from './overview';
import { PlatformReadiness } from './PlatformReadiness';

function HubHeader({
  cm,
  issues,
  loading,
}: {
  cm?: ClusterManagerJson;
  issues: Issue[];
  loading: boolean;
}) {
  const { t } = useText();
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const tone: Tone = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success';
  const version = hubVersionHint(cm);
  const status = loading
    ? t('Loading…')
    : issues.length === 0
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
      <IconBadge icon={hubIcon} tone="primary" size={56} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {t('Multicluster Hub')}
          </Typography>
          {version && (
            <Tooltip title={t('Version taken from the hub component image tags')}>
              <Chip label={version} size="small" color="primary" />
            </Tooltip>
          )}
          {cm?.spec?.deployOption?.mode && (
            <Chip
              label={t('{{mode}} mode', { mode: cm.spec.deployOption.mode })}
              size="small"
              variant="outlined"
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" component="div">
          {cm ? (
            <>
              {t('Hub cluster')} <strong>{getCluster() || '-'}</strong> · {t('Cluster manager')}{' '}
              <ResourceRefLink kind="ClusterManager" name={cm.metadata.name} />
            </>
          ) : (
            t('Open Cluster Management hub')
          )}
        </Typography>
      </Box>
      <Chip
        icon={
          <Icon icon={issues.length === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'} width={18} />
        }
        label={status}
        color={loading ? 'default' : tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Paper>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useText();
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">{t('Nothing needs attention')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Clusters, add-ons, placements and workloads look healthy.')}
          </Typography>
        </Box>
      </Box>
    );
  }
  return (
    <ScrollArea maxHeight={360}>
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

function ClusterStates({
  clusters,
  pendingCSRs,
}: {
  clusters: ManagedClusterJson[];
  pendingCSRs: number;
}) {
  const { t } = useText();
  const counts = clusterCounts(clusters);
  if (counts.total === 0) {
    return (
      <EmptyState
        dense
        icon="mdi:server-network-off"
        title={t('No managed clusters yet')}
        description={t('Import a cluster to start managing it from this hub.')}
      />
    );
  }
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
          {counts.available}/{counts.total}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('available · {{joined}} joined', { joined: counts.joined })}
        </Typography>
      </Box>
      <StackedBar
        segments={[
          {
            id: 'available',
            label: t('Available'),
            value: counts.available,
            color: 'success.main',
          },
          {
            id: 'unavailable',
            label: t('Unavailable'),
            value: counts.unavailable + counts.denied,
            color: 'error.main',
          },
          { id: 'unknown', label: t('Unknown'), value: counts.unknown, color: 'warning.main' },
          { id: 'join', label: t('Pending join'), value: counts.pendingJoin, color: 'info.main' },
          {
            id: 'accept',
            label: t('Not accepted'),
            value: counts.pendingAccept,
            color: 'secondary.main',
          },
          { id: 'deleting', label: t('Detaching'), value: counts.deleting, color: 'text.disabled' },
        ]}
      />
      {pendingCSRs > 0 && (
        <Alert severity="warning" icon={<Icon icon="mdi:certificate-outline" />} sx={{ mt: 2 }}>
          {t('{{count}} certificate signing request(s) from cluster agents wait for approval.', {
            count: pendingCSRs,
          })}
        </Alert>
      )}
    </Box>
  );
}

function AddonHealth({
  cmas,
  mcas,
}: {
  cmas: ClusterManagementAddOnJson[];
  mcas: ManagedClusterAddOnJson[];
}) {
  const { t } = useText();
  const rows = addonHealthSummary(cmas, mcas);
  if (rows.length === 0) {
    return <EmptyState dense icon="mdi:puzzle-outline" title={t('No add-ons registered')} />;
  }
  return (
    <ScrollArea maxHeight={300}>
      {rows.map(row => {
        const health: Health =
          row.degraded > 0
            ? 'error'
            : row.total === 0
            ? 'unknown'
            : row.other > 0
            ? 'warning'
            : 'success';
        return (
          <Box
            key={row.name}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 110px 70px',
              alignItems: 'center',
              columnGap: 1.5,
              py: 0.75,
            }}
          >
            <Typography variant="body2" noWrap component="div">
              <ResourceRefLink kind="ClusterManagementAddOn" name={row.name} />
              {row.displayName !== row.name && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {row.displayName}
                </Typography>
              )}
            </Typography>
            <Bar value={row.available} total={row.total} tone={HEALTH_TONE[health]} />
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
              {row.total === 0 ? t('not installed') : `${row.available}/${row.total}`}
            </Typography>
          </Box>
        );
      })}
    </ScrollArea>
  );
}

function Placements({
  placements,
  decisions,
}: {
  placements: PlacementJson[];
  decisions: PlacementDecisionJson[];
}) {
  const { t } = useText();
  const rows = placementSummary(placements, decisions);
  if (rows.length === 0) {
    return <EmptyState dense icon="mdi:target" title={t('No placements yet')} />;
  }
  return (
    <ScrollArea maxHeight={300}>
      {rows.map(row => (
        <Box
          key={`${row.namespace}/${row.name}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto 70px',
            alignItems: 'center',
            columnGap: 1.5,
            py: 0.75,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <ResourceRefLink kind="Placement" name={row.name} namespace={row.namespace} qualified />
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {row.clusters.length > 0 ? row.clusters.join(', ') : t('no clusters selected')}
            </Typography>
          </Box>
          <HealthLabel
            health={PLACEMENT_STATE_HEALTH[row.state]}
            label={t(PLACEMENT_STATE_LABEL[row.state])}
          />
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            {row.requested !== undefined ? `${row.selected}/${row.requested}` : row.selected}
          </Typography>
        </Box>
      ))}
    </ScrollArea>
  );
}

function HubComponents({ cm, error }: { cm?: ClusterManagerJson; error: unknown }) {
  const { t } = useText();
  if (error) return <ErrorState error={error} what={t('the cluster manager')} />;
  if (!cm) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t(
          'No ClusterManager object is visible to your user. The hub may be installed in hosted mode or with restricted RBAC.'
        )}
      </Typography>
    );
  }
  const conditions = cm.status?.conditions || [];
  const gates = featureGates(cm);
  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {conditions.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('No conditions reported.')}
          </Typography>
        )}
        {conditions.map(c => (
          <HealthLabel
            key={c.type}
            health={operatorHealth([c])}
            label={`${c.type}: ${c.status}`}
            tooltip={c.message || c.reason}
          />
        ))}
      </Box>
      {gates.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
            {t('Feature gates')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {gates.flatMap(g =>
              g.gates.map(gate => (
                <Chip
                  key={`${g.component}/${gate.feature}`}
                  size="small"
                  variant="outlined"
                  color={gate.mode === 'Disable' ? 'default' : 'primary'}
                  label={`${g.component}: ${gate.feature}${
                    gate.mode === 'Disable' ? ' (off)' : ''
                  }`}
                />
              ))
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

function GuidedActions({ availability }: { availability: Availability }) {
  const { t } = useText();
  const [open, setOpen] = React.useState<string | null>(null);
  const flows = GUIDED_FLOWS.filter(f =>
    f.requires.every(kind => isKindAvailable(availability, crd(kind)))
  );
  if (flows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('The guided flows need APIs that are not installed in this cluster.')}
      </Typography>
    );
  }
  const current = flows.find(f => f.id === open);
  const Dialog = current?.Dialog;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 1.5,
      }}
    >
      {flows.map(flow => (
        <ButtonBase
          key={flow.id}
          onClick={() => setOpen(flow.id)}
          sx={{
            p: 1.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            gap: 1.5,
            alignItems: 'center',
            justifyContent: 'flex-start',
            textAlign: 'left',
            '&:hover, &:focus-visible': { borderColor: 'primary.main' },
          }}
        >
          <IconBadge icon={flow.icon} tone="primary" size={40} />
          <Box>
            <Typography variant="subtitle2">{t(flow.label)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t(flow.description)}
            </Typography>
          </Box>
        </ButtonBase>
      ))}
      {Dialog && <Dialog open onClose={() => setOpen(null)} />}
    </Box>
  );
}

/** Count of one kind with its failing / degraded objects; reports the count to its group. */
function InventoryRow({
  info,
  availability,
  onCount,
}: {
  info: CRDInfo;
  availability: Availability;
  onCount: (kind: string, count: number | null) => void;
}) {
  const { t } = useText();
  const history = useHistory();
  const state = kindState(availability, info);
  const available = state.status === 'available';
  const list = useOcmList(info.kind, {
    enabled: available,
    // Only OCM registration requests are relevant here.
    labelSelector:
      info.kind === 'CertificateSigningRequest'
        ? 'open-cluster-management.io/cluster-name'
        : undefined,
  });
  const counts = available && list.items ? kindHealthCounts(info.kind, list.items) : null;
  // A kind the user may not list counts as 0 in the group total (the row shows "!").
  const total = available ? (counts ? counts.total : list.error ? 0 : null) : 0;
  React.useEffect(() => onCount(info.kind, total), [info.kind, total, onCount]);
  const count = !available ? '—' : counts ? counts.total : list.error ? '!' : '…';
  const tooltip =
    state.status === 'available'
      ? `${t(info.description)} (${state.apiVersion})`
      : state.status === 'unsupported'
      ? t('Served in an API version this plugin does not support ({{v}})', {
          v: state.served.join(', '),
        })
      : t('This kind is not installed');
  const fullTooltip =
    available && list.error && !list.items
      ? t('Your user cannot list {{kind}}', { kind: info.kind })
      : tooltip;
  return (
    <Tooltip title={fullTooltip} placement="left">
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
            {t(info.tabLabel)}
          </Typography>
          {counts && counts.error > 0 && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={`${counts.error} ${t(counts.errorLabel)}`}
              sx={{ height: 20 }}
            />
          )}
          {counts && counts.error === 0 && counts.warning > 0 && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${counts.warning} ${t(counts.warningLabel)}`}
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

/** Card of one sidebar section: its kinds with counts, and the section total. */
function InventoryGroup({
  section,
  availability,
}: {
  section: SectionInfo;
  availability: Availability;
}) {
  const { t } = useText();
  const history = useHistory();
  const kinds = crdsOfSection(section.id).filter(
    // Legacy kinds are only listed when the cluster still serves them.
    info => !info.legacy || kindState(availability, info).status !== 'missing'
  );
  const [counts, setCounts] = React.useState<Record<string, number | null>>({});
  const onCount = React.useCallback(
    (kind: string, count: number | null) =>
      setCounts(c => (c[kind] === count ? c : { ...c, [kind]: count })),
    []
  );
  const values = kinds.map(k => counts[k.kind]);
  const total = values.some(v => v === null || v === undefined)
    ? null
    : values.reduce((n: number, v) => n + (v || 0), 0);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 2, height: '100%', boxSizing: 'border-box' }}
    >
      <ButtonBase
        onClick={() => history.push(sectionURL(section.id))}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 0.75,
          px: 1,
          pb: 1,
          pt: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          justifyContent: 'flex-start',
          textAlign: 'left',
        }}
      >
        <Box sx={{ color: 'primary.main', display: 'flex' }}>
          <Icon icon={section.icon} width={20} aria-hidden />
        </Box>
        <Typography variant="subtitle2" noWrap sx={{ flexGrow: 1 }}>
          {t(section.label)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {total === null ? '…' : total}
        </Typography>
      </ButtonBase>
      {kinds.map(info => (
        <InventoryRow key={info.kind} info={info} availability={availability} onCount={onCount} />
      ))}
    </Paper>
  );
}

function Inventory({ availability }: { availability: Availability }) {
  return (
    <Box
      sx={{
        display: 'grid',
        // Equal columns filling the panel; every card in a row is as tall as the tallest one.
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 2,
        alignItems: 'stretch',
      }}
    >
      {SECTIONS.map(section => (
        <InventoryGroup key={section.id} section={section} availability={availability} />
      ))}
    </Box>
  );
}

function Dashboard({ availability }: { availability: Availability }) {
  const { t } = useText();
  const clusterManagers = useOcmList<ClusterManagerJson>('ClusterManager');
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const csrs = useOcmList<CSRJson>('CertificateSigningRequest', {
    labelSelector: 'open-cluster-management.io/cluster-name',
  });
  const cmas = useOcmList<ClusterManagementAddOnJson>('ClusterManagementAddOn');
  const mcas = useOcmList<ManagedClusterAddOnJson>('ManagedClusterAddOn');
  const placements = useOcmList<PlacementJson>('Placement');
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision');
  const works = useOcmList<ManifestWorkJson>('ManifestWork');
  const replicaSets = useOcmList<ManifestWorkReplicaSetJson>('ManifestWorkReplicaSet');
  const subscriptions = useOcmList<SubscriptionJson>('Subscription');
  const argoApps = useOcmList<ArgoApplicationJson>('Application');
  const policies = useOcmList<PolicyJson>('Policy');

  const cm = (clusterManagers.items || [])[0];
  const clusterList = clusters.items || [];
  const pending = pendingCSRsByCluster(csrs.items || []);
  const pendingCSRCount = Object.values(pending).reduce((n, l) => n + l.length, 0);
  const issues = collectIssues({
    clusterManagers: clusterManagers.items || [],
    clusters: clusterList,
    csrs: csrs.items || [],
    addons: mcas.items || [],
    placements: placements.items || [],
    works: works.items || [],
    replicaSets: replicaSets.items || [],
    subscriptions: subscriptions.items || [],
    argoApps: argoApps.items || [],
    policies: policies.items || [],
  });
  const counts = clusterCounts(clusterList);
  const failedWorks = (works.items || []).filter(w =>
    ['failed', 'degraded'].includes(workState(w))
  ).length;
  const failedSubs = issues.filter(i => i.kind === 'Subscription').length;
  const loading = clusters.items === null;
  const forbidden = [clusters, placements, works].some(
    l => !!l.error && !l.items && (l.error as { status?: number }).status === 403
  );
  const loaded = (ready: boolean, value: React.ReactNode) => (ready ? value : '…');
  const errorCount = issues.filter(i => i.severity === 'error').length;

  const argo = argoCounts(argoApps.items || []);
  const gov = policyCounts(policies.items || []);

  const stats: Stat[] = [
    {
      id: 'clusters',
      label: t('Managed clusters'),
      icon: 'mdi:server-network',
      tone: counts.unavailable + counts.unknown > 0 ? 'warning' : 'success',
      value: loaded(!loading, counts.total),
      caption: t('{{available}} available · {{pending}} pending', {
        available: counts.available,
        pending: counts.pendingAccept + counts.pendingJoin,
      }),
      to: listURL(crd('ManagedCluster')),
    },
    {
      id: 'sets',
      label: t('Cluster sets'),
      icon: 'mdi:select-group',
      tone: 'info',
      value: loaded(sets.items !== null, (sets.items || []).length),
      caption: t('groups of clusters'),
      to: listURL(crd('ManagedClusterSet')),
    },
    ...(placements.missing
      ? []
      : [
          {
            id: 'placements',
            label: t('Placements'),
            icon: 'mdi:target',
            tone: 'primary' as Tone,
            value: loaded(placements.items !== null, (placements.items || []).length),
            caption: t('{{count}} decision object(s)', { count: (decisions.items || []).length }),
            to: listURL(crd('Placement')),
          },
        ]),
    ...(works.missing
      ? []
      : [
          {
            id: 'works',
            label: t('ManifestWorks'),
            icon: 'mdi:package-variant-closed',
            tone: (failedWorks > 0 ? 'error' : 'primary') as Tone,
            value: loaded(works.items !== null, (works.items || []).length),
            caption:
              failedWorks > 0 ? t('{{count}} failing', { count: failedWorks }) : t('all applied'),
            to: listURL(crd('ManifestWork')),
          },
        ]),
    ...(subscriptions.missing
      ? []
      : [
          {
            id: 'subscriptions',
            label: t('Subscriptions'),
            icon: 'mdi:apps',
            tone: (failedSubs > 0 ? 'error' : 'primary') as Tone,
            value: loaded(subscriptions.items !== null, (subscriptions.items || []).length),
            caption:
              failedSubs > 0 ? t('{{count}} failed', { count: failedSubs }) : t('no failures'),
            to: listURL(crd('Subscription')),
          },
        ]),
    ...(mcas.missing
      ? []
      : [
          {
            id: 'addons',
            label: t('Add-on installations'),
            icon: 'mdi:puzzle-check-outline',
            tone: 'info' as Tone,
            value: loaded(mcas.items !== null, (mcas.items || []).length),
            caption: t('{{count}} add-on(s) on the hub', { count: (cmas.items || []).length }),
            to: listURL(crd('ManagedClusterAddOn')),
          },
        ]),
    ...(policies.missing
      ? []
      : [
          {
            id: 'policies',
            label: t('Policies'),
            icon: 'mdi:shield-check-outline',
            tone: (gov.nonCompliant > 0
              ? 'error'
              : gov.pending > 0
              ? 'warning'
              : 'success') as Tone,
            value: loaded(policies.items !== null, gov.total),
            caption: t(
              '{{compliant}} compliant · {{nonCompliant}} non-compliant',
              gov as unknown as Record<string, unknown>
            ),
            to: listURL(crd('Policy')),
          },
        ]),
    ...(argoApps.missing
      ? []
      : [
          {
            id: 'argo',
            label: t('Argo CD applications'),
            icon: 'mdi:rocket-launch-outline',
            tone: (argo.degraded > 0
              ? 'error'
              : argo.outOfSync > 0
              ? 'warning'
              : 'success') as Tone,
            value: loaded(argoApps.items !== null, argo.total),
            caption: t(
              '{{healthy}} healthy · {{outOfSync}} out of sync',
              argo as unknown as Record<string, unknown>
            ),
            to: listURL(crd('Application')),
          },
        ]),
  ];

  const workIssues = issues.filter(i =>
    ['ManifestWork', 'ManifestWorkReplicaSet', 'Subscription', 'Application'].includes(i.kind || '')
  );

  return (
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      <HubHeader cm={cm} issues={issues} loading={loading} />
      {!isHub(availability) && (
        <Alert severity="info">
          {t(
            'This cluster does not serve the ManagedCluster API, so it is not an OCM hub. Agent-side resources (Klusterlet, cluster claims, applied works) are available under Hub Settings.'
          )}
        </Alert>
      )}
      {forbidden && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          {t(
            'Your user is not allowed to list some OCM resources, so parts of this overview are incomplete.'
          )}
        </Alert>
      )}
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
      <TwoColumns>
        <Panel title={t('Cluster health')} icon="mdi:server-network">
          {clusters.error && !clusters.items ? (
            <ErrorState error={clusters.error} what={t('managed clusters')} />
          ) : loading ? (
            <CircularProgress size={20} />
          ) : (
            <ClusterStates clusters={clusterList} pendingCSRs={pendingCSRCount} />
          )}
        </Panel>
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
      </TwoColumns>
      <TwoColumns>
        <Panel title={t('Add-on health')} icon="mdi:puzzle-outline">
          {mcas.missing ? (
            <Typography variant="body2" color="text.secondary">
              {t('The add-on APIs are not installed.')}
            </Typography>
          ) : (
            <AddonHealth cmas={cmas.items || []} mcas={mcas.items || []} />
          )}
        </Panel>
        <Panel title={t('Placements and decisions')} icon="mdi:target">
          {placements.missing ? (
            <Typography variant="body2" color="text.secondary">
              {t('The Placement API is not installed.')}
            </Typography>
          ) : (
            <Placements placements={placements.items || []} decisions={decisions.items || []} />
          )}
        </Panel>
      </TwoColumns>
      <TwoColumns>
        <Panel
          title={t('Recent workload and application failures')}
          icon="mdi:alert-octagon-outline"
        >
          {workIssues.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('No failing ManifestWorks, replica sets or subscriptions.')}
            </Typography>
          ) : (
            <IssueList issues={workIssues.slice(0, 20)} />
          )}
        </Panel>
        <Panel title={t('Hub components')} icon="mdi:hub-outline">
          <HubComponents cm={cm} error={clusterManagers.missing ? null : clusterManagers.error} />
        </Panel>
      </TwoColumns>
      {!policies.missing && (
        <Panel title={t('Governance')} icon="mdi:shield-check-outline">
          {policies.error && !policies.items ? (
            <ErrorState error={policies.error} what={t('policies')} />
          ) : policies.items === null ? (
            <CircularProgress size={20} />
          ) : gov.total === 0 ? (
            <EmptyState dense icon="mdi:shield-outline" title={t('No policies yet')} />
          ) : (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
                <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
                  {gov.compliant}/{gov.total}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(
                    'policies compliant · {{enforced}} enforced · {{disabled}} disabled',
                    gov as unknown as Record<string, unknown>
                  )}
                </Typography>
              </Box>
              <StackedBar
                segments={[
                  {
                    id: 'compliant',
                    label: t('Compliant'),
                    value: gov.compliant,
                    color: 'success.main',
                  },
                  {
                    id: 'noncompliant',
                    label: t('Non-compliant'),
                    value: gov.nonCompliant,
                    color: 'error.main',
                  },
                  { id: 'pending', label: t('Pending'), value: gov.pending, color: 'warning.main' },
                  {
                    id: 'nostatus',
                    label: t('No status'),
                    value: gov.noStatus,
                    color: 'text.disabled',
                  },
                ]}
              />
            </Box>
          )}
        </Panel>
      )}
      {!argoApps.missing && (
        <Panel title={t('Argo CD applications')} icon="mdi:rocket-launch-outline">
          {argoApps.error && !argoApps.items ? (
            <ErrorState error={argoApps.error} what={t('Argo CD applications')} />
          ) : argoApps.items === null ? (
            <CircularProgress size={20} />
          ) : argo.total === 0 ? (
            <EmptyState
              dense
              icon="mdi:rocket-launch-outline"
              title={t('No Argo CD applications')}
            />
          ) : (
            <TwoColumns>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('Health')}
                </Typography>
                <StackedBar
                  segments={[
                    {
                      id: 'healthy',
                      label: t('Healthy'),
                      value: argo.healthy,
                      color: 'success.main',
                    },
                    {
                      id: 'progressing',
                      label: t('Progressing'),
                      value: argo.progressing,
                      color: 'info.main',
                    },
                    {
                      id: 'degraded',
                      label: t('Degraded / missing'),
                      value: argo.degraded,
                      color: 'error.main',
                    },
                    { id: 'other', label: t('Other'), value: argo.other, color: 'text.disabled' },
                  ]}
                />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('Sync ({{pull}} pull model)', { pull: argo.pull })}
                </Typography>
                <StackedBar
                  segments={[
                    { id: 'synced', label: t('Synced'), value: argo.synced, color: 'success.main' },
                    {
                      id: 'outofsync',
                      label: t('Out of sync'),
                      value: argo.outOfSync,
                      color: 'warning.main',
                    },
                    {
                      id: 'unknown',
                      label: t('Unknown'),
                      value: argo.total - argo.synced - argo.outOfSync,
                      color: 'text.disabled',
                    },
                  ]}
                />
              </Box>
            </TwoColumns>
          )}
        </Panel>
      )}
      <Panel title={t('Guided workflows')} icon="mdi:wizard-hat">
        <GuidedActions availability={availability} />
      </Panel>
      <Panel title={t('Resources')} icon="mdi:view-grid-outline">
        <Inventory availability={availability} />
      </Panel>
      <PlatformReadiness
        availability={availability}
        data={{
          clusterManager: cm,
          clusters: clusters.items,
          csrs: csrs.items,
          sets: sets.items,
          cmas: cmas.items,
          mcas: mcas.items,
        }}
      />
    </Box>
  );
}

/** Landing page: hub health, cluster states, add-ons, placements, failures and entry points. */
export function Overview() {
  const { t } = useText();
  return (
    <CRDGate title={t('Multicluster Hub')}>
      {availability => <Dashboard availability={availability} />}
    </CRDGate>
  );
}
