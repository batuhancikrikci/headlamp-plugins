/**
 * Hub Settings section: ClusterManager, Klusterlet, ClusterClaim, ClusterProperty and
 * AppliedManifestWork.
 */
import {
  DateLabel,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { useText } from '../../common/i18n';
import { Condition, KubeJson } from '../../resources/models/common';
import {
  activeProblems,
  ClusterManagerJson,
  featureGates,
  hubVersionHint,
  KlusterletJson,
  operatorHealth,
} from '../../resources/models/operator';
import { AppliedManifestWorkJson } from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { col, RelatedTable } from '../common/Related';
import { HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

const HEALTH_TEXT = {
  success: 'Healthy',
  warning: 'Progressing',
  error: 'Degraded',
  unknown: 'Unknown',
} as const;

function OperatorHealthLabel({ conditions }: { conditions?: Condition[] }) {
  const { t } = useText();
  const health = operatorHealth(conditions);
  const problems = activeProblems(conditions);
  return (
    <HealthLabel
      health={health}
      label={t(HEALTH_TEXT[health])}
      tooltip={problems.map(p => `${p.type}: ${p.message || p.reason}`).join('\n') || undefined}
    />
  );
}

export function ClusterManagerList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterManager')}
      columns={[
        col<ClusterManagerJson>(
          'health',
          t('Health'),
          j => operatorHealth(j.status?.conditions),
          j => <OperatorHealthLabel conditions={j.status?.conditions} />
        ),
        col<ClusterManagerJson>('mode', t('Mode'), j => j.spec?.deployOption?.mode || 'Default'),
        col<ClusterManagerJson>('version', t('Version (image tag)'), j => hubVersionHint(j)),
        col<ClusterManagerJson>(
          'driver',
          t('Work driver'),
          j => j.spec?.workConfiguration?.workDriver || 'kube'
        ),
      ]}
    />
  );
}

export function ClusterManagerDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterManager')}
      extraInfo={item => {
        const j = item.jsonData as ClusterManagerJson;
        const s = j.spec || {};
        return [
          { name: t('Health'), value: <OperatorHealthLabel conditions={j.status?.conditions} /> },
          { name: t('Deploy mode'), value: s.deployOption?.mode || 'Default' },
          { name: t('Version (image tag)'), value: hubVersionHint(j) || '-' },
          { name: t('Work driver'), value: s.workConfiguration?.workDriver || 'kube' },
          {
            name: t('Auto-approved users'),
            value: <StringArray items={s.registrationConfiguration?.autoApproveUsers} />,
          },
          {
            name: t('Registration drivers'),
            value: (
              <StringArray
                items={(s.registrationConfiguration?.registrationDrivers || []).map(
                  d => d.authType || '?'
                )}
              />
            ),
            hide: !s.registrationConfiguration?.registrationDrivers,
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as ClusterManagerJson;
        const gates = featureGates(j);
        return [
          {
            id: 'mch-images',
            section: (
              <SectionBox title={t('Component images')}>
                <NameValueTable
                  rows={[
                    { name: t('Registration'), value: j.spec?.registrationImagePullSpec || '-' },
                    { name: t('Work'), value: j.spec?.workImagePullSpec || '-' },
                    { name: t('Placement'), value: j.spec?.placementImagePullSpec || '-' },
                    { name: t('Add-on manager'), value: j.spec?.addOnManagerImagePullSpec || '-' },
                  ]}
                />
              </SectionBox>
            ),
          },
          {
            id: 'mch-gates',
            section: (
              <SectionBox title={t('Feature gates')}>
                <NameValueTable
                  rows={
                    gates.length === 0
                      ? [{ name: t('Feature gates'), value: t('Defaults') }]
                      : gates.map(g => ({
                          name: g.component,
                          value: (
                            <StringArray
                              items={g.gates.map(x => `${x.feature}=${x.mode || 'Enable'}`)}
                              max={30}
                            />
                          ),
                        }))
                  }
                />
              </SectionBox>
            ),
          },
          {
            id: 'mch-related',
            section: (
              <RelatedTable
                title={t('Managed resources')}
                items={j.status?.relatedResources || []}
                what={t('related resources')}
                emptyMessage={t('No related resources reported.')}
                columns={[
                  {
                    label: t('Resource'),
                    getter: (r: { group: string; resource: string }) =>
                      `${r.resource}${r.group ? `.${r.group}` : ''}`,
                  },
                  {
                    label: t('Name'),
                    getter: (r: { name: string; namespace?: string }) =>
                      `${r.namespace ? `${r.namespace}/` : ''}${r.name}`,
                  },
                  { label: t('Version'), getter: (r: { version: string }) => r.version },
                ]}
              />
            ),
          },
        ];
      }}
    />
  );
}

