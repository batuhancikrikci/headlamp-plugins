/**
 * Argo CD sections on OCM pages: the managed cluster page (Argo CD registrations and the
 * applications that target the cluster) and the GitOpsCluster page (placement vs. registered
 * clusters consistency).
 */
import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useCoreList, useOcmList } from '../../hooks/useOcmList';
import { GitOpsClusterJson } from '../../resources/models/apps';
import {
  ArgoApplicationJson,
  ArgoClusterSecret,
  destinationCluster,
  gitOpsConsistency,
  isPullModel,
  OCM_ARGO,
} from '../../resources/models/argo';
import {
  decidedClusters,
  decisionsOfPlacement,
  PlacementDecisionJson,
} from '../../resources/models/placement';
import { RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';
import { useArgoClusterSecrets } from './useArgo';
import { ArgoHealthLabel, SyncLabel } from './Views';

/** Argo CD registrations and applications of one managed cluster. */
export function ClusterArgoSection({ cluster }: { cluster: string }) {
  const { t } = useText();
  const apps = useOcmList<ArgoApplicationJson>('Application');
  const secrets = useArgoClusterSecrets();
  if (apps.missing) return null;
  const registrations = (secrets.items || []).filter(s => s.cluster === cluster);
  const targeting = apps.items
    ? apps.items.filter(a => destinationCluster(a, secrets.items || []) === cluster)
    : null;
  return (
    <>
      <SectionBox title={t('Argo CD')}>
        <NameValueTable
          rows={[
            {
              name: t('Registered in'),
              value:
                secrets.items === null ? (
                  secrets.error ? (
                    t('Cluster secrets cannot be read with your permissions.')
                  ) : (
                    '…'
                  )
                ) : registrations.length === 0 ? (
                  t('No Argo CD instance (no cluster secret for this cluster)')
                ) : (
                  <StringArray
                    items={registrations.map(
                      r =>
                        `${r.namespace}${
                          r.serverLabel === `${cluster}-control-plane`
                            ? ` (${t('pull model')})`
                            : ''
                        }${r.ocmManaged ? '' : ` (${t('not created by OCM')})`}`
                    )}
                  />
                ),
            },
          ]}
        />
      </SectionBox>
      <RelatedTable
        title={t('Argo CD applications on this cluster')}
        items={targeting}
        error={apps.error}
        what={t('Argo CD applications')}
        emptyMessage={t('No Argo CD application targets this cluster.')}
        columns={[
          {
            label: t('Application'),
            getter: (a: ArgoApplicationJson) => (
              <ResourceRefLink
                kind="Application"
                name={a.metadata.name}
                namespace={a.metadata.namespace}
                qualified
              />
            ),
          },
          {
            label: t('Model'),
            getter: (a: ArgoApplicationJson) => (isPullModel(a) ? t('Pull') : t('Push')),
          },
          { label: t('Sync'), getter: (a: ArgoApplicationJson) => <SyncLabel app={a} /> },
          { label: t('Health'), getter: (a: ArgoApplicationJson) => <ArgoHealthLabel app={a} /> },
        ]}
      />
    </>
  );
}

/**
 * Compares the clusters the GitOpsCluster's placement selects with the Argo CD cluster secrets
 * in the Argo CD namespace, and checks the generator ConfigMap.
 */
export function GitOpsConsistencySection({ gitops }: { gitops: GitOpsClusterJson }) {
  const { t } = useText();
  const ns = gitops.metadata.namespace || '';
  const argoNs = gitops.spec?.argoServer?.argoNamespace;
  const placement = gitops.spec?.placementRef?.name;
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision', {
    namespace: ns,
    enabled: !!placement,
  });
  const secrets = useArgoClusterSecrets(argoNs);
  const configMaps = useCoreList('ConfigMap', argoNs);
  if (!argoNs || !placement) return null;
  const decided = decisions.items
    ? decidedClusters(
        decisionsOfPlacement({ metadata: { name: placement, namespace: ns } }, decisions.items)
      )
    : null;
  const result = decided && secrets.items ? gitOpsConsistency(decided, secrets.items) : null;
  const hasConfigMap = configMaps.items
    ? configMaps.items.some(c => c.metadata.name === OCM_ARGO.placementConfigMap)
    : undefined;
  const ok = result && result.missing.length === 0 && result.foreign.length === 0;
  return (
    <SectionBox title={t('Argo CD registration check')}>
      {secrets.error && !secrets.items ? (
        <Alert severity="info">
          {t('Argo CD cluster secrets in {{ns}} cannot be listed with your permissions.', {
            ns: argoNs,
          })}
        </Alert>
      ) : !result ? (
        <Typography variant="body2">…</Typography>
      ) : (
        <Box>
          {ok ? (
            <Alert severity="success" sx={{ mb: 1 }}>
              {t(
                'All {{count}} cluster(s) selected by the placement are registered in Argo CD ({{ns}}).',
                { count: decided?.length || 0, ns: argoNs }
              )}
            </Alert>
          ) : null}
          {result.missing.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {t(
                'Selected but not registered in Argo CD: {{c}}. Check the GitOpsCluster status message; without credentials (no managed service account and no cluster secret) use createBlankClusterSecrets for the pull model.',
                {
                  c: result.missing.join(', '),
                }
              )}
            </Alert>
          )}
          {result.foreign.length > 0 && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {t(
                'Argo CD already has cluster secrets not created by OCM for: {{c}}. The GitOpsCluster controller refuses to manage these clusters.',
                { c: result.foreign.join(', ') }
              )}
            </Alert>
          )}
          {result.extra.length > 0 && (
            <Alert severity="info" sx={{ mb: 1 }}>
              {t(
                'Registered by OCM but not selected by this placement (another GitOpsCluster may own them): {{c}}',
                { c: result.extra.join(', ') }
              )}
            </Alert>
          )}
          <NameValueTable
            rows={[
              {
                name: t('Registered clusters'),
                value: (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                    {(secrets.items || [])
                      .filter(
                        (s: ArgoClusterSecret) =>
                          s.ocmManaged && s.cluster && decided?.includes(s.cluster)
                      )
                      .map(s => (
                        <ClusterLink key={s.name} name={s.cluster as string} />
                      ))}
                  </Box>
                ),
              },
              {
                name: t('ApplicationSet generator ConfigMap'),
                value:
                  hasConfigMap === undefined ? (
                    '-'
                  ) : (
                    <HealthLabel
                      health={hasConfigMap ? 'success' : 'warning'}
                      label={
                        hasConfigMap
                          ? `${OCM_ARGO.placementConfigMap} ${t('present')}`
                          : `${OCM_ARGO.placementConfigMap} ${t('missing')}`
                      }
                    />
                  ),
              },
            ]}
          />
        </Box>
      )}
    </SectionBox>
  );
}
