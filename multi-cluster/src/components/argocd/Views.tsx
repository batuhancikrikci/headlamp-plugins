/**
 * Argo CD views: Applications and ApplicationSets (Applications section), AppProjects and the
 * Argo CD cluster secrets created by GitOpsClusters (GitOps section).
 */
import {
  DateLabel,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  appSetIsPull,
  appSetPlacements,
  appsOfAppSet,
  appSources,
  ArgoApplicationJson,
  ArgoApplicationSetJson,
  ArgoClusterSecret,
  argoHealth,
  destinationCluster,
  generatorTypes,
  gitOpsConsistency,
  healthStatus,
  isPullModel,
  OCM_ARGO,
  operationPhase,
  owningAppSet,
  pullTargetCluster,
  sourceText,
  syncHealth,
  syncStatus,
} from '../../resources/models/argo';
import { KubeJson } from '../../resources/models/common';
import {
  decidedClusters,
  decisionsOfPlacement,
  PlacementDecisionJson,
} from '../../resources/models/placement';
import { ManifestWorkJson } from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { CRDGate } from '../common/CRDGate';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';
import { WorkStateLabel } from '../workloads/Views';
import { ArgoAppActions } from './Actions';
import { useArgoClusterSecrets } from './useArgo';

export function SyncLabel({ app }: { app: ArgoApplicationJson }) {
  const status = syncStatus(app);
  return (
    <HealthLabel health={syncHealth(status)} label={status} tooltip={app.status?.sync?.revision} />
  );
}

export function ArgoHealthLabel({ app }: { app: ArgoApplicationJson }) {
  const status = healthStatus(app);
  return (
    <HealthLabel health={argoHealth(status)} label={status} tooltip={app.status?.health?.message} />
  );
}

function ModelChip({ pull }: { pull: boolean }) {
  const { t } = useText();
  return (
    <Chip
      size="small"
      variant="outlined"
      color={pull ? 'secondary' : 'default'}
      label={pull ? t('Pull') : t('Push')}
    />
  );
}

/** Managed cluster an application targets, resolved through the Argo CD cluster secrets. */
function TargetCluster({
  app,
  secrets,
}: {
  app: ArgoApplicationJson;
  secrets: ArgoClusterSecret[];
}) {
  const cluster = destinationCluster(app, secrets);
  if (cluster) return <ClusterLink name={cluster} />;
  const dest = app.spec?.destination;
  return <>{dest?.name || dest?.server || '-'}</>;
}

export function ArgoApplicationList() {
  const { t } = useText();
  const secrets = useArgoClusterSecrets();
  const list = secrets.items || [];
  return (
    <OcmListView
      info={crd('Application')}
      columns={[
        col<ArgoApplicationJson>(
          'sync',
          t('Sync'),
          j => syncStatus(j),
          j => <SyncLabel app={j} />
        ),
        col<ArgoApplicationJson>(
          'health',
          t('Health'),
          j => healthStatus(j),
          j => <ArgoHealthLabel app={j} />
        ),
        col<ArgoApplicationJson>(
          'model',
          t('Model'),
          j => (isPullModel(j) ? 'Pull' : 'Push'),
          j => <ModelChip pull={isPullModel(j)} />
        ),
        col<ArgoApplicationJson>(
          'cluster',
          t('Target cluster'),
          j =>
            destinationCluster(j, list) || j.spec?.destination?.name || j.spec?.destination?.server,
          j => <TargetCluster app={j} secrets={list} />
        ),
        col<ArgoApplicationJson>('source', t('Source'), j =>
          appSources(j.spec).map(sourceText).join(', ')
        ),
        col<ArgoApplicationJson>(
          'appset',
          t('ApplicationSet'),
          j => owningAppSet(j),
          j => {
            const owner = owningAppSet(j);
            return owner ? (
              <ResourceRefLink
                kind="ApplicationSet"
                name={owner}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            );
          }
        ),
      ]}
    />
  );
}

