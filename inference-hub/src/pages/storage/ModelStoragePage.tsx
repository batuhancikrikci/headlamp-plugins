import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Discovery, isServed, locationsOf } from '../../api/discovery';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { EmptyState, ForbiddenState, LoadingState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { ExpandableTable } from '../../components/common/ExpandableTable';
import { GuardedButton } from '../../components/common/GuardedButton';
import { NotInstalledState } from '../../components/common/NotInstalledState';
import { StatusBadge } from '../../components/common/StatusBadge';
import { UsageBar } from '../../components/common/UsageBar';
import { YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { docsTargets } from '../../components/docs/docsTargets';
import { useResourceList } from '../../hooks/useLive';
import {
  ClusterStorageContainerJson,
  LocalModelCacheJson,
  LocalModelNodeGroupJson,
  LocalModelNodeJson,
  nodeCacheHealth,
  nodeGroupUsage,
} from '../../resources/catalog';
import { ResourceId } from '../../resources/definitions';
import {
  clusterStorageContainerTemplate,
  localModelNodeGroupTemplate,
} from '../../resources/templates';
import { KubeJson } from '../../resources/types';
import { DETAIL_PAGES } from '../../routes';
import { formatBytes } from '../../utils/quantity';

type Editing = { obj: KubeJson; mode: 'create' | 'edit' } | null;

function EditButton({
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
  const loc = locationsOf(discovery, id)[0];
  return (
    <GuardedButton
      iconOnly
      size="small"
      check={
        loc ? { verb: 'update', group: loc.group, resource: id, name: obj.metadata.name } : null
      }
      label={t('Edit YAML')}
      icon="mdi:pencil-outline"
      onClick={() => onEdit({ obj, mode: 'edit' })}
    />
  );
}

function NodeGroups({ discovery, onEdit }: { discovery: Discovery; onEdit: (e: Editing) => void }) {
  const groups = useResourceList<LocalModelNodeGroupJson>('localmodelnodegroups', {}, 30000);
  const caches = useResourceList<LocalModelCacheJson>('localmodelcaches', {}, 60000);
  const loc = locationsOf(discovery, 'localmodelnodegroups')[0];

  let body: React.ReactNode;
  if (groups.forbidden) body = <ForbiddenState what={t('node groups')} />;
  else if (groups.loading && !groups.items.length) body = <LoadingState />;
  else if (!groups.items.length) {
    body = (
      <EmptyState
        dense
        icon="mdi:server-network-off"
        title={t('No node groups')}
        description={t(
          'A LocalModelNodeGroup defines which nodes cache models and the local volume used for it. Nodes also need the label kserve/localmodel=worker for the KServe agent.'
        )}
      />
    );
  } else {
    body = (
      <SimpleTable
        data={groups.items}
        columns={[
          { label: t('Name'), getter: (g: LocalModelNodeGroupJson) => g.metadata.name },
          {
            label: t('Used / limit'),
            getter: (g: LocalModelNodeGroupJson) => {
              const u = nodeGroupUsage(g);
              return u.limitBytes ? (
                <UsageBar
                  used={u.usedBytes || 0}
                  total={u.limitBytes}
                  width={100}
                  label={`${formatBytes(u.usedBytes || 0, 0)} / ${formatBytes(u.limitBytes, 0)}`}
                  tooltip={
                    u.availableBytes !== undefined
                      ? t('{{a}} available', { a: formatBytes(u.availableBytes, 0) })
                      : undefined
                  }
                />
              ) : (
                '—'
              );
            },
          },
          {
            label: t('Volume'),
            getter: (g: LocalModelNodeGroupJson) => {
              const u = nodeGroupUsage(g);
              return [u.storageClass, u.path].filter(Boolean).join(' · ') || '—';
            },
          },
          {
            label: t('Nodes'),
            getter: (g: LocalModelNodeGroupJson) => {
              const u = nodeGroupUsage(g);
              return u.placement.length ? (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {u.placement.map(p => (
                    <Chip key={p} size="small" variant="outlined" label={p} />
                  ))}
                </Box>
              ) : (
                t('All nodes')
              );
            },
          },
          {
            label: t('Cached models'),
            getter: (g: LocalModelNodeGroupJson) =>
              caches.items.filter(c => (c.spec?.nodeGroups || []).includes(g.metadata.name)).length,
          },
          {
            label: '',
            getter: (g: LocalModelNodeGroupJson) => (
              <EditButton obj={g} id="localmodelnodegroups" discovery={discovery} onEdit={onEdit} />
            ),
          },
        ]}
      />
    );
  }
  return (
    <SectionBox
      title={t('Node groups')}
      headerProps={{
        titleSideActions: [
          <DocsDrawer
            key="docs"
            iconOnly
            targets={docsTargets(discovery, ['localmodelnodegroups'])}
          />,
          <GuardedButton
            key="new"
            variant="outlined"
            size="small"
            check={
              loc ? { verb: 'create', group: loc.group, resource: 'localmodelnodegroups' } : null
            }
            label={t('New node group')}
            icon="mdi:plus"
            onClick={() =>
              loc && onEdit({ obj: localModelNodeGroupTemplate(loc.apiVersion), mode: 'create' })
            }
          />,
        ],
      }}
    >
      {body}
    </SectionBox>
  );
}

function statusCounts(node: LocalModelNodeJson) {
  const statuses = Object.values(node.status?.modelStatus || {});
  return {
    total: (node.spec?.localModels || []).length,
    downloaded: statuses.filter(s => s === 'ModelDownloaded').length,
    downloading: statuses.filter(s => s === 'ModelDownloading' || s === 'ModelDownloadPending')
      .length,
    failed: statuses.filter(s => s === 'ModelDownloadError').length,
  };
}

function CacheNodes() {
  const nodes = useResourceList<LocalModelNodeJson>('localmodelnodes', {}, 30000);
  if (nodes.forbidden)
    return (
      <SectionBox title={t('Cache nodes')}>
        <ForbiddenState what={t('LocalModelNode objects')} />
      </SectionBox>
    );
  if (nodes.loading && !nodes.items.length) {
    return (
      <SectionBox title={t('Cache nodes')}>
        <LoadingState />
      </SectionBox>
    );
  }
  return (
    <SectionBox title={t('Cache nodes')}>
      <ExpandableTable<LocalModelNodeJson>
        rows={nodes.items}
        getRowId={n => n.metadata.name}
        emptyMessage={t('No node caches models yet.')}
        renderDetail={row => (
          <SimpleTable
            data={row.spec?.localModels || []}
            columns={[
              {
                label: t('Model'),
                getter: m => (
                  <Link routeName={DETAIL_PAGES.catalogEntry.name} params={{ name: m.modelName }}>
                    {m.modelName}
                  </Link>
                ),
              },
              {
                label: t('Source'),
                getter: m => (
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {m.sourceModelUri || '—'}
                  </Typography>
                ),
              },
              { label: t('Node group'), getter: m => m.nodeGroup || '—' },
              {
                label: t('Status'),
                getter: m => {
                  const s = row.status?.modelStatus?.[m.modelName] || '';
                  const h = nodeCacheHealth(s);
                  return <StatusBadge summary={h} label={h.reason} />;
                },
              },
            ]}
          />
        )}
        columns={[
          {
            id: 'node',
            header: t('Node'),
            value: n => n.metadata.name,
            render: row => (
              <Link routeName="node" params={{ name: row.metadata.name }}>
                {row.metadata.name}
              </Link>
            ),
          },
          { id: 'models', header: t('Models'), value: n => statusCounts(n).total },
          {
            id: 'downloaded',
            header: t('Downloaded'),
            value: n => statusCounts(n).downloaded,
          },
          {
            id: 'downloading',
            header: t('In progress'),
            value: n => statusCounts(n).downloading,
          },
          {
            id: 'failed',
            header: t('Failed'),
            value: n => statusCounts(n).failed,
            render: row => {
              const failed = statusCounts(row).failed;
              return failed ? <Chip size="small" color="error" label={failed} /> : <>0</>;
            },
          },
        ]}
      />
    </SectionBox>
  );
}

function StorageContainers({
  discovery,
  onEdit,
}: {
  discovery: Discovery;
  onEdit: (e: Editing) => void;
}) {
  const containers = useResourceList<ClusterStorageContainerJson>(
    'clusterstoragecontainers',
    {},
    60000
  );
  const loc = locationsOf(discovery, 'clusterstoragecontainers')[0];
  return (
    <SectionBox
      title={t('Storage containers')}
      headerProps={{
        titleSideActions: [
          <DocsDrawer
            key="docs"
            iconOnly
            targets={docsTargets(discovery, ['clusterstoragecontainers'])}
          />,
          <GuardedButton
            key="new"
            variant="outlined"
            size="small"
            check={
              loc
                ? { verb: 'create', group: loc.group, resource: 'clusterstoragecontainers' }
                : null
            }
            label={t('New storage container')}
            icon="mdi:plus"
            onClick={() =>
              loc &&
              onEdit({ obj: clusterStorageContainerTemplate(loc.apiVersion), mode: 'create' })
            }
          />,
        ],
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t(
          'Containers that download model weights before a model server starts, chosen by URI prefix or regex.'
        )}
      </Typography>
      {containers.forbidden ? (
        <ForbiddenState what={t('ClusterStorageContainer objects')} />
      ) : (
        <SimpleTable
          data={containers.items}
          emptyMessage={t('No storage containers.')}
          columns={[
            { label: t('Name'), getter: (c: ClusterStorageContainerJson) => c.metadata.name },
            {
              label: t('Handles'),
              getter: (c: ClusterStorageContainerJson) => (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {(c.spec?.supportedUriFormats || []).map((f, i) => (
                    <Tooltip key={i} title={f.regex ? t('Regular expression') : t('Prefix')}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={f.prefix || f.regex}
                        sx={{ fontFamily: f.regex ? 'monospace' : undefined }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              ),
            },
            {
              label: t('Image'),
              getter: (c: ClusterStorageContainerJson) => c.spec?.container?.image || '—',
            },
            {
              label: t('Runs as'),
              getter: (c: ClusterStorageContainerJson) => c.spec?.workloadType || 'initContainer',
            },
            {
              label: '',
              getter: (c: ClusterStorageContainerJson) => (
                <EditButton
                  obj={c}
                  id="clusterstoragecontainers"
                  discovery={discovery}
                  onEdit={onEdit}
                />
              ),
            },
          ]}
        />
      )}
    </SectionBox>
  );
}

function Storage({ discovery }: { discovery: Discovery }) {
  const [editing, setEditing] = React.useState<Editing>(null);
  const localModel = isServed(discovery, 'localmodelnodegroups');
  return (
    <>
      {localModel ? (
        <>
          <NodeGroups discovery={discovery} onEdit={setEditing} />
          <CacheNodes />
        </>
      ) : (
        <SectionBox title={t('Local model cache')}>
          <NotInstalledState
            resources={['localmodelnodegroups']}
            title={t('The KServe local model cache is not installed')}
          />
        </SectionBox>
      )}
      {isServed(discovery, 'clusterstoragecontainers') && (
        <StorageContainers discovery={discovery} onEdit={setEditing} />
      )}
      {editing && (
        <YamlEditorDialog
          open
          mode={editing.mode}
          title={
            editing.mode === 'create'
              ? t('New {{kind}}', { kind: editing.obj.kind })
              : t('Edit {{name}}', { name: editing.obj.metadata.name })
          }
          initial={editing.obj}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function ModelStoragePage() {
  return (
    <DiscoveryGate
      title={t('Model Storage')}
      anyOf={['localmodelnodegroups', 'clusterstoragecontainers']}
    >
      {discovery => <Storage discovery={discovery} />}
    </DiscoveryGate>
  );
}
