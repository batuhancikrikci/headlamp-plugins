/**
 * ClusterManagementAddOn, ManagedClusterAddOn and AddOnDeploymentConfig forms. The add-on forms
 * edit a version-neutral list of configurations and write the shape of the served version.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  ComboInput,
  FieldGrid,
  FormSection,
  SelectInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import {
  ADDON_DEPLOYMENT_CONFIG_RESOURCE,
  AddOnConfigRef,
  ClusterManagementAddOnJson,
  defaultConfigs,
  InstallPlacement,
  isV1beta1,
  withDefaultConfigs,
} from '../../resources/models/addon';
import { KubeJson } from '../../resources/models/common';
import { MetadataFields } from '../common/form/MetadataFields';
import { KeyValueEditor } from '../common/form/SelectorEditor';
import { RolloutEditor } from '../workloads/Forms';

const DOCS = 'https://open-cluster-management.io/docs/concepts/add-on-extensibility/addon/';

/** Editor for add-on configuration references (group, resource, name, namespace). */
export function ConfigRefsEditor({
  value,
  onChange,
  requireName,
  emptyText,
}: {
  value: AddOnConfigRef[] | undefined;
  onChange: (v: AddOnConfigRef[] | undefined) => void;
  requireName: boolean;
  emptyText?: string;
}) {
  const { t } = useText();
  const configs = useOcmList<KubeJson>('AddOnDeploymentConfig');
  return (
    <ArrayEditor<AddOnConfigRef>
      items={value}
      onChange={onChange}
      newItem={() => ({ ...ADDON_DEPLOYMENT_CONFIG_RESOURCE, name: '', namespace: '' })}
      addLabel={t('Add configuration')}
      itemTitle={(c, i) =>
        c.name ? `${c.resource}: ${c.name}` : t('Configuration {{n}}', { n: i + 1 })
      }
      emptyText={emptyText}
      renderItem={(c, update) => {
        const isADC = c.resource === ADDON_DEPLOYMENT_CONFIG_RESOURCE.resource;
        return (
          <FieldGrid columns={2}>
            <TextInput
              label={t('API group')}
              value={c.group}
              onChange={v => update({ ...c, group: v })}
            />
            <TextInput
              label={t('Resource (plural)')}
              value={c.resource}
              onChange={v => update({ ...c, resource: v || '' })}
              required
            />
            {isADC ? (
              <ComboInput
                label={t('AddOnDeploymentConfig')}
                value={c.name && c.namespace ? `${c.namespace}/${c.name}` : c.name}
                onChange={v => {
                  const [ns, name] = (v || '').includes('/')
                    ? (v || '').split('/')
                    : [c.namespace, v];
                  update({ ...c, name: name || undefined, namespace: ns || undefined });
                }}
                options={(configs.items || []).map(
                  a => `${a.metadata.namespace}/${a.metadata.name}`
                )}
                required={requireName}
              />
            ) : (
              <TextInput
                label={t('Name')}
                value={c.name}
                onChange={v => update({ ...c, name: v })}
                required={requireName}
              />
            )}
            {!isADC && (
              <TextInput
                label={t('Namespace')}
                value={c.namespace}
                onChange={v => update({ ...c, namespace: v })}
              />
            )}
          </FieldGrid>
        );
      }}
    />
  );
}

