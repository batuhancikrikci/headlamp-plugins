import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, Grid, Paper, Typography } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Discovery, locationsOf } from '../../api/discovery';
import { isNotFound } from '../../api/liveStore';
import { deleteObject } from '../../api/mutations';
import { customItemPath } from '../../api/paths';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, LoadingState } from '../../common/States';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { CopyableCode } from '../../components/common/CopyableCode';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { ModelAvatar, ModelTraits, StorageUri } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { useLivePath } from '../../hooks/useLive';
import {
  CatalogEntry,
  catalogEntry,
  EndpointRef,
  LocalModelCacheJson,
  NodeCopy,
} from '../../resources/catalog';
import { RESOURCES } from '../../resources/definitions';
import { deployUrl, DETAIL_PAGES, PAGES } from '../../routes';
import { checkFit, estimateServingMemory, gpusForMemory } from '../../utils/gpuFit';
import { formatParams } from '../../utils/modelInfo';
import { formatBytes } from '../../utils/quantity';

/** Where the model would run: GPUs per replica by GPU model and whether one replica fits now. */
function ServingFit({ entry }: { entry: CatalogEntry }) {
  const fleet = useGpuFleet({ withMetrics: false });
  const { model } = entry;
  if (!model.paramsB) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('The parameter count cannot be read from the model name, so no GPU estimate is shown.')}
      </Typography>
    );
  }
  const estimate = estimateServingMemory(model.paramsB, model.quantization);
  const products = new Map<string, number>();
  fleet.nodes.forEach(n => n.product && n.memoryMiB && products.set(n.product, n.memoryMiB));
  const rows = Array.from(products.entries()).map(([product, memoryMiB]) => {
    const gpus = gpusForMemory(estimate.requiredGiB, memoryMiB / 1024);
    const fit = checkFit(fleet.nodes, {
      resource: 'nvidia.com/gpu',
      gpusPerReplica: gpus,
      replicas: 1,
      nodeSelector: { 'nvidia.com/gpu.product': product },
    });
    return { product, memoryMiB, gpus, free: fit.placeable, capacity: fit.capacityReplicas };
  });

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t('~{{r}} GiB of GPU memory per replica ({{w}} GiB weights in {{q}}).', {
          r: estimate.requiredGiB,
          w: estimate.weightsGiB,
          q: model.quantization || 'BF16',
        })}
      </Typography>
      {rows.length > 0 && (
        <SimpleTable
          data={rows}
          columns={[
            { label: t('GPU'), getter: r => r.product },
            { label: t('Memory'), getter: r => formatBytes(r.memoryMiB * 2 ** 20, 0) },
            { label: t('GPUs per replica'), getter: r => r.gpus },
            {
              label: t('Replicas possible now / at most'),
              getter: r => (
                <Typography
                  variant="body2"
                  color={
                    r.free > 0 ? 'success.main' : r.capacity > 0 ? 'warning.main' : 'error.main'
                  }
                >
                  {r.free} / {r.capacity}
                </Typography>
              ),
            },
          ]}
        />
      )}
    </Box>
  );
}

