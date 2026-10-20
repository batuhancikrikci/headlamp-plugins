import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { BackendTrafficPolicy, RateLimitRule } from '../../resources/backendTrafficPolicy';
import { crdByKind } from '../../resources/registry';
import { FeatureChips, StringArray, TargetRefsList, useYesNo } from '../common/SharedComponents';
import { EGDetailView, SpecTabs } from '../common/Views';
import { EDITING } from '../editing';
import { btpFeatures } from '../features';

function RateLimitRules({ rules }: { rules: RateLimitRule[] }) {
  const { t } = useText();
  return (
    <NameValueTable
      rows={rules.map((r, i) => {
        const sel = r.clientSelectors?.[0];
        const header = sel?.headers?.[0];
        const scope = header
          ? t('per header {{name}} ({{type}})', { name: header.name, type: header.type || 'Exact' })
          : sel?.sourceCIDR
          ? t('per client {{cidr}} ({{type}})', {
              cidr: sel.sourceCIDR.value,
              type: sel.sourceCIDR.type || 'Exact',
            })
          : t('all clients');
        return {
          name: t('Rule #{{index}}', { index: i + 1 }),
          value: `${r.limit?.requests} / ${r.limit?.unit} — ${scope}`,
        };
      })}
    />
  );
}

export function BackendTrafficPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('BackendTrafficPolicy')!}
      editing={EDITING.BackendTrafficPolicy}
      extraInfo={(item: BackendTrafficPolicy) => [
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
        { name: t('Features'), value: <FeatureChips features={btpFeatures(item, t)} /> },
      ]}
      sections={(item: BackendTrafficPolicy) => {
        const s = item.spec;
        const rl = s.rateLimit;
        const hc = s.healthCheck;
        return [
          {
            id: 'eg-btp-config',
            section: (
              <SpecTabs
                title={t('Configuration')}
                tabs={[
                  {
                    label: t('Load balancing'),
                    content: s.loadBalancer && (
                      <NameValueTable
                        rows={[
                          { name: t('Algorithm'), value: s.loadBalancer.type || '-' },
                          {
                            name: t('Hash on'),
                            value: s.loadBalancer.consistentHash
                              ? [
                                  s.loadBalancer.consistentHash.type,
                                  s.loadBalancer.consistentHash.header?.name,
                                  s.loadBalancer.consistentHash.cookie?.name,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')
                              : '-',
                            hide: !s.loadBalancer.consistentHash,
                          },
                          {
                            name: t('Cookie TTL'),
                            value: s.loadBalancer.consistentHash?.cookie?.ttl || '-',
                            hide: !s.loadBalancer.consistentHash?.cookie,
                          },
                          {
                            name: t('Slow start window'),
                            value: s.loadBalancer.slowStart?.window || '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Rate limiting'),
                    content: rl && (
                      <>
                        <NameValueTable rows={[{ name: t('Scope'), value: rl.type || 'Local' }]} />
                        {!!rl.local?.rules?.length && <RateLimitRules rules={rl.local.rules} />}
                        {!!rl.global?.rules?.length && <RateLimitRules rules={rl.global.rules} />}
                      </>
                    ),
                  },
                  {
                    label: t('Timeouts'),
                    content: s.timeout && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Request timeout'),
                            value: s.timeout.http?.requestTimeout || '-',
                          },
                          {
                            name: t('TCP connect timeout'),
                            value: s.timeout.tcp?.connectTimeout || '-',
                          },
                          {
                            name: t('Connection idle timeout'),
                            value: s.timeout.http?.connectionIdleTimeout || '-',
                          },
                          {
                            name: t('Max connection duration'),
                            value: s.timeout.http?.maxConnectionDuration || '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Retries'),
                    content: s.retry && (
                      <NameValueTable
                        rows={[
                          { name: t('Number of retries'), value: s.retry.numRetries ?? '-' },
                          {
                            name: t('Retry on'),
                            value: <StringArray items={s.retry.retryOn?.triggers} />,
                          },
                          {
                            name: t('Retry on HTTP status codes'),
                            value: <StringArray items={s.retry.retryOn?.httpStatusCodes} />,
                          },
                          {
                            name: t('Timeout per attempt'),
                            value: s.retry.perRetry?.timeout || '-',
                          },
                          {
                            name: t('Backoff'),
                            value: s.retry.perRetry?.backOff
                              ? `${s.retry.perRetry.backOff.baseInterval || '-'} → ${
                                  s.retry.perRetry.backOff.maxInterval || '-'
                                }`
                              : '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Circuit breaker'),
                    content: s.circuitBreaker && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Max connections'),
                            value: s.circuitBreaker.maxConnections ?? '-',
                          },
                          {
                            name: t('Max pending requests'),
                            value: s.circuitBreaker.maxPendingRequests ?? '-',
                          },
                          {
                            name: t('Max parallel requests'),
                            value: s.circuitBreaker.maxParallelRequests ?? '-',
                          },
                          {
                            name: t('Max parallel retries'),
                            value: s.circuitBreaker.maxParallelRetries ?? '-',
                          },
                          {
                            name: t('Max requests per connection'),
                            value: s.circuitBreaker.maxRequestsPerConnection ?? '-',
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Health checks'),
                    content: hc && (
                      <>
                        {hc.active && (
                          <>
                            <Typography variant="subtitle2">
                              {t('Active health checks (probe endpoints)')}
                            </Typography>
                            <NameValueTable
                              rows={[
                                { name: t('Probe type'), value: hc.active.type || '-' },
                                {
                                  name: t('Path'),
                                  value: hc.active.http?.path || '-',
                                  hide: hc.active.type !== 'HTTP',
                                },
                                {
                                  name: t('Expected statuses'),
                                  value: <StringArray items={hc.active.http?.expectedStatuses} />,
                                  hide: hc.active.type !== 'HTTP',
                                },
                                { name: t('Interval'), value: hc.active.interval || '-' },
                                { name: t('Timeout'), value: hc.active.timeout || '-' },
                                {
                                  name: t('Thresholds (unhealthy / healthy)'),
                                  value: `${hc.active.unhealthyThreshold ?? '-'} / ${
                                    hc.active.healthyThreshold ?? '-'
                                  }`,
                                },
                              ]}
                            />
                          </>
                        )}
                        {hc.passive && (
                          <Box sx={{ mt: hc.active ? 2 : 0 }}>
                            <Typography variant="subtitle2">
                              {t('Passive health checks (outlier detection)')}
                            </Typography>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Consecutive 5xx errors'),
                                  value: hc.passive.consecutive5XxErrors ?? '-',
                                },
                                {
                                  name: t('Consecutive gateway errors'),
                                  value: hc.passive.consecutiveGatewayErrors ?? '-',
                                },
                                { name: t('Interval'), value: hc.passive.interval || '-' },
                                {
                                  name: t('Base ejection time'),
                                  value: hc.passive.baseEjectionTime || '-',
                                },
                                {
                                  name: t('Max ejection percent'),
                                  value: hc.passive.maxEjectionPercent ?? '-',
                                },
                              ]}
                            />
                          </Box>
                        )}
                      </>
                    ),
                  },
                  {
                    label: t('Other'),
                    content: (s.faultInjection ||
                      s.compression?.length ||
                      s.tcpKeepalive ||
                      s.proxyProtocol ||
                      s.useClientProtocol !== undefined) && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Fault injection: delay'),
                            value: s.faultInjection?.delay
                              ? `${s.faultInjection.delay.fixedDelay || '-'} (${
                                  s.faultInjection.delay.percentage ?? 100
                                }%)`
                              : '-',
                          },
                          {
                            name: t('Fault injection: abort'),
                            value: s.faultInjection?.abort
                              ? `${
                                  s.faultInjection.abort.httpStatus ??
                                  s.faultInjection.abort.grpcStatus ??
                                  '-'
                                } (${s.faultInjection.abort.percentage ?? 100}%)`
                              : '-',
                          },
                          {
                            name: t('Compression'),
                            value: <StringArray items={s.compression?.map(c => c.type)} />,
                          },
                          {
                            name: t('TCP keepalive'),
                            value: s.tcpKeepalive
                              ? [
                                  s.tcpKeepalive.probes,
                                  s.tcpKeepalive.idleTime,
                                  s.tcpKeepalive.interval,
                                ]
                                  .filter(v => v !== undefined)
                                  .join(' / ') || t('Enabled')
                              : '-',
                          },
                          { name: t('PROXY protocol'), value: s.proxyProtocol?.version || '-' },
                          { name: t('Use client protocol'), value: yesNo(s.useClientProtocol) },
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