/** Pull model: the ManifestWork that carries the application to the managed cluster. */
function PullPropagation({ app }: { app: ArgoApplicationJson }) {
  const { t } = useText();
  const cluster = pullTargetCluster(app);
  const works = useOcmList<ManifestWorkJson>('ManifestWork', {
    namespace: cluster,
    enabled: !!cluster,
  });
  if (!cluster) {
    return (
      <SectionBox title={t('Pull model')}>
        <Alert severity="warning">
          {t(
            'The application is labelled for the pull model but has no {{a}} annotation, so it is not propagated.',
            {
              a: OCM_ARGO.managedClusterAnnotation,
            }
          )}
        </Alert>
      </SectionBox>
    );
  }
  const own = (works.items || []).filter(
    w =>
      w.metadata.annotations?.[OCM_ARGO.hubAppNameAnnotation] === app.metadata.name &&
      w.metadata.annotations?.[OCM_ARGO.hubAppNamespaceAnnotation] === app.metadata.namespace
  );
  return (
    <RelatedTable
      title={t('Pull model propagation')}
      description={t(
        'The hub copy is not reconciled by the hub Argo CD; this ManifestWork delivers the application to the Argo CD on {{cluster}}. Sync and health above are reported back from the managed cluster.',
        { cluster }
      )}
      items={works.items ? own : null}
      error={works.error}
      what={t('ManifestWorks')}
      emptyMessage={t('No ManifestWork has been created for this application yet.')}
      columns={[
        { label: t('Cluster'), getter: () => <ClusterLink name={cluster} /> },
        {
          label: t('ManifestWork'),
          getter: (w: ManifestWorkJson) => (
            <ResourceRefLink
              kind="ManifestWork"
              name={w.metadata.name}
              namespace={w.metadata.namespace}
            />
          ),
        },
        { label: t('Status'), getter: (w: ManifestWorkJson) => <WorkStateLabel work={w} /> },
      ]}
    />
  );
}

type AppResource = NonNullable<NonNullable<ArgoApplicationJson['status']>['resources']>[number];
type AppHistory = NonNullable<NonNullable<ArgoApplicationJson['status']>['history']>[number];

