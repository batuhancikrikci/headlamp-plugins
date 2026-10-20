import { Box, Typography } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  DurationInput,
  FieldGrid,
  NumberInput,
  NumberListInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  ToggleSection,
  useBinder,
} from '../../common/form/Fields';
import { useText } from '../../common/i18n';
import { RateLimitRule } from '../../resources/backendTrafficPolicy';
import { KubeJson } from '../../resources/types';

export interface SectionProps {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}

const RETRY_TRIGGERS = [
  '5xx',
  'gateway-error',
  'reset',
  'connect-failure',
  'retriable-4xx',
  'refused-stream',
  'retriable-status-codes',
  'cancelled',
  'deadline-exceeded',
  'internal',
  'resource-exhausted',
  'unavailable',
];

function useSpecToggle({ value, onChange }: SectionProps) {
  const bind = useBinder<KubeJson>(value, onChange);
  const spec = value.spec || {};
  return {
    bind,
    spec,
    enabled: (key: string) => spec[key] !== undefined,
    toggle: (key: string, defaults: unknown) => (on: boolean) =>
      bind(['spec', key]).onChange(on ? defaults : undefined),
  };
}

export function LoadBalancerSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, enabled, toggle } = useSpecToggle(props);
  const type = spec.loadBalancer?.type;
  const hashType = spec.loadBalancer?.consistentHash?.type;
  return (
    <ToggleSection
      title={t('Load balancing')}
      description={t('Algorithm used to pick an endpoint of the backend.')}
      icon="mdi:scale-balance"
      enabled={enabled('loadBalancer')}
      onToggle={toggle('loadBalancer', { type: 'RoundRobin' })}
    >
      <FieldGrid>
        <SelectInput
          label={t('Algorithm')}
          allowEmpty={false}
          options={['RoundRobin', 'LeastRequest', 'Random', 'ConsistentHash']}
          value={type}
          onChange={v =>
            bind(['spec', 'loadBalancer']).onChange(
              v === 'ConsistentHash'
                ? { type: v, consistentHash: { type: 'SourceIP' } }
                : {
                    type: v,
                    ...(spec.loadBalancer?.slowStart
                      ? { slowStart: spec.loadBalancer.slowStart }
                      : {}),
                  }
            )
          }
        />
        {type === 'ConsistentHash' ? (
          <SelectInput
            label={t('Hash on')}
            allowEmpty={false}
            options={[
              { value: 'SourceIP', label: t('Client IP') },
              { value: 'Header', label: t('Request header') },
              { value: 'Cookie', label: t('Cookie (sticky session)') },
            ]}
            value={hashType}
            onChange={v =>
              bind(['spec', 'loadBalancer', 'consistentHash']).onChange(
                v === 'Header'
                  ? { type: v, header: { name: '' } }
                  : v === 'Cookie'
                  ? { type: v, cookie: { name: 'session-affinity', ttl: '1h' } }
                  : { type: v }
              )
            }
          />
        ) : (
          <DurationInput
            label={t('Slow start window')}
            help={t('New endpoints receive gradually more traffic during this window.')}
            {...bind(['spec', 'loadBalancer', 'slowStart', 'window'])}
          />
        )}
        {type === 'ConsistentHash' && hashType === 'Header' && (
          <TextInput
            label={t('Header name')}
            required
            {...bind(['spec', 'loadBalancer', 'consistentHash', 'header', 'name'])}
          />
        )}
        {type === 'ConsistentHash' && hashType === 'Cookie' && (
          <>
            <TextInput
              label={t('Cookie name')}
              required
              {...bind(['spec', 'loadBalancer', 'consistentHash', 'cookie', 'name'])}
            />
            <DurationInput
              label={t('Cookie TTL')}
              help={t('If set, Envoy generates the cookie when the client does not send it.')}
              {...bind(['spec', 'loadBalancer', 'consistentHash', 'cookie', 'ttl'])}
            />
          </>
        )}
      </FieldGrid>
    </ToggleSection>
  );
}

