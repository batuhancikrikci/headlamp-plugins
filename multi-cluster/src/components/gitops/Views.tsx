/**
 * GitOps section: GitOpsCluster, MulticlusterApplicationSetReport, ManagedServiceAccount and
 * ClusterPermission (multicloud-integrations and the add-ons it depends on).
 */
import {
  DateLabel,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  AppSetReportJson,
  appSetSummary,
  gitOpsArgoNamespace,
  GitOpsClusterJson,
  gitOpsHealth,
  gitOpsStatusText,
  isAgentGitOpsCluster,
} from '../../resources/models/apps';
import { Condition, KubeJson } from '../../resources/models/common';
import {
  decidedClusters,
  decisionsOfPlacement,
  PlacementDecisionJson,
} from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { GitOpsConsistencySection } from '../argocd/Integrations';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { ConditionSummary, HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

function GitOpsPhase({ gitops }: { gitops: GitOpsClusterJson }) {
  return (
    <HealthLabel
      health={gitOpsHealth(gitops)}
      label={gitOpsStatusText(gitops) || '-'}
      tooltip={gitops.status?.message}
    />
  );
}

function PlacementRef({ gitops }: { gitops: GitOpsClusterJson }) {
  const ref = gitops.spec?.placementRef;
  if (!ref?.name) return <>-</>;
  // The controller only accepts Placements and looks them up in the GitOpsCluster's namespace.
  return <ResourceRefLink kind="Placement" name={ref.name} namespace={gitops.metadata.namespace} />;
}

export function GitOpsClusterList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('GitOpsCluster')}
      columns={[
        col<GitOpsClusterJson>(
          'phase',
          t('Status'),
          j => gitOpsStatusText(j),
          j => <GitOpsPhase gitops={j} />
        ),
        col<GitOpsClusterJson>('model', t('Model'), j =>
          isAgentGitOpsCluster(j) ? t('argocd-agent') : t('cluster secrets')
        ),
        col<GitOpsClusterJson>('argo', t('Argo CD namespace'), j => gitOpsArgoNamespace(j)),
        col<GitOpsClusterJson>(
          'placement',
          t('Placement'),
          j => j.spec?.placementRef?.name,
          j => <PlacementRef gitops={j} />
        ),
        col<GitOpsClusterJson>(
          'updated',
          t('Updated'),
          j => j.status?.lastUpdateTime,
          j =>
            j.status?.lastUpdateTime ? (
              <DateLabel date={j.status.lastUpdateTime} format="mini" />
            ) : (
              '-'
            )
        ),
      ]}
    />
  );
}

const gitopsNs = (g: GitOpsClusterJson) => gitOpsArgoNamespace(g) || '?';

function RegisteredClusters({ gitops }: { gitops: GitOpsClusterJson }) {
  const { t } = useText();
  const ref = gitops.spec?.placementRef;
  const ns = gitops.metadata.namespace;
  const isPlacement = ref?.kind === 'Placement' && !!ref?.name;
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision', {
    namespace: ns,
    enabled: isPlacement,
  });
  const clusters =
    isPlacement && decisions.items
      ? decidedClusters(
          decisionsOfPlacement({ metadata: { name: ref!.name!, namespace: ns } }, decisions.items)
        )
      : null;
  if (!isPlacement) return null;
  const agent = isAgentGitOpsCluster(gitops);
  return (
    <RelatedTable
      title={agent ? t('Clusters with the Argo CD agent') : t('Clusters registered in Argo CD')}
      description={
        agent
          ? t(
              'The clusters selected by the placement; the controller deploys the argocd-agent add-on to each of them and registers it with the principal in {{ns}}.',
              {
                ns: gitopsNs(gitops),
              }
            )
          : t(
              'The clusters selected by the placement; the GitOps controller creates an Argo CD cluster secret for each of them in {{ns}}.',
              { ns: gitopsNs(gitops) }
            )
      }
      items={clusters ? clusters.map(name => ({ name })) : null}
      error={decisions.error}
      what={t('placement decisions')}
      emptyMessage={t('The placement selects no clusters.')}
      columns={[
        { label: t('Cluster'), getter: (c: { name: string }) => <ClusterLink name={c.name} /> },
      ]}
    />
  );
}

