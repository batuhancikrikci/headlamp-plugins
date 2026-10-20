/**
 * Workloads section: ManifestWork and ManifestWorkReplicaSet.
 */
import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import { conditionHealth, conditionPolarity, KubeJson } from '../../resources/models/common';
import {
  feedbackValue,
  ManifestStatus,
  manifestSummaries,
  ManifestWorkJson,
  ManifestWorkReplicaSetJson,
  MWRS_STATE_HEALTH,
  MWRS_STATE_LABEL,
  mwrsState,
  normalizeSummary,
  WORK_STATE_HEALTH,
  WORK_STATE_LABEL,
  workCluster,
  worksOfReplicaSet,
  workState,
} from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { Bar, HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

export function WorkStateLabel({ work }: { work: ManifestWorkJson }) {
  const { t } = useText();
  const state = workState(work);
  return <HealthLabel health={WORK_STATE_HEALTH[state]} label={t(WORK_STATE_LABEL[state])} />;
}

export function ManifestWorkList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManifestWork')}
      columns={[
        col<ManifestWorkJson>(
          'status',
          t('Status'),
          j => WORK_STATE_LABEL[workState(j)],
          j => <WorkStateLabel work={j} />
        ),
        col<ManifestWorkJson>(
          'cluster',
          t('Cluster'),
          j => workCluster(j),
          j => {
            const c = workCluster(j);
            return c ? <ClusterLink name={c} /> : '-';
          }
        ),
        col<ManifestWorkJson>(
          'manifests',
          t('Manifests'),
          j => (j.spec?.workload?.manifests || []).length
        ),
        col<ManifestWorkJson>(
          'owner',
          t('Replica set'),
          j => j.metadata.labels?.['work.open-cluster-management.io/manifestworkreplicaset']
        ),
      ]}
    />
  );
}

/** One row per manifest: spec and its status on the managed cluster. */
function ManifestsSection({ work }: { work: ManifestWorkJson }) {
  const { t } = useText();
  const manifests = work.spec?.workload?.manifests || [];
  const statuses = work.status?.resourceStatus?.manifests || [];
  const rows = manifests.map((m, ordinal) => ({
    ordinal,
    manifest: m,
    status: statuses.find(s => s.resourceMeta.ordinal === ordinal),
  }));
  return (
    <SectionBox title={t('Manifests')}>
      <SimpleTable
        columns={[
          { label: t('Kind'), getter: (r: { manifest: KubeJson }) => r.manifest?.kind || '?' },
          {
            label: t('Name'),
            getter: (r: { manifest: KubeJson }) =>
              `${r.manifest?.metadata?.namespace ? `${r.manifest.metadata.namespace}/` : ''}${
                r.manifest?.metadata?.name || '?'
              }`,
          },
          {
            label: t('Conditions on the cluster'),
            getter: (r: { status?: ManifestStatus }) =>
              (r.status?.conditions || []).length === 0 ? (
                '-'
              ) : (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {(r.status?.conditions || []).map(c => (
                    <HealthLabel
                      key={c.type}
                      health={conditionHealth(c, conditionPolarity(c.type))}
                      label={`${c.type}: ${c.status}`}
                      tooltip={c.message || c.reason}
                    />
                  ))}
                </Box>
              ),
          },
          {
            label: t('Status feedback'),
            getter: (r: { status?: ManifestStatus }) => (
              <StringArray
                items={(r.status?.statusFeedback?.values || []).map(
                  v => `${v.name}=${feedbackValue(v.fieldValue)}`
                )}
                monospace
              />
            ),
          },
        ]}
        data={rows}
        emptyMessage={t('No manifests.')}
      />
    </SectionBox>
  );
}

export function ManifestWorkDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManifestWork')}
      extraInfo={item => {
        const j = item.jsonData as ManifestWorkJson;
        const cluster = workCluster(j);
        const owner = j.metadata.labels?.['work.open-cluster-management.io/manifestworkreplicaset'];
        const [ownerNs, ...ownerName] = (owner || '').split('.');
        return [
          { name: t('Status'), value: <WorkStateLabel work={j} /> },
          { name: t('Target cluster'), value: cluster ? <ClusterLink name={cluster} /> : '-' },
          {
            name: t('Created by'),
            value: owner ? (
              <ResourceRefLink
                kind="ManifestWorkReplicaSet"
                name={ownerName.join('.')}
                namespace={ownerNs}
                qualified
              />
            ) : (
              '-'
            ),
            hide: !owner,
          },
          {
            name: t('Deletion propagation'),
            value: j.spec?.deleteOption?.propagationPolicy || 'Foreground',
          },
          {
            name: t('Executor'),
            value: j.spec?.executor?.subject?.serviceAccount
              ? `${j.spec.executor.subject.serviceAccount.namespace}/${j.spec.executor.subject.serviceAccount.name}`
              : t('work agent'),
          },
          {
            name: t('Update strategies'),
            value: (
              <StringArray
                items={(j.spec?.manifestConfigs || []).map(
                  c =>
                    `${c.resourceIdentifier.resource}/${c.resourceIdentifier.name}: ${
                      c.updateStrategy?.type || 'Update'
                    }`
                )}
              />
            ),
            hide: !(j.spec?.manifestConfigs || []).length,
          },
        ];
      }}
      sections={item => [
        {
          id: 'mch-manifests',
          section: <ManifestsSection work={item.jsonData as ManifestWorkJson} />,
        },
      ]}
    />
  );
}

