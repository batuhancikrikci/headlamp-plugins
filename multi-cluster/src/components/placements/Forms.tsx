/**
 * Placement form. The sections are exported for the placement wizard and the other wizards that
 * create a placement on the way.
 */
import { Alert, Box, Chip, Typography } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  StringListInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { getIn, setIn } from '../../common/objects';
import { useCapability } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import {
  boundSets,
  ManagedClusterJson,
  ManagedClusterSetBindingJson,
  ManagedClusterSetJson,
  selectorSuggestions,
} from '../../resources/models/cluster';
import { KubeJson } from '../../resources/models/common';
import {
  BUILTIN_PRIORITIZERS,
  ClusterPredicate,
  PlacementSpec,
  PrioritizerConfig,
  SpreadConstraint,
  Toleration,
} from '../../resources/models/placement';
import { CapabilityHint } from '../common/form/CapabilityHint';
import { MetadataFields } from '../common/form/MetadataFields';
import { ClaimSelectorEditor, LabelSelectorEditor } from '../common/form/SelectorEditor';

const DOCS = 'https://open-cluster-management.io/docs/concepts/content-placement/placement/';

/** Label keys and claim names of the visible clusters, for the selector editors. */
export function useSelectorSuggestions() {
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  return React.useMemo(() => selectorSuggestions(clusters.items || []), [clusters.items]);
}

/** Cluster set choice with a binding check against the placement namespace. */
export function ClusterSetsSection({
  namespace,
  value,
  onChange,
}: {
  namespace?: string;
  value: string[] | undefined;
  onChange: (sets: string[] | undefined) => void;
}) {
  const { t } = useText();
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const bindings = useOcmList<ManagedClusterSetBindingJson>('ManagedClusterSetBinding', {
    namespace,
    enabled: !!namespace,
  });
  const bound = namespace && bindings.items ? boundSets(bindings.items, namespace) : [];
  const names = (sets.items || []).map(s => s.metadata.name).sort();
  const unbound = (value || []).filter(s => !bound.includes(s));
  return (
    <FormSection
      title={t('Cluster sets')}
      icon="mdi:select-group"
      description={t(
        'The placement selects clusters from these sets. Leave empty to use every set bound to the namespace.'
      )}
      docsUrl={DOCS}
    >
      <StringListInput
        label={t('Cluster sets')}
        value={value}
        onChange={onChange}
        suggestions={names}
        placeholder={t('All bound sets')}
      />
      {namespace && (
        <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            {t('Bound to {{ns}}:', { ns: namespace })}
          </Typography>
          {bound.length === 0 ? (
            <Typography variant="caption" color="warning.main">
              {t('none')}
            </Typography>
          ) : (
            bound.map(s => (
              <Chip key={s} size="small" label={s} color="success" variant="outlined" />
            ))
          )}
        </Box>
      )}
      {unbound.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {t(
            'Not bound to {{ns}}: {{sets}}. Create a ManagedClusterSetBinding for each (the placement wizard can do it), otherwise the placement is misconfigured.',
            {
              ns: namespace || '?',
              sets: unbound.join(', '),
            }
          )}
        </Alert>
      )}
    </FormSection>
  );
}

export function PredicatesSection({
  value,
  onChange,
}: {
  value: ClusterPredicate[] | undefined;
  onChange: (v: ClusterPredicate[] | undefined) => void;
}) {
  const { t } = useText();
  const suggestions = useSelectorSuggestions();
  const cel = useCapability('placementCelSelector');
  return (
    <FormSection
      title={t('Predicates')}
      icon="mdi:filter-variant"
      description={t(
        'A cluster is selected when it matches any predicate. Inside a predicate, labels and claims must both match.'
      )}
    >
      <ArrayEditor<ClusterPredicate>
        items={value}
        onChange={onChange}
        newItem={() => ({ requiredClusterSelector: { labelSelector: { matchLabels: {} } } })}
        addLabel={t('Add predicate')}
        itemTitle={(_, i) => t('Predicate {{n}}', { n: i + 1 })}
        emptyText={t('No predicates: every cluster of the eligible sets is selected.')}
        renderItem={(p, update) => {
          const rcs = p.requiredClusterSelector || {};
          const set = (key: 'labelSelector' | 'claimSelector' | 'celSelector', v: unknown) =>
            update(setIn(p, ['requiredClusterSelector', key], v));
          return (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('Cluster labels')}
              </Typography>
              <LabelSelectorEditor
                value={rcs.labelSelector}
                onChange={v => set('labelSelector', v)}
                keySuggestions={suggestions.labels}
              />
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                {t('Cluster claims')}
              </Typography>
              <ClaimSelectorEditor
                value={rcs.claimSelector}
                onChange={v => set('claimSelector', v)}
                claimSuggestions={suggestions.claims}
              />
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                {t('CEL expressions')}
              </Typography>
              <CapabilityHint capability={cel} />
              <StringListInput
                label={t('CEL expressions')}
                value={rcs.celSelector?.celExpressions}
                onChange={v => set('celSelector', v ? { celExpressions: v } : undefined)}
                disabled={cel.state === 'no'}
                placeholder="managedCluster.status.version.kubernetes == 'v1.30.0'"
              />
            </Box>
          );
        }}
      />
    </FormSection>
  );
}