export function GitOpsClusterDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('GitOpsCluster')}
      conditions
      extraInfo={item => {
        const j = item.jsonData as GitOpsClusterJson;
        const agent = isAgentGitOpsCluster(j);
        const a = j.spec?.argoCDAgentAddon;
        if (agent) {
          return [
            { name: t('Status'), value: <GitOpsPhase gitops={j} /> },
            { name: t('Model'), value: t('argocd-agent (advanced pull)') },
            {
              name: t('Argo CD namespace'),
              value: <ResourceRefLink kind="Namespace" name={j.metadata.namespace || ''} />,
            },
            { name: t('Placement'), value: <PlacementRef gitops={j} /> },
            { name: t('Agent mode'), value: a?.mode || 'managed' },
            {
              name: t('Principal server'),
              value: a?.principalServerAddress
                ? `${a.principalServerAddress}${
                    a.principalServerPort ? `:${a.principalServerPort}` : ''
                  }`
                : t('discovered automatically'),
            },
            {
              name: t('Agent namespace'),
              value: a?.agentNamespace || '-',
              hide: !a?.agentNamespace,
            },
            {
              name: t('Operator namespace'),
              value: a?.operatorNamespace || '-',
              hide: !a?.operatorNamespace,
            },
            {
              name: t('Custom ArgoCD CR'),
              value: t('{{n}} manifest(s)', {
                n: (a?.argoCDCRManifestWork?.manifests || []).length,
              }),
              hide: !a?.argoCDCRManifestWork,
            },
          ];
        }
        return [
          { name: t('Phase'), value: <GitOpsPhase gitops={j} /> },
          { name: t('Message'), value: j.status?.message || '-', hide: !j.status?.message },
          {
            name: t('Argo CD namespace'),
            value: j.spec?.argoServer?.argoNamespace ? (
              <ResourceRefLink kind="Namespace" name={j.spec.argoServer.argoNamespace} />
            ) : (
              '-'
            ),
          },
          { name: t('Placement'), value: <PlacementRef gitops={j} /> },
          {
            name: t('Managed service account'),
            value: j.spec?.managedServiceAccountRef || '-',
            hide: !j.spec?.managedServiceAccountRef,
          },
          {
            name: t('Create policy template'),
            value: j.spec?.createPolicyTemplate ? t('Yes') : t('No'),
          },
        ];
      }}
      sections={item => [
        {
          id: 'mch-registered',
          section: <RegisteredClusters gitops={item.jsonData as GitOpsClusterJson} />,
        },
        ...(isAgentGitOpsCluster(item.jsonData)
          ? []
          : [
              {
                id: 'mch-argo-check',
                section: <GitOpsConsistencySection gitops={item.jsonData as GitOpsClusterJson} />,
              },
            ]),
      ]}
    />
  );
}

// ----- MulticlusterApplicationSetReport -----

export function AppSetReportList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('MulticlusterApplicationSetReport')}
      columns={[
        col<AppSetReportJson>('clusters', t('Clusters'), j => appSetSummary(j).clusters),
        col<AppSetReportJson>('healthy', t('Healthy'), j => appSetSummary(j).healthy),
        col<AppSetReportJson>('synced', t('Synced'), j => appSetSummary(j).synced),
        col<AppSetReportJson>(
          'problems',
          t('Not healthy / not synced'),
          j => appSetSummary(j).notHealthy + appSetSummary(j).notSynced,
          j => {
            const s = appSetSummary(j);
            const n = s.notHealthy + s.notSynced;
            return n > 0 ? (
              <HealthLabel health="error" label={`${s.notHealthy} / ${s.notSynced}`} />
            ) : (
              '0'
            );
          }
        ),
      ]}
    />
  );
}

