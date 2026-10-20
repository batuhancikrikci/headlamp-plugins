/**
 * Thin client for the Prometheus (v1) and Alertmanager (v2) HTTP APIs, reached
 * through the Kubernetes API server service proxy (requires `services/proxy`).
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  AMAlert,
  AMMatcher,
  AMSilence,
  PromAlert,
  PromQueryData,
  PromRuleGroup,
  PromTarget,
} from '../types';

export class MonitoringApiError extends Error {
  status?: number;
  /** Error type reported by Prometheus (bad_data, timeout, ...). */
  errorType?: string;

  constructor(message: string, status?: number, errorType?: string) {
    super(message);
    this.name = 'MonitoringApiError';
    this.status = status;
    this.errorType = errorType;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isUnavailable() {
    return this.status === 502 || this.status === 503 || this.status === 404;
  }
}

/** Extracts the useful message from an error thrown by ApiProxy (message is "StatusText - body"). */
function toApiError(err: unknown): MonitoringApiError {
  const e = err as { message?: string; status?: number };
  const message = e?.message || String(err);
  const dash = message.indexOf(' - ');
  const body = dash >= 0 ? message.slice(dash + 3) : '';
  if (body) {
    try {
      const json = JSON.parse(body);
      if (json?.error) return new MonitoringApiError(String(json.error), e.status, json.errorType);
      if (json?.message) return new MonitoringApiError(String(json.message), e.status);
    } catch {
      // Not JSON (e.g. plain text from Alertmanager): keep the raw body.
      return new MonitoringApiError(body.trim(), e.status);
    }
  }
  return new MonitoringApiError(message, e.status);
}

async function rawRequest(url: string, init: Record<string, unknown> = {}): Promise<unknown> {
  let response: Response;
  try {
    // isJSON:false returns the raw Response so empty bodies (DELETE) don't throw.
    response = (await ApiProxy.request(url, { ...init, isJSON: false })) as Response;
  } catch (err) {
    throw toApiError(err);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface PromEnvelope<T> {
  status: 'success' | 'error';
  data: T;
  error?: string;
  errorType?: string;
  warnings?: string[];
}

async function promGet<T>(
  base: string,
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  const qs = params
    ? '?' +
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const res = (await rawRequest(`${base}${path}${qs}`)) as PromEnvelope<T> | null;
  if (!res || typeof res !== 'object') {
    throw new MonitoringApiError('Unexpected response from Prometheus');
  }
  if (res.status !== 'success') {
    throw new MonitoringApiError(res.error || 'Prometheus query failed', undefined, res.errorType);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Prometheus
// ---------------------------------------------------------------------------

export function promQuery(base: string, query: string, time?: number) {
  return promGet<PromQueryData>(base, '/api/v1/query', time ? { query, time } : { query });
}

export function promQueryRange(
  base: string,
  query: string,
  start: number,
  end: number,
  step: number
) {
  return promGet<PromQueryData>(base, '/api/v1/query_range', { query, start, end, step });
}

export async function promTargets(base: string): Promise<PromTarget[]> {
  const data = await promGet<{ activeTargets: PromTarget[] }>(base, '/api/v1/targets', {
    state: 'active',
  });
  return data.activeTargets || [];
}

export async function promRuleGroups(
  base: string,
  type?: 'alert' | 'record'
): Promise<PromRuleGroup[]> {
  const data = await promGet<{ groups: PromRuleGroup[] }>(
    base,
    '/api/v1/rules',
    type ? { type } : undefined
  );
  return data.groups || [];
}

export async function promAlerts(base: string): Promise<PromAlert[]> {
  const data = await promGet<{ alerts: PromAlert[] }>(base, '/api/v1/alerts');
  return data.alerts || [];
}

export async function promLabelValues(base: string, label: string): Promise<string[]> {
  return (await promGet<string[]>(base, `/api/v1/label/${encodeURIComponent(label)}/values`)) || [];
}

export interface PromBuildInfo {
  version: string;
  revision?: string;
  goVersion?: string;
}

export function promBuildInfo(base: string) {
  return promGet<PromBuildInfo>(base, '/api/v1/status/buildinfo');
}

export interface PromRuntimeInfo {
  reloadConfigSuccess: boolean;
  lastConfigTime: string;
  storageRetention?: string;
  startTime?: string;
}

export function promRuntimeInfo(base: string) {
  return promGet<PromRuntimeInfo>(base, '/api/v1/status/runtimeinfo');
}

// ---------------------------------------------------------------------------
// Alertmanager
// ---------------------------------------------------------------------------

export async function amAlerts(
  base: string,
  opts: { silenced?: boolean; inhibited?: boolean; active?: boolean } = {}
): Promise<AMAlert[]> {
  const params = new URLSearchParams({
    silenced: String(opts.silenced ?? true),
    inhibited: String(opts.inhibited ?? true),
    active: String(opts.active ?? true),
  });
  return ((await rawRequest(`${base}/api/v2/alerts?${params}`)) as AMAlert[]) || [];
}

export async function amSilences(base: string): Promise<AMSilence[]> {
  return ((await rawRequest(`${base}/api/v2/silences`)) as AMSilence[]) || [];
}

export interface SilencePayload {
  /** Set to update (Alertmanager replaces the silence with a new id). */
  id?: string;
  matchers: AMMatcher[];
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

export async function amCreateSilence(base: string, payload: SilencePayload): Promise<string> {
  const res = (await rawRequest(`${base}/api/v2/silences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as { silenceID?: string } | null;
  return res?.silenceID || '';
}

export async function amExpireSilence(base: string, id: string): Promise<void> {
  await rawRequest(`${base}/api/v2/silence/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface AMStatus {
  versionInfo?: { version?: string };
  cluster?: { status?: string; peers?: unknown[] };
  uptime?: string;
}

export async function amStatus(base: string): Promise<AMStatus> {
  return ((await rawRequest(`${base}/api/v2/status`)) as AMStatus) || {};
}
