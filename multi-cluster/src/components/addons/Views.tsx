/**
 * Add-ons section: ClusterManagementAddOn, ManagedClusterAddOn, AddOnDeploymentConfig and
 * AddOnTemplate. Views read both API shapes (v1alpha1 / v1beta1) through the addon model.
 */
import { Icon } from '@iconify/react';
import { AuthVisible, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  ADDON_STATE_HEALTH,
  ADDON_STATE_LABEL,
  addonCluster,
  AddOnDeploymentConfigJson,
  addonDisplayName,
  addonState,
  AddOnTemplateJson,
  ClusterManagementAddOnJson,
  configReferences,
  defaultConfigs,
  installStrategyType,
  ManagedClusterAddOnJson,
  registrations,
} from '../../resources/models/addon';
import { ManagedClusterJson } from '../../resources/models/cluster';
import { manifestSummaries } from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { DisableAddonAction, ManageAddonsDialog } from '../clusters/Actions';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

function AddOnStateLabel({ addon }: { addon: ManagedClusterAddOnJson }) {
  const { t } = useText();
  const state = addonState(addon);
  return <HealthLabel health={ADDON_STATE_HEALTH[state]} label={t(ADDON_STATE_LABEL[state])} />;
}

function InstalledCount({ name }: { name: string }) {
  const mcas = useOcmList<ManagedClusterAddOnJson>('ManagedClusterAddOn');
  if (!mcas.items) return <>…</>;
  const own = mcas.items.filter(m => m.metadata.name === name);
  const ok = own.filter(m => addonState(m) === 'available').length;
  return <>{own.length === 0 ? '0' : `${ok}/${own.length}`}</>;
}

export function ClusterManagementAddOnList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterManagementAddOn')}
      columns={[
        col<ClusterManagementAddOnJson>('display', t('Display name'), j => addonDisplayName(j)),
        col<ClusterManagementAddOnJson>('strategy', t('Install strategy'), j =>
          installStrategyType(j)
        ),
        col<ClusterManagementAddOnJson>(
          'installed',
          t('Available / installed'),
          () => '',
          j => <InstalledCount name={j.metadata.name} />
        ),
      ]}
    />
  );
}

/** Installations of one add-on across clusters, plus a shortcut to enable it on more clusters. */
function AddonInstallations({ addon }: { addon: ClusterManagementAddOnJson }) {
  const { t } = useText();
  const mcas = useOcmList<ManagedClusterAddOnJson>('ManagedClusterAddOn');
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const [cluster, setCluster] = React.useState<string | null>(null);
  const installed = mcas.items
    ? mcas.items.filter(m => m.metadata.name === addon.metadata.name)
    : null;
  const without = (clusters.items || [])
    .map(c => c.metadata.name)
    .filter(c => !(installed || []).some(m => m.metadata.namespace === c))
    .sort();
  return (
    <>
      <RelatedTable
        title={t('Installed on clusters')}
        items={installed}
        error={mcas.error}
        what={t('managed cluster add-ons')}
        emptyMessage={t('The add-on is not installed on any cluster.')}
        columns={[
          {
            label: t('Cluster'),
            getter: (m: ManagedClusterAddOnJson) => (
              <ClusterLink name={m.metadata.namespace || ''} />
            ),
          },
          {
            label: t('Status'),
            getter: (m: ManagedClusterAddOnJson) => <AddOnStateLabel addon={m} />,
          },
          {
            label: t('Installation'),
            getter: (m: ManagedClusterAddOnJson) => (
              <ResourceRefLink
                kind="ManagedClusterAddOn"
                name={m.metadata.name}
                namespace={m.metadata.namespace}
              />
            ),
          },
          { label: '', getter: (m: ManagedClusterAddOnJson) => <DisableAddonAction addon={m} /> },
        ]}
      />
      {without.length > 0 && (
        <SectionBox title={t('Not installed on')}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(
              'Enable the add-on on a cluster by creating a ManagedClusterAddOn in the cluster namespace.'
            )}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {without.map(c => (
              <AuthVisible
                key={c}
                item={crd('ManagedClusterAddOn').cls}
                authVerb="create"
                namespace={c}
              >
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Icon icon="mdi:puzzle-plus-outline" />}
                  onClick={() => setCluster(c)}
                >
                  {c}
                </Button>
              </AuthVisible>
            ))}
          </Box>
        </SectionBox>
      )}
      {cluster && <ManageAddonsDialog cluster={cluster} onClose={() => setCluster(null)} />}
    </>
  );
}

export function ClusterManagementAddOnDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterManagementAddOn')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as ClusterManagementAddOnJson;
        return [
          { name: t('Display name'), value: addonDisplayName(j) },
          { name: t('Description'), value: j.spec?.addOnMeta?.description || '-' },
          { name: t('Install strategy'), value: installStrategyType(j) },
          {
            name: t('Install placements'),
            value: (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {(j.spec?.installStrategy?.placements || []).map(p => (
                  <ResourceRefLink
                    key={`${p.namespace}/${p.name}`}
                    kind="Placement"
                    name={p.name}
                    namespace={p.namespace}
                    qualified
                  />
                ))}
              </Box>
            ),
            hide: installStrategyType(j) !== 'Placements',
          },
          {
            name: t('Default configurations'),
            value: (
              <StringArray
                items={defaultConfigs(j).map(
                  c =>
                    `${c.resource}${
                      c.name
                        ? `: ${c.namespace ? `${c.namespace}/` : ''}${c.name}`
                        : ` (${t('no default')})`
                    }`
                )}
              />
            ),
          },
        ];
      }}
      sections={item => [
        {
          id: 'mch-installs',
          section: <AddonInstallations addon={item.jsonData as ClusterManagementAddOnJson} />,
        },
      ]}
    />
  );
}