export function PrioritizersSection({
  value,
  onChange,
}: {
  value: PlacementSpec;
  onChange: (v: PlacementSpec) => void;
}) {
  const { t } = useText();
  const policy = value.prioritizerPolicy || {};
  return (
    <FormSection
      title={t('Prioritizers')}
      icon="mdi:sort-numeric-descending"
      description={t(
        'Scores rank clusters when the number of clusters is limited. Weights range from -10 to 10.'
      )}
    >
      <Box sx={{ maxWidth: 320, mb: 2 }}>
        <SelectInput
          label={t('Mode')}
          value={policy.mode}
          onChange={v => onChange(setIn(value, ['prioritizerPolicy', 'mode'], v))}
          options={[
            {
              value: 'Additive',
              description: t('Configured prioritizers are added to the default ones'),
            },
            { value: 'Exact', description: t('Only the configured prioritizers are used') },
          ]}
          emptyLabel="Additive"
        />
      </Box>
      <ArrayEditor<PrioritizerConfig>
        items={policy.configurations}
        onChange={v => onChange(setIn(value, ['prioritizerPolicy', 'configurations'], v))}
        newItem={() => ({ scoreCoordinate: { type: 'BuiltIn', builtIn: 'Steady' }, weight: 1 })}
        addLabel={t('Add prioritizer')}
        itemTitle={(c, i) =>
          c.scoreCoordinate.builtIn ||
          c.scoreCoordinate.addOn?.resourceName ||
          t('Prioritizer {{n}}', { n: i + 1 })
        }
        renderItem={(c, update) => (
          <FieldGrid columns={3}>
            <SelectInput
              label={t('Type')}
              value={c.scoreCoordinate.type}
              onChange={type =>
                update({
                  ...c,
                  scoreCoordinate:
                    type === 'AddOn'
                      ? { type: 'AddOn', addOn: { resourceName: '', scoreName: '' } }
                      : { type: 'BuiltIn', builtIn: 'Steady' },
                })
              }
              options={['BuiltIn', 'AddOn']}
              allowEmpty={false}
            />
            {c.scoreCoordinate.type === 'AddOn' ? (
              <>
                <TextInput
                  label={t('AddOnPlacementScore name')}
                  value={c.scoreCoordinate.addOn?.resourceName}
                  onChange={v =>
                    update(setIn(c, ['scoreCoordinate', 'addOn', 'resourceName'], v || ''))
                  }
                  required
                />
                <TextInput
                  label={t('Score name')}
                  value={c.scoreCoordinate.addOn?.scoreName}
                  onChange={v =>
                    update(setIn(c, ['scoreCoordinate', 'addOn', 'scoreName'], v || ''))
                  }
                  required
                />
              </>
            ) : (
              <SelectInput
                label={t('Built-in prioritizer')}
                value={c.scoreCoordinate.builtIn}
                onChange={v => update(setIn(c, ['scoreCoordinate', 'builtIn'], v))}
                options={BUILTIN_PRIORITIZERS.map(p => ({ value: p }))}
                allowEmpty={false}
              />
            )}
            <NumberInput
              label={t('Weight')}
              value={c.weight}
              onChange={v => update({ ...c, weight: v })}
              min={-10}
              max={10}
              placeholder="1"
            />
          </FieldGrid>
        )}
      />
    </FormSection>
  );
}

