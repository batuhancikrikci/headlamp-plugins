/**
 * ManifestWork and ManifestWorkReplicaSet forms. The work spec sections are shared: an MWRS
 * template is a ManifestWork spec.
 */
import { Box } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { YamlField } from '../../common/form/YamlField';
import { useText } from '../../common/i18n';
import { getIn, Path, setIn } from '../../common/objects';
import { useCapability } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import { ManagedClusterJson } from '../../resources/models/cluster';
import { KubeJson } from '../../resources/models/common';
import { PlacementJson } from '../../resources/models/placement';
import {
  ManifestConfig,
  ManifestWorkSpec,
  PROPAGATION_POLICIES,
  RolloutStrategy,
  UPDATE_STRATEGIES,
} from '../../resources/models/work';
import { CapabilityHint } from '../common/form/CapabilityHint';
import { MetadataFields } from '../common/form/MetadataFields';

const DOCS = 'https://open-cluster-management.io/docs/concepts/work-distribution/manifestwork/';

/** Sections editing a ManifestWork spec located at `path` inside `value`. */
export function WorkSpecSections({
  value,
  onChange,
  path,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  path: Path;
}) {
  const { t } = useText();
  const spec: ManifestWorkSpec = getIn(value, path) || {};
  const set = (sub: Path, v: unknown) => onChange(setIn(value, [...path, ...sub], v));
  const ttl = useCapability('workDeleteTTL');
  return (
    <>
      <FormSection
        title={t('Manifests')}
        icon="mdi:file-code-outline"
        description={t(
          'Kubernetes objects applied on the managed cluster, as YAML documents separated by "---". Namespaced objects need metadata.namespace.'
        )}
        docsUrl={DOCS}
      >
        <YamlField
          label={t('Manifests')}
          value={spec.workload?.manifests}
          onChange={v => set(['workload', 'manifests'], v)}
          expect="manifests"
          minRows={14}
        />
      </FormSection>
      <FormSection
        title={t('Update strategy per resource')}
        icon="mdi:update"
        description={t(
          'Optional: how the work agent updates individual resources (default Update).'
        )}
      >
        <ArrayEditor<ManifestConfig>
          items={spec.manifestConfigs}
          onChange={v => set(['manifestConfigs'], v)}
          newItem={() => ({
            resourceIdentifier: { group: '', resource: '', name: '', namespace: '' },
            updateStrategy: { type: 'ServerSideApply' },
          })}
          addLabel={t('Add resource configuration')}
          itemTitle={(c, i) =>
            c.resourceIdentifier.name
              ? `${c.resourceIdentifier.resource}/${c.resourceIdentifier.name}`
              : t('Resource {{n}}', { n: i + 1 })
          }
          renderItem={(c, update) => (
            <FieldGrid columns={3}>
              <TextInput
                label={t('API group')}
                value={c.resourceIdentifier.group}
                onChange={v => update(setIn(c, ['resourceIdentifier', 'group'], v ?? ''))}
                placeholder={t('empty = core')}
              />
              <TextInput
                label={t('Resource (plural)')}
                value={c.resourceIdentifier.resource}
                onChange={v => update(setIn(c, ['resourceIdentifier', 'resource'], v ?? ''))}
                placeholder="deployments"
                required
              />
              <TextInput
                label={t('Name')}
                value={c.resourceIdentifier.name}
                onChange={v => update(setIn(c, ['resourceIdentifier', 'name'], v ?? ''))}
                required
              />
              <TextInput
                label={t('Namespace')}
                value={c.resourceIdentifier.namespace}
                onChange={v => update(setIn(c, ['resourceIdentifier', 'namespace'], v ?? ''))}
              />
              <SelectInput
                label={t('Update strategy')}
                value={c.updateStrategy?.type}
                onChange={v =>
                  update(
                    setIn(
                      c,
                      ['updateStrategy'],
                      v ? { ...(c.updateStrategy || {}), type: v } : undefined
                    )
                  )
                }
                options={UPDATE_STRATEGIES.map(s => ({ value: s }))}
              />
              {c.updateStrategy?.type === 'ServerSideApply' && (
                <SwitchInput
                  label={t('Force apply')}
                  value={c.updateStrategy?.serverSideApply?.force}
                  onChange={v =>
                    update(setIn(c, ['updateStrategy', 'serverSideApply', 'force'], v))
                  }
                />
              )}
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection title={t('Deletion')} icon="mdi:delete-clock-outline">
        <FieldGrid columns={2}>
          <SelectInput
            label={t('Propagation policy')}
            value={spec.deleteOption?.propagationPolicy}
            onChange={v => set(['deleteOption', 'propagationPolicy'], v)}
            options={PROPAGATION_POLICIES.map(p => ({ value: p }))}
            emptyLabel="Foreground"
            help={t(
              'Foreground deletes the applied resources with the work; Orphan leaves them on the cluster.'
            )}
          />
          <Box>
            <CapabilityHint capability={ttl} />
            <NumberInput
              label={t('Delete after completion (seconds)')}
              value={spec.deleteOption?.ttlSecondsAfterFinished}
              onChange={v => set(['deleteOption', 'ttlSecondsAfterFinished'], v)}
              min={0}
              disabled={ttl.state === 'no'}
            />
          </Box>
        </FieldGrid>
      </FormSection>
      <FormSection
        title={t('Executor')}
        icon="mdi:account-cog-outline"
        description={t(
          'Optional: a service account on the managed cluster whose permissions the work agent uses.'
        )}
      >
        <FieldGrid columns={2}>
          <TextInput
            label={t('Service account namespace')}
            value={spec.executor?.subject?.serviceAccount?.namespace}
            onChange={v =>
              set(
                ['executor'],
                v || spec.executor?.subject?.serviceAccount?.name
                  ? {
                      subject: {
                        type: 'ServiceAccount',
                        serviceAccount: {
                          namespace: v || '',
                          name: spec.executor?.subject?.serviceAccount?.name || '',
                        },
                      },
                    }
                  : undefined
              )
            }
          />
          <TextInput
            label={t('Service account name')}
            value={spec.executor?.subject?.serviceAccount?.name}
            onChange={v =>
              set(
                ['executor'],
                v || spec.executor?.subject?.serviceAccount?.namespace
                  ? {
                      subject: {
                        type: 'ServiceAccount',
                        serviceAccount: {
                          name: v || '',
                          namespace: spec.executor?.subject?.serviceAccount?.namespace || '',
                        },
                      },
                    }
                  : undefined
              )
            }
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}

export function ManifestWorkForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        namespaceOptions={(clusters.items || []).map(c => c.metadata.name).sort()}
        namespaceHelp={t(
          'The namespace of a ManifestWork is the name of the target managed cluster.'
        )}
      />
      <WorkSpecSections value={value} onChange={onChange} path={['spec']} />
    </Box>
  );
}

/** Rollout strategy of one placement reference. */
export function RolloutEditor({
  value,
  onChange,
}: {
  value: RolloutStrategy | undefined;
  onChange: (v: RolloutStrategy | undefined) => void;
}) {
  const { t } = useText();
  const type = value?.type || 'All';
  const key =
    type === 'All' ? 'all' : type === 'Progressive' ? 'progressive' : 'progressivePerGroup';
  const body = (value?.[key as keyof RolloutStrategy] || {}) as Record<string, unknown>;
  const setBody = (field: string, v: unknown) =>
    onChange(setIn(value || { type }, [key, field], v));
  return (
    <FieldGrid columns={3}>
      <SelectInput
        label={t('Rollout')}
        value={type}
        onChange={v => onChange({ type: v || 'All' })}
        options={[
          { value: 'All', description: t('All selected clusters at once') },
          {
            value: 'Progressive',
            description: t('Cluster by cluster, limited by max concurrency'),
          },
          { value: 'ProgressivePerGroup', description: t('Decision group by decision group') },
        ]}
        allowEmpty={false}
      />
      {type === 'Progressive' && (
        <TextInput
          label={t('Max concurrency')}
          value={body.maxConcurrency?.toString()}
          onChange={v => setBody('maxConcurrency', v)}
          placeholder="25%"
        />
      )}
      <TextInput
        label={t('Max failures')}
        value={body.maxFailures?.toString()}
        onChange={v => setBody('maxFailures', v)}
        placeholder="0"
      />
      <TextInput
        label={t('Progress deadline')}
        value={body.progressDeadline as string}
        onChange={v => setBody('progressDeadline', v)}
        placeholder="None"
        help={t('e.g. 10m; None waits forever.')}
      />
      <TextInput
        label={t('Minimum success time')}
        value={body.minSuccessTime as string}
        onChange={v => setBody('minSuccessTime', v)}
        placeholder="0"
        help={t('Soak time before the next step, e.g. 5m.')}
      />
    </FieldGrid>
  );
}

export function ManifestWorkReplicaSetForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const placements = useOcmList<PlacementJson>('Placement', {
    namespace: value.metadata?.namespace,
    enabled: !!value.metadata?.namespace,
  });
  const cascade = useCapability('mwrsCascadeDeletion');
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection
        title={t('Placements')}
        icon="mdi:target"
        description={t(
          'A ManifestWork is created in the namespace of every cluster the placements select.'
        )}
        docsUrl="https://open-cluster-management.io/docs/concepts/work-distribution/manifestworkreplicaset/"
      >
        <ArrayEditor<{ name: string; rolloutStrategy?: RolloutStrategy }>
          items={value.spec?.placementRefs}
          onChange={v => onChange(setIn(value, ['spec', 'placementRefs'], v))}
          newItem={() => ({ name: '', rolloutStrategy: { type: 'All' } })}
          addLabel={t('Add placement')}
          itemTitle={(r, i) => r.name || t('Placement {{n}}', { n: i + 1 })}
          renderItem={(r, update) => (
            <Box>
              <Box sx={{ mb: 2, maxWidth: 420 }}>
                <SelectInput
                  label={t('Placement')}
                  value={r.name || undefined}
                  onChange={v => update({ ...r, name: v || '' })}
                  options={(placements.items || []).map(p => p.metadata.name).sort()}
                  allowEmpty={false}
                  required
                />
              </Box>
              <RolloutEditor
                value={r.rolloutStrategy}
                onChange={v => update({ ...r, rolloutStrategy: v })}
              />
            </Box>
          )}
        />
        <Box sx={{ mt: 2, maxWidth: 420 }}>
          <CapabilityHint capability={cascade} />
          <SelectInput
            {...bind<string>(['spec', 'cascadeDeletionPolicy'])}
            label={t('Cascade deletion policy')}
            options={['Background', 'Foreground']}
            emptyLabel={t('Default (Background)')}
            disabled={cascade.state === 'no'}
            help={t('Foreground keeps the replica set until its ManifestWorks are deleted.')}
          />
        </Box>
      </FormSection>
      <WorkSpecSections value={value} onChange={onChange} path={['spec', 'manifestWorkTemplate']} />
    </Box>
  );
}