export function AppSetReportDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('MulticlusterApplicationSetReport')}
      conditions={false}
      extraInfo={item => {
        const s = appSetSummary(item.jsonData as AppSetReportJson);
        return [
          {
            name: t('Summary'),
            value: t(
              '{{clusters}} clusters · {{healthy}} healthy · {{notHealthy}} not healthy · {{synced}} synced · {{notSynced}} not synced · {{inProgress}} in progress',
              s as unknown as Record<string, unknown>
            ),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as AppSetReportJson;
        type Row = NonNullable<
          NonNullable<AppSetReportJson['statuses']>['clusterConditions']
        >[number];
        return [
          {
            id: 'mch-cluster-conditions',
            section: (
              <RelatedTable
                title={t('Per cluster')}
                items={j.statuses?.clusterConditions || []}
                what={t('cluster conditions')}
                emptyMessage={t('No cluster reported a problem.')}
                columns={[
                  {
                    label: t('Cluster'),
                    getter: (r: Row) => (r.cluster ? <ClusterLink name={r.cluster} /> : '-'),
                  },
                  { label: t('Application'), getter: (r: Row) => r.app || '-' },
                  {
                    label: t('Health'),
                    getter: (r: Row) => (
                      <HealthLabel
                        health={
                          r.healthStatus === 'Healthy'
                            ? 'success'
                            : r.healthStatus
                            ? 'error'
                            : 'unknown'
                        }
                        label={r.healthStatus || '-'}
                      />
                    ),
                  },
                  {
                    label: t('Sync'),
                    getter: (r: Row) => (
                      <HealthLabel
                        health={
                          r.syncStatus === 'Synced'
                            ? 'success'
                            : r.syncStatus
                            ? 'warning'
                            : 'unknown'
                        }
                        label={r.syncStatus || '-'}
                      />
                    ),
                  },
                  {
                    label: t('Messages'),
                    getter: (r: Row) => (
                      <StringArray
                        items={(r.conditions || []).map(c => `${c.type}: ${c.message}`)}
                        max={3}
                      />
                    ),
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

// ----- ManagedServiceAccount / ClusterPermission -----

interface MSAJson extends KubeJson {
  spec?: { rotation?: { enabled?: boolean; validity?: string }; ttlSecondsAfterCreation?: number };
  status?: {
    conditions?: Condition[];
    expirationTimestamp?: string;
    tokenSecretRef?: { name: string; lastRefreshTimestamp: string };
  };
}

export function ManagedServiceAccountList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManagedServiceAccount')}
      columns={[
        col<MSAJson>(
          'cluster',
          t('Cluster'),
          j => j.metadata.namespace,
          j => <ClusterLink name={j.metadata.namespace || ''} />
        ),
        col<MSAJson>(
          'conditions',
          t('Conditions'),
          () => '',
          j => <ConditionSummary conditions={j.status?.conditions} />
        ),
        col<MSAJson>(
          'expires',
          t('Token expires'),
          j => j.status?.expirationTimestamp,
          j =>
            j.status?.expirationTimestamp ? (
              <DateLabel date={j.status.expirationTimestamp} format="mini" />
            ) : (
              '-'
            )
        ),
      ]}
    />
  );
}

export function ManagedServiceAccountDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManagedServiceAccount')}
      extraInfo={item => {
        const j = item.jsonData as MSAJson;
        return [
          { name: t('Cluster'), value: <ClusterLink name={j.metadata.namespace || ''} /> },
          {
            name: t('Rotation'),
            value: j.spec?.rotation?.enabled === false ? t('Disabled') : t('Enabled'),
          },
          { name: t('Validity'), value: j.spec?.rotation?.validity || '-' },
          {
            name: t('Token secret'),
            value: j.status?.tokenSecretRef?.name ? (
              <ResourceRefLink
                kind="Secret"
                name={j.status.tokenSecretRef.name}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            ),
          },
          {
            name: t('Expires'),
            value: j.status?.expirationTimestamp ? (
              <DateLabel date={j.status.expirationTimestamp} />
            ) : (
              '-'
            ),
          },
        ];
      }}
    />
  );
}

interface ClusterPermissionJson extends KubeJson {
  spec?: {
    clusterRole?: { rules?: unknown[] };
    clusterRoleBinding?: { subject?: { kind?: string; name?: string } };
    roles?: Array<{ namespace?: string; rules?: unknown[] }>;
    roleBindings?: Array<{
      namespace?: string;
      roleRef?: { kind?: string; name?: string };
      subject?: { kind?: string; name?: string };
    }>;
  };
  status?: { conditions?: Condition[] };
}

export function ClusterPermissionList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterPermission')}
      columns={[
        col<ClusterPermissionJson>(
          'cluster',
          t('Cluster'),
          j => j.metadata.namespace,
          j => <ClusterLink name={j.metadata.namespace || ''} />
        ),
        col<ClusterPermissionJson>(
          'roles',
          t('Roles'),
          j => (j.spec?.roles || []).length + (j.spec?.clusterRole ? 1 : 0)
        ),
        col<ClusterPermissionJson>(
          'conditions',
          t('Conditions'),
          () => '',
          j => <ConditionSummary conditions={j.status?.conditions} />
        ),
      ]}
    />
  );
}

export function ClusterPermissionDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterPermission')}
      sections={item => {
        const j = item.jsonData as ClusterPermissionJson;
        const s = j.spec || {};
        return [
          {
            id: 'mch-rbac',
            section: (
              <SectionBox title={t('RBAC on the managed cluster')}>
                <NameValueTable
                  rows={[
                    {
                      name: t('Cluster'),
                      value: <ClusterLink name={j.metadata.namespace || ''} />,
                    },
                    {
                      name: t('ClusterRole rules'),
                      value: (s.clusterRole?.rules || []).length,
                      hide: !s.clusterRole,
                    },
                    {
                      name: t('ClusterRoleBinding subject'),
                      value: `${s.clusterRoleBinding?.subject?.kind || ''} ${
                        s.clusterRoleBinding?.subject?.name || ''
                      }`,
                      hide: !s.clusterRoleBinding,
                    },
                    {
                      name: t('Roles'),
                      value: (
                        <StringArray
                          items={(s.roles || []).map(
                            r => `${r.namespace || '*'} (${(r.rules || []).length} rules)`
                          )}
                        />
                      ),
                      hide: !s.roles,
                    },
                    {
                      name: t('RoleBindings'),
                      value: (
                        <Box>
                          <StringArray
                            items={(s.roleBindings || []).map(
                              b =>
                                `${b.namespace || '*'}: ${b.roleRef?.kind || ''}/${
                                  b.roleRef?.name || ''
                                } → ${b.subject?.kind || ''} ${b.subject?.name || ''}`
                            )}
                          />
                        </Box>
                      ),
                      hide: !s.roleBindings,
                    },
                  ]}
                />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}
