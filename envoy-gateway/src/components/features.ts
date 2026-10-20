/**
 * Feature summaries shown as icon chips in list views and detail headers.
 */
import type { BackendTrafficPolicy } from '../resources/backendTrafficPolicy';
import type { ClientTrafficPolicy } from '../resources/clientTrafficPolicy';
import type { EnvoyExtensionPolicy } from '../resources/envoyExtensionPolicy';
import type { SecurityPolicy } from '../resources/securityPolicy';
import type { Feature } from './common/SharedComponents';

type T = (key: string, params?: Record<string, unknown>) => string;

export function btpFeatures(item: BackendTrafficPolicy, t: T): Feature[] {
  const s = item.spec;
  const f: Feature[] = [];
  if (s.rateLimit) {
    f.push({
      id: 'rateLimit',
      label: t('Rate limit ({{type}})', { type: s.rateLimit.type || 'Local' }),
      icon: 'mdi:speedometer',
    });
  }
  if (s.loadBalancer)
    f.push({
      id: 'lb',
      label: s.loadBalancer.type || t('Load balancer'),
      icon: 'mdi:scale-balance',
    });
  if (s.circuitBreaker)
    f.push({ id: 'cb', label: t('Circuit breaker'), icon: 'mdi:electric-switch' });
  if (s.retry) f.push({ id: 'retry', label: t('Retry'), icon: 'mdi:refresh' });
  if (s.timeout) f.push({ id: 'timeout', label: t('Timeout'), icon: 'mdi:timer-outline' });
  if (s.healthCheck) f.push({ id: 'hc', label: t('Health check'), icon: 'mdi:heart-pulse' });
  if (s.faultInjection) f.push({ id: 'fi', label: t('Fault injection'), icon: 'mdi:bug-outline' });
  if (s.compression?.length)
    f.push({ id: 'comp', label: t('Compression'), icon: 'mdi:zip-box-outline' });
  return f;
}

export function ctpFeatures(item: ClientTrafficPolicy, t: T): Feature[] {
  const s = item.spec;
  const f: Feature[] = [];
  if (s.tls) {
    f.push({
      id: 'tls',
      label: s.tls.minVersion ? t('TLS ≥ {{v}}', { v: s.tls.minVersion }) : t('TLS'),
      icon: 'mdi:lock-outline',
    });
  }
  if (s.tls?.clientValidation)
    f.push({ id: 'mtls', label: t('mTLS'), icon: 'mdi:certificate-outline' });
  if (s.enableProxyProtocol)
    f.push({ id: 'pp', label: t('PROXY protocol'), icon: 'mdi:swap-horizontal' });
  if (s.timeout) f.push({ id: 'timeout', label: t('Timeout'), icon: 'mdi:timer-outline' });
  if (s.connection) f.push({ id: 'conn', label: t('Connection limits'), icon: 'mdi:speedometer' });
  if (s.clientIPDetection)
    f.push({ id: 'ip', label: t('Client IP detection'), icon: 'mdi:ip-network-outline' });
  if (s.tcpKeepalive) f.push({ id: 'ka', label: t('TCP keepalive'), icon: 'mdi:heart-pulse' });
  if (s.headers) f.push({ id: 'headers', label: t('Headers'), icon: 'mdi:format-list-bulleted' });
  return f;
}

export function spFeatures(item: SecurityPolicy, t: T): Feature[] {
  const s = item.spec;
  const f: Feature[] = [];
  if (s.jwt) f.push({ id: 'jwt', label: 'JWT', icon: 'mdi:key-chain-variant' });
  if (s.oidc) f.push({ id: 'oidc', label: 'OIDC', icon: 'mdi:account-key-outline' });
  if (s.basicAuth)
    f.push({ id: 'basic', label: t('Basic auth'), icon: 'mdi:account-lock-outline' });
  if (s.apiKeyAuth) f.push({ id: 'apikey', label: t('API key'), icon: 'mdi:key-outline' });
  if (s.extAuth)
    f.push({ id: 'ext', label: t('External auth'), icon: 'mdi:shield-account-outline' });
  if (s.cors) f.push({ id: 'cors', label: 'CORS', icon: 'mdi:web' });
  if (s.authorization) {
    f.push({
      id: 'authz',
      label: t('Authorization ({{action}})', { action: s.authorization.defaultAction || 'Deny' }),
      icon: 'mdi:shield-check-outline',
    });
  }
  return f;
}

export function eepFeatures(item: EnvoyExtensionPolicy, t: T): Feature[] {
  const f: Feature[] = [];
  if (item.wasmCount)
    f.push({
      id: 'wasm',
      label: t('Wasm × {{n}}', { n: item.wasmCount }),
      icon: 'mdi:puzzle-outline',
    });
  if (item.extProcCount) {
    f.push({
      id: 'extproc',
      label: t('ExtProc × {{n}}', { n: item.extProcCount }),
      icon: 'mdi:cog-transfer-outline',
    });
  }
  if (item.luaCount)
    f.push({ id: 'lua', label: t('Lua × {{n}}', { n: item.luaCount }), icon: 'mdi:language-lua' });
  return f;
}
