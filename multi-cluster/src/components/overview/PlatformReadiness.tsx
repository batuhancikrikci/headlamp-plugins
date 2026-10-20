import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Link,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { Availability, errorStatusOf, kindState } from '../../api/discovery';
import { findKindMeta } from '../../api/kinds';
import { useText } from '../../common/i18n';
import { useCurrentCluster, useOcmDiscovery } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import {
  argoNamespaces,
  assessReadiness,
  Check,
  CheckState,
  GENERATOR_CONFIGMAPS,
  Layer,
  LAYER_LABELS,
  ReadinessInput,
  SEARCH_NAMESPACE,
  SEARCH_SERVICES,
  StackReadiness,
  StackStatus,
  summarize,
} from '../../readiness/model';
import { ClusterManagementAddOnJson, ManagedClusterAddOnJson } from '../../resources/models/addon';
import { GitOpsClusterJson } from '../../resources/models/apps';
import { ArgoApplicationSetJson, ArgoClusterSecret } from '../../resources/models/argo';
import { CSRJson, ManagedClusterJson, ManagedClusterSetJson } from '../../resources/models/cluster';
import { ClusterManagerJson } from '../../resources/models/operator';
import { useArgoClusterSecrets } from '../argocd/useArgo';
import { IconBadge, Panel, Stat, StatCard, Tone } from '../common/Shared';

const STACK_ICONS: Record<string, string> = {
  hub: 'mdi:hub-outline',
  registration: 'mdi:server-plus',
  placement: 'mdi:target',
  work: 'mdi:package-variant-closed',
  addons: 'mdi:puzzle-outline',
  subscriptions: 'mdi:source-branch',
  argocd: 'mdi:rocket-launch-outline',
  'gitops-push': 'mdi:arrow-up-bold-circle-outline',
  'gitops-pull': 'mdi:arrow-down-bold-circle-outline',
  'gitops-agent': 'mdi:robot-outline',
  governance: 'mdi:shield-check-outline',
  msa: 'mdi:account-key-outline',
  'cluster-proxy': 'mdi:lan-connect',
  'cluster-inventory': 'mdi:format-list-checks',
  search: 'mdi:magnify',
};

const CHECK_ICON: Record<CheckState, { icon: string; color: string }> = {
  ok: { icon: 'mdi:check-circle', color: 'success.main' },
  warn: { icon: 'mdi:alert', color: 'warning.main' },
  error: { icon: 'mdi:close-circle', color: 'error.main' },
  info: { icon: 'mdi:information-outline', color: 'text.secondary' },
};

const LAYERS: Layer[] = ['core', 'delivery', 'gitops', 'governance', 'access'];

interface ConfigMapProbe {
  /** Names found in at least one namespace. */
  found: string[];
  /** Names that could not be read (e.g. no permission) where they were not found. */
  unreadable: string[];
}

/**
 * Whether each ApplicationSet generator ConfigMap exists in the given namespaces. Each name is
 * read with a GET; a 404 counts as absent, any other failure as unreadable.
 */
function useGeneratorConfigMaps(namespaces: string[], nonce: number): ConfigMapProbe | null {
  const cluster = useCurrentCluster();
  const key = namespaces.join(',');
  const [found, setFound] = React.useState<ConfigMapProbe | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const params = cluster ? { cluster } : {};
    const probes = namespaces.flatMap(ns =>
      GENERATOR_CONFIGMAPS.map(name =>
        (
          ApiProxy.request(
            `/api/v1/namespaces/${ns}/configmaps/${name}`,
            params
          ) as Promise<unknown>
        )
          .then(() => ({ name, found: true, unreadable: false }))
          .catch((err: unknown) => ({ name, found: false, unreadable: errorStatusOf(err) !== 404 }))
      )
    );
    Promise.all(probes).then(results => {
      if (cancelled) return;
      const names = new Set(results.filter(r => r.found).map(r => r.name));
      const unreadable = new Set(
        results.filter(r => !r.found && r.unreadable && !names.has(r.name)).map(r => r.name)
      );
      setFound({ found: [...names], unreadable: [...unreadable] });
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for the namespace list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, key, nonce]);
  return found;
}

/**
 * Search services found in the `open-cluster-management` namespace (`namespace/name`). Each
 * name is read with a GET; a 404 counts as absent. Null while loading or when reads fail.
 */
