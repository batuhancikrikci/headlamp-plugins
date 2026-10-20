/**
 * Form model for the "Connect a Provider" wizard (AIServiceBackend + companions), its edit
 * mapping and in-cluster Service discovery helpers. Pure, unit tested.
 */
import type { APISchemaName } from '../../resources/common';
import { PROVIDER_PRESETS, ProviderPreset } from './providerPresets';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BackendForm {
  presetId: string;
  name: string;
  namespace: string;
  schema: APISchemaName;
  schemaVersion: string;
  schemaPrefix: string;
  endpointMode: 'new' | 'existing';
  envoyBackendName: string;
  hostname: string;
  port: string;
  tls: boolean;
  configureAuth: boolean;
}

export function formFromPreset(p: ProviderPreset, prev?: BackendForm): BackendForm {
  return {
    presetId: p.id,
    name: prev?.name || '',
    namespace: prev?.namespace || 'default',
    schema: p.schema,
    schemaVersion: p.schemaVersion || '',
    schemaPrefix: '',
    endpointMode: prev?.endpointMode || 'new',
    envoyBackendName: prev?.envoyBackendName || '',
    hostname: p.hostname,
    port: String(p.port),
    tls: p.tls,
    configureAuth: !!p.policyType,
  };
}

// ─── Edit support ──────────────────────────────────────────────────────────

/** Best matching preset for an existing schema (used for the logo and defaults only). */
export function presetForSchema(schema: string, version?: string): ProviderPreset {
  return (
    PROVIDER_PRESETS.find(
      p => p.schema === schema && (p.schemaVersion || '') === (version || '')
    ) ||
    PROVIDER_PRESETS.find(p => p.schema === schema) ||
    PROVIDER_PRESETS[0]
  );
}

/** Pre-fills the form from an existing AIServiceBackend (endpoint = its current Backend). */
export function formFromAISB(json: Json): BackendForm {
  const spec: Json = json.spec || {};
  const preset = presetForSchema(spec.schema?.name, spec.schema?.version);
  return {
    ...formFromPreset(preset),
    name: json.metadata?.name || '',
    namespace: json.metadata?.namespace || '',
    schema: spec.schema?.name || preset.schema,
    schemaVersion: spec.schema?.version || '',
    schemaPrefix: spec.schema?.prefix || '',
    endpointMode: 'existing',
    envoyBackendName: spec.backendRef?.name || '',
    configureAuth: false,
  };
}

function setOrDelete(obj: Json, key: string, value: string) {
  if (value) obj[key] = value;
  else delete obj[key];
}

/**
 * Applies the form onto an existing spec. Header/body mutations and extra backendRef fields
 * (namespace, port) are kept; the backendRef only changes when another Backend is chosen.
 */
export function mergeAISBSpec(
  original: Json | undefined,
  form: BackendForm,
  envoyName: string
): Json {
  const spec: Json = JSON.parse(JSON.stringify(original || {}));
  const schema: Json = { ...(spec.schema || {}), name: form.schema };
  setOrDelete(schema, 'version', form.schemaVersion);
  setOrDelete(schema, 'prefix', form.schemaPrefix);
  spec.schema = schema;
  const ref: Json = spec.backendRef || {};
  if (ref.name !== envoyName) {
    spec.backendRef = { group: 'gateway.envoyproxy.io', kind: 'Backend', name: envoyName };
  }
  return spec;
}

// ─── In-cluster Service discovery ──────────────────────────────────────────

export interface ServicePortLike {
  name?: string;
  port: number;
  protocol?: string;
  appProtocol?: string;
}

const PORT_NAME_HINT =
  /^(https?|openai|api|mcp|serve|serving|inference|vllm|ollama|tgi|web)(-.*)?$/i;
const INFERENCE_PORTS = [8000, 11434, 8080, 80, 3000, 443, 8443];

/** Picks the port an OpenAI-compatible server most likely listens on. */
export function bestServicePort(ports: ServicePortLike[] | undefined): ServicePortLike | undefined {
  const tcp = (ports || []).filter(p => !p.protocol || p.protocol === 'TCP');
  if (tcp.length <= 1) return tcp[0];
  return (
    tcp.find(p => p.name && PORT_NAME_HINT.test(p.name)) ||
    INFERENCE_PORTS.map(n => tcp.find(p => p.port === n)).find(Boolean) ||
    tcp[0]
  );
}

/** Whether traffic to this port should use TLS. */
export function portUsesTLS(port: ServicePortLike | undefined): boolean {
  if (!port) return false;
  return (
    port.port === 443 ||
    port.port === 8443 ||
    /^https/i.test(port.name || '') ||
    /^https/i.test(port.appProtocol || '')
  );
}

/** Cluster DNS name of a Service. */
export function serviceHostname(name: string, namespace: string): string {
  return `${name}.${namespace}.svc.cluster.local`;
}
