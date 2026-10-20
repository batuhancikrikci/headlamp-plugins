import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Button, Chip, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { locationsOf } from '../../api/discovery';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { ForbiddenState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { ModelCell } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { docsTargets } from '../../components/docs/docsTargets';
import { useCan } from '../../hooks/useCan';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useDefaultNamespace, useEndpoints } from '../../hooks/useEndpoints';
import { ModelEndpoint } from '../../resources/endpoint';
import { inferenceServiceTemplate, llmInferenceServiceTemplate } from '../../resources/templates';
import { KubeJson } from '../../resources/types';
import { deployUrl, DETAIL_PAGES } from '../../routes';
import { Health, HEALTH_META } from '../../utils/health';

const TILE_COLORS: Record<Health, string> = {
  ready: 'success.main',
  progressing: 'info.main',
  failed: 'error.main',
  stopped: 'text.secondary',
  unknown: 'warning.main',
};

function CreateMenu() {
  const state = useDiscovery();
  const namespace = useDefaultNamespace();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [draft, setDraft] = React.useState<KubeJson | null>(null);
  const history = useHistory();
  const discovery = state.status === 'ready' ? state.discovery : undefined;
  const llmLoc = locationsOf(discovery, 'llminferenceservices')[0];
  const isvcLoc = locationsOf(discovery, 'inferenceservices')[0];
  const canLLM = useCan(
    llmLoc
      ? { verb: 'create', group: llmLoc.group, resource: 'llminferenceservices', namespace }
      : null
  );
  const canIsvc = useCan(
    isvcLoc
      ? { verb: 'create', group: isvcLoc.group, resource: 'inferenceservices', namespace }
      : null
  );

  const item = (
    label: string,
    help: string,
    enabled: boolean | undefined,
    reason: string | undefined,
    make: () => KubeJson
  ) => (
    <Tooltip title={enabled === false ? reason || '' : ''} placement="left">
      <span>
        <MenuItem
          disabled={!enabled}
          onClick={() => {
            setAnchor(null);
            setDraft(make());
          }}
        >
          <Box>
            <Typography variant="body2">{label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {help}
            </Typography>
          </Box>
        </MenuItem>
      </span>
    </Tooltip>
  );

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DocsDrawer
          iconOnly
          targets={docsTargets(discovery, ['llminferenceservices', 'inferenceservices'])}
        />
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:rocket-launch-outline" />}
          onClick={() => history.push(deployUrl())}
          disabled={!llmLoc && !isvcLoc}
        >
          {t('Deploy model')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Icon icon="mdi:code-braces" />}
          onClick={e => setAnchor(e.currentTarget)}
          disabled={!llmLoc && !isvcLoc}
        >
          {t('From YAML')}
        </Button>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {item(
          t('LLM service from YAML'),
          t('LLMInferenceService with the llm-d scheduler'),
          !!llmLoc && canLLM.allowed,
          llmLoc ? canLLM.reason : t('LLMInferenceService is not installed'),
          () => llmInferenceServiceTemplate(llmLoc.apiVersion, namespace)
        )}
        {item(
          t('Inference service from YAML'),
          t('InferenceService with the Hugging Face runtime'),
          !!isvcLoc && canIsvc.allowed,
          isvcLoc ? canIsvc.reason : t('InferenceService is not installed'),
          () => inferenceServiceTemplate(isvcLoc.apiVersion, namespace)
        )}
      </Menu>
      {draft && (
        <YamlEditorDialog
          open
          mode="create"
          title={t('New {{kind}}', { kind: draft.kind })}
          description={t(
            'Adjust the model, namespace and resources, validate against the API server, then create.'
          )}
          initial={draft}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}

function replicasText(ep: ModelEndpoint): string {
  if (ep.status.health === 'stopped') return '0';
  const desired =
    ep.replicas ??
    (ep.minReplicas !== undefined && ep.maxReplicas !== undefined
      ? `${ep.minReplicas}–${ep.maxReplicas}`
      : undefined);
  if (ep.readyReplicas !== undefined && desired !== undefined)
    return `${ep.readyReplicas}/${desired}`;
  return desired !== undefined ? String(desired) : '—';
}

function EndpointsTable() {
  const { endpoints, loading, errors, forbidden, llmServed, isvcServed } = useEndpoints();
  const filterFunc = useFilterFunc<ModelEndpoint['raw']>(['.spec.model.uri', '.spec.model.name']);
  const [healthFilter, setHealthFilter] = React.useState<Health | null>(null);

  const visible = endpoints.filter(ep => filterFunc(ep.raw));
  const byHealth = (h: Health) => visible.filter(ep => ep.status.health === h).length;
  const rows = healthFilter ? visible.filter(ep => ep.status.health === healthFilter) : visible;
  const gpus = visible.reduce(
    (sum, ep) => sum + (ep.status.health === 'stopped' ? 0 : ep.totalGpus),
    0
  );

  const tiles = (['ready', 'progressing', 'failed', 'stopped'] as Health[]).map(h => ({
    id: h,
    label: t(HEALTH_META[h].label),
    value: byHealth(h),
    icon: HEALTH_META[h].icon,
    color: TILE_COLORS[h],
    active: healthFilter === h,
    onClick: () => setHealthFilter(current => (current === h ? null : h)),
  }));

  return (
    <SectionBox
      title={
        <SectionFilterHeader title={t('Model Endpoints')} actions={[<CreateMenu key="create" />]} />
      }
    >
      {forbidden ? (
        <ForbiddenState what={t('model endpoints')} />
      ) : (
        <>
          <SummaryTiles
            tiles={[
              ...tiles,
              {
                id: 'gpus',
                label: t('GPUs requested'),
                value: gpus,
                icon: 'mdi:expansion-card-variant',
                color: 'primary.main',
              },
            ]}
          />
          {errors.length > 0 && !forbidden && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('Some endpoints could not be loaded: {{e}}', {
                e: errors.map(e => e.message).join('; '),
              })}
            </Alert>
          )}
          {(!llmServed || !isvcServed) && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              {!llmServed
                ? t('LLMInferenceService is not installed; showing InferenceService only.')
                : t('InferenceService is not installed; showing LLMInferenceService only.')}
            </Typography>
          )}
          <Table<ModelEndpoint>
            data={rows}
            loading={loading && endpoints.length === 0}
            getRowId={ep => `${ep.kind}/${ep.namespace}/${ep.name}`}
            emptyMessage={
              healthFilter
                ? t('No endpoints in this state.')
                : t('No model endpoints yet. Use "Deploy model" to create one.')
            }
            columns={[
              {
                id: 'name',
                header: t('Name'),
                accessorFn: ep => ep.name,
                Cell: ({ row }) => (
                  <Link
                    routeName={DETAIL_PAGES.endpoint.name}
                    params={{
                      slug: row.original.slug,
                      namespace: row.original.namespace,
                      name: row.original.name,
                    }}
                  >
                    {row.original.name}
                  </Link>
                ),
              },
              { id: 'namespace', header: t('Namespace'), accessorFn: ep => ep.namespace },
              {
                id: 'model',
                header: t('Model'),
                accessorFn: ep => ep.servedModelName,
                gridTemplate: 'minmax(220px, 2fr)',
                Cell: ({ row }) => (
                  <ModelCell model={row.original.model} servedName={row.original.servedModelName} />
                ),
              },
              {
                id: 'type',
                header: t('Type'),
                accessorFn: ep => ep.kind,
                Cell: ({ row }) => (
                  <Tooltip title={row.original.kind}>
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={
                        <Icon
                          icon={
                            row.original.slug === 'llm'
                              ? 'mdi:chat-processing-outline'
                              : 'mdi:cube-outline'
                          }
                        />
                      }
                      label={
                        row.original.slug === 'llm' ? t('LLM service') : t('Inference service')
                      }
                    />
                  </Tooltip>
                ),
              },
              { id: 'engine', header: t('Engine'), accessorFn: ep => ep.engine },
              {
                id: 'status',
                header: t('Status'),
                accessorFn: ep => ep.status.health,
                Cell: ({ row }) => <StatusBadge summary={row.original.status} />,
              },
              { id: 'replicas', header: t('Replicas'), accessorFn: ep => replicasText(ep) },
              { id: 'gpus', header: t('GPUs'), accessorFn: ep => ep.totalGpus || '—' },
              {
                id: 'age',
                header: t('Age'),
                accessorFn: ep => ep.createdAt || '',
                Cell: ({ row }) =>
                  row.original.createdAt ? (
                    <DateLabel date={row.original.createdAt} format="mini" />
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </>
      )}
    </SectionBox>
  );
}

export function EndpointsPage() {
  return (
    <DiscoveryGate
      title={t('Model Endpoints')}
      anyOf={['llminferenceservices', 'inferenceservices']}
    >
      <EndpointsTable />
    </DiscoveryGate>
  );
}