export function ArgoApplicationDetail() {
  const { t } = useText();
  const secrets = useArgoClusterSecrets();
  return (
    <OcmDetailView
      info={crd('Application')}
      conditions={false}
      actions={item => [<ArgoAppActions key="argo-actions" item={item} />]}
      extraInfo={item => {
        const j = item.jsonData as ArgoApplicationJson;
        const op = j.status?.operationState;
        const owner = owningAppSet(j);
        return [
          { name: t('Sync'), value: <SyncLabel app={j} /> },
          { name: t('Health'), value: <ArgoHealthLabel app={j} /> },
          {
            name: t('Health message'),
            value: j.status?.health?.message,
            hide: !j.status?.health?.message,
          },
          {
            name: t('Last operation'),
            value: op ? `${op.phase}${op.message ? ` · ${op.message}` : ''}` : '-',
          },
          {
            name: t('Model'),
            value: isPullModel(j)
              ? t('Pull (deployed by the Argo CD on the managed cluster)')
              : t('Push (deployed by this Argo CD)'),
          },
          {
            name: t('Target cluster'),
            value: <TargetCluster app={j} secrets={secrets.items || []} />,
          },
          { name: t('Destination namespace'), value: j.spec?.destination?.namespace || '-' },
          {
            name: t('Project'),
            value: (
              <ResourceRefLink
                kind="AppProject"
                name={j.spec?.project || 'default'}
                namespace={j.metadata.namespace}
              />
            ),
          },
          { name: t('Sources'), value: <StringArray items={appSources(j.spec).map(sourceText)} /> },
          {
            name: t('Synced revision'),
            value: j.status?.sync?.revision || (j.status?.sync?.revisions || []).join(', ') || '-',
          },
          {
            name: t('Automated sync'),
            value: j.spec?.syncPolicy?.automated
              ? [
                  t('on'),
                  j.spec.syncPolicy.automated.prune && t('prune'),
                  j.spec.syncPolicy.automated.selfHeal && t('self-heal'),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('off'),
          },
          {
            name: t('ApplicationSet'),
            value: owner ? (
              <ResourceRefLink
                kind="ApplicationSet"
                name={owner}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            ),
            hide: !owner,
          },
          {
            name: t('Reconciled'),
            value: j.status?.reconciledAt ? <DateLabel date={j.status.reconciledAt} /> : '-',
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ArgoApplicationJson;
        return [
          ...(isPullModel(j) ? [{ id: 'mch-pull', section: <PullPropagation app={j} /> }] : []),
          ...((j.status?.conditions || []).length > 0
            ? [
                {
                  id: 'mch-argo-conditions',
                  section: (
                    <SectionBox title={t('Application conditions')}>
                      {(j.status?.conditions || []).map(c => (
                        <Alert
                          key={c.type + c.message}
                          severity={/Error|Warning/.test(c.type) ? 'warning' : 'info'}
                          sx={{ mb: 1 }}
                        >
                          <strong>{c.type}</strong>: {c.message}
                        </Alert>
                      ))}
                    </SectionBox>
                  ),
                },
              ]
            : []),
          {
            id: 'mch-resources',
            section: (
              <RelatedTable
                title={t('Resources')}
                items={j.status?.resources || []}
                what={t('resources')}
                emptyMessage={t('No resources reported.')}
                columns={[
                  { label: t('Kind'), getter: (r: AppResource) => r.kind || '-' },
                  {
                    label: t('Name'),
                    getter: (r: AppResource) =>
                      `${r.namespace ? `${r.namespace}/` : ''}${r.name || '?'}`,
                  },
                  {
                    label: t('Sync'),
                    getter: (r: AppResource) => (
                      <HealthLabel
                        health={syncHealth(r.status || 'Unknown')}
                        label={r.status || '-'}
                      />
                    ),
                  },
                  {
                    label: t('Health'),
                    getter: (r: AppResource) =>
                      r.health?.status ? (
                        <HealthLabel
                          health={argoHealth(r.health.status)}
                          label={r.health.status}
                          tooltip={r.health.message}
                        />
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            ),
          },
          {
            id: 'mch-history',
            section: (
              <RelatedTable
                title={t('Sync history')}
                items={[...(j.status?.history || [])].reverse()}
                what={t('history')}
                emptyMessage={t('No syncs yet.')}
                columns={[
                  { label: t('ID'), getter: (h: AppHistory) => h.id },
                  {
                    label: t('Revision'),
                    getter: (h: AppHistory) => h.revision || (h.revisions || []).join(', ') || '-',
                  },
                  {
                    label: t('Deployed'),
                    getter: (h: AppHistory) => <DateLabel date={h.deployedAt} />,
                  },
                  {
                    label: t('Initiated by'),
                    getter: (h: AppHistory) =>
                      h.initiatedBy?.automated ? t('automated') : h.initiatedBy?.username || '-',
                  },
                ]}
              />
            ),
          },
        ];
      }}
    />
  );
}

// ----- ApplicationSet -----

export function ApplicationSetList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ApplicationSet')}
      columns={[
        col<ArgoApplicationSetJson>('generators', t('Generators'), j =>
          generatorTypes(j).join(', ')
        ),
        col<ArgoApplicationSetJson>(
          'placements',
          t('Placements'),
          j =>
            appSetPlacements(j)
              .map(p => p.name)
              .join(', '),
          j => {
            const ps = appSetPlacements(j);
            return ps.length === 0 ? (
              '-'
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {ps.map(p => (
                  <ResourceRefLink
                    key={p.name}
                    kind="Placement"
                    name={p.name}
                    namespace={j.metadata.namespace}
                  />
                ))}
              </Box>
            );
          }
        ),
        col<ArgoApplicationSetJson>(
          'model',
          t('Model'),
          j => (appSetIsPull(j) ? 'Pull' : 'Push'),
          j => <ModelChip pull={appSetIsPull(j)} />
        ),
        col<ArgoApplicationSetJson>(
          'apps',
          t('Applications'),
          j => j.status?.resourcesCount ?? (j.status?.resources || []).length
        ),
        col<ArgoApplicationSetJson>(
          'health',
          t('Health'),
          j => j.status?.health?.status,
          j =>
            j.status?.health?.status ? (
              <HealthLabel
                health={argoHealth(j.status.health.status)}
                label={j.status.health.status}
              />
            ) : (
              '-'
            )
        ),
      ]}
    />
  );
}

function AppSetChain({ appset }: { appset: ArgoApplicationSetJson }) {
  const { t } = useText();
  const ns = appset.metadata.namespace || '';
  const placements = appSetPlacements(appset);
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision', {
    namespace: ns,
    enabled: placements.length > 0,
  });
  const secrets = useArgoClusterSecrets(ns);
  const pull = appSetIsPull(appset);
  const decided = decisions.items
    ? placements.flatMap(p =>
        decidedClusters(
          decisionsOfPlacement({ metadata: { name: p.name, namespace: ns } }, decisions.items!)
        )
      )
    : null;
  const consistency = decided && secrets.items ? gitOpsConsistency(decided, secrets.items) : null;
  if (placements.length === 0) {
    return (
      <SectionBox title={t('Placement')}>
        <Typography variant="body2" color="text.secondary">
          {t(
            'This ApplicationSet does not use an OCM placement (no clusterDecisionResource generator with a placement label).'
          )}
        </Typography>
      </SectionBox>
    );
  }
  return (
    <SectionBox title={t('Placement → clusters')}>
      <NameValueTable
        rows={[
          {
            name: t('Placements'),
            value: (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {placements.map(p => (
                  <ResourceRefLink key={p.name} kind="Placement" name={p.name} namespace={ns} />
                ))}
              </Box>
            ),
          },
          { name: t('Generator ConfigMap'), value: placements.map(p => p.configMapRef).join(', ') },
          {
            name: t('Decided clusters'),
            value: decided ? (
              decided.length === 0 ? (
                t('none')
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                  {decided.map(c => (
                    <ClusterLink key={c} name={c} />
                  ))}
                </Box>
              )
            ) : (
              '…'
            ),
          },
        ]}
      />
      {consistency && consistency.missing.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t(
            'No Argo CD cluster secret in {{ns}} for: {{clusters}}. The clusterDecisionResource generator only creates applications for clusters registered in Argo CD — check the GitOpsCluster for this placement{{pull}}.',
            {
              ns,
              clusters: consistency.missing.join(', '),
              pull: pull ? t(' (pull model: it needs createBlankClusterSecrets: true)') : '',
            }
          )}
        </Alert>
      )}
    </SectionBox>
  );
}

function AppSetApplications({ appset }: { appset: ArgoApplicationSetJson }) {
  const { t } = useText();
  const apps = useOcmList<ArgoApplicationJson>('Application', {
    namespace: appset.metadata.namespace,
  });
  const secrets = useArgoClusterSecrets(appset.metadata.namespace);
  return (
    <RelatedTable
      title={t('Generated applications')}
      items={apps.items ? appsOfAppSet(appset, apps.items) : null}
      error={apps.error}
      what={t('Argo CD applications')}
      emptyMessage={t('No applications have been generated.')}
      columns={[
        {
          label: t('Application'),
          getter: (a: ArgoApplicationJson) => (
            <ResourceRefLink
              kind="Application"
              name={a.metadata.name}
              namespace={a.metadata.namespace}
            />
          ),
        },
        {
          label: t('Cluster'),
          getter: (a: ArgoApplicationJson) => (
            <TargetCluster app={a} secrets={secrets.items || []} />
          ),
        },
        { label: t('Sync'), getter: (a: ArgoApplicationJson) => <SyncLabel app={a} /> },
        { label: t('Health'), getter: (a: ArgoApplicationJson) => <ArgoHealthLabel app={a} /> },
        { label: t('Operation'), getter: (a: ArgoApplicationJson) => operationPhase(a) || '-' },
      ]}
    />
  );
}

export function ApplicationSetDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ApplicationSet')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as ArgoApplicationSetJson;
        const tpl = j.spec?.template?.spec;
        return [
          { name: t('Generators'), value: <StringArray items={generatorTypes(j)} /> },
          { name: t('Model'), value: appSetIsPull(j) ? t('Pull') : t('Push') },
          { name: t('Application name template'), value: j.spec?.template?.metadata?.name || '-' },
          { name: t('Sources'), value: <StringArray items={appSources(tpl).map(sourceText)} /> },
          {
            name: t('Destination'),
            value: tpl
              ? `${tpl.destination?.name || tpl.destination?.server || ''} / ${
                  tpl.destination?.namespace || ''
                }`
              : '-',
          },
          { name: t('Project'), value: tpl?.project || '-' },
          {
            name: t('Applications sync policy'),
            value: j.spec?.syncPolicy?.applicationsSync || t('default (create-update-delete)'),
          },
          {
            name: t('Report'),
            value: (
              <ResourceRefLink
                kind="MulticlusterApplicationSetReport"
                name={j.metadata.name}
                namespace={j.metadata.namespace}
              />
            ),
            hide: !appSetIsPull(j),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ArgoApplicationSetJson;
        return [
          { id: 'mch-chain', section: <AppSetChain appset={j} /> },
          { id: 'mch-apps', section: <AppSetApplications appset={j} /> },
          ...((j.status?.conditions || []).length > 0
            ? [
                {
                  id: 'mch-appset-conditions',
                  section: (
                    <SectionBox title={t('Conditions')}>
                      <NameValueTable
                        rows={(j.status?.conditions || []).map(c => ({
                          name: (
                            <HealthLabel
                              health={
                                c.type === 'ErrorOccurred'
                                  ? c.status === 'True'
                                    ? 'error'
                                    : 'success'
                                  : c.status === 'True'
                                  ? 'success'
                                  : 'unknown'
                              }
                              label={`${c.type}: ${c.status}`}
                            />
                          ),
                          value: c.message || c.reason || '-',
                        }))}
                      />
                    </SectionBox>
                  ),
                },
              ]
            : []),
        ];
      }}
    />
  );
}