export function KlusterletList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('Klusterlet')}
      columns={[
        col<KlusterletJson>(
          'health',
          t('Health'),
          j => operatorHealth(j.status?.conditions),
          j => <OperatorHealthLabel conditions={j.status?.conditions} />
        ),
        col<KlusterletJson>('cluster', t('Cluster name'), j => j.spec?.clusterName),
        col<KlusterletJson>('mode', t('Mode'), j => j.spec?.deployOption?.mode || 'Default'),
        col<KlusterletJson>('ns', t('Agent namespace'), j => j.spec?.namespace),
      ]}
    />
  );
}

export function KlusterletDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('Klusterlet')}
      extraInfo={item => {
        const j = item.jsonData as KlusterletJson;
        return [
          { name: t('Health'), value: <OperatorHealthLabel conditions={j.status?.conditions} /> },
          { name: t('Cluster name'), value: j.spec?.clusterName || '-' },
          { name: t('Deploy mode'), value: j.spec?.deployOption?.mode || 'Default' },
          { name: t('Agent namespace'), value: j.spec?.namespace || '-' },
          {
            name: t('External server URLs'),
            value: <StringArray items={(j.spec?.externalServerURLs || []).map(u => u.url)} />,
          },
          {
            name: t('Image'),
            value: j.spec?.imagePullSpec || j.spec?.registrationImagePullSpec || '-',
          },
        ];
      }}
    />
  );
}

interface ValueJson extends KubeJson {
  spec?: { value?: string };
}

export function ClusterClaimList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterClaim')}
      columns={[col<ValueJson>('value', t('Value'), j => j.spec?.value)]}
    />
  );
}

export function ClusterClaimDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterClaim')}
      conditions={false}
      extraInfo={item => [
        { name: t('Value'), value: (item.jsonData as ValueJson).spec?.value || '-' },
      ]}
    />
  );
}

export function ClusterPropertyList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('ClusterProperty')}
      columns={[col<ValueJson>('value', t('Value'), j => j.spec?.value)]}
    />
  );
}

export function ClusterPropertyDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('ClusterProperty')}
      conditions={false}
      extraInfo={item => [
        { name: t('Value'), value: (item.jsonData as ValueJson).spec?.value || '-' },
      ]}
    />
  );
}

export function AppliedManifestWorkList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('AppliedManifestWork')}
      columns={[
        col<AppliedManifestWorkJson>('work', t('ManifestWork'), j => j.spec?.manifestWorkName),
        col<AppliedManifestWorkJson>(
          'resources',
          t('Resources'),
          j => (j.status?.appliedResources || []).length
        ),
        col<AppliedManifestWorkJson>(
          'evicting',
          t('Eviction'),
          j => j.status?.evictionStartTime,
          j =>
            j.status?.evictionStartTime ? (
              <DateLabel date={j.status.evictionStartTime} format="mini" />
            ) : (
              '-'
            )
        ),
      ]}
    />
  );
}

export function AppliedManifestWorkDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('AppliedManifestWork')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as AppliedManifestWorkJson;
        return [
          { name: t('ManifestWork'), value: j.spec?.manifestWorkName || '-' },
          { name: t('Hub hash'), value: j.spec?.hubHash || '-' },
          { name: t('Agent ID'), value: j.spec?.agentID || '-' },
        ];
      }}
      sections={item => {
        const j = item.jsonData as AppliedManifestWorkJson;
        type R = NonNullable<
          NonNullable<AppliedManifestWorkJson['status']>['appliedResources']
        >[number];
        return [
          {
            id: 'mch-applied',
            section: (
              <RelatedTable
                title={t('Applied resources')}
                items={j.status?.appliedResources || []}
                what={t('applied resources')}
                emptyMessage={t('No resources applied.')}
                columns={[
                  {
                    label: t('Resource'),
                    getter: (r: R) =>
                      `${r.resource}${r.group ? `.${r.group}` : ''}/${r.version || ''}`,
                  },
                  {
                    label: t('Name'),
                    getter: (r: R) => `${r.namespace ? `${r.namespace}/` : ''}${r.name}`,
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
