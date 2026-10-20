/**
 * Placements section: Placement, PlacementDecision, AddOnPlacementScore and PlacementRule.
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
import { ClusterManagementAddOnJson } from '../../resources/models/addon';
import {
  GitOpsClusterJson,
  SubscriptionJson,
  subscriptionPlacementRef,
} from '../../resources/models/apps';
import { appSetPlacements, ArgoApplicationSetJson } from '../../resources/models/argo';
import {
  boundSets,
  CLUSTER_STATE_HEALTH,
  CLUSTER_STATE_LABEL,
  clusterState,
  ManagedClusterJson,
  ManagedClusterSetBindingJson,
} from '../../resources/models/cluster';
import {
  AddOnPlacementScoreJson,
  decidedClusters,
  decisionsOfPlacement,
  PLACEMENT_STATE_HEALTH,
  PLACEMENT_STATE_LABEL,
  PlacementDecisionJson,
  PlacementJson,
  placementOfDecision,
  PlacementRuleJson,
  placementState,
} from '../../resources/models/placement';
import { bindingsOfPlacement, PlacementBindingJson } from '../../resources/models/policy';
import { ManifestWorkReplicaSetJson } from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { ClaimSelectorView, HealthLabel, SelectorView, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';
import { PlacementPreviewPanel } from './Preview';

function PlacementStateLabel({ placement }: { placement: PlacementJson }) {
  const { t } = useText();
  const state = placementState(placement);
  return (
    <HealthLabel health={PLACEMENT_STATE_HEALTH[state]} label={t(PLACEMENT_STATE_LABEL[state])} />
  );
}

export function PlacementList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('Placement')}
      columns={[
        col<PlacementJson>(
          'status',
          t('Status'),
          j => PLACEMENT_STATE_LABEL[placementState(j)],
          j => <PlacementStateLabel placement={j} />
        ),
        col<PlacementJson>(
          'sets',
          t('Cluster sets'),
          j => (j.spec?.clusterSets || []).join(', ') || t('all bound'),
          j =>
            (j.spec?.clusterSets || []).length > 0 ? (
              <StringArray items={j.spec?.clusterSets} />
            ) : (
              t('all bound')
            )
        ),
        col<PlacementJson>(
          'selected',
          t('Selected'),
          j => j.status?.numberOfSelectedClusters ?? 0,
          j =>
            j.spec?.numberOfClusters !== undefined
              ? `${j.status?.numberOfSelectedClusters ?? 0}/${j.spec.numberOfClusters}`
              : `${j.status?.numberOfSelectedClusters ?? 0}`
        ),
        col<PlacementJson>('predicates', t('Predicates'), j => (j.spec?.predicates || []).length),
      ]}
    />
  );
}

/** Readable rendering of the placement spec. */
function PlacementRules({
  placement,
  bound,
}: {
  placement: PlacementJson;
  bound: string[] | null;
}) {
  const { t } = useText();
  const spec = placement.spec || {};
  const sets = spec.clusterSets || [];
  return (
    <SectionBox title={t('Selection rules')}>
      <NameValueTable
        rows={[
          {
            name: t('Cluster sets'),
            value:
              sets.length === 0 ? (
                <Typography variant="body2">
                  {t('All sets bound to this namespace')}
                  {bound ? `: ${bound.join(', ') || t('none')}` : ''}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {sets.map(s => (
                    <Box key={s} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      <ResourceRefLink kind="ManagedClusterSet" name={s} />
                      {bound && !bound.includes(s) && (
                        <HealthLabel health="error" label={t('not bound')} />
                      )}
                    </Box>
                  ))}
                </Box>
              ),
          },
          {
            name: t('Predicates (any of)'),
            value:
              (spec.predicates || []).length === 0 ? (
                t('All clusters of the sets')
              ) : (
                <Box>
                  {(spec.predicates || []).map((p, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <Box key={i} sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('Predicate {{n}}', { n: i + 1 })}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <SelectorView
                          selector={p.requiredClusterSelector?.labelSelector}
                          nilLabel={t('any labels')}
                          emptyLabel={t('any labels')}
                        />
                        {(p.requiredClusterSelector?.claimSelector?.matchExpressions || []).length >
                          0 && (
                          <ClaimSelectorView selector={p.requiredClusterSelector?.claimSelector} />
                        )}
                        {(p.requiredClusterSelector?.celSelector?.celExpressions || []).length >
                          0 && (
                          <StringArray
                            items={p.requiredClusterSelector?.celSelector?.celExpressions}
                            monospace
                          />
                        )}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ),
          },
          { name: t('Number of clusters'), value: spec.numberOfClusters ?? t('All matching') },
          {
            name: t('Prioritizers'),
            value: (
              <StringArray
                items={(spec.prioritizerPolicy?.configurations || []).map(c => {
                  const coord = c.scoreCoordinate;
                  const name =
                    coord.type === 'AddOn'
                      ? `${coord.addOn?.resourceName}/${coord.addOn?.scoreName}`
                      : coord.builtIn;
                  return `${name} ×${c.weight ?? 1}`;
                })}
              />
            ),
            hide: !spec.prioritizerPolicy,
          },
          {
            name: t('Prioritizer mode'),
            value: spec.prioritizerPolicy?.mode || 'Additive',
            hide: !spec.prioritizerPolicy,
          },
          {
            name: t('Tolerations'),
            value: (
              <StringArray
                items={(spec.tolerations || []).map(
                  tl =>
                    `${tl.key || '*'} ${tl.operator || 'Equal'}${tl.value ? ` ${tl.value}` : ''}${
                      tl.effect ? `:${tl.effect}` : ''
                    }${tl.tolerationSeconds !== undefined ? ` (${tl.tolerationSeconds}s)` : ''}`
                )}
                monospace
              />
            ),
            hide: !spec.tolerations,
          },
          {
            name: t('Spread'),
            value: (
              <StringArray
                items={(spec.spreadPolicy?.spreadConstraints || []).map(
                  c =>
                    `${c.topologyKeyType}:${c.topologyKey} maxSkew=${c.maxSkew ?? 1} ${
                      c.whenUnsatisfiable || 'ScheduleAnyway'
                    }`
                )}
                monospace
              />
            ),
            hide: !spec.spreadPolicy,
          },
          {
            name: t('Decision groups'),
            value: (
              <StringArray
                items={[
                  ...(spec.decisionStrategy?.groupStrategy?.decisionGroups || []).map(
                    g => g.groupName
                  ),
                  ...(spec.decisionStrategy?.groupStrategy?.clustersPerDecisionGroup !== undefined
                    ? [
                        t('{{n}} per group', {
                          n: spec.decisionStrategy.groupStrategy.clustersPerDecisionGroup,
                        }),
                      ]
                    : []),
                ]}
              />
            ),
            hide: !spec.decisionStrategy,
          },
          { name: t('Sort decisions by'), value: spec.sortBy, hide: !spec.sortBy },
        ]}
      />
    </SectionBox>
  );
}

function PlacementDecisions({ placement }: { placement: PlacementJson }) {
  const { t } = useText();
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision', {
    namespace: placement.metadata.namespace,
  });
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const own = decisions.items ? decisionsOfPlacement(placement, decisions.items) : null;
  const rows = own
    ? own.flatMap(d =>
        (d.status?.decisions || []).map(x => ({
          cluster: x.clusterName,
          reason: x.reason,
          score: x.score,
          decision: d.metadata.name,
          group:
            d.metadata.labels?.['cluster.open-cluster-management.io/decision-group-name'] || '',
        }))
      )
    : null;
  const byName = new Map((clusters.items || []).map(c => [c.metadata.name, c]));
  return (
    <RelatedTable
      title={t('Selected clusters')}
      description={t('From the placement decisions written by the scheduler.')}
      items={rows}
      error={decisions.error}
      what={t('placement decisions')}
      emptyMessage={t('The placement has not selected any cluster.')}
      columns={[
        {
          label: t('Cluster'),
          getter: (r: { cluster: string }) => <ClusterLink name={r.cluster} />,
        },
        {
          label: t('Cluster status'),
          getter: (r: { cluster: string }) => {
            const c = byName.get(r.cluster);
            if (!c) return '-';
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
          label: t('Score'),
          getter: (r: { score?: number }) => (r.score === undefined ? '-' : r.score),
        },
        { label: t('Group'), getter: (r: { group: string }) => r.group || '-' },
        {
          label: t('Decision'),
          getter: (r: { decision: string }) => (
            <ResourceRefLink
              kind="PlacementDecision"
              name={r.decision}
              namespace={placement.metadata.namespace}
            />
          ),
        },
      ]}
    />
  );
}

interface Consumer {
  kind: string;
  name: string;
  namespace?: string;
}

function PlacementConsumers({ placement }: { placement: PlacementJson }) {
  const { t } = useText();
  const ns = placement.metadata.namespace || '';
  const name = placement.metadata.name;
  const mwrs = useOcmList<ManifestWorkReplicaSetJson>('ManifestWorkReplicaSet', { namespace: ns });
  const subs = useOcmList<SubscriptionJson>('Subscription', { namespace: ns });
  const gitops = useOcmList<GitOpsClusterJson>('GitOpsCluster', { namespace: ns });
  const cmas = useOcmList<ClusterManagementAddOnJson>('ClusterManagementAddOn');
  const appsets = useOcmList<ArgoApplicationSetJson>('ApplicationSet', { namespace: ns });
  const bindings = useOcmList<PlacementBindingJson>('PlacementBinding', { namespace: ns });
  const loading = [mwrs, subs, gitops, cmas, appsets, bindings].some(
    l => l.items === null && !l.error
  );
  const consumers: Consumer[] = [
    ...(mwrs.items || [])
      .filter(m => (m.spec?.placementRefs || []).some(r => r.name === name))
      .map(m => ({ kind: 'ManifestWorkReplicaSet', name: m.metadata.name, namespace: ns })),
    ...(subs.items || [])
      .filter(s => {
        const ref = subscriptionPlacementRef(s);
        return ref?.kind === 'Placement' && ref.name === name && ref.namespace === ns;
      })
      .map(s => ({ kind: 'Subscription', name: s.metadata.name, namespace: ns })),
    ...(gitops.items || [])
      .filter(
        g =>
          g.spec?.placementRef?.name === name &&
          (g.spec.placementRef.kind || 'Placement') === 'Placement'
      )
      .map(g => ({ kind: 'GitOpsCluster', name: g.metadata.name, namespace: ns })),
    ...(cmas.items || [])
      .filter(c =>
        (c.spec?.installStrategy?.placements || []).some(p => p.name === name && p.namespace === ns)
      )
      .map(c => ({ kind: 'ClusterManagementAddOn', name: c.metadata.name })),
    ...(appsets.items || [])
      .filter(a => appSetPlacements(a).some(p => p.name === name))
      .map(a => ({ kind: 'ApplicationSet', name: a.metadata.name, namespace: ns })),
    ...bindingsOfPlacement(placement, bindings.items || []).map(b => ({
      kind: 'PlacementBinding',
      name: b.metadata.name,
      namespace: ns,
    })),
  ];
  return (
    <RelatedTable
      title={t('Used by')}
      items={loading ? null : consumers}
      what={t('workloads, subscriptions and add-ons')}
      emptyMessage={t('Nothing references this placement.')}
      columns={[
        { label: t('Kind'), getter: (c: Consumer) => c.kind },
        {
          label: t('Name'),
          getter: (c: Consumer) => (
            <ResourceRefLink kind={c.kind} name={c.name} namespace={c.namespace} />
          ),
        },
      ]}
    />
  );
}

function PlacementPreviewSection({ placement }: { placement: PlacementJson }) {
  const { t } = useText();
  return (
    <SectionBox title={t('Preview (client-side)')}>
      <PlacementPreviewPanel spec={placement.spec || {}} namespace={placement.metadata.namespace} />
    </SectionBox>
  );
}

function BoundSetsRules({ placement }: { placement: PlacementJson }) {
  const bindings = useOcmList<ManagedClusterSetBindingJson>('ManagedClusterSetBinding', {
    namespace: placement.metadata.namespace,
  });
  return (
    <PlacementRules
      placement={placement}
      bound={bindings.items ? boundSets(bindings.items, placement.metadata.namespace || '') : null}
    />
  );
}

export function PlacementDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('Placement')}
      extraInfo={item => {
        const j = item.jsonData as PlacementJson;
        return [
          { name: t('Status'), value: <PlacementStateLabel placement={j} /> },
          { name: t('Selected clusters'), value: j.status?.numberOfSelectedClusters ?? 0 },
          {
            name: t('Last score update'),
            value: j.status?.lastScoreUpdateTime ? (
              <DateLabel date={j.status.lastScoreUpdateTime} />
            ) : (
              '-'
            ),
            hide: !j.status?.lastScoreUpdateTime,
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as PlacementJson;
        return [
          { id: 'mch-rules', section: <BoundSetsRules placement={j} /> },
          { id: 'mch-decisions', section: <PlacementDecisions placement={j} /> },
          { id: 'mch-consumers', section: <PlacementConsumers placement={j} /> },
          { id: 'mch-preview', section: <PlacementPreviewSection placement={j} /> },
        ];
      }}
    />
  );
}