function useSearchServices(nonce: number): string[] | null {
  const cluster = useCurrentCluster();
  const [found, setFound] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const params = cluster ? { cluster } : {};
    const names = Object.values(SEARCH_SERVICES).flat();
    Promise.all(
      names.map(name =>
        (
          ApiProxy.request(
            `/api/v1/namespaces/${SEARCH_NAMESPACE}/services/${name}`,
            params
          ) as Promise<unknown>
        )
          .then(() => `${SEARCH_NAMESPACE}/${name}`)
          .catch((err: unknown) => {
            if (errorStatusOf(err) === 404) return undefined;
            throw err;
          })
      )
    )
      .then(hits => {
        if (!cancelled) setFound(hits.filter((h): h is string => !!h));
      })
      .catch(() => {
        if (!cancelled) setFound(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, nonce]);
  return found;
}

function statusChip(stack: StackReadiness) {
  const map: Record<
    StackStatus,
    { label: string; color: 'success' | 'warning' | 'error' | 'default' }
  > = {
    ready: { label: 'Ready', color: 'success' },
    partial: { label: 'Needs attention', color: 'warning' },
    missing: {
      label: stack.optional ? 'Not installed' : 'Missing',
      color: stack.optional ? 'default' : 'error',
    },
  };
  return map[stack.status];
}

const STATUS_TONE: Record<StackStatus, Tone | 'neutral'> = {
  ready: 'success',
  partial: 'warning',
  missing: 'neutral',
};

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        pl: 1,
        py: 0.25,
      }}
    >
      <Box
        component="code"
        sx={{
          flexGrow: 1,
          fontFamily: 'monospace',
          fontSize: 12,
          py: 0.75,
          wordBreak: 'break-all',
        }}
      >
        {command}
      </Box>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          aria-label="Copy command"
          onClick={() => {
            navigator.clipboard?.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function CheckRow({ check }: { check: Check }) {
  const { icon, color } = CHECK_ICON[check.state];
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <Box sx={{ color, display: 'flex', pt: '2px', flexShrink: 0 }}>
        <Icon icon={icon} width={16} />
      </Box>
      <Typography variant="body2" sx={{ minWidth: 0 }}>
        {check.label}
        {check.detail && (
          <Typography component="span" variant="body2" color="text.secondary">
            {' — '}
            {check.detail}
          </Typography>
        )}
      </Typography>
    </Box>
  );
}

function StackCard({ stack, availability }: { stack: StackReadiness; availability: Availability }) {
  const { t } = useText();
  const [open, setOpen] = React.useState(false);
  const chip = statusChip(stack);
  const served = stack.kinds.flatMap(kind => {
    const meta = findKindMeta(kind);
    if (!meta) return [];
    const state = kindState(availability, meta);
    return state.status === 'available' ? [{ kind, apiVersion: state.apiVersion }] : [];
  });
  const showInstall = !!stack.install && stack.status !== 'ready';
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconBadge
          icon={STACK_ICONS[stack.id] || 'mdi:cube-outline'}
          tone={STATUS_TONE[stack.status]}
          size={36}
        />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {stack.name}
          </Typography>
          {stack.optional && (
            <Typography variant="caption" color="text.secondary">
              {t('Optional')}
            </Typography>
          )}
        </Box>
        <Chip
          size="small"
          label={t(chip.label)}
          color={chip.color}
          variant={chip.color === 'default' ? 'outlined' : 'filled'}
        />
      </Box>
      <Typography variant="body2" color="text.secondary">
        {stack.description}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {stack.checks.map(c => (
          <CheckRow key={c.label} check={c} />
        ))}
      </Box>
      {served.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {served.map(s => (
            <Tooltip key={s.kind} title={s.apiVersion}>
              <Chip
                size="small"
                variant="outlined"
                label={`${s.kind} · ${s.apiVersion.split('/')[1]}`}
              />
            </Tooltip>
          ))}
        </Box>
      )}
      {showInstall && stack.install && (
        <Box sx={{ mt: 'auto' }}>
          <Button
            size="small"
            onClick={() => setOpen(o => !o)}
            startIcon={<Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} />}
            aria-expanded={open}
          >
            {t('How to install')}
          </Button>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, pt: 1 }}>
              <Typography variant="body2">{stack.install.text}</Typography>
              {(stack.install.commands || []).map(cmd => (
                <CopyableCommand key={cmd} command={cmd} />
              ))}
              <Link
                href={stack.install.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="body2"
              >
                {t('Documentation')}
              </Link>
            </Box>
          </Collapse>
        </Box>
      )}
    </Paper>
  );
}

export interface ReadinessData {
  clusterManager?: ClusterManagerJson;
  clusters: ManagedClusterJson[] | null;
  csrs: CSRJson[] | null;
  sets: ManagedClusterSetJson[] | null;
  cmas: ClusterManagementAddOnJson[] | null;
  mcas: ManagedClusterAddOnJson[] | null;
}