function RateLimitRuleEditor({
  rule,
  onChange,
}: {
  rule: RateLimitRule;
  onChange: (next: RateLimitRule) => void;
}) {
  const { t } = useText();
  const selector = rule.clientSelectors?.[0] || {};
  const header = selector.headers?.[0];
  const setSelector = (next: typeof selector) => {
    const empty = !next.headers?.length && !next.sourceCIDR;
    const copy = { ...rule, clientSelectors: empty ? undefined : [next] };
    if (empty) delete copy.clientSelectors;
    onChange(copy);
  };
  return (
    <FieldGrid columns={3}>
      <NumberInput
        label={t('Requests')}
        required
        min={1}
        value={rule.limit?.requests}
        onChange={v => onChange({ ...rule, limit: { ...rule.limit, requests: v as number } })}
      />
      <SelectInput
        label={t('Per')}
        allowEmpty={false}
        options={[
          { value: 'Second', label: t('Second') },
          { value: 'Minute', label: t('Minute') },
          { value: 'Hour', label: t('Hour') },
          { value: 'Day', label: t('Day') },
        ]}
        value={rule.limit?.unit}
        onChange={v => onChange({ ...rule, limit: { ...rule.limit, unit: v || 'Second' } })}
      />
      <SelectInput
        label={t('Apply per')}
        options={[
          { value: 'header', label: t('Request header value') },
          { value: 'cidr', label: t('Client IP / CIDR') },
        ]}
        value={header ? 'header' : selector.sourceCIDR ? 'cidr' : undefined}
        onChange={v =>
          setSelector(
            v === 'header'
              ? { headers: [{ name: 'x-user-id', type: 'Distinct' }] }
              : v === 'cidr'
              ? { sourceCIDR: { type: 'Distinct', value: '0.0.0.0/0' } }
              : {}
          )
        }
      />
      {header && (
        <>
          <TextInput
            label={t('Header name')}
            value={header.name}
            onChange={v => setSelector({ headers: [{ ...header, name: v || '' }] })}
          />
          <SelectInput
            label={t('Match')}
            allowEmpty={false}
            options={[
              { value: 'Distinct', label: t('Each distinct value') },
              { value: 'Exact', label: t('Exact value') },
              { value: 'RegularExpression', label: t('Regular expression') },
            ]}
            value={header.type || 'Exact'}
            onChange={v => {
              const next = { ...header, type: v };
              if (v === 'Distinct') delete next.value;
              setSelector({ headers: [next] });
            }}
          />
          {header.type !== 'Distinct' && (
            <TextInput
              label={t('Header value')}
              value={header.value}
              onChange={v => setSelector({ headers: [{ ...header, value: v }] })}
            />
          )}
        </>
      )}
      {selector.sourceCIDR && (
        <>
          <TextInput
            label={t('CIDR')}
            value={selector.sourceCIDR.value}
            onChange={v => setSelector({ sourceCIDR: { ...selector.sourceCIDR, value: v } })}
          />
          <SelectInput
            label={t('Match')}
            allowEmpty={false}
            options={[
              { value: 'Distinct', label: t('Each client IP separately') },
              { value: 'Exact', label: t('The whole CIDR together') },
            ]}
            value={selector.sourceCIDR.type || 'Exact'}
            onChange={v => setSelector({ sourceCIDR: { ...selector.sourceCIDR, type: v } })}
          />
        </>
      )}
    </FieldGrid>
  );
}

export function RateLimitSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, enabled, toggle } = useSpecToggle(props);
  const type: 'Local' | 'Global' = spec.rateLimit?.type === 'Global' ? 'Global' : 'Local';
  const key = type === 'Global' ? 'global' : 'local';
  const rules = bind<RateLimitRule[]>(['spec', 'rateLimit', key, 'rules']);

  return (
    <ToggleSection
      title={t('Rate limiting')}
      description={t('Limit the number of requests sent to the backend.')}
      icon="mdi:speedometer"
      enabled={enabled('rateLimit')}
      onToggle={toggle('rateLimit', {
        type: 'Local',
        local: { rules: [{ limit: { requests: 100, unit: 'Second' } }] },
      })}
    >
      <FieldGrid>
        <SelectInput
          label={t('Scope')}
          allowEmpty={false}
          options={[
            { value: 'Local', label: t('Local (per Envoy instance)') },
            { value: 'Global', label: t('Global (shared, needs the rate limit service)') },
          ]}
          value={type}
          onChange={v => {
            const nextKey = v === 'Global' ? 'global' : 'local';
            const currentRules = spec.rateLimit?.[key]?.rules;
            bind(['spec', 'rateLimit']).onChange({
              type: v,
              [nextKey]: { rules: currentRules || [] },
            });
          }}
        />
      </FieldGrid>
      <Box sx={{ mt: 2 }}>
        <ArrayEditor<RateLimitRule>
          items={rules.value}
          onChange={rules.onChange}
          newItem={() => ({ limit: { requests: 10, unit: 'Second' } })}
          addLabel={t('Add rule')}
          itemTitle={(r, i) =>
            t('Rule #{{index}}: {{requests}} / {{unit}}', {
              index: i + 1,
              requests: r.limit?.requests ?? '?',
              unit: r.limit?.unit || '?',
            })
          }
          renderItem={(rule, update) => <RateLimitRuleEditor rule={rule} onChange={update} />}
        />
      </Box>
    </ToggleSection>
  );
}