// ----- AppProject -----

interface AppProjectJson extends KubeJson {
  spec?: {
    description?: string;
    sourceRepos?: string[];
    destinations?: Array<{ server?: string; name?: string; namespace?: string }>;
    sourceNamespaces?: string[];
    clusterResourceWhitelist?: Array<{ group: string; kind: string }>;
    namespaceResourceBlacklist?: Array<{ group: string; kind: string }>;
    syncWindows?: Array<{ kind?: string; schedule?: string; duration?: string }>;
  };
}

const destText = (d: { server?: string; name?: string; namespace?: string }) =>
  `${d.name || d.server || '*'} / ${d.namespace || '*'}`;

export function AppProjectList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('AppProject')}
      columns={[
        col<AppProjectJson>('description', t('Description'), j => j.spec?.description),
        col<AppProjectJson>('repos', t('Source repositories'), j =>
          (j.spec?.sourceRepos || []).join(', ')
        ),
        col<AppProjectJson>('dests', t('Destinations'), j =>
          (j.spec?.destinations || []).map(destText).join(', ')
        ),
      ]}
    />
  );
}

export function AppProjectDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('AppProject')}
      conditions={false}
      extraInfo={item => {
        const s = (item.jsonData as AppProjectJson).spec || {};
        return [
          { name: t('Description'), value: s.description || '-' },
          { name: t('Source repositories'), value: <StringArray items={s.sourceRepos} max={20} /> },
          {
            name: t('Destinations'),
            value: <StringArray items={(s.destinations || []).map(destText)} max={20} />,
          },
          {
            name: t('Source namespaces'),
            value: <StringArray items={s.sourceNamespaces} />,
            hide: !s.sourceNamespaces,
          },
          {
            name: t('Cluster resources allowed'),
            value: (
              <StringArray
                items={(s.clusterResourceWhitelist || []).map(
                  r => `${r.group || 'core'}/${r.kind}`
                )}
              />
            ),
          },
          {
            name: t('Namespace resources denied'),
            value: (
              <StringArray
                items={(s.namespaceResourceBlacklist || []).map(
                  r => `${r.group || 'core'}/${r.kind}`
                )}
              />
            ),
            hide: !s.namespaceResourceBlacklist,
          },
          {
            name: t('Sync windows'),
            value: (
              <StringArray
                items={(s.syncWindows || []).map(w => `${w.kind} ${w.schedule} (${w.duration})`)}
              />
            ),
            hide: !s.syncWindows,
          },
        ];
      }}
    />
  );
}

