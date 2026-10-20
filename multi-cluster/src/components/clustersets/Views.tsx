/**
 * Cluster Sets section: ManagedClusterSet and ManagedClusterSetBinding.
 */
import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  bindingBound,
  CLUSTER_STATE_HEALTH,
  CLUSTER_STATE_LABEL,
  clusterState,
  ManagedClusterJson,
  ManagedClusterSetBindingJson,
  ManagedClusterSetJson,
  setMembers,
  setSelectorType,
} from '../../resources/models/cluster';
import { findCondition } from '../../resources/models/common';
import { PlacementJson } from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

function SetMemberCount({ set }: { set: ManagedClusterSetJson }) {
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  if (!clusters.items) return <>…</>;
  return <>{setMembers(set, clusters.items).length}</>;
}

function selectorText(set: ManagedClusterSetJson, t: (s: string) => string): string {
  return setSelectorType(set) === 'LabelSelector' ? t('Label selector') : t('Cluster set label');
}

export function ManagedClusterSetList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManagedClusterSet')}
      columns={[
        col<ManagedClusterSetJson>('selector', t('Membership'), j => selectorText(j, t)),
        col<ManagedClusterSetJson>(
          'members',
          t('Clusters'),
          () => '',
          j => <SetMemberCount set={j} />
        ),
        col<ManagedClusterSetJson>(
          'empty',
          t('Empty'),
          j => findCondition(j.status?.conditions, 'ClusterSetEmpty')?.status || '-'
        ),
      ]}
    />
  );
}

function SetMembers({ set }: { set: ManagedClusterSetJson }) {
  const { t } = useText();
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  return (
    <RelatedTable
      title={t('Clusters in this set')}
      items={clusters.items ? setMembers(set, clusters.items) : null}
      error={clusters.error}
      what={t('managed clusters')}
      emptyMessage={
        setSelectorType(set) === 'LabelSelector'
          ? t('No cluster matches the label selector.')
          : t(
              'No cluster carries the label cluster.open-cluster-management.io/clusterset={{set}}.',
              {
                set: set.metadata.name,
              }
            )
      }
      columns={[
        {
          label: t('Cluster'),
          getter: (c: ManagedClusterJson) => <ClusterLink name={c.metadata.name} />,
        },
        {
          label: t('Status'),
          getter: (c: ManagedClusterJson) => {
            const state = clusterState(c);
            return (
              <HealthLabel
                health={CLUSTER_STATE_HEALTH[state]}
                label={t(CLUSTER_STATE_LABEL[state])}
              />
            );
          },
        },
        {
          label: t('Kubernetes'),
          getter: (c: ManagedClusterJson) => c.status?.version?.kubernetes || '-',
        },
      ]}
    />
  );
}

function SetBindings({ set }: { set: string }) {
  const { t } = useText();
  const bindings = useOcmList<ManagedClusterSetBindingJson>('ManagedClusterSetBinding');
  const placements = useOcmList<PlacementJson>('Placement');
  const rows = bindings.items ? bindings.items.filter(b => b.spec?.clusterSet === set) : null;
  if (bindings.missing) return null;
  return (
    <RelatedTable
      title={t('Bound to namespaces')}
      description={t(
        'Placements can select clusters of this set only in namespaces that have a binding.'
      )}
      items={rows}
      error={bindings.error}
      what={t('cluster set bindings')}
      emptyMessage={t('The set is not bound to any namespace yet.')}
      columns={[
        {
          label: t('Namespace'),
          getter: (b: ManagedClusterSetBindingJson) => (
            <ResourceRefLink
              kind="ManagedClusterSetBinding"
              name={b.metadata.name}
              namespace={b.metadata.namespace}
              qualified
            />
          ),
        },
        {
          label: t('Bound'),
          getter: (b: ManagedClusterSetBindingJson) => {
            const bound = bindingBound(b);
            return bound === undefined ? (
              '-'
            ) : (
              <HealthLabel
                health={bound ? 'success' : 'error'}
                label={bound ? t('Bound') : t('Not bound')}
              />
            );
          },
        },
        {
          label: t('Placements using the set'),
          getter: (b: ManagedClusterSetBindingJson) => {
            const using = (placements.items || []).filter(
              p =>
                p.metadata.namespace === b.metadata.namespace &&
                ((p.spec?.clusterSets || []).length === 0 ||
                  (p.spec?.clusterSets || []).includes(set))
            );
            return using.length === 0 ? (
              '-'
            ) : (
              <StringArray items={using.map(p => p.metadata.name)} />
            );
          },
        },
      ]}
    />
  );
}

export function ManagedClusterSetDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManagedClusterSet')}
      extraInfo={item => {
        const j = item.jsonData as ManagedClusterSetJson;
        const labelSelector = setSelectorType(j) === 'LabelSelector';
        return [
          { name: t('Membership'), value: selectorText(j, t) },
          {
            name: t('Label selector'),
            value: (
              <SelectorView
                selector={j.spec?.clusterSelector?.labelSelector || {}}
                emptyLabel={t('All clusters')}
              />
            ),
            hide: !labelSelector,
          },
          {
            name: t('Cluster set label'),
            value: `cluster.open-cluster-management.io/clusterset=${j.metadata.name}`,
            hide: labelSelector,
          },
          {
            name: t('Managed namespaces'),
            value: <StringArray items={(j.spec?.managedNamespaces || []).map(n => n.name)} />,
            hide: !j.spec?.managedNamespaces,
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ManagedClusterSetJson;
        return [
          { id: 'mch-members', section: <SetMembers set={j} /> },
          { id: 'mch-bindings', section: <SetBindings set={j.metadata.name} /> },
        ];
      }}
    />
  );
}

export function ManagedClusterSetBindingList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManagedClusterSetBinding')}
      columns={[
        col<ManagedClusterSetBindingJson>(
          'set',
          t('Cluster set'),
          j => j.spec?.clusterSet,
          j =>
            j.spec?.clusterSet ? (
              <ResourceRefLink kind="ManagedClusterSet" name={j.spec.clusterSet} />
            ) : (
              '-'
            )
        ),
        col<ManagedClusterSetBindingJson>('bound', t('Bound'), j => {
          const bound = bindingBound(j);
          return bound === undefined ? '-' : bound ? t('Yes') : t('No');
        }),
      ]}
    />
  );
}

export function ManagedClusterSetBindingDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManagedClusterSetBinding')}
      extraInfo={item => {
        const j = item.jsonData as ManagedClusterSetBindingJson;
        return [
          {
            name: t('Cluster set'),
            value: j.spec?.clusterSet ? (
              <ResourceRefLink kind="ManagedClusterSet" name={j.spec.clusterSet} />
            ) : (
              '-'
            ),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ManagedClusterSetBindingJson;
        return [
          {
            id: 'mch-binding-help',
            section: (
              <SectionBox title={t('What this binding allows')}>
                <NameValueTable
                  rows={[
                    {
                      name: t('Namespace'),
                      value: j.metadata.namespace || '-',
                    },
                    {
                      name: t('Effect'),
                      value: t(
                        'Placements in namespace {{ns}} may select clusters of set {{set}}.',
                        {
                          ns: j.metadata.namespace || '',
                          set: j.spec?.clusterSet || '',
                        }
                      ),
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