function EntryBody({ discovery, name }: { discovery: Discovery; name: string }) {
  const cluster = useCurrentCluster();
  const history = useHistory();
  const location = locationsOf(discovery, 'localmodelcaches')[0];
  const item = useLivePath<LocalModelCacheJson>(
    customItemPath(RESOURCES.localmodelcaches, location, name)
  );
  const { endpoints } = useEndpoints();
  const [dialog, setDialog] = React.useState<'edit' | 'delete' | null>(null);

  if (item.loading) return <LoadingState title={t('Loading the catalog entry…')} />;
  if (!item.data) {
    return (
      <SectionBox title={name}>
        {isNotFound(item.error) ? (
          <EmptyState
            icon="mdi:file-question-outline"
            title={t('Catalog entry {{name}} was not found', { name })}
            action={
              <Button
                variant="outlined"
                startIcon={<Icon icon="mdi:arrow-left" />}
                onClick={() => history.push(Router.createRouteURL(PAGES.catalog.name))}
              >
                {t('Back to the catalog')}
              </Button>
            }
          />
        ) : (
          <ErrorState error={item.error || t('Unknown error')} onRetry={item.refetch} />
        )}
      </SectionBox>
    );
  }

  const entry = catalogEntry(item.data, endpoints);
  const { model } = entry;
  const access = (verb: 'update' | 'delete') => ({
    verb,
    group: location.group,
    resource: 'localmodelcaches',
    name,
  });

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <ModelAvatar model={model} size={56} />
          <Box sx={{ flexGrow: 1, minWidth: 240 }}>
            <Typography variant="h5" component="h1">
              {entry.displayName}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ my: 0.5 }}>
              {[
                model.provider?.label,
                model.family,
                formatParams(model.paramsB),
                model.publisher && t('published by {{p}}', { p: model.publisher }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge summary={entry.health} />
              <ModelTraits model={model} />
              {entry.tags.map(tag => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<Icon icon="mdi:rocket-launch-outline" />}
              onClick={() => history.push(deployUrl({ cache: entry.name, uri: entry.uri }))}
            >
              {t('Deploy')}
            </Button>
            <GuardedButton
              check={access('update')}
              label={t('Edit YAML')}
              icon="mdi:pencil-outline"
              variant="outlined"
              onClick={() => setDialog('edit')}
            />
            <GuardedButton
              check={access('delete')}
              label={t('Delete')}
              icon="mdi:delete-outline"
              variant="outlined"
              color="error"
              onClick={() => setDialog('delete')}
            />
          </Box>
        </Box>
        {entry.description && (
          <Typography variant="body2" sx={{ mt: 2 }}>
            {entry.description}
          </Typography>
        )}
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={6}>
          <SectionBox title={t('Source')}>
            <NameValueTable
              rows={[
                { name: t('URI'), value: <StorageUri uri={entry.uri} /> },
                { name: t('Model size'), value: entry.modelSize || '—' },
                { name: t('Node groups'), value: entry.nodeGroups.join(', ') || '—' },
                {
                  name: t('Service account'),
                  value: entry.serviceAccountName || '—',
                  hide: !entry.serviceAccountName,
                },
                {
                  name: t('Storage key'),
                  value: entry.raw.spec?.storage?.key || '—',
                  hide: !entry.raw.spec?.storage?.key,
                },
                { name: t('License'), value: entry.license || '—', hide: !entry.license },
                { name: t('Catalog entry'), value: <CopyableCode code={entry.name} /> },
                {
                  name: t('Added'),
                  value: entry.createdAt ? <DateLabel date={entry.createdAt} /> : '—',
                },
                {
                  name: t('Model card'),
                  value: (
                    <a
                      href={`https://huggingface.co/${model.path.split('@')[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      huggingface.co/{model.path.split('@')[0]}
                    </a>
                  ),
                  hide: model.scheme !== 'hf',
                },
              ]}
            />
          </SectionBox>
        </Grid>
        <Grid item xs={12} lg={6}>
          <SectionBox title={t('Serving estimate')}>
            <ServingFit entry={entry} />
          </SectionBox>
        </Grid>
      </Grid>

      <SectionBox title={t('Cached copies')}>
        {entry.nodes.length === 0 ? (
          <EmptyState
            dense
            icon="mdi:database-off-outline"
            title={t('No node copies reported yet')}
            description={t(
              'Copies appear when the KServe local model controller schedules downloads to the nodes of {{g}}.',
              {
                g: entry.nodeGroups.join(', '),
              }
            )}
          />
        ) : (
          <SimpleTable
            data={entry.nodes}
            columns={[
              {
                label: t('Node'),
                getter: (n: NodeCopy) => (
                  <Link routeName="node" params={{ name: n.node }}>
                    {n.node}
                  </Link>
                ),
              },
              {
                label: t('Status'),
                getter: (n: NodeCopy) => <StatusBadge summary={n.health} label={n.health.reason} />,
              },
            ]}
          />
        )}
      </SectionBox>

      <SectionBox title={t('Endpoints using this model')}>
        {entry.users.length === 0 ? (
          <EmptyState dense icon="mdi:rocket-launch-outline" title={t('Not deployed yet')} />
        ) : (
          <SimpleTable
            data={entry.users}
            columns={[
              {
                label: t('Endpoint'),
                getter: (u: EndpointRef) => (
                  <Link
                    routeName={DETAIL_PAGES.endpoint.name}
                    params={{
                      slug: u.kind === 'LLMInferenceService' ? 'llm' : 'isvc',
                      namespace: u.namespace,
                      name: u.name,
                    }}
                  >
                    {u.namespace}/{u.name}
                  </Link>
                ),
              },
              { label: t('Type'), getter: (u: EndpointRef) => u.kind },
              {
                label: t('Status'),
                getter: (u: EndpointRef) =>
                  u.endpoint ? <StatusBadge summary={u.endpoint.status} /> : '—',
              },
            ]}
          />
        )}
      </SectionBox>

      <YamlEditorDialog
        open={dialog === 'edit'}
        mode="edit"
        title={t('Edit {{name}}', { name })}
        description={t('sourceModelUri cannot be changed; create a new entry for another URI.')}
        initial={entry.raw}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        danger
        title={t('Remove {{name}} from the catalog?', { name: entry.displayName })}
        message={
          <>
            {t('KServe deletes the cached copies from the nodes.')}
            {entry.users.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t(
                  '{{n}} endpoint(s) use this model. Their pods keep running, but new pods download the model again.',
                  {
                    n: entry.users.length,
                  }
                )}
              </Alert>
            )}
          </>
        }
        typeToConfirm={entry.users.length > 0 ? entry.name : undefined}
        confirmLabel={t('Delete')}
        onConfirm={async () => {
          await deleteObject(entry.raw, { cluster });
          history.push(Router.createRouteURL(PAGES.catalog.name));
        }}
        onClose={() => setDialog(null)}
      />
    </Box>
  );
}

export function CatalogEntryPage() {
  const { name } = useParams<{ name: string }>();
  return (
    <DiscoveryGate title={name} anyOf={['localmodelcaches']}>
      {discovery => <EntryBody discovery={discovery} name={name} />}
    </DiscoveryGate>
  );
}
