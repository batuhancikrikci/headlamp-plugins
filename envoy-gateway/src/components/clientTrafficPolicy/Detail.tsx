import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ClientTrafficPolicy } from '../../resources/clientTrafficPolicy';
import { crdByKind } from '../../resources/registry';
import { ResourceRefList } from '../common/ResourceRefLink';
import { FeatureChips, StringArray, TargetRefsList, useYesNo } from '../common/SharedComponents';
import { EGDetailView, SpecTabs } from '../common/Views';
import { EDITING } from '../editing';
import { ctpFeatures } from '../features';

export function ClientTrafficPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('ClientTrafficPolicy')!}
      editing={EDITING.ClientTrafficPolicy}
      extraInfo={(item: ClientTrafficPolicy) => [
        {
          name: t('Targets'),
          value: (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
        },
        { name: t('HTTP Versions'), value: item.httpVersions.join(', ') || '-' },
        { name: t('Features'), value: <FeatureChips features={ctpFeatures(item, t)} /> },
      ]}
      sections={(item: ClientTrafficPolicy) => {
        const s = item.spec;
        return [
          {
            id: 'eg-ctp-config',
            section: (
              <SpecTabs
                title={t('Configuration')}
                tabs={[
                  {
                    label: t('TLS'),
                    content: s.tls && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Minimum TLS version'),
                            value: s.tls.minVersion || t('Default'),
                          },
                          {
                            name: t('Maximum TLS version'),
                            value: s.tls.maxVersion || t('Default'),
                          },
                          {
                            name: t('Cipher suites'),
                            value: <StringArray items={s.tls.ciphers} />,
                          },
                          {
                            name: t('ECDH curves'),
                            value: <StringArray items={s.tls.ecdhCurves} />,
                          },
                          {
                            name: t('Signature algorithms'),
                            value: <StringArray items={s.tls.signatureAlgorithms} />,
                          },
                          {
                            name: t('ALPN protocols'),
                            value: <StringArray items={s.tls.alpnProtocols} />,
                          },
                          {
                            name: t('Client CA certificates'),
                            value: (
                              <ResourceRefList
                                refs={(s.tls.clientValidation?.caCertificateRefs || []).map(r => ({
                                  group: r.group || '',
                                  kind: r.kind || 'Secret',
                                  name: r.name,
                                  namespace: r.namespace || item.metadata.namespace,
                                }))}
                              />
                            ),
                          },
                          {
                            name: t('Client certificate optional'),
                            value: yesNo(s.tls.clientValidation?.optional),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('HTTP'),
                    content: (s.http1 || s.http2 || s.http3) && (
                      <>
                        {s.http1 && (
                          <>
                            <Typography variant="subtitle2">HTTP/1.1</Typography>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Enable trailers'),
                                  value: yesNo(s.http1.enableTrailers, true),
                                },
                                {
                                  name: t('Preserve header case'),
                                  value: yesNo(s.http1.preserveHeaderCase, true),
                                },
                                {
                                  name: t('Accept HTTP/1.0 (use default host)'),
                                  value: yesNo(s.http1.http10?.useDefaultHost, true),
                                },
                              ]}
                            />
                          </>
                        )}
                        {s.http2 && (
                          <>
                            <Typography variant="subtitle2" sx={{ mt: 2 }}>
                              HTTP/2
                            </Typography>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Max concurrent streams'),
                                  value: s.http2.maxConcurrentStreams ?? '-',
                                },
                                {
                                  name: t('Initial stream window'),
                                  value: s.http2.initialStreamWindowSize || '-',
                                },
                                {
                                  name: t('Initial connection window'),
                                  value: s.http2.initialConnectionWindowSize || '-',
                                },
                              ]}
                            />
                          </>
                        )}
                        {s.http3 && (
                          <Typography variant="body2" sx={{ mt: 2 }}>
                            {t('HTTP/3 (QUIC) is enabled.')}
                          </Typography>
                        )}
                      </>
                    ),
                  },
                  {
                    label: t('Connection'),
                    content: (s.timeout ||
                      s.connection ||
                      s.tcpKeepalive ||
                      s.enableProxyProtocol) && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Request received timeout'),
                            value: s.timeout?.http?.requestReceivedTimeout || '-',
                          },
                          { name: t('Idle timeout'), value: s.timeout?.http?.idleTimeout || '-' },
                          {
                            name: t('Connection limit'),
                            value: s.connection?.connectionLimit?.value ?? '-',
                          },
                          {
                            name: t('Close delay'),
                            value: s.connection?.connectionLimit?.closeDelay || '-',
                          },
                          { name: t('Buffer limit'), value: s.connection?.bufferLimit || '-' },
                          {
                            name: t('TCP keepalive'),
                            value: s.tcpKeepalive
                              ? [
                                  s.tcpKeepalive.probes !== undefined
                                    ? t('{{n}} probes', { n: s.tcpKeepalive.probes })
                                    : '',
                                  s.tcpKeepalive.idleTime
                                    ? t('idle {{v}}', { v: s.tcpKeepalive.idleTime })
                                    : '',
                                  s.tcpKeepalive.interval
                                    ? t('every {{v}}', { v: s.tcpKeepalive.interval })
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(', ') || t('Enabled')
                              : '-',
                          },
                          { name: t('PROXY protocol'), value: yesNo(s.enableProxyProtocol, true) },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Client IP & Headers'),
                    content: (s.clientIPDetection || s.headers) && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Trusted X-Forwarded-For hops'),
                            value: s.clientIPDetection?.xForwardedFor?.numTrustedHops ?? '-',
                          },
                          {
                            name: t('Custom client IP header'),
                            value: s.clientIPDetection?.customHeader?.name || '-',
                          },
                          {
                            name: t('Add Envoy headers (x-envoy-*)'),
                            value: yesNo(s.headers?.enableEnvoyHeaders),
                          },
                          {
                            name: t('Disable rate limit headers'),
                            value: yesNo(s.headers?.disableRateLimitHeaders),
                          },
                          {
                            name: t('Headers with underscores'),
                            value: s.headers?.withUnderscoresAction || '-',
                          },
                          {
                            name: t('X-Forwarded-Client-Cert mode'),
                            value: s.headers?.xForwardedClientCert?.mode || '-',
                          },
                          {
                            name: t('Preserve X-Request-ID'),
                            value: yesNo(s.headers?.preserveXRequestID),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Path'),
                    content: (s.path || s.healthCheck) && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Escaped slashes action'),
                            value: s.path?.escapedSlashesAction || '-',
                          },
                          {
                            name: t('Disable merge slashes'),
                            value: yesNo(s.path?.disableMergeSlashes),
                          },
                          { name: t('Health check path'), value: s.healthCheck?.path || '-' },
                        ]}
                      />
                    ),
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