export function CircuitBreakerSection(props: SectionProps) {
  const { t } = useText();
  const { bind, enabled, toggle } = useSpecToggle(props);
  const f = (k: string) => bind(['spec', 'circuitBreaker', k]);
  return (
    <ToggleSection
      title={t('Circuit breaker')}
      description={t(
        'Caps concurrent work towards the backend so an overloaded service can recover.'
      )}
      icon="mdi:electric-switch"
      enabled={enabled('circuitBreaker')}
      onToggle={toggle('circuitBreaker', { maxConnections: 1024, maxPendingRequests: 1024 })}
    >
      <FieldGrid columns={3}>
        <NumberInput label={t('Max connections')} min={0} {...f('maxConnections')} />
        <NumberInput label={t('Max pending requests')} min={0} {...f('maxPendingRequests')} />
        <NumberInput label={t('Max parallel requests')} min={0} {...f('maxParallelRequests')} />
        <NumberInput label={t('Max parallel retries')} min={0} {...f('maxParallelRetries')} />
        <NumberInput
          label={t('Max requests per connection')}
          min={0}
          {...f('maxRequestsPerConnection')}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function RetrySection(props: SectionProps) {
  const { t } = useText();
  const { bind, enabled, toggle } = useSpecToggle(props);
  return (
    <ToggleSection
      title={t('Retries')}
      description={t('Automatically retry failed requests.')}
      icon="mdi:refresh"
      enabled={enabled('retry')}
      onToggle={toggle('retry', {
        numRetries: 2,
        retryOn: { triggers: ['connect-failure', 'reset'] },
      })}
    >
      <FieldGrid>
        <NumberInput
          label={t('Number of retries')}
          min={0}
          {...bind(['spec', 'retry', 'numRetries'])}
        />
        <DurationInput
          label={t('Timeout per attempt')}
          {...bind(['spec', 'retry', 'perRetry', 'timeout'])}
        />
        <StringListInput
          label={t('Retry on')}
          suggestions={RETRY_TRIGGERS}
          {...bind(['spec', 'retry', 'retryOn', 'triggers'])}
        />
        <NumberListInput
          label={t('Retry on HTTP status codes')}
          suggestions={[502, 503, 504]}
          help={t('Used together with the "retriable-status-codes" trigger.')}
          {...bind(['spec', 'retry', 'retryOn', 'httpStatusCodes'])}
        />
        <DurationInput
          label={t('Backoff base interval')}
          placeholder="100ms"
          {...bind(['spec', 'retry', 'perRetry', 'backOff', 'baseInterval'])}
        />
        <DurationInput
          label={t('Backoff max interval')}
          placeholder="1s"
          {...bind(['spec', 'retry', 'perRetry', 'backOff', 'maxInterval'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function TimeoutSection(props: SectionProps) {
  const { t } = useText();
  const { bind, enabled, toggle } = useSpecToggle(props);
  return (
    <ToggleSection
      title={t('Timeouts')}
      icon="mdi:timer-outline"
      enabled={enabled('timeout')}
      onToggle={toggle('timeout', { http: { requestTimeout: '15s' } })}
    >
      <FieldGrid>
        <DurationInput
          label={t('Request timeout')}
          {...bind(['spec', 'timeout', 'http', 'requestTimeout'])}
        />
        <DurationInput
          label={t('TCP connect timeout')}
          {...bind(['spec', 'timeout', 'tcp', 'connectTimeout'])}
        />
        <DurationInput
          label={t('Connection idle timeout')}
          {...bind(['spec', 'timeout', 'http', 'connectionIdleTimeout'])}
        />
        <DurationInput
          label={t('Max connection duration')}
          {...bind(['spec', 'timeout', 'http', 'maxConnectionDuration'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function HealthCheckSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, enabled, toggle } = useSpecToggle(props);
  const active = spec.healthCheck?.active;
  const passive = spec.healthCheck?.passive;
  return (
    <ToggleSection
      title={t('Health checks')}
      description={t('Detect and eject unhealthy endpoints.')}
      icon="mdi:heart-pulse"
      enabled={enabled('healthCheck')}
      onToggle={toggle('healthCheck', { passive: { consecutive5XxErrors: 5, interval: '10s' } })}
    >
      <SwitchInput
        label={t('Active health checks (probe endpoints)')}
        value={!!active}
        onChange={on =>
          bind(['spec', 'healthCheck', 'active']).onChange(
            on
              ? {
                  type: 'HTTP',
                  interval: '10s',
                  timeout: '1s',
                  unhealthyThreshold: 3,
                  healthyThreshold: 1,
                  http: { path: '/healthz' },
                }
              : undefined
          )
        }
      />
      {active && (
        <Box sx={{ mb: 2 }}>
          <FieldGrid columns={3}>
            <SelectInput
              label={t('Probe type')}
              allowEmpty={false}
              options={['HTTP', 'TCP', 'GRPC']}
              value={active.type}
              onChange={v =>
                bind(['spec', 'healthCheck', 'active']).onChange({
                  ...active,
                  type: v,
                  http: v === 'HTTP' ? active.http || { path: '/healthz' } : undefined,
                })
              }
            />
            {active.type === 'HTTP' && (
              <>
                <TextInput
                  label={t('Path')}
                  {...bind(['spec', 'healthCheck', 'active', 'http', 'path'])}
                />
                <NumberListInput
                  label={t('Expected statuses')}
                  suggestions={[200, 204]}
                  {...bind(['spec', 'healthCheck', 'active', 'http', 'expectedStatuses'])}
                />
              </>
            )}
            <DurationInput
              label={t('Interval')}
              {...bind(['spec', 'healthCheck', 'active', 'interval'])}
            />
            <DurationInput
              label={t('Timeout')}
              {...bind(['spec', 'healthCheck', 'active', 'timeout'])}
            />
            <NumberInput
              label={t('Unhealthy threshold')}
              min={1}
              {...bind(['spec', 'healthCheck', 'active', 'unhealthyThreshold'])}
            />
            <NumberInput
              label={t('Healthy threshold')}
              min={1}
              {...bind(['spec', 'healthCheck', 'active', 'healthyThreshold'])}
            />
          </FieldGrid>
        </Box>
      )}
      <SwitchInput
        label={t('Passive health checks (outlier detection)')}
        value={!!passive}
        onChange={on =>
          bind(['spec', 'healthCheck', 'passive']).onChange(
            on ? { consecutive5XxErrors: 5, interval: '10s', baseEjectionTime: '30s' } : undefined
          )
        }
      />
      {passive && (
        <FieldGrid columns={3}>
          <NumberInput
            label={t('Consecutive 5xx errors')}
            min={0}
            {...bind(['spec', 'healthCheck', 'passive', 'consecutive5XxErrors'])}
          />
          <NumberInput
            label={t('Consecutive gateway errors')}
            min={0}
            {...bind(['spec', 'healthCheck', 'passive', 'consecutiveGatewayErrors'])}
          />
          <DurationInput
            label={t('Interval')}
            {...bind(['spec', 'healthCheck', 'passive', 'interval'])}
          />
          <DurationInput
            label={t('Base ejection time')}
            {...bind(['spec', 'healthCheck', 'passive', 'baseEjectionTime'])}
          />
          <NumberInput
            label={t('Max ejection percent')}
            min={0}
            max={100}
            {...bind(['spec', 'healthCheck', 'passive', 'maxEjectionPercent'])}
          />
        </FieldGrid>
      )}
    </ToggleSection>
  );
}

export function FaultInjectionSection(props: SectionProps) {
  const { t } = useText();
  const { bind, enabled, toggle } = useSpecToggle(props);
  return (
    <ToggleSection
      title={t('Fault injection')}
      description={t(
        'Inject delays or errors to test client resilience. Do not leave enabled in production.'
      )}
      icon="mdi:bug-outline"
      enabled={enabled('faultInjection')}
      onToggle={toggle('faultInjection', { abort: { httpStatus: 503, percentage: 5 } })}
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('Delay')}
      </Typography>
      <FieldGrid>
        <DurationInput
          label={t('Fixed delay')}
          {...bind(['spec', 'faultInjection', 'delay', 'fixedDelay'])}
        />
        <NumberInput
          label={t('Percentage of requests')}
          min={0}
          max={100}
          {...bind(['spec', 'faultInjection', 'delay', 'percentage'])}
        />
      </FieldGrid>
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        {t('Abort')}
      </Typography>
      <FieldGrid columns={3}>
        <NumberInput
          label={t('HTTP status')}
          min={200}
          max={599}
          {...bind(['spec', 'faultInjection', 'abort', 'httpStatus'])}
        />
        <NumberInput
          label={t('gRPC status')}
          min={0}
          {...bind(['spec', 'faultInjection', 'abort', 'grpcStatus'])}
        />
        <NumberInput
          label={t('Percentage of requests')}
          min={0}
          max={100}
          {...bind(['spec', 'faultInjection', 'abort', 'percentage'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function CompressionSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, enabled, toggle } = useSpecToggle(props);
  const types: string[] = (spec.compression || []).map((c: { type: string }) => c.type);
  return (
    <ToggleSection
      title={t('Response compression')}
      icon="mdi:zip-box-outline"
      enabled={enabled('compression')}
      onToggle={toggle('compression', [{ type: 'Gzip' }])}
    >
      <FieldGrid>
        <StringListInput
          label={t('Algorithms')}
          suggestions={['Gzip', 'Brotli', 'Zstd']}
          value={types}
          onChange={v => bind(['spec', 'compression']).onChange((v || []).map(type => ({ type })))}
        />
        <SwitchInput
          label={t('Use client protocol')}
          help={t('Talk to the backend with the same HTTP version the client used.')}
          {...bind(['spec', 'useClientProtocol'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}
