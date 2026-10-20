/**
 * Forms for ManagedCluster, ManagedClusterSet, ManagedClusterSetBinding, ClusterClaim and
 * ClusterProperty.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { useCapability } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import {
  CLUSTER_SET_LABEL,
  ManagedClusterJson,
  ManagedClusterSetJson,
  setSelectorType,
  Taint,
} from '../../resources/models/cluster';
import { KubeJson } from '../../resources/models/common';
import { CapabilityHint } from '../common/form/CapabilityHint';
import { MetadataFields } from '../common/form/MetadataFields';
import { LabelSelectorEditor } from '../common/form/SelectorEditor';

/** Cluster set picker that writes the cluster set label. */
export function ClusterSetLabelField({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const options = (sets.items || [])
    .filter(s => setSelectorType(s) === 'ExclusiveClusterSetLabel')
    .map(s => s.metadata.name)
    .sort();
  return (
    <SelectInput
      label={t('Cluster set')}
      value={value.metadata?.labels?.[CLUSTER_SET_LABEL]}
      onChange={v => onChange(setIn(value, ['metadata', 'labels', CLUSTER_SET_LABEL], v))}
      options={options}
      emptyLabel={t('No cluster set')}
      help={t(
        'Writes the label cluster.open-cluster-management.io/clusterset. Requires the managedclustersets/join permission.'
      )}
    />
  );
}

export function TaintsEditor({
  value,
  onChange,
}: {
  value: Taint[] | undefined;
  onChange: (v: Taint[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <ArrayEditor<Taint>
      items={value}
      onChange={onChange}
      newItem={() => ({ key: '', effect: 'NoSelect' })}
      addLabel={t('Add taint')}
      itemTitle={(taint, i) => taint.key || t('Taint {{n}}', { n: i + 1 })}
      emptyText={t(
        'No taints. Taints keep placements from selecting the cluster unless they tolerate them.'
      )}
      renderItem={(taint, update) => (
        <FieldGrid columns={3}>
          <TextInput
            label={t('Key')}
            value={taint.key}
            onChange={v => update({ ...taint, key: v || '' })}
            required
          />
          <TextInput
            label={t('Value')}
            value={taint.value}
            onChange={v => update({ ...taint, value: v })}
          />
          <SelectInput
            label={t('Effect')}
            value={taint.effect}
            onChange={v => update({ ...taint, effect: v || 'NoSelect' })}
            options={[
              {
                value: 'NoSelect',
                description: t('Not selected by placements without a toleration'),
              },
              { value: 'PreferNoSelect', description: t('Avoided by placements when possible') },
              {
                value: 'NoSelectIfNew',
                description: t('Not selected by new decisions; existing ones stay'),
              },
            ]}
            allowEmpty={false}
          />
        </FieldGrid>
      )}
    />
  );
}

export function ManagedClusterForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value as ManagedClusterJson, onChange);
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        nameHelp={t(
          'Must be a DNS label: the hub creates a namespace with this name for the cluster.'
        )}
      />
      <FormSection title={t('Registration')} icon="mdi:handshake-outline">
        <FieldGrid>
          <SwitchInput
            {...bind<boolean>(['spec', 'hubAcceptsClient'])}
            label={t('Hub accepts the cluster')}
            keepFalse
            help={t('When off, the agent cannot register even with an approved CSR.')}
          />
          <NumberInput
            {...bind<number>(['spec', 'leaseDurationSeconds'])}
            label={t('Lease duration (seconds)')}
            min={1}
            placeholder="60"
            help={t(
              'How often the agent renews its lease; the cluster turns Unknown after missing a few renewals.'
            )}
          />
          <ClusterSetLabelField value={value} onChange={onChange} />
        </FieldGrid>
      </FormSection>
      <FormSection
        title={t('API server')}
        icon="mdi:api"
        description={t(
          'Optional: how the hub (and add-ons such as cluster-proxy) reach the managed cluster API server.'
        )}
      >
        <StringListInput
          label={t('API server URLs')}
          value={(value.spec?.managedClusterClientConfigs || []).map((c: { url: string }) => c.url)}
          onChange={urls =>
            onChange(
              setIn(
                value,
                ['spec', 'managedClusterClientConfigs'],
                urls?.map(url => {
                  const existing = (value.spec?.managedClusterClientConfigs || []).find(
                    (c: { url: string }) => c.url === url
                  );
                  return existing || { url };
                })
              )
            )
          }
          placeholder="https://api.example.com:6443"
          validateItem={u => /^https?:\/\//.test(u)}
        />
      </FormSection>
      <FormSection title={t('Taints')} icon="mdi:alert-octagon-outline">
        <TaintsEditor {...bind<Taint[]>(['spec', 'taints'])} />
      </FormSection>
    </Box>
  );
}

export function ManagedClusterSetForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value as ManagedClusterSetJson, onChange);
  const managedNs = useCapability('clusterSetManagedNamespaces');
  const type = setSelectorType(value as ManagedClusterSetJson);
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection title={t('Membership')} icon="mdi:select-group">
        <SelectInput
          label={t('Selector type')}
          value={type}
          onChange={v => {
            let next = setIn(value, ['spec', 'clusterSelector', 'selectorType'], v);
            if (v !== 'LabelSelector')
              next = setIn(next, ['spec', 'clusterSelector', 'labelSelector'], undefined);
            else if (!next.spec?.clusterSelector?.labelSelector)
              next = setIn(next, ['spec', 'clusterSelector', 'labelSelector'], {});
            onChange(next);
          }}
          options={[
            {
              value: 'ExclusiveClusterSetLabel',
              description: t(
                'Clusters labelled cluster.open-cluster-management.io/clusterset=<this set>; a cluster belongs to one such set'
              ),
            },
            {
              value: 'LabelSelector',
              description: t(
                'Clusters matching a label selector; an empty selector selects every cluster'
              ),
            },
          ]}
          allowEmpty={false}
          disabled={mode === 'edit'}
          helperText={
            mode === 'edit' ? t('The selector type cannot be changed after creation.') : undefined
          }
        />
        {type === 'LabelSelector' && (
          <Box sx={{ mt: 2 }}>
            <LabelSelectorEditor {...bind(['spec', 'clusterSelector', 'labelSelector'])} />
          </Box>
        )}
      </FormSection>
      <FormSection
        title={t('Managed namespaces')}
        icon="mdi:folder-network-outline"
        description={t('Namespaces created on every cluster of the set (OCM v1.1.0 and later).')}
      >
        <CapabilityHint capability={managedNs} />
        <StringListInput
          label={t('Namespaces')}
          value={(value.spec?.managedNamespaces || []).map((n: { name: string }) => n.name)}
          onChange={names =>
            onChange(
              setIn(
                value,
                ['spec', 'managedNamespaces'],
                names?.map(name => ({ name }))
              )
            )
          }
          disabled={managedNs.state === 'no'}
        />
      </FormSection>
    </Box>
  );
}

export function ManagedClusterSetBindingForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        showLabels={false}
        nameHelp={t('Set automatically from the cluster set.')}
        namespaceHelp={t('Placements in this namespace may use the set.')}
      />
      <FormSection title={t('Cluster set')} icon="mdi:link-variant">
        <SelectInput
          label={t('Cluster set to bind')}
          value={value.spec?.clusterSet || undefined}
          onChange={v => {
            // The binding must be named after the set.
            let next = setIn(value, ['spec', 'clusterSet'], v || '');
            if (mode === 'create') next = setIn(next, ['metadata', 'name'], v || '');
            onChange(next);
          }}
          options={(sets.items || []).map(s => s.metadata.name).sort()}
          allowEmpty={false}
          disabled={mode === 'edit'}
          required
        />
        <Alert severity="info" sx={{ mt: 2 }}>
          {t(
            'Creating a binding requires the "create" permission on the managedclustersets/bind subresource of the set.'
          )}
        </Alert>
      </FormSection>
    </Box>
  );
}

/** ClusterClaim and ClusterProperty: a cluster-scoped name/value pair. */
export function ValueForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        nameHelp={t(
          'Well-known claims use names such as id.k8s.io or platform.open-cluster-management.io.'
        )}
      />
      <FormSection title={t('Value')} icon="mdi:tag-text-outline">
        <TextInput {...bind<string>(['spec', 'value'])} label={t('Value')} required />
      </FormSection>
    </Box>
  );
}