// ----- ManifestWorkReplicaSet -----

export function MWRSStateLabel({ mwrs }: { mwrs: ManifestWorkReplicaSetJson }) {
  const { t } = useText();
  const state = mwrsState(mwrs);
  return <HealthLabel health={MWRS_STATE_HEALTH[state]} label={t(MWRS_STATE_LABEL[state])} />;
}

function SummaryBar({ mwrs }: { mwrs: ManifestWorkReplicaSetJson }) {
  const summary = normalizeSummary(mwrs.status?.summary);
  return (
    <Box sx={{ minWidth: 140 }}>
      <Bar
        value={summary.available}
        total={summary.total}
        tone={summary.degraded > 0 ? 'error' : 'success'}
      />
      <Typography variant="caption" color="text.secondary">
        {summary.available}/{summary.total}
      </Typography>
    </Box>
  );
}

export function ManifestWorkReplicaSetList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManifestWorkReplicaSet')}
      columns={[
        col<ManifestWorkReplicaSetJson>(
          'status',
          t('Status'),
          j => MWRS_STATE_LABEL[mwrsState(j)],
          j => <MWRSStateLabel mwrs={j} />
        ),
        col<ManifestWorkReplicaSetJson>(
          'placements',
          t('Placements'),
          j => (j.spec?.placementRefs || []).map(p => p.name).join(', '),
          j => <StringArray items={(j.spec?.placementRefs || []).map(p => p.name)} />
        ),
        col<ManifestWorkReplicaSetJson>(
          'available',
          t('Available'),
          j => normalizeSummary(j.status?.summary).available,
          j => <SummaryBar mwrs={j} />
        ),
        col<ManifestWorkReplicaSetJson>(
          'manifests',
          t('Manifests'),
          j => (j.spec?.manifestWorkTemplate?.workload?.manifests || []).length
        ),
      ]}
    />
  );
}

function ReplicaSetWorks({ mwrs }: { mwrs: ManifestWorkReplicaSetJson }) {
  const { t } = useText();
  const works = useOcmList<ManifestWorkJson>('ManifestWork', {
    labelSelector: `work.open-cluster-management.io/manifestworkreplicaset=${mwrs.metadata.namespace}.${mwrs.metadata.name}`,
  });
  return (
    <RelatedTable
      title={t('ManifestWorks per cluster')}
      items={works.items ? (worksOfReplicaSet(mwrs, works.items) as ManifestWorkJson[]) : null}
      error={works.error}
      what={t('ManifestWorks')}
      emptyMessage={t('No ManifestWorks have been created yet.')}
      columns={[
        {
          label: t('Cluster'),
          getter: (w: ManifestWorkJson) => <ClusterLink name={w.metadata.namespace || ''} />,
        },
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
        {
          label: t('Placement'),
          getter: (w: ManifestWorkJson) =>
            w.metadata.labels?.['work.open-cluster-management.io/placementname'] || '-',
        },
      ]}
    />
  );
}

function PlacementSummaries({ mwrs }: { mwrs: ManifestWorkReplicaSetJson }) {
  const { t } = useText();
  const refs = mwrs.spec?.placementRefs || [];
  const summaries = mwrs.status?.placementSummary || [];
  return (
    <SectionBox title={t('Placements and rollout')}>
      <NameValueTable
        rows={refs.map(ref => {
          const s = summaries.find(x => x.name === ref.name);
          const sum = normalizeSummary(s?.summary);
          return {
            name: (
              <ResourceRefLink
                kind="Placement"
                name={ref.name}
                namespace={mwrs.metadata.namespace}
              />
            ),
            value: (
              <Box>
                <Typography variant="body2">
                  {t('Rollout: {{type}}', { type: ref.rolloutStrategy?.type || 'All' })}
                  {s?.availableDecisionGroups
                    ? ` · ${t('decision groups: {{g}}', { g: s.availableDecisionGroups })}`
                    : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(
                    '{{total}} total · {{applied}} applied · {{available}} available · {{degraded}} degraded · {{progressing}} progressing',
                    {
                      ...sum,
                    }
                  )}
                </Typography>
              </Box>
            ),
          };
        })}
      />
    </SectionBox>
  );
}

export function ManifestWorkReplicaSetDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManifestWorkReplicaSet')}
      extraInfo={item => {
        const j = item.jsonData as ManifestWorkReplicaSetJson;
        const s = normalizeSummary(j.status?.summary);
        return [
          { name: t('Status'), value: <MWRSStateLabel mwrs={j} /> },
          {
            name: t('Summary'),
            value: t(
              '{{available}} of {{total}} available, {{degraded}} degraded',
              s as unknown as Record<string, unknown>
            ),
          },
          { name: t('Desired'), value: s.desiredTotal ?? '-', hide: s.desiredTotal === undefined },
          {
            name: t('Cascade deletion'),
            value: j.spec?.cascadeDeletionPolicy || '-',
            hide: !j.spec?.cascadeDeletionPolicy,
          },
          {
            name: t('Manifests'),
            value: (
              <StringArray
                items={manifestSummaries(j.spec?.manifestWorkTemplate?.workload?.manifests)}
              />
            ),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ManifestWorkReplicaSetJson;
        return [
          { id: 'mch-placements', section: <PlacementSummaries mwrs={j} /> },
          { id: 'mch-works', section: <ReplicaSetWorks mwrs={j} /> },
        ];
      }}
    />
  );
}