// ----- PlacementDecision -----

export function PlacementDecisionList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('PlacementDecision')}
      columns={[
        col<PlacementDecisionJson>(
          'placement',
          t('Placement'),
          j => placementOfDecision(j),
          j => {
            const p = placementOfDecision(j);
            return p ? (
              <ResourceRefLink kind="Placement" name={p} namespace={j.metadata.namespace} />
            ) : (
              '-'
            );
          }
        ),
        col<PlacementDecisionJson>(
          'clusters',
          t('Clusters'),
          j => decidedClusters([j]).join(', '),
          j => <StringArray items={decidedClusters([j])} />
        ),
      ]}
    />
  );
}

export function PlacementDecisionDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('PlacementDecision')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as PlacementDecisionJson;
        const p = placementOfDecision(j);
        return [
          {
            name: t('Placement'),
            value: p ? (
              <ResourceRefLink kind="Placement" name={p} namespace={j.metadata.namespace} />
            ) : (
              '-'
            ),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as PlacementDecisionJson;
        return [
          {
            id: 'mch-decisions',
            section: (
              <RelatedTable
                title={t('Decisions')}
                items={j.status?.decisions || []}
                what={t('decisions')}
                emptyMessage={t('No clusters in this decision.')}
                columns={[
                  {
                    label: t('Cluster'),
                    getter: (d: { clusterName: string }) => <ClusterLink name={d.clusterName} />,
                  },
                  { label: t('Reason'), getter: (d: { reason?: string }) => d.reason || '-' },
                  {
                    label: t('Score'),
                    getter: (d: { score?: number }) => (d.score === undefined ? '-' : d.score),
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

// ----- AddOnPlacementScore -----

export function AddOnPlacementScoreList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('AddOnPlacementScore')}
      columns={[
        col<AddOnPlacementScoreJson>(
          'cluster',
          t('Cluster'),
          j => j.metadata.namespace,
          j => (j.metadata.namespace ? <ClusterLink name={j.metadata.namespace} /> : '-')
        ),
        col<AddOnPlacementScoreJson>(
          'scores',
          t('Scores'),
          j => (j.status?.scores || []).map(s => `${s.name}=${s.value}`).join(', '),
          j => (
            <StringArray
              items={(j.status?.scores || []).map(s => `${s.name}=${s.value}`)}
              monospace
            />
          )
        ),
        col<AddOnPlacementScoreJson>(
          'valid',
          t('Valid until'),
          j => j.status?.validUntil,
          j => (j.status?.validUntil ? <DateLabel date={j.status.validUntil} format="mini" /> : '-')
        ),
      ]}
    />
  );
}

export function AddOnPlacementScoreDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('AddOnPlacementScore')}
      extraInfo={item => {
        const j = item.jsonData as AddOnPlacementScoreJson;
        return [
          {
            name: t('Cluster'),
            value: j.metadata.namespace ? <ClusterLink name={j.metadata.namespace} /> : '-',
          },
          {
            name: t('Scores'),
            value: (
              <StringArray
                items={(j.status?.scores || []).map(s => `${s.name}=${s.value}`)}
                monospace
              />
            ),
          },
          {
            name: t('Valid until'),
            value: j.status?.validUntil ? <DateLabel date={j.status.validUntil} /> : '-',
          },
        ];
      }}
    />
  );
}

// ----- PlacementRule (legacy) -----

export function PlacementRuleList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('PlacementRule')}
      columns={[
        col<PlacementRuleJson>('replicas', t('Replicas'), j => j.spec?.clusterReplicas ?? ''),
        col<PlacementRuleJson>(
          'decisions',
          t('Decisions'),
          j => (j.status?.decisions || []).map(d => d.clusterName).join(', '),
          j => <StringArray items={(j.status?.decisions || []).map(d => d.clusterName || '?')} />
        ),
      ]}
    />
  );
}

export function PlacementRuleDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('PlacementRule')}
      extraInfo={item => {
        const j = item.jsonData as PlacementRuleJson;
        return [
          {
            name: t('Cluster selector'),
            value: <SelectorView selector={j.spec?.clusterSelector} nilLabel={t('none')} />,
          },
          {
            name: t('Clusters'),
            value: <StringArray items={(j.spec?.clusters || []).map(c => c.name)} />,
          },
          { name: t('Cluster replicas'), value: j.spec?.clusterReplicas ?? '-' },
          {
            name: t('Cluster conditions'),
            value: (
              <StringArray
                items={(j.spec?.clusterConditions || []).map(c => `${c.type}=${c.status}`)}
              />
            ),
          },
          {
            name: t('Decisions'),
            value: (
              <Box>
                {(j.status?.decisions || []).map(d => (
                  <ClusterLink key={d.clusterName} name={d.clusterName || '?'} />
                ))}
              </Box>
            ),
          },
        ];
      }}
    />
  );
}
