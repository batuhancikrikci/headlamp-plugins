/**
 * Clusters section: ManagedCluster, CertificateSigningRequest (OCM registration requests only)
 * and ClusterProfile.
 */
import {
  DateLabel,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  ADDON_STATE_HEALTH,
  ADDON_STATE_LABEL,
  addonState,
  ManagedClusterAddOnJson,
} from '../../resources/models/addon';
import {
  CLUSTER_NAME_LABEL,
  CLUSTER_STATE_HEALTH,
  CLUSTER_STATE_LABEL,
  clusterClaims,
  clusterSetOf,
  clusterState,
  clusterURL,
  csrCluster,
  CSRJson,
  csrState,
  kubernetesVersion,
  ManagedClusterJson,
  ManagedClusterSetJson,
  setsOfCluster,
} from '../../resources/models/cluster';
import { KubeJson } from '../../resources/models/common';
import { PlacementDecisionJson, placementOfDecision } from '../../resources/models/placement';
import {
  ManifestWorkJson,
  WORK_STATE_HEALTH,
  WORK_STATE_LABEL,
  workState,
} from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { ClusterArgoSection } from '../argocd/Integrations';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink, ResourceRefList } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';
import { ClusterPoliciesSection } from '../governance/Integrations';
import { ClusterActions, CSRActions, DisableAddonAction, PendingCSRs } from './Actions';

const CSR_STATE_HEALTH = {
  pending: 'warning',
  approved: 'success',
  issued: 'success',
  denied: 'error',
  failed: 'error',
} as const;

export function ClusterStateLabel({ cluster }: { cluster: ManagedClusterJson }) {
  const { t } = useText();
  const state = clusterState(cluster);
  return <HealthLabel health={CLUSTER_STATE_HEALTH[state]} label={t(CLUSTER_STATE_LABEL[state])} />;
}

export function ManagedClusterList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManagedCluster')}
      columns={[
        col<ManagedClusterJson>(
          'status',
          t('Status'),
          j => CLUSTER_STATE_LABEL[clusterState(j)],
          j => <ClusterStateLabel cluster={j} />
        ),
        col<ManagedClusterJson>('accepted', t('Accepted'), j =>
          j.spec?.hubAcceptsClient ? t('Yes') : t('No')
        ),
        col<ManagedClusterJson>(
          'clusterset',
          t('Cluster set'),
          j => clusterSetOf(j),
          j => {
            const set = clusterSetOf(j);
            return set ? <ResourceRefLink kind="ManagedClusterSet" name={set} /> : '-';
          }
        ),
        col<ManagedClusterJson>('version', t('Kubernetes'), j => kubernetesVersion(j)),
        col<ManagedClusterJson>('url', t('API server'), j => clusterURL(j)),
        'labels',
      ]}
    />
  );
}

function ClusterAddOns({ cluster }: { cluster: string }) {
  const { t } = useText();
  const addons = useOcmList<ManagedClusterAddOnJson>('ManagedClusterAddOn', { namespace: cluster });
  if (addons.missing) return null;
  return (
    <RelatedTable
      title={t('Add-ons')}
      items={addons.items}
      error={addons.error}
      what={t('managed cluster add-ons')}
      emptyMessage={t('No add-ons are installed on this cluster.')}
      columns={[
        {
          label: t('Add-on'),
          getter: (a: ManagedClusterAddOnJson) => (
            <ResourceRefLink
              kind="ManagedClusterAddOn"
              name={a.metadata.name}
              namespace={a.metadata.namespace}
            />
          ),
        },
        {
          label: t('Status'),
          getter: (a: ManagedClusterAddOnJson) => {
            const state = addonState(a);
            return (
              <HealthLabel health={ADDON_STATE_HEALTH[state]} label={t(ADDON_STATE_LABEL[state])} />
            );
          },
        },
        {
          label: t('Agent namespace'),
          getter: (a: ManagedClusterAddOnJson) => a.status?.namespace || '-',
        },
        { label: '', getter: (a: ManagedClusterAddOnJson) => <DisableAddonAction addon={a} /> },
      ]}
    />
  );
}

function ClusterWorks({ cluster }: { cluster: string }) {
  const { t } = useText();
  const works = useOcmList<ManifestWorkJson>('ManifestWork', { namespace: cluster });
  if (works.missing) return null;
  return (
    <RelatedTable
      title={t('ManifestWorks')}
      items={works.items}
      error={works.error}
      what={t('ManifestWorks')}
      emptyMessage={t('No ManifestWorks target this cluster.')}
      columns={[
        {
          label: t('Name'),
          getter: (w: ManifestWorkJson) => (
            <ResourceRefLink
              kind="ManifestWork"
              name={w.metadata.name}
              namespace={w.metadata.namespace}
            />
          ),
        },
        {
          label: t('Status'),
          getter: (w: ManifestWorkJson) => {
            const state = workState(w);
            return (
              <HealthLabel health={WORK_STATE_HEALTH[state]} label={t(WORK_STATE_LABEL[state])} />
            );
          },
        },
        {
          label: t('Manifests'),
          getter: (w: ManifestWorkJson) => (w.spec?.workload?.manifests || []).length,
        },
        {
          label: t('Age'),
          getter: (w: ManifestWorkJson) =>
            w.metadata.creationTimestamp ? (
              <DateLabel date={w.metadata.creationTimestamp} format="mini" />
            ) : (
              '-'
            ),
        },
      ]}
    />
  );
}

