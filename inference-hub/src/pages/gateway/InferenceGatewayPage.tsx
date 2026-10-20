import {
  Link,
  SectionBox,
  SectionFilterHeader,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Chip, Paper, Typography } from '@mui/material';
import React from 'react';
import { Discovery, isServed, locationsOf } from '../../api/discovery';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { EmptyState, ForbiddenState, LoadingState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { StatusBadge } from '../../components/common/StatusBadge';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { EditorMode, YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { docsTargets } from '../../components/docs/docsTargets';
import { useResourceList } from '../../hooks/useLive';
import { ResourceId } from '../../resources/definitions';
import {
  buildChains,
  describeRewrite,
  gatewayHealth,
  GatewayJson,
  HTTPRouteJson,
  InferencePoolJson,
  ModelRewriteJson,
  normalizePool,
  ObjectiveJson,
  PoolChain,
} from '../../resources/inference';
import {
  inferenceModelRewriteTemplate,
  inferenceObjectiveTemplate,
} from '../../resources/templates';
import { KubeJson } from '../../resources/types';
import { classifyConditions } from '../../utils/health';
import { TopologyDiagram } from './TopologyDiagram';

type Editing = { obj: KubeJson; mode: EditorMode } | null;

function YamlButtons({
  obj,
  id,
  discovery,
  onEdit,
}: {
  obj: KubeJson;
  id: ResourceId;
  discovery: Discovery;
  onEdit: (e: Editing) => void;
}) {
  const group = (obj.apiVersion || '').split('/')[0] || locationsOf(discovery, id)[0]?.group || '';
  return (
    <Box sx={{ display: 'flex' }}>
      <GuardedButton
        iconOnly
        size="small"
        check={{
          verb: 'get',
          group,
          resource: id,
          namespace: obj.metadata.namespace,
          name: obj.metadata.name,
        }}
        label={t('View YAML')}
        icon="mdi:code-braces"
        onClick={() => onEdit({ obj, mode: 'view' })}
      />
      <GuardedButton
        iconOnly
        size="small"
        check={{
          verb: 'update',
          group,
          resource: id,
          namespace: obj.metadata.namespace,
          name: obj.metadata.name,
        }}
        label={t('Edit YAML')}
        icon="mdi:pencil-outline"
        onClick={() => onEdit({ obj, mode: 'edit' })}
      />
    </Box>
  );
}

function ChainCard({
  chain,
  discovery,
  onEdit,
}: {
  chain: PoolChain;
  discovery: Discovery;
  onEdit: (e: Editing) => void;
}) {
  const { pool } = chain;
  const objectiveLoc = locationsOf(discovery, 'inferenceobjectives')[0];
  const rewriteLoc = locationsOf(discovery, 'inferencemodelrewrites')[0];
  const poolRef = { name: pool.name, namespace: pool.namespace, group: pool.group };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {pool.namespace}/{pool.name}
        </Typography>
        <StatusBadge summary={pool.health} />
        <DocsDrawer
          iconOnly
          targets={docsTargets(discovery, [
            'inferencepools',
            'inferenceobjectives',
            'inferencemodelrewrites',
          ])}
        />
        {objectiveLoc && (
          <GuardedButton
            size="small"
            check={{
              verb: 'create',
              group: objectiveLoc.group,
              resource: 'inferenceobjectives',
              namespace: pool.namespace,
            }}
            label={t('Add objective')}
            icon="mdi:flag-plus-outline"
            onClick={() =>
              onEdit({
                obj: inferenceObjectiveTemplate(objectiveLoc.apiVersion, poolRef),
                mode: 'create',
              })
            }
          />
        )}
        {rewriteLoc && (
          <GuardedButton
            size="small"
            check={{
              verb: 'create',
              group: rewriteLoc.group,
              resource: 'inferencemodelrewrites',
              namespace: pool.namespace,
            }}
            label={t('Add model rewrite')}
            icon="mdi:swap-horizontal"
            onClick={() =>
              onEdit({
                obj: inferenceModelRewriteTemplate(
                  rewriteLoc.apiVersion,
                  poolRef,
                  pool.owner?.name || 'model'
                ),
                mode: 'create',
              })
            }
          />
        )}
        <YamlButtons obj={pool.raw} id="inferencepools" discovery={discovery} onEdit={onEdit} />
      </Box>
      <TopologyDiagram chain={chain} />
      {(chain.objectives.length > 0 || chain.rewrites.length > 0) && (
        <Box
          sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}
        >
          {chain.objectives.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t('Objectives')}
              </Typography>
              <SimpleTable
                data={chain.objectives}
                columns={[
                  { label: t('Name'), getter: (o: ObjectiveJson) => o.metadata.name },
                  { label: t('Priority'), getter: (o: ObjectiveJson) => o.spec?.priority ?? 0 },
                  {
                    label: t('Status'),
                    getter: (o: ObjectiveJson) =>
                      o.status?.conditions?.length ? (
                        <StatusBadge
                          summary={classifyConditions(o.status.conditions, {
                            readyType: 'Accepted',
                          })}
                        />
                      ) : (
                        '—'
                      ),
                  },
                  {
                    label: '',
                    getter: (o: ObjectiveJson) => (
                      <YamlButtons
                        obj={o}
                        id="inferenceobjectives"
                        discovery={discovery}
                        onEdit={onEdit}
                      />
                    ),
                  },
                ]}
              />
            </Box>
          )}
          {chain.rewrites.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t('Model rewrites')}
              </Typography>
              <SimpleTable
                data={chain.rewrites}
                columns={[
                  { label: t('Name'), getter: (r: ModelRewriteJson) => r.metadata.name },
                  {
                    label: t('Rules'),
                    getter: (r: ModelRewriteJson) => (
                      <Box>
                        {describeRewrite(r).map(line => (
                          <Typography key={line} variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {line}
                          </Typography>
                        ))}
                      </Box>
                    ),
                  },
                  {
                    label: '',
                    getter: (r: ModelRewriteJson) => (
                      <YamlButtons
                        obj={r}
                        id="inferencemodelrewrites"
                        discovery={discovery}
                        onEdit={onEdit}
                      />
                    ),
                  },
                ]}
              />
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
}

function Gateway({ discovery }: { discovery: Discovery }) {
  const pools = useResourceList<InferencePoolJson>('inferencepools');
  const routes = useResourceList<HTTPRouteJson>(
    'httproutes',
    isServed(discovery, 'httproutes') ? {} : null,
    30000
  );
  const gateways = useResourceList<GatewayJson>(
    'gateways',
    isServed(discovery, 'gateways') ? {} : null,
    30000
  );
  const objectives = useResourceList<ObjectiveJson>(
    'inferenceobjectives',
    isServed(discovery, 'inferenceobjectives') ? {} : null,
    30000
  );
  const rewrites = useResourceList<ModelRewriteJson>(
    'inferencemodelrewrites',
    isServed(discovery, 'inferencemodelrewrites') ? {} : null,
    30000
  );
  const filterFunc = useFilterFunc<InferencePoolJson>();
  const [editing, setEditing] = React.useState<Editing>(null);

  const chains = React.useMemo(
    () =>
      buildChains(
        pools.items.filter(p => filterFunc(p)).map(normalizePool),
        routes.items,
        gateways.items,
        objectives.items,
        rewrites.items
      ),
    [pools.items, routes.items, gateways.items, objectives.items, rewrites.items, filterFunc]
  );
  const inferenceGateways = new Set(
    chains.flatMap(c => c.gateways.map(g => `${g.metadata.namespace}/${g.metadata.name}`))
  );

  let body: React.ReactNode;
  if (pools.forbidden) body = <ForbiddenState what={t('InferencePools')} />;
  else if (pools.loading && !pools.items.length)
    body = <LoadingState title={t('Loading inference pools…')} />;
  else if (!pools.items.length) {
    body = (
      <EmptyState
        icon="mdi:scale-balance"
        title={t('No InferencePools yet')}
        description={t(
          'An InferencePool groups model server pods behind the llm-d endpoint picker. KServe creates one for every LLM service deployed with the "Gateway + llm-d scheduler" routing.'
        )}
      />
    );
  } else {
    body = (
      <>
        <SummaryTiles
          tiles={[
            {
              id: 'pools',
              label: t('Inference pools'),
              value: chains.length,
              icon: 'mdi:scale-balance',
              color: 'primary.main',
            },
            {
              id: 'exposed',
              label: t('Exposed through a gateway'),
              value: chains.filter(c => c.routes.length > 0).length,
              icon: 'mdi:gate',
              color: 'success.main',
            },
            {
              id: 'issues',
              label: t('With problems'),
              value: chains.filter(c => c.pool.health.health === 'failed').length,
              icon: 'mdi:alert-circle-outline',
              color: 'error.main',
            },
            {
              id: 'objectives',
              label: t('Objectives'),
              value: objectives.items.length,
              icon: 'mdi:flag-outline',
              color: 'text.secondary',
            },
            {
              id: 'rewrites',
              label: t('Model rewrites'),
              value: rewrites.items.length,
              icon: 'mdi:swap-horizontal',
              color: 'text.secondary',
            },
          ]}
        />
        {!isServed(discovery, 'httproutes') && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('Gateway API is not installed, so pools cannot be exposed through a Gateway.')}
          </Alert>
        )}
        {(routes.forbidden || gateways.forbidden) && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t(
              'You cannot list Gateways or HTTPRoutes in all namespaces; the topology may be incomplete.'
            )}
          </Alert>
        )}
        {chains.map(chain => (
          <ChainCard key={chain.pool.key} chain={chain} discovery={discovery} onEdit={setEditing} />
        ))}
      </>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title={t('Inference Gateway')} />}>{body}</SectionBox>
      {inferenceGateways.size > 0 && (
        <SectionBox title={t('Gateways serving models')}>
          <SimpleTable
            data={gateways.items.filter(g =>
              inferenceGateways.has(`${g.metadata.namespace}/${g.metadata.name}`)
            )}
            columns={[
              {
                label: t('Gateway'),
                getter: (g: GatewayJson) => (
                  <Link
                    routeName="gateway"
                    params={{ namespace: g.metadata.namespace || '', name: g.metadata.name }}
                  >
                    {g.metadata.namespace}/{g.metadata.name}
                  </Link>
                ),
              },
              { label: t('Class'), getter: (g: GatewayJson) => g.spec?.gatewayClassName || '—' },
              {
                label: t('Listeners'),
                getter: (g: GatewayJson) => (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {(g.spec?.listeners || []).map(l => (
                      <Chip
                        key={l.name}
                        size="small"
                        variant="outlined"
                        label={`${l.protocol}:${l.port}${l.hostname ? ` ${l.hostname}` : ''}`}
                      />
                    ))}
                  </Box>
                ),
              },
              {
                label: t('Address'),
                getter: (g: GatewayJson) =>
                  g.status?.addresses?.map(a => a.value).join(', ') || '—',
              },
              {
                label: t('Pools'),
                getter: (g: GatewayJson) => chains.filter(c => c.gateways.includes(g)).length,
              },
              {
                label: t('Status'),
                getter: (g: GatewayJson) => <StatusBadge summary={gatewayHealth(g)} />,
              },
            ]}
          />
        </SectionBox>
      )}
      {editing && (
        <YamlEditorDialog
          open
          mode={editing.mode}
          title={
            editing.mode === 'create'
              ? t('New {{kind}}', { kind: editing.obj.kind })
              : `${editing.obj.kind} ${editing.obj.metadata.name}`
          }
          initial={editing.obj}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function InferenceGatewayPage() {
  return (
    <DiscoveryGate title={t('Inference Gateway')} anyOf={['inferencepools']}>
      {discovery => <Gateway discovery={discovery} />}
    </DiscoveryGate>
  );
}