export function ClusterManagementAddOnForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value as ClusterManagementAddOnJson, onChange);
  const beta = isV1beta1(value.apiVersion);
  const namespaces = useNamespaceNames();
  const strategy = value.spec?.installStrategy?.type || 'Manual';
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        nameHelp={t('The add-on name; ManagedClusterAddOns use the same name.')}
      />
      <FormSection
        title={t('Display')}
        icon="mdi:puzzle-outline"
        docsUrl={DOCS}
        description={t('How the add-on is presented.')}
      >
        <FieldGrid columns={2}>
          <TextInput
            {...bind<string>(['spec', 'addOnMeta', 'displayName'])}
            label={t('Display name')}
          />
          <TextInput
            {...bind<string>(['spec', 'addOnMeta', 'description'])}
            label={t('Description')}
          />
        </FieldGrid>
      </FormSection>
      <FormSection
        title={beta ? t('Default configurations') : t('Supported configurations')}
        icon="mdi:tune-variant"
        description={
          beta
            ? t(
                'addon v1beta1: default configurations applied to every installation (each needs a name).'
              )
            : t(
                'addon v1alpha1: configuration types the add-on supports, optionally with a default object.'
              )
        }
      >
        <ConfigRefsEditor
          value={defaultConfigs(value as ClusterManagementAddOnJson)}
          onChange={v => onChange(withDefaultConfigs(value as ClusterManagementAddOnJson, v || []))}
          requireName={beta}
        />
      </FormSection>
      <FormSection
        title={t('Install strategy')}
        icon="mdi:download-network-outline"
        description={t(
          'Manual: install per cluster by creating ManagedClusterAddOns. Placements: the add-on manager installs it on every cluster the placements select.'
        )}
      >
        <Box sx={{ maxWidth: 320, mb: 2 }}>
          <SelectInput
            {...bind<string>(['spec', 'installStrategy', 'type'])}
            label={t('Strategy')}
            options={['Manual', 'Placements']}
            allowEmpty={false}
          />
        </Box>
        {strategy === 'Placements' && (
          <ArrayEditor<InstallPlacement>
            items={value.spec?.installStrategy?.placements}
            onChange={v => onChange(setIn(value, ['spec', 'installStrategy', 'placements'], v))}
            newItem={() => ({ name: '', namespace: '', rolloutStrategy: { type: 'All' } })}
            addLabel={t('Add placement')}
            itemTitle={(p, i) =>
              p.name ? `${p.namespace}/${p.name}` : t('Placement {{n}}', { n: i + 1 })
            }
            renderItem={(p, update) => (
              <Box>
                <FieldGrid columns={2}>
                  <ComboInput
                    label={t('Namespace')}
                    value={p.namespace}
                    onChange={v => update({ ...p, namespace: v || '' })}
                    options={namespaces}
                    required
                  />
                  <TextInput
                    label={t('Placement name')}
                    value={p.name}
                    onChange={v => update({ ...p, name: v || '' })}
                    required
                  />
                </FieldGrid>
                <Box sx={{ mt: 2 }}>
                  <RolloutEditor
                    value={p.rolloutStrategy}
                    onChange={v => update({ ...p, rolloutStrategy: v })}
                  />
                </Box>
              </Box>
            )}
          />
        )}
      </FormSection>
    </Box>
  );
}

export function ManagedClusterAddOnForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const clusters = useOcmList<KubeJson>('ManagedCluster');
  const addons = useOcmList<ClusterManagementAddOnJson>('ClusterManagementAddOn');
  const beta = isV1beta1(value.apiVersion);
  return (
    <Box>
      <FormSection
        title={t('Add-on and cluster')}
        icon="mdi:puzzle-check-outline"
        docsUrl={DOCS}
        description={t(
          'A ManagedClusterAddOn installs an add-on on one cluster: its name is the add-on name and its namespace the cluster name.'
        )}
      >
        <FieldGrid columns={2}>
          <SelectInput
            {...bind<string>(['metadata', 'name'])}
            label={t('Add-on')}
            options={(addons.items || []).map(a => a.metadata.name).sort()}
            allowEmpty={false}
            disabled={mode === 'edit'}
            required
          />
          <SelectInput
            {...bind<string>(['metadata', 'namespace'])}
            label={t('Cluster')}
            options={(clusters.items || []).map(c => c.metadata.name).sort()}
            allowEmpty={false}
            disabled={mode === 'edit'}
            required
          />
        </FieldGrid>
      </FormSection>
      <FormSection
        title={t('Configurations')}
        icon="mdi:tune-variant"
        description={t('Override the default configurations of the add-on for this cluster.')}
      >
        <ConfigRefsEditor {...bind<AddOnConfigRef[]>(['spec', 'configs'])} requireName />
      </FormSection>
      {!beta && (
        <FormSection title={t('Install namespace (deprecated)')} icon="mdi:folder-outline">
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(
              'Only addon v1alpha1 has this field. Prefer AddOnDeploymentConfig.spec.agentInstallNamespace.'
            )}
          </Alert>
          <TextInput
            {...bind<string>(['spec', 'installNamespace'])}
            label={t('Install namespace')}
            placeholder="open-cluster-management-agent-addon"
          />
        </FormSection>
      )}
    </Box>
  );
}

