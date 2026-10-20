/**
 * Detects vLLM model servers among pods: KServe LLMInferenceService workloads, llm-d model
 * servers, the KServe Hugging Face runtime (vLLM backend) and plain vLLM deployments.
 */
import { HealthSummary } from '../utils/health';
import { EndpointSlug, podRole } from './endpoint';
import { podGpus, podHealth, PodJson } from './pod';

interface Probe {
  httpGet?: { scheme?: string; port?: number | string };
}

export interface EngineContainer {
  name?: string;
  image?: string;
  command?: string[];
  args?: string[];
  ports?: Array<{ containerPort: number; name?: string }>;
  readinessProbe?: Probe;
  livenessProbe?: Probe;
  startupProbe?: Probe;
}

export type EngineFlavor = 'vllm' | 'kserve-hf';

export interface VllmEngine {
  /** "namespace/pod" */
  key: string;
  namespace: string;
  pod: string;
  node?: string;
  container: string;
  flavor: EngineFlavor;
  role: string;
  image: string;
  version?: string;
  servedModelName?: string;
  port: number;
  scheme: 'http' | 'https';
  gpus: number;
  health: HealthSummary;
  endpoint?: { slug: EndpointSlug; name: string };
  createdAt?: string;
  raw: PodJson;
}

const VLLM_IMAGE = /vllm|\/llm-d-(cuda|rocm|xpu|cpu|aws|hpu|tpu)\b|\/llm-d:/i;
/** llm-d images that sit next to vLLM but are not model servers. */
const NOT_ENGINE_IMAGE =
  /router|sidecar|endpoint-picker|scheduler|tokenizer|latency-predictor|inference-sim|epp/i;
const KSERVE_HF_IMAGE = /huggingfaceserver/i;

function commandLine(c: EngineContainer): string {
  return [...(c.command || []), ...(c.args || [])].join(' ');
}

export function imageVersion(image: string): string | undefined {
  const withoutDigest = image.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.lastIndexOf(':');
  return colon > lastSlash ? withoutDigest.slice(colon + 1) : undefined;
}

function flagValue(line: string, flag: string): string | undefined {
  const m = new RegExp(`${flag}(?:=|\\s+)"?([^"\\s]+)"?`).exec(line);
  return m?.[1];
}

export function engineFlavor(c: EngineContainer): EngineFlavor | null {
  const image = c.image || '';
  const line = commandLine(c);
  if (KSERVE_HF_IMAGE.test(image)) return 'kserve-hf';
  if (/vllm\s+serve|vllm\.entrypoints/.test(line)) return 'vllm';
  if (VLLM_IMAGE.test(image) && !NOT_ENGINE_IMAGE.test(image)) return 'vllm';
  return null;
}

function probeScheme(c: EngineContainer): 'http' | 'https' {
  const probes = [c.readinessProbe, c.livenessProbe, c.startupProbe];
  return probes.some(p => p?.httpGet?.scheme?.toUpperCase() === 'HTTPS') ? 'https' : 'http';
}

function enginePort(c: EngineContainer, flavor: EngineFlavor): number {
  const fromArgs = Number(
    flagValue(commandLine(c), '--port') || flagValue(commandLine(c), '--http_port')
  );
  const declared = c.ports?.[0]?.containerPort;
  // Rendered KServe presets start vLLM with "--port 8000" but the P/D decode preset moves vLLM
  // to the declared container port (8001) behind the routing sidecar: prefer the declared port.
  return (
    declared ||
    (isFinite(fromArgs) && fromArgs > 0 ? fromArgs : flavor === 'kserve-hf' ? 8080 : 8000)
  );
}

function endpointOf(labels: Record<string, string>): VllmEngine['endpoint'] {
  if (
    labels['app.kubernetes.io/part-of'] === 'llminferenceservice' &&
    labels['app.kubernetes.io/name']
  ) {
    return { slug: 'llm', name: labels['app.kubernetes.io/name'] };
  }
  if (labels['serving.kserve.io/inferenceservice']) {
    return { slug: 'isvc', name: labels['serving.kserve.io/inferenceservice'] };
  }
  return undefined;
}

export function detectEngine(pod: PodJson): VllmEngine | null {
  const containers = (pod.spec?.containers || []) as EngineContainer[];
  // Prefer the container named "main" (KServe convention).
  const ordered = [...containers].sort((a, b) =>
    a.name === 'main' ? -1 : b.name === 'main' ? 1 : 0
  );
  for (const c of ordered) {
    const flavor = engineFlavor(c);
    if (!flavor) continue;
    const labels = pod.metadata.labels || {};
    const line = commandLine(c);
    return {
      key: `${pod.metadata.namespace || ''}/${pod.metadata.name}`,
      namespace: pod.metadata.namespace || '',
      pod: pod.metadata.name,
      node: pod.spec?.nodeName,
      container: c.name || '',
      flavor,
      role: podRole(labels),
      image: c.image || '',
      version: imageVersion(c.image || ''),
      servedModelName:
        flagValue(line, '--served-model-name') ||
        flagValue(line, '--model_name') ||
        flagValue(line, '--model'),
      port: enginePort(c, flavor),
      scheme: probeScheme(c),
      gpus: podGpus(pod),
      health: podHealth(pod),
      endpoint: endpointOf(labels),
      createdAt: pod.metadata.creationTimestamp,
      raw: pod,
    };
  }
  return null;
}

export function detectEngines(pods: PodJson[]): VllmEngine[] {
  return pods
    .map(detectEngine)
    .filter((e): e is VllmEngine => e !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Engines worth scraping: running and not terminating. */
export function isScrapable(engine: VllmEngine): boolean {
  return engine.raw.status?.phase === 'Running' && !engine.raw.metadata.deletionTimestamp;
}