export function ManagedClusterAddOnList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ManagedClusterAddOn')}
      columns={[
        col<ManagedClusterAddOnJson>(
          'status',
          t('Status'),
          j => ADDON_STATE_LABEL[addonState(j)],
          j => <AddOnStateLabel addon={j} />
        ),
        col<ManagedClusterAddOnJson>(
          'cluster',
          t('Cluster'),
          j => addonCluster(j),
          j => <ClusterLink name={addonCluster(j) || ''} />
        ),
        col<ManagedClusterAddOnJson>('agentns', t('Agent namespace'), j => j.status?.namespace),
        col<ManagedClusterAddOnJson>('health', t('Health check'), j => j.status?.healthCheck?.mode),
      ]}
    />
  );
}

export function ManagedClusterAddOnDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ManagedClusterAddOn')}
      actions={item => [
        <DisableAddonAction key="disable" addon={item.jsonData as ManagedClusterAddOnJson} />,
      ]}
      extraInfo={item => {
        const j = item.jsonData as ManagedClusterAddOnJson;
        return [
          { name: t('Status'), value: <AddOnStateLabel addon={j} /> },
          { name: t('Cluster'), value: <ClusterLink name={addonCluster(j) || ''} /> },
          {
            name: t('Add-on'),
            value: <ResourceRefLink kind="ClusterManagementAddOn" name={j.metadata.name} />,
          },
          { name: t('Agent namespace'), value: j.status?.namespace || '-' },
          {
            name: t('Install namespace (v1alpha1)'),
            value: j.spec?.installNamespace,
            hide: !j.spec?.installNamespace,
          },
          {
            name: t('Configurations'),
            value: (
              <StringArray
                items={configReferences(j).map(
                  c => `${c.resource}: ${c.namespace ? `${c.namespace}/` : ''}${c.name || '?'}`
                )}
              />
            ),
          },
          {
            name: t('Registrations'),
            value: (
              <StringArray
                items={registrations(j).map(
                  r =>
                    `${r.type}${r.signer ? ` (${r.signer})` : ''}${
                      r.driver ? ` · ${r.driver}` : ''
                    }`
                )}
              />
            ),
          },
          { name: t('Health check'), value: j.status?.healthCheck?.mode || '-' },
        ];
      }}
    />
  );
}

export function AddOnDeploymentConfigList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('AddOnDeploymentConfig')}
      columns={[
        col<AddOnDeploymentConfigJson>(
          'ns',
          t('Agent install namespace'),
          j => j.spec?.agentInstallNamespace
        ),
        col<AddOnDeploymentConfigJson>(
          'vars',
          t('Variables'),
          j => (j.spec?.customizedVariables || []).length
        ),
        col<AddOnDeploymentConfigJson>('proxy', t('Proxy'), j =>
          j.spec?.proxyConfig ? t('Yes') : t('No')
        ),
      ]}
    />
  );
}

export function AddOnDeploymentConfigDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('AddOnDeploymentConfig')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as AddOnDeploymentConfigJson;
        const s = j.spec || {};
        return [
          { name: t('Agent install namespace'), value: s.agentInstallNamespace || '-' },
          {
            name: t('Variables'),
            value: (
              <StringArray
                items={(s.customizedVariables || []).map(v => `${v.name}=${v.value ?? ''}`)}
                monospace
              />
            ),
          },
          {
            name: t('Node selector'),
            value: (
              <StringArray
                items={Object.entries(s.nodePlacement?.nodeSelector || {}).map(
                  ([k, v]) => `${k}=${v}`
                )}
                monospace
              />
            ),
          },
          {
            name: t('Proxy'),
            value: s.proxyConfig
              ? [
                  s.proxyConfig.httpProxy && `HTTP ${s.proxyConfig.httpProxy}`,
                  s.proxyConfig.httpsProxy && `HTTPS ${s.proxyConfig.httpsProxy}`,
                  s.proxyConfig.noProxy && `no proxy: ${s.proxyConfig.noProxy}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '-',
          },
          {
            name: t('Registry mirrors'),
            value: (
              <StringArray
                items={(s.registries || []).map(r => `${r.source || '*'} → ${r.mirror}`)}
              />
            ),
          },
        ];
      }}
    />
  );
}

export function AddOnTemplateList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('AddOnTemplate')}
      columns={[
        col<AddOnTemplateJson>('addon', t('Add-on'), j => j.spec?.addonName),
        col<AddOnTemplateJson>(
          'manifests',
          t('Manifests'),
          j => (j.spec?.agentSpec?.workload?.manifests || []).length
        ),
        col<AddOnTemplateJson>('registration', t('Registration'), j =>
          (j.spec?.registration || []).map(r => r.type).join(', ')
        ),
      ]}
    />
  );
}

export function AddOnTemplateDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('AddOnTemplate')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as AddOnTemplateJson;
        return [
          {
            name: t('Add-on'),
            value: j.spec?.addonName ? (
              <ResourceRefLink kind="ClusterManagementAddOn" name={j.spec.addonName} />
            ) : (
              '-'
            ),
          },
          {
            name: t('Agent manifests'),
            value: (
              <StringArray
                items={manifestSummaries(j.spec?.agentSpec?.workload?.manifests)}
                max={20}
              />
            ),
          },
          {
            name: t('Registration'),
            value: <StringArray items={(j.spec?.registration || []).map(r => r.type)} />,
          },
        ];
      }}
    />
  );
}
