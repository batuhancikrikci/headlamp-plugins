import { Icon } from '@iconify/react';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useCoreList } from '../../hooks/useLive';
import { gatewayHealth, parentsHealth, PoolChain } from '../../resources/inference';
import { podHealth, PodJson } from '../../resources/pod';
import { DETAIL_PAGES } from '../../routes';
import { Health, HealthSummary } from '../../utils/health';

const TONE: Record<Health, string> = {
  ready: 'success.main',
  progressing: 'info.main',
  failed: 'error.main',
  stopped: 'text.disabled',
  unknown: 'warning.main',
};

/** One box of the flow; `tone` follows the health of the object. */
function Stage({
  icon,
  kind,
  children,
  health,
}: {
  icon: string;
  kind: string;
  children: React.ReactNode;
  health?: HealthSummary;
}) {
  const color = health ? TONE[health.health] : 'divider';
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        minWidth: 170,
        flex: '1 1 170px',
        borderTop: 3,
        borderTopColor: color,
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, color: 'text.secondary' }}
      >
        <Icon icon={icon} width={16} />
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {kind}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
}

function Arrow() {
  return (
    <Box
      aria-hidden
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.disabled',
        transform: { xs: 'rotate(90deg)', md: 'none' },
        flex: '0 0 auto',
      }}
    >
      <Icon icon="mdi:arrow-right-thick" width={22} />
    </Box>
  );
}

function PoolPods({ chain }: { chain: PoolChain }) {
  const { pool } = chain;
  const selector = Object.entries(pool.selector)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const pods = useCoreList<PodJson>(
    'v1',
    'pods',
    true,
    selector ? { namespace: pool.namespace, labelSelector: selector } : null,
    30000
  );
  const ready = pods.items.filter(p => podHealth(p).health === 'ready').length;
  const health: HealthSummary =
    pods.items.length === 0
      ? { health: 'failed', reason: t('No pod matches the pool selector') }
      : ready === pods.items.length
      ? { health: 'ready' }
      : {
          health: 'progressing',
          reason: t('{{r}} of {{n}} ready', { r: ready, n: pods.items.length }),
        };
  return (
    <Stage icon="mdi:server" kind={t('Model servers')} health={pods.forbidden ? undefined : health}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {pods.forbidden
          ? t('Not allowed to list pods')
          : t('{{r}} / {{n}} ready', { r: ready, n: pods.items.length })}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        {t('port {{p}}', { p: pool.targetPorts.join(', ') || '—' })}
      </Typography>
      {pool.owner?.kind === 'LLMInferenceService' && (
        <Link
          routeName={DETAIL_PAGES.endpoint.name}
          params={{ slug: 'llm', namespace: pool.namespace, name: pool.owner.name }}
        >
          {pool.owner.name}
        </Link>
      )}
    </Stage>
  );
}

/**
 * Gateway → HTTPRoute → InferencePool → endpoint picker and model servers, for one pool.
 * Laid out left to right on wide screens and top to bottom on narrow ones.
 */
export function TopologyDiagram({ chain }: { chain: PoolChain }) {
  const { pool } = chain;
  return (
    <Box
      role="group"
      aria-label={t('Traffic path of InferencePool {{name}}', { name: pool.name })}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: 1,
        alignItems: 'stretch',
      }}
    >
      <Stage icon="mdi:gate" kind={t('Gateway')}>
        {chain.gateways.length === 0 && chain.missingGateways.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('Not exposed')}
          </Typography>
        )}
        {chain.gateways.map(g => (
          <Box key={`${g.metadata.namespace}/${g.metadata.name}`} sx={{ mb: 0.5 }}>
            <Link
              routeName="gateway"
              params={{ namespace: g.metadata.namespace || '', name: g.metadata.name }}
            >
              {g.metadata.name}
            </Link>
            <Box
              sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}
            >
              <StatusBadge summary={gatewayHealth(g)} />
              {g.status?.addresses?.[0] && (
                <Tooltip title={t('Gateway address')}>
                  <Chip size="small" variant="outlined" label={g.status.addresses[0].value} />
                </Tooltip>
              )}
            </Box>
          </Box>
        ))}
        {chain.missingGateways.map(k => (
          <Typography key={k} variant="body2" color="warning.main">
            {k} ({t('not found')})
          </Typography>
        ))}
      </Stage>
      <Arrow />
      <Stage icon="mdi:routes" kind={t('HTTPRoute')}>
        {chain.routes.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('No route targets this pool')}
          </Typography>
        ) : (
          chain.routes.map(r => (
            <Box key={r.metadata.name} sx={{ mb: 0.5 }}>
              <Link
                routeName="httproute"
                params={{ namespace: r.metadata.namespace || '', name: r.metadata.name }}
              >
                {r.metadata.name}
              </Link>
              <Box sx={{ mt: 0.25 }}>
                <StatusBadge summary={parentsHealth(r.status?.parents, 'route')} />
              </Box>
              {r.spec?.hostnames?.length ? (
                <Typography variant="caption" color="text.secondary" component="div">
                  {r.spec.hostnames.join(', ')}
                </Typography>
              ) : null}
            </Box>
          ))
        )}
      </Stage>
      <Arrow />
      <Stage icon="mdi:scale-balance" kind={t('InferencePool')} health={pool.health}>
        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
          {pool.name}
        </Typography>
        {chain.objectives.length > 0 && (
          <Chip
            size="small"
            icon={<Icon icon="mdi:flag-outline" />}
            label={t('{{n}} objective(s)', { n: chain.objectives.length })}
            sx={{ mt: 0.5, mr: 0.5 }}
          />
        )}
        {chain.rewrites.length > 0 && (
          <Chip
            size="small"
            icon={<Icon icon="mdi:swap-horizontal" />}
            label={t('{{n}} rewrite(s)', { n: chain.rewrites.length })}
            sx={{ mt: 0.5 }}
          />
        )}
      </Stage>
      <Arrow />
      <Stage icon="mdi:source-branch" kind={t('Endpoint picker')}>
        {pool.picker ? (
          <>
            {pool.picker.kind === 'Service' ? (
              <Link
                routeName="service"
                params={{ namespace: pool.namespace, name: pool.picker.name }}
              >
                {pool.picker.name}
              </Link>
            ) : (
              <Typography variant="body2">{pool.picker.name}</Typography>
            )}
            <Typography variant="caption" color="text.secondary" component="div">
              {[pool.picker.port ? `:${pool.picker.port}` : '', pool.picker.failureMode]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('Not configured')}
          </Typography>
        )}
      </Stage>
      <Arrow />
      <PoolPods chain={chain} />
    </Box>
  );
}