function ClusterDecisions({ cluster }: { cluster: string }) {
  const { t } = useText();
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision');
  if (decisions.missing) return null;
  const selecting = decisions.items
    ? decisions.items.filter(d => (d.status?.decisions || []).some(x => x.clusterName === cluster))
    : null;
  return (
    <RelatedTable
      title={t('Selected by placements')}
      items={selecting}
      error={decisions.error}
      what={t('placement decisions')}
      emptyMessage={t('No placement currently selects this cluster.')}
      columns={[
        {
          label: t('Placement'),
          getter: (d: PlacementDecisionJson) => {
            const placement = placementOfDecision(d);
            return placement ? (
              <ResourceRefLink
                kind="Placement"
                name={placement}
                namespace={d.metadata.namespace}
                qualified
              />
            ) : (
              '-'
            );
          },
        },
        {
          label: t('Decision'),
          getter: (d: PlacementDecisionJson) => (
            <ResourceRefLink
              kind="PlacementDecision"
              name={d.metadata.name}
              namespace={d.metadata.namespace}
            />
          ),
        },
        {
          label: t('Reason'),
          getter: (d: PlacementDecisionJson) =>
            (d.status?.decisions || []).find(x => x.clusterName === cluster)?.reason || '-',
        },
      ]}
    />
  );
}

function ClusterSets({ cluster }: { cluster: ManagedClusterJson }) {
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  if (sets.missing || !sets.items) return null;
  return (
    <ResourceRefList
      refs={setsOfCluster(cluster, sets.items).map(name => ({ kind: 'ManagedClusterSet', name }))}
    />
  );
}

function ClusterInventory({ cluster }: { cluster: ManagedClusterJson }) {
  const { t } = useText();
  const claims = Object.entries(clusterClaims(cluster));
  const taints = cluster.spec?.taints || [];
  const capacity = cluster.status?.capacity || {};
  const allocatable = cluster.status?.allocatable || {};
  const resources = Array.from(
    new Set([...Object.keys(capacity), ...Object.keys(allocatable)])
  ).sort();
  return (
    <SectionBox title={t('Inventory')}>
      <NameValueTable
        rows={[
          {
            name: t('Cluster claims'),
            value:
              claims.length === 0 ? (
                '-'
              ) : (
                <StringArray items={claims.map(([k, v]) => `${k}=${v}`)} max={20} monospace />
              ),
          },
          {
            name: t('Taints'),
            value: (
              <StringArray
                items={taints.map(tt => `${tt.key}${tt.value ? `=${tt.value}` : ''}:${tt.effect}`)}
                monospace
              />
            ),
          },
          {
            name: t('Capacity / allocatable'),
            value:
              resources.length === 0 ? (
                '-'
              ) : (
                <Box>
                  {resources.map(r => (
                    <Typography key={r} variant="body2">
                      {r}: {capacity[r] || '-'} / {allocatable[r] || '-'}
                    </Typography>
                  ))}
                </Box>
              ),
          },
          {
            name: t('Managed namespaces'),
            value: (
              <StringArray
                items={(cluster.status?.managedNamespaces || []).map(
                  n => `${n.name} (${n.clusterSet})`
                )}
              />
            ),
            hide: !cluster.status?.managedNamespaces,
          },
        ]}
      />
    </SectionBox>
  );
}

export function ManagedClusterDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManagedCluster')}
      actions={item => [<ClusterActions key="cluster-actions" item={item} />]}
      extraInfo={item => {
        const j = item.jsonData as ManagedClusterJson;
        return [
          { name: t('Status'), value: <ClusterStateLabel cluster={j} /> },
          { name: t('Hub accepts client'), value: j.spec?.hubAcceptsClient ? t('Yes') : t('No') },
          { name: t('Cluster sets'), value: <ClusterSets cluster={j} /> },
          { name: t('Kubernetes version'), value: kubernetesVersion(j) || '-' },
          {
            name: t('API server URLs'),
            value: (
              <StringArray items={(j.spec?.managedClusterClientConfigs || []).map(c => c.url)} />
            ),
          },
          {
            name: t('Lease duration'),
            value: t('{{s}} s', { s: j.spec?.leaseDurationSeconds ?? 60 }),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ManagedClusterJson;
        const name = j.metadata.name;
        return [
          { id: 'mch-csrs', section: <PendingCSRs cluster={name} /> },
          { id: 'mch-inventory', section: <ClusterInventory cluster={j} /> },
          { id: 'mch-addons', section: <ClusterAddOns cluster={name} /> },
          { id: 'mch-works', section: <ClusterWorks cluster={name} /> },
          { id: 'mch-decisions', section: <ClusterDecisions cluster={name} /> },
          { id: 'mch-policies', section: <ClusterPoliciesSection cluster={name} /> },
          { id: 'mch-argo', section: <ClusterArgoSection cluster={name} /> },
        ];
      }}
    />
  );
}