// ----- Argo CD cluster secrets (GitOps tab) -----

export function ArgoClustersTab() {
  const { t } = useText();
  const secrets = useArgoClusterSecrets();
  return (
    <CRDGate title={t('Argo CD clusters')} kind="Application">
      <RelatedTable
        title={t('Clusters registered in Argo CD')}
        description={t(
          'Argo CD cluster secrets (label argocd.argoproj.io/secret-type=cluster). Secrets marked OCM are created by GitOpsClusters; credentials are never shown.'
        )}
        items={
          secrets.items
            ? [...secrets.items].sort(
                (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
              )
            : null
        }
        error={secrets.error}
        what={t('secrets')}
        emptyMessage={t('No Argo CD cluster secrets found.')}
        columns={[
          {
            label: t('Argo CD namespace'),
            getter: (s: ArgoClusterSecret) => (
              <ResourceRefLink kind="Namespace" name={s.namespace} />
            ),
          },
          {
            label: t('Secret'),
            getter: (s: ArgoClusterSecret) => (
              <ResourceRefLink kind="Secret" name={s.name} namespace={s.namespace} />
            ),
          },
          {
            label: t('Managed cluster'),
            getter: (s: ArgoClusterSecret) => (s.cluster ? <ClusterLink name={s.cluster} /> : '-'),
          },
          {
            label: t('Server'),
            getter: (s: ArgoClusterSecret) =>
              s.serverLabel?.endsWith('-control-plane') &&
              s.cluster &&
              s.serverLabel === `${s.cluster}-control-plane`
                ? t('blank (pull model)')
                : s.serverLabel || '-',
          },
          {
            label: t('Created by'),
            getter: (s: ArgoClusterSecret) =>
              s.ocmManaged ? (
                <Chip size="small" color="primary" variant="outlined" label="OCM" />
              ) : (
                t('other')
              ),
          },
        ]}
      />
    </CRDGate>
  );
}
