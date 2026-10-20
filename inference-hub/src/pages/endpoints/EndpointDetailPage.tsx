import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Chip, Paper, Tab, Tabs, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { locationsOf } from '../../api/discovery';
import { Discovery } from '../../api/discovery';
import { isNotFound } from '../../api/liveStore';
import { deleteObject, patchAnnotations } from '../../api/mutations';
import { customItemPath } from '../../api/paths';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, LoadingState } from '../../common/States';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { ModelAvatar } from '../../components/common/ModelAvatar';
import { StatusLine } from '../../components/common/StatusBadge';
import { YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { EventJson, EventsPanel } from '../../components/detail/EventsPanel';
import { LogsPanel } from '../../components/detail/LogsPanel';
import { PodsTable } from '../../components/detail/PodsTable';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useCoreList, useLivePath } from '../../hooks/useLive';
import { ResourceId, RESOURCES } from '../../resources/definitions';
import {
  EndpointSlug,
  fromInferenceService,
  fromLLMInferenceService,
  InferenceServiceJson,
  LLMInferenceServiceJson,
  ModelEndpoint,
  podSelector,
  STOP_ANNOTATION,
} from '../../resources/endpoint';
import { PodJson } from '../../resources/pod';
import { KubeJson } from '../../resources/types';
import { PAGES, playgroundUrl } from '../../routes';
import { featuresOf, useSettings } from '../../settings/settings';
import { EndpointMetrics } from './EndpointMetrics';
import { EndpointOverview } from './EndpointOverview';

const TABS = ['overview', 'metrics', 'pods', 'events', 'logs'] as const;
type TabId = (typeof TABS)[number];

const RESOURCE_BY_SLUG: Record<EndpointSlug, ResourceId> = {
  llm: 'llminferenceservices',
  isvc: 'inferenceservices',
};

function useTab(): [TabId, (tab: TabId) => void] {
  const location = useLocation();
  const history = useHistory();
  const current = new URLSearchParams(location.search).get('tab') as TabId | null;
  const tab = current && (TABS as readonly string[]).includes(current) ? current : 'overview';
  const setTab = (next: TabId) => {
    const params = new URLSearchParams(location.search);
    params.set('tab', next);
    history.replace({ ...location, search: params.toString() });
  };
  return [tab, setTab];
}

function EndpointHeader({ endpoint, group }: { endpoint: ModelEndpoint; group: string }) {
  const cluster = useCurrentCluster();
  const history = useHistory();
  const { enqueueSnackbar } = useSnackbar();
  const [dialog, setDialog] = React.useState<'edit' | 'delete' | 'stop' | null>(null);
  const resource = RESOURCES[RESOURCE_BY_SLUG[endpoint.slug]].plural;
  const access = (verb: 'update' | 'delete' | 'patch') => ({
    verb,
    group,
    resource,
    namespace: endpoint.namespace,
    name: endpoint.name,
  });
  const stopped = endpoint.status.health === 'stopped';
  const playgroundEnabled = featuresOf(useSettings()).playground;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <ModelAvatar model={endpoint.model} size={52} />
        <Box sx={{ flexGrow: 1, minWidth: 240 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h5" component="h1">
              {endpoint.name}
            </Typography>
            <Chip size="small" variant="outlined" label={endpoint.kind} />
            <Chip
              size="small"
              variant="outlined"
              icon={<Icon icon="mdi:folder-outline" />}
              label={endpoint.namespace}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ my: 0.5 }}>
            {endpoint.servedModelName} · {endpoint.engine}
          </Typography>
          <StatusLine summary={endpoint.status} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {playgroundEnabled && (
            <Button
              variant="contained"
              startIcon={<Icon icon="mdi:chat-processing-outline" />}
              disabled={stopped}
              onClick={() =>
                history.push(
                  playgroundUrl(`${endpoint.slug}/${endpoint.namespace}/${endpoint.name}`)
                )
              }
            >
              {t('Open in Playground')}
            </Button>
          )}
          <GuardedButton
            check={access('update')}
            label={t('Edit YAML')}
            icon="mdi:pencil-outline"
            variant="outlined"
            onClick={() => setDialog('edit')}
          />
          <GuardedButton
            check={access('patch')}
            label={stopped ? t('Resume') : t('Stop')}
            icon={stopped ? 'mdi:play-circle-outline' : 'mdi:stop-circle-outline'}
            variant="outlined"
            onClick={() =>
              stopped
                ? patchAnnotations(endpoint.raw, { [STOP_ANNOTATION]: null }, cluster).catch(
                    (err: Error) =>
                      enqueueSnackbar(t('Could not resume: {{m}}', { m: err.message }), {
                        variant: 'error',
                      })
                  )
                : setDialog('stop')
            }
          />
          <GuardedButton
            check={access('delete')}
            label={t('Delete')}
            icon="mdi:delete-outline"
            color="error"
            variant="outlined"
            onClick={() => setDialog('delete')}
          />
        </Box>
      </Box>
      <YamlEditorDialog
        open={dialog === 'edit'}
        mode="edit"
        title={t('Edit {{name}}', { name: endpoint.name })}
        initial={endpoint.raw}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'stop'}
        title={t('Stop {{name}}?', { name: endpoint.name })}
        message={t(
          'KServe removes the model server pods and keeps the configuration (annotation serving.kserve.io/stop). GPUs are released until you resume the endpoint.'
        )}
        confirmLabel={t('Stop')}
        onConfirm={async () => {
          await patchAnnotations(endpoint.raw, { [STOP_ANNOTATION]: 'true' }, cluster);
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        danger
        title={t('Delete {{name}}?', { name: endpoint.name })}
        message={t(
          'The {{kind}} and every object KServe created for it (pods, services, routes) are deleted. Clients lose access immediately.',
          { kind: endpoint.kind }
        )}
        typeToConfirm={endpoint.name}
        confirmLabel={t('Delete')}
        onConfirm={async () => {
          await deleteObject(endpoint.raw, { cluster });
          history.push(Router.createRouteURL(PAGES.endpoints.name));
        }}
        onClose={() => setDialog(null)}
      />
    </Paper>
  );
}