interface Variable {
  name: string;
  value?: string;
}

interface Registry {
  source?: string;
  mirror: string;
}

export function AddOnDeploymentConfigForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection
        title={t('Agent')}
        icon="mdi:robot-outline"
        docsUrl="https://open-cluster-management.io/docs/getting-started/installation/addon-management/"
      >
        <TextInput
          {...bind<string>(['spec', 'agentInstallNamespace'])}
          label={t('Agent install namespace')}
          placeholder="open-cluster-management-agent-addon"
          help={t('Namespace on the managed cluster where the add-on agent is installed.')}
        />
      </FormSection>
      <FormSection
        title={t('Variables')}
        icon="mdi:variable"
        description={t('Name/value pairs the add-on templates can use.')}
      >
        <ArrayEditor<Variable>
          items={value.spec?.customizedVariables}
          onChange={v => onChange(setIn(value, ['spec', 'customizedVariables'], v))}
          newItem={() => ({ name: '', value: '' })}
          addLabel={t('Add variable')}
          itemTitle={(v, i) => v.name || t('Variable {{n}}', { n: i + 1 })}
          renderItem={(v, update) => (
            <FieldGrid columns={2}>
              <TextInput
                label={t('Name')}
                value={v.name}
                onChange={n => update({ ...v, name: n || '' })}
                required
              />
              <TextInput
                label={t('Value')}
                value={v.value}
                onChange={n => update({ ...v, value: n })}
              />
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection
        title={t('Node placement')}
        icon="mdi:server"
        description={t(
          'Node selector for the add-on agent pods (tolerations can be added in YAML).'
        )}
      >
        <KeyValueEditor
          {...bind<Record<string, string>>(['spec', 'nodePlacement', 'nodeSelector'])}
          addLabel={t('Add node label')}
        />
      </FormSection>
      <FormSection title={t('Proxy')} icon="mdi:lan-pending">
        <FieldGrid columns={3}>
          <TextInput
            {...bind<string>(['spec', 'proxyConfig', 'httpProxy'])}
            label={t('HTTP proxy')}
          />
          <TextInput
            {...bind<string>(['spec', 'proxyConfig', 'httpsProxy'])}
            label={t('HTTPS proxy')}
          />
          <TextInput {...bind<string>(['spec', 'proxyConfig', 'noProxy'])} label={t('No proxy')} />
        </FieldGrid>
      </FormSection>
      <FormSection title={t('Registry mirrors')} icon="mdi:docker">
        <ArrayEditor<Registry>
          items={value.spec?.registries}
          onChange={v => onChange(setIn(value, ['spec', 'registries'], v))}
          newItem={() => ({ source: '', mirror: '' })}
          addLabel={t('Add mirror')}
          itemTitle={(r, i) => r.mirror || t('Mirror {{n}}', { n: i + 1 })}
          renderItem={(r, update) => (
            <FieldGrid columns={2}>
              <TextInput
                label={t('Source registry')}
                value={r.source}
                onChange={v => update({ ...r, source: v })}
                placeholder={t('empty = all registries')}
              />
              <TextInput
                label={t('Mirror')}
                value={r.mirror}
                onChange={v => update({ ...r, mirror: v || '' })}
                required
              />
            </FieldGrid>
          )}
        />
      </FormSection>
    </Box>
  );
}
