import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { EnvoyProxy } from '../../resources/envoyProxy';
import { crdByKind } from '../../resources/registry';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { KeyValueBlock, useYesNo } from '../common/SharedComponents';
import { EGDetailView, SpecTabs } from '../common/Views';
import { EDITING } from '../editing';
import { EnvoyProxyUsedBy } from '../relations/UsedBy';
import { EnvoyProxyStatus } from './status';

export function EnvoyProxyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('EnvoyProxy')!}
      editing={EDITING.EnvoyProxy}
      statusValue={(item: EnvoyProxy) => (
        <EnvoyProxyStatus name={item.metadata.name} namespace={item.metadata.namespace} />
      )}
      extraInfo={(item: EnvoyProxy) => [
        { name: t('Provider'), value: item.providerType },
        { name: t('Replicas'), value: item.replicas ?? '-' },
        { name: t('Service Type'), value: item.serviceType || '-' },
        { name: t('Merge Gateways'), value: yesNo(item.mergeGateways, true) },
      ]}
      sections={(item: EnvoyProxy) => {
        const spec = item.spec;
        const k8s = spec.provider?.kubernetes;
        const patch = k8s?.envoyDeployment?.patch;
        return [
          {
            id: 'eg-envoyproxy-config',
            section: (
              <SpecTabs
                title={t('Configuration')}
                tabs={[
                  {
                    label: t('Deployment'),
                    content: k8s && (
                      <>
                        <NameValueTable
                          rows={[
                            { name: t('Replicas'), value: k8s.envoyDeployment?.replicas ?? '-' },
                            {
                              name: t('Image'),
                              value: k8s.envoyDeployment?.container?.image || t('Default'),
                            },
                            {
                              name: t('HPA'),
                              value: k8s.envoyHpa
                                ? `${k8s.envoyHpa.minReplicas ?? 1} – ${
                                    k8s.envoyHpa.maxReplicas ?? '-'
                                  }`
                                : '-',
                            },
                            {
                              name: t('Resources'),
                              value: k8s.envoyDeployment?.container?.resources ? (
                                <KeyValueBlock value={k8s.envoyDeployment.container.resources} />
                              ) : (
                                '-'
                              ),
                            },
                          ]}
                        />
                        {patch && (
                          <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                              {t('Deployment patch ({{type}})', {
                                type: patch.type || 'StrategicMerge',
                              })}
                            </Typography>
                            <KeyValueBlock value={patch.value} />
                          </Box>
                        )}
                      </>
                    ),
                  },
                  {
                    label: t('Service'),
                    content: k8s?.envoyService && (
                      <NameValueTable
                        rows={[
                          { name: t('Type'), value: k8s.envoyService.type || 'LoadBalancer' },
                          {
                            name: t('External traffic policy'),
                            value: k8s.envoyService.externalTrafficPolicy || '-',
                          },
                          {
                            name: t('Annotations'),
                            value: k8s.envoyService.annotations ? (
                              <KeyValueBlock value={k8s.envoyService.annotations} />
                            ) : (
                              '-'
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Logging'),
                    content: spec.logging?.level && (
                      <NameValueTable
                        rows={Object.entries(spec.logging.level).map(([component, level]) => ({
                          name: component,
                          value: level,
                        }))}
                      />
                    ),
                  },
                  {
                    label: t('Telemetry'),
                    content: spec.telemetry && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Prometheus metrics'),
                            value: spec.telemetry.metrics?.prometheus?.disable
                              ? t('Disabled')
                              : t('Enabled'),
                          },
                          {
                            name: t('Access logs'),
                            value: spec.telemetry.accessLog?.disable ? t('Disabled') : t('Enabled'),
                          },
                          {
                            name: t('Tracing provider'),
                            value: spec.telemetry.tracing?.provider
                              ? [
                                  spec.telemetry.tracing.provider.type,
                                  spec.telemetry.tracing.provider.host,
                                  spec.telemetry.tracing.provider.port,
                                ]
                                  .filter(Boolean)
                                  .join(' ')
                              : '-',
                          },
                          {
                            name: t('Tracing sampling rate'),
                            value: spec.telemetry.tracing?.samplingRate ?? '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Bootstrap'),
                    content: spec.bootstrap && (
                      <>
                        <NameValueTable
                          rows={[{ name: t('Type'), value: spec.bootstrap.type || 'Merge' }]}
                        />
                        {spec.bootstrap.value && (
                          <Box sx={{ mt: 1 }}>
                            <CodeBlock value={spec.bootstrap.value} />
                          </Box>
                        )}
                      </>
                    ),
                  },
                  {
                    label: t('Shutdown'),
                    content: spec.shutdown && (
                      <NameValueTable
                        rows={[
                          { name: t('Drain timeout'), value: spec.shutdown.drainTimeout || '-' },
                          {
                            name: t('Minimum drain duration'),
                            value: spec.shutdown.minDrainDuration || '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Filter Order'),
                    content: !!spec.filterOrder?.length && (
                      <NameValueTable
                        rows={spec.filterOrder.map(f => ({
                          name: f.name,
                          value:
                            [
                              f.before ? t('before {{name}}', { name: f.before }) : '',
                              f.after ? t('after {{name}}', { name: f.after }) : '',
                            ]
                              .filter(Boolean)
                              .join(', ') || '-',
                        }))}
                      />
                    ),
                  },
                  {
                    label: t('Backend TLS'),
                    content: spec.backendTLS?.clientCertificateRef && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Client certificate'),
                            value: (
                              <ResourceRefLink
                                group={spec.backendTLS.clientCertificateRef.group || ''}
                                kind={spec.backendTLS.clientCertificateRef.kind || 'Secret'}
                                name={spec.backendTLS.clientCertificateRef.name}
                                namespace={
                                  spec.backendTLS.clientCertificateRef.namespace ||
                                  item.metadata.namespace
                                }
                              />
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            id: 'eg-envoyproxy-usedby',
            section: (
              <EnvoyProxyUsedBy name={item.metadata.name} namespace={item.metadata.namespace} />
            ),
          },
        ];
      }}
    />
  );
}