export function TolerationsSection({
  value,
  onChange,
}: {
  value: Toleration[] | undefined;
  onChange: (v: Toleration[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <FormSection
      title={t('Tolerations')}
      icon="mdi:shield-half-full"
      description={t(
        'Allow clusters with matching taints, e.g. cluster.open-cluster-management.io/unreachable to keep decisions while a cluster is offline.'
      )}
    >
      <ArrayEditor<Toleration>
        items={value}
        onChange={onChange}
        newItem={() => ({ key: '', operator: 'Exists' })}
        addLabel={t('Add toleration')}
        itemTitle={(tl, i) => tl.key || t('Toleration {{n}}', { n: i + 1 })}
        renderItem={(tl, update) => (
          <FieldGrid columns={3}>
            <TextInput
              label={t('Key')}
              value={tl.key}
              onChange={v => update({ ...tl, key: v })}
              placeholder={t('empty = any key')}
            />
            <SelectInput
              label={t('Operator')}
              value={tl.operator}
              onChange={v =>
                update({ ...tl, operator: v, ...(v === 'Exists' ? { value: undefined } : {}) })
              }
              options={['Equal', 'Exists']}
              emptyLabel="Equal"
            />
            <TextInput
              label={t('Value')}
              value={tl.value}
              onChange={v => update({ ...tl, value: v })}
              disabled={tl.operator === 'Exists'}
            />
            <SelectInput
              label={t('Effect')}
              value={tl.effect}
              onChange={v => update({ ...tl, effect: v })}
              options={['NoSelect', 'PreferNoSelect', 'NoSelectIfNew']}
              emptyLabel={t('Any effect')}
            />
            <NumberInput
              label={t('Toleration seconds')}
              value={tl.tolerationSeconds}
              onChange={v => update({ ...tl, tolerationSeconds: v })}
              min={0}
              help={t('How long the toleration lasts after the taint was added; empty = forever.')}
            />
          </FieldGrid>
        )}
      />
    </FormSection>
  );
}

export function SpreadSection({
  value,
  onChange,
}: {
  value: SpreadConstraint[] | undefined;
  onChange: (v: SpreadConstraint[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <FormSection
      title={t('Spread')}
      icon="mdi:arrow-split-vertical"
      description={t(
        'Spread decisions evenly across a topology (label or claim), up to 8 constraints.'
      )}
    >
      <ArrayEditor<SpreadConstraint>
        items={value}
        onChange={onChange}
        max={8}
        newItem={() => ({
          topologyKey: '',
          topologyKeyType: 'Label',
          maxSkew: 1,
          whenUnsatisfiable: 'ScheduleAnyway',
        })}
        addLabel={t('Add spread constraint')}
        itemTitle={(c, i) => c.topologyKey || t('Constraint {{n}}', { n: i + 1 })}
        renderItem={(c, update) => (
          <FieldGrid columns={2}>
            <TextInput
              label={t('Topology key')}
              value={c.topologyKey}
              onChange={v => update({ ...c, topologyKey: v || '' })}
              required
            />
            <SelectInput
              label={t('Key type')}
              value={c.topologyKeyType}
              onChange={v => update({ ...c, topologyKeyType: v || 'Label' })}
              options={['Label', 'Claim']}
              allowEmpty={false}
            />
            <NumberInput
              label={t('Max skew')}
              value={c.maxSkew}
              onChange={v => update({ ...c, maxSkew: v })}
              min={1}
            />
            <SelectInput
              label={t('When unsatisfiable')}
              value={c.whenUnsatisfiable}
              onChange={v => update({ ...c, whenUnsatisfiable: v })}
              options={['ScheduleAnyway', 'DoNotSchedule']}
              emptyLabel="ScheduleAnyway"
            />
          </FieldGrid>
        )}
      />
    </FormSection>
  );
}

export function SelectionLimitsSection({
  value,
  onChange,
}: {
  value: PlacementSpec;
  onChange: (v: PlacementSpec) => void;
}) {
  const { t } = useText();
  const sortBy = useCapability('placementSortBy');
  const rate = useCapability('placementScoreRateLimit');
  return (
    <FormSection title={t('Number of clusters and decision groups')} icon="mdi:counter">
      <FieldGrid columns={2}>
        <NumberInput
          label={t('Number of clusters')}
          value={value.numberOfClusters}
          onChange={v => onChange(setIn(value, ['numberOfClusters'], v))}
          min={0}
          placeholder={t('all matching')}
          help={t('The scheduler picks the highest scoring clusters up to this number.')}
        />
        <TextInput
          label={t('Clusters per decision group')}
          value={getIn<string | number>(value, [
            'decisionStrategy',
            'groupStrategy',
            'clustersPerDecisionGroup',
          ])?.toString()}
          onChange={v =>
            onChange(
              setIn(
                value,
                ['decisionStrategy', 'groupStrategy', 'clustersPerDecisionGroup'],
                v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : v
              )
            )
          }
          placeholder="100%"
          help={t(
            'Number or percentage; used by progressive rollouts of ManifestWorkReplicaSets and add-ons.'
          )}
        />
      </FieldGrid>
      {(sortBy.state !== 'no' || rate.state !== 'no') && (
        <Box sx={{ mt: 2 }}>
          <CapabilityHint capability={sortBy} />
          <FieldGrid columns={2}>
            <SelectInput
              label={t('Sort decisions by')}
              value={value.sortBy}
              onChange={v => onChange(setIn(value, ['sortBy'], v))}
              options={['ClusterName', 'Score']}
              emptyLabel="ClusterName"
              disabled={sortBy.state === 'no'}
            />
            <TextInput
              label={t('Score rate limit')}
              value={value.scoreRateLimit}
              onChange={v => onChange(setIn(value, ['scoreRateLimit'], v))}
              placeholder="1m"
              disabled={rate.state === 'no'}
              help={t('Minimum interval between recorded score updates, e.g. 30s, 5m.')}
            />
          </FieldGrid>
        </Box>
      )}
    </FormSection>
  );
}

/** Edits `spec` of a Placement-shaped object through the sections above. */
export function PlacementSpecSections({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const spec: PlacementSpec = value.spec || {};
  const setSpec = (next: PlacementSpec) => onChange({ ...value, spec: next });
  return (
    <>
      <ClusterSetsSection
        namespace={value.metadata?.namespace}
        value={spec.clusterSets}
        onChange={v => setSpec(setIn(spec, ['clusterSets'], v))}
      />
      <PredicatesSection
        value={spec.predicates}
        onChange={v => setSpec(setIn(spec, ['predicates'], v))}
      />
      <SelectionLimitsSection value={spec} onChange={setSpec} />
      <PrioritizersSection value={spec} onChange={setSpec} />
      <TolerationsSection
        value={spec.tolerations}
        onChange={v => setSpec(setIn(spec, ['tolerations'], v))}
      />
      <SpreadSection
        value={spec.spreadPolicy?.spreadConstraints}
        onChange={v => setSpec(setIn(spec, ['spreadPolicy', 'spreadConstraints'], v))}
      />
    </>
  );
}

export function PlacementForm({ value, onChange, mode }: ResourceFormProps) {
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <PlacementSpecSections value={value} onChange={onChange} />
    </Box>
  );
}

export function PlacementRuleForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const suggestions = useSelectorSuggestions();
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('PlacementRule is a legacy API. Prefer a Placement for new subscriptions.')}
      </Alert>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection title={t('Cluster selection')} icon="mdi:target-variant">
        <LabelSelectorEditor
          {...bind(['spec', 'clusterSelector'])}
          keySuggestions={suggestions.labels}
        />
        <Box sx={{ mt: 2 }}>
          <FieldGrid>
            <StringListInput
              label={t('Explicit clusters')}
              value={(value.spec?.clusters || []).map((c: { name: string }) => c.name)}
              onChange={v =>
                onChange(
                  setIn(
                    value,
                    ['spec', 'clusters'],
                    v?.map(name => ({ name }))
                  )
                )
              }
              suggestions={(clusters.items || []).map(c => c.metadata.name)}
            />
            <NumberInput
              {...bind<number>(['spec', 'clusterReplicas'])}
              label={t('Cluster replicas')}
              min={0}
              placeholder={t('all')}
            />
          </FieldGrid>
        </Box>
      </FormSection>
    </Box>
  );
}