function ReadinessBody({
  data,
  availability,
  argoSecrets,
  refresh,
}: {
  data: ReadinessData;
  availability: Availability;
  argoSecrets: ArgoClusterSecret[] | null;
  refresh: () => void;
}) {
  const { t } = useText();
  const [nonce, setNonce] = React.useState(0);
  const gitops = useOcmList<GitOpsClusterJson>('GitOpsCluster');
  const appSets = useOcmList<ArgoApplicationSetJson>('ApplicationSet');
  const namespaces = React.useMemo(
    () =>
      argoNamespaces(
        gitops.items || [],
        argoSecrets || [],
        (appSets.items || []).map(a => a.metadata.namespace || '')
      ),
    [gitops.items, argoSecrets, appSets.items]
  );
  const configMaps = useGeneratorConfigMaps(namespaces, nonce);
  const searchServices = useSearchServices(nonce);

  const input: ReadinessInput = {
    availability,
    clusterManager: data.clusterManager,
    clusters: data.clusters,
    csrs: data.csrs,
    sets: data.sets,
    cmas: data.cmas,
    mcas: data.mcas,
    gitops: gitops.items,
    argoSecrets,
    generatorConfigMaps: configMaps ? configMaps.found : null,
    unreadableConfigMaps: configMaps?.unreadable,
    searchServices,
  };
  const stacks = assessReadiness(input);
  const summary = summarize(stacks);
  const addonsTotal = (data.mcas || []).length;

  const stats: Stat[] = [
    {
      id: 'core',
      label: t('Core stacks ready'),
      value: `${summary.requiredReady}/${summary.required}`,
      caption: t('hub, registration, placement, work, add-ons'),
      icon: 'mdi:hub-outline',
      tone: summary.requiredReady === summary.required ? 'success' : 'warning',
    },
    {
      id: 'optional',
      label: t('Optional stacks installed'),
      value: `${summary.optionalInstalled}/${summary.optional}`,
      caption: t('delivery, GitOps, governance, access'),
      icon: 'mdi:puzzle-outline',
      tone: 'primary',
    },
    {
      id: 'addons',
      label: t('Add-on installations'),
      value: addonsTotal,
      caption: t('{{count}} registered add-on(s)', { count: (data.cmas || []).length }),
      icon: 'mdi:puzzle-check-outline',
      tone: 'info',
    },
    {
      id: 'gitops',
      label: t('GitOps models'),
      value: summary.gitopsModels.length,
      caption: summary.gitopsModels.length ? summary.gitopsModels.join(', ') : t('none detected'),
      icon: 'mdi:source-pull',
      tone: summary.gitopsModels.length ? 'success' : 'info',
    },
  ];

  return (
    <Panel
      title={t('Platform readiness')}
      icon="mdi:clipboard-check-outline"
      action={
        <Button
          size="small"
          variant="outlined"
          startIcon={<Icon icon="mdi:refresh" />}
          onClick={() => {
            refresh();
            setNonce(n => n + 1);
          }}
        >
          {t('Rescan APIs')}
        </Button>
      }
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 2,
          mb: 3,
        }}
      >
        {stats.map(s => (
          <StatCard key={s.id} stat={s} />
        ))}
      </Box>
      {LAYERS.map(layer => {
        const own = stacks.filter(s => s.layer === layer);
        if (own.length === 0) return null;
        return (
          <Box key={layer} sx={{ mb: 3, '&:last-of-type': { mb: 0 } }}>
            <Typography
              variant="overline"
              color="text.secondary"
              component="h3"
              sx={{ display: 'block', mb: 1 }}
            >
              {t(LAYER_LABELS[layer])}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  md: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(3, minmax(0, 1fr))',
                },
                gap: 2,
              }}
            >
              {own.map(s => (
                <StackCard key={s.id} stack={s} availability={availability} />
              ))}
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}

/** Argo CD cluster secrets are only listed when an Argo CD or GitOps API is served. */
function WithArgoSecrets(props: {
  data: ReadinessData;
  availability: Availability;
  refresh: () => void;
}) {
  const secrets = useArgoClusterSecrets();
  return <ReadinessBody {...props} argoSecrets={secrets.items} />;
}

/**
 * Which parts of a full OCM stack are installed and working, with install hints. Uses its own
 * discovery state so "Rescan APIs" re-reads the served APIs.
 */
export function PlatformReadiness({
  data,
  availability,
}: {
  data: ReadinessData;
  availability: Availability;
}) {
  const discovery = useOcmDiscovery();
  const current = discovery.status === 'ready' ? discovery.availability : availability;
  const refresh = discovery.status === 'ready' ? discovery.refresh : () => undefined;
  const argo = ['GitOpsCluster', 'ApplicationSet', 'Application'].some(kind => {
    const meta = findKindMeta(kind);
    return !!meta && kindState(current, meta).status === 'available';
  });
  return argo ? (
    <WithArgoSecrets data={data} availability={current} refresh={refresh} />
  ) : (
    <ReadinessBody data={data} availability={current} argoSecrets={[]} refresh={refresh} />
  );
}