function EndpointBody({
  discovery,
  slug,
  namespace,
  name,
}: {
  discovery: Discovery;
  slug: EndpointSlug;
  namespace: string;
  name: string;
}) {
  const id = RESOURCE_BY_SLUG[slug];
  const location = locationsOf(discovery, id)[0];
  const item = useLivePath<KubeJson>(customItemPath(RESOURCES[id], location, name, namespace));
  const [tab, setTab] = useTab();
  const history = useHistory();
  const endpoint = React.useMemo(() => {
    if (!item.data) return null;
    return slug === 'llm'
      ? fromLLMInferenceService(item.data as LLMInferenceServiceJson)
      : fromInferenceService(item.data as InferenceServiceJson);
  }, [item.data, slug]);
  const pods = useCoreList<PodJson>('v1', 'pods', true, {
    namespace,
    labelSelector: podSelector({ kind: RESOURCES[id].kind as ModelEndpoint['kind'], name }),
  });

  if (item.loading) return <LoadingState title={t('Loading endpoint…')} />;
  if (isNotFound(item.error)) {
    return (
      <SectionBox title={name}>
        <EmptyState
          icon="mdi:file-question-outline"
          title={t('Endpoint {{ns}}/{{name}} was not found', { ns: namespace, name })}
          description={t('It may have been deleted.')}
          action={
            <Button
              variant="outlined"
              startIcon={<Icon icon="mdi:arrow-left" />}
              onClick={() => history.push(Router.createRouteURL(PAGES.endpoints.name))}
            >
              {t('All endpoints')}
            </Button>
          }
        />
      </SectionBox>
    );
  }
  if (!endpoint) {
    return (
      <SectionBox title={name}>
        <ErrorState error={item.error || t('Unknown error')} onRetry={item.refetch} />
      </SectionBox>
    );
  }

  const matchEvent = (e: EventJson) => {
    const target = e.involvedObject?.name || '';
    return target === name || target.startsWith(`${name}-`);
  };

  return (
    <Box>
      <EndpointHeader endpoint={endpoint} group={location.group} />
      {item.error && (
        <ErrorState
          title={t('Showing the last known state')}
          error={item.error}
          onRetry={item.refetch}
        />
      )}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          aria-label={t('Endpoint sections')}
        >
          <Tab value="overview" label={t('Overview')} />
          <Tab value="metrics" label={t('Metrics')} />
          <Tab value="pods" label={t('Pods ({{n}})', { n: pods.items.length })} />
          <Tab value="events" label={t('Events')} />
          <Tab value="logs" label={t('Logs')} />
        </Tabs>
      </Box>
      {tab === 'overview' && <EndpointOverview endpoint={endpoint} />}
      {tab === 'metrics' && <EndpointMetrics endpoint={endpoint} pods={pods.items} />}
      {tab === 'pods' && (
        <SectionBox title={t('Pods')}>
          <PodsTable
            pods={pods.items}
            forbidden={pods.forbidden}
            emptyHint={
              endpoint.status.health === 'stopped'
                ? t('The endpoint is stopped. Resume it to start pods again.')
                : undefined
            }
          />
        </SectionBox>
      )}
      {tab === 'events' && (
        <SectionBox title={t('Events')}>
          <EventsPanel namespace={namespace} match={matchEvent} />
        </SectionBox>
      )}
      {tab === 'logs' && (
        <SectionBox title={t('Logs')}>
          <LogsPanel pods={pods.items} />
        </SectionBox>
      )}
    </Box>
  );
}

export function EndpointDetailPage() {
  const { slug, namespace, name } = useParams<{
    slug: EndpointSlug;
    namespace: string;
    name: string;
  }>();
  const id = RESOURCE_BY_SLUG[slug] || 'llminferenceservices';
  return (
    <DiscoveryGate title={name} anyOf={[id]}>
      {discovery => (
        <EndpointBody discovery={discovery} slug={slug} namespace={namespace} name={name} />
      )}
    </DiscoveryGate>
  );
}