// ----- CertificateSigningRequest -----

function CSRStateLabel({ csr }: { csr: CSRJson }) {
  const { t } = useText();
  const state = csrState(csr);
  const label = {
    pending: t('Pending'),
    approved: t('Approved'),
    issued: t('Issued'),
    denied: t('Denied'),
    failed: t('Failed'),
  }[state];
  return <HealthLabel health={CSR_STATE_HEALTH[state]} label={label} />;
}

/** Only OCM registration CSRs (labelled with the cluster name) are listed here. */
export function CSRList() {
  const { t } = useText();
  const info = crd('CertificateSigningRequest');
  const csrs = useOcmList<CSRJson>('CertificateSigningRequest', {
    labelSelector: 'open-cluster-management.io/cluster-name',
  });
  return (
    <RelatedTable
      title={t(info.labelPlural)}
      items={
        csrs.items
          ? [...csrs.items].sort((a, b) =>
              (b.metadata.creationTimestamp || '').localeCompare(a.metadata.creationTimestamp || '')
            )
          : null
      }
      error={csrs.error}
      what={t('certificate signing requests')}
      emptyMessage={t('No registration requests from cluster agents.')}
      description={t(
        'Certificate signing requests created by klusterlet agents when they register or renew their hub credentials. Approve them to let a cluster join.'
      )}
      columns={[
        {
          label: t('Name'),
          getter: (c: CSRJson) => (
            <ResourceRefLink kind="CertificateSigningRequest" name={c.metadata.name} />
          ),
        },
        {
          label: t('Cluster'),
          getter: (c: CSRJson) => {
            const cluster = csrCluster(c);
            return cluster ? <ClusterLink name={cluster} /> : '-';
          },
        },
        { label: t('Status'), getter: (c: CSRJson) => <CSRStateLabel csr={c} /> },
        { label: t('Requestor'), getter: (c: CSRJson) => c.spec?.username || '-' },
        {
          label: t('Age'),
          getter: (c: CSRJson) =>
            c.metadata.creationTimestamp ? (
              <DateLabel date={c.metadata.creationTimestamp} format="mini" />
            ) : (
              '-'
            ),
        },
        { label: '', getter: (c: CSRJson) => <CSRActions csr={c} /> },
      ]}
    />
  );
}

export function CSRDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('CertificateSigningRequest')}
      conditions
      actions={item => [<CSRActions key="csr-actions" csr={item.jsonData as CSRJson} />]}
      extraInfo={item => {
        const j = item.jsonData as CSRJson;
        const cluster = csrCluster(j);
        return [
          { name: t('Status'), value: <CSRStateLabel csr={j} /> },
          { name: t('Cluster'), value: cluster ? <ClusterLink name={cluster} /> : '-' },
          { name: t('Signer'), value: j.spec?.signerName || '-' },
          { name: t('Requestor'), value: j.spec?.username || '-' },
          { name: t('Groups'), value: <StringArray items={j.spec?.groups} /> },
          { name: t('Usages'), value: <StringArray items={j.spec?.usages} /> },
        ];
      }}
    />
  );
}

// ----- ClusterProfile -----

interface ClusterProfileJson extends KubeJson {
  spec?: { displayName?: string; clusterManager?: { name?: string } };
  status?: {
    version?: { kubernetes?: string };
    properties?: Array<{ name: string; value: string }>;
    accessProviders?: Array<{ name: string; cluster?: { server?: string } }>;
  };
}

export function ClusterProfileList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterProfile')}
      columns={[
        col<ClusterProfileJson>('display', t('Display name'), j => j.spec?.displayName),
        col<ClusterProfileJson>('manager', t('Cluster manager'), j => j.spec?.clusterManager?.name),
        col<ClusterProfileJson>('k8s', t('Kubernetes'), j => j.status?.version?.kubernetes),
      ]}
    />
  );
}

export function ClusterProfileDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterProfile')}
      extraInfo={item => {
        const j = item.jsonData as ClusterProfileJson;
        return [
          { name: t('Display name'), value: j.spec?.displayName || '-' },
          { name: t('Cluster manager'), value: j.spec?.clusterManager?.name || '-' },
          {
            name: t('Managed cluster'),
            value: (
              <ClusterLink name={j.metadata.labels?.[CLUSTER_NAME_LABEL] || j.metadata.name} />
            ),
          },
          { name: t('Kubernetes version'), value: j.status?.version?.kubernetes || '-' },
          {
            name: t('Properties'),
            value: (
              <StringArray
                items={(j.status?.properties || []).map(p => `${p.name}=${p.value}`)}
                monospace
              />
            ),
          },
          {
            name: t('Access providers'),
            value: (
              <StringArray
                items={(j.status?.accessProviders || []).map(
                  p => `${p.name}${p.cluster?.server ? ` (${p.cluster.server})` : ''}`
                )}
              />
            ),
          },
        ];
      }}
    />
  );
}
