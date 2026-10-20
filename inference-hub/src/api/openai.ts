/**
 * OpenAI-compatible chat against model endpoints, reached through the Kubernetes API server
 * service (or pod) proxy via the Headlamp backend. Nothing leaves the cluster connection.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterParams, podProxyPath, serviceProxyPath } from './paths';

export type TargetKind = 'LLMInferenceService' | 'InferenceService' | 'Engine';

/** Something the Playground can talk to. */
export interface ChatTarget {
  /** "llm/ns/name", "isvc/ns/name" or "pod/ns/pod". */
  id: string;
  kind: TargetKind;
  namespace: string;
  name: string;
  defaultModel: string;
  /** Public URL (e.g. gateway) for the curl snippet. */
  publicUrl?: string;
  /** Engine pods: port and scheme of the vLLM server. */
  pod?: { port: number; scheme: 'http' | 'https' };
}

export interface ResolvedTarget {
  /** Proxy path up to the API root, e.g. /api/v1/namespaces/ai/services/x:8000/proxy */
  proxyBase: string;
  /** "/v1" (vLLM) or "/openai/v1" (KServe Hugging Face runtime). */
  apiPrefix: string;
  /** In-cluster base URL for curl, e.g. http://x.ai.svc:8000 */
  inClusterUrl: string;
  models: string[];
}

interface ServiceJson {
  metadata: { name: string; namespace: string; labels?: Record<string, string> };
  spec?: {
    type?: string;
    ports?: Array<{ name?: string; port: number; appProtocol?: string }>;
  };
}

export class ChatError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function errorOf(err: unknown): ChatError {
  const e = err as { status?: number; message?: string };
  return new ChatError(e?.message || String(err), e?.status);
}

async function listServices(
  cluster: string,
  namespace: string,
  selector: string
): Promise<ServiceJson[]> {
  const res: { items?: ServiceJson[] } = await ApiProxy.request(
    `/api/v1/namespaces/${encodeURIComponent(
      namespace
    )}/services?labelSelector=${encodeURIComponent(selector)}`,
    clusterParams(cluster)
  );
  return res.items || [];
}

function serviceScheme(port?: { name?: string; appProtocol?: string }): 'http' | 'https' {
  return port?.name === 'https' || port?.appProtocol === 'https' ? 'https' : 'http';
}

/** Picks the service in front of the model server of a KServe endpoint. */
export function pickService(target: ChatTarget, services: ServiceJson[]): ServiceJson | undefined {
  const usable = services.filter(
    s => s.spec?.type !== 'ExternalName' && (s.spec?.ports || []).length > 0
  );
  if (target.kind === 'LLMInferenceService') {
    return (
      usable.find(
        s => s.metadata.labels?.['app.kubernetes.io/component'] === 'llminferenceservice-workload'
      ) || usable.find(s => s.metadata.name.endsWith('-kserve-workload-svc'))
    );
  }
  return (
    usable.find(s => s.metadata.name === `${target.name}-predictor`) ||
    usable.find(s => s.metadata.labels?.component === 'predictor')
  );
}

async function fetchModels(cluster: string, path: string): Promise<string[]> {
  const res: { data?: Array<{ id: string }> } = await ApiProxy.request(
    path,
    clusterParams(cluster, { timeout: 15000 })
  );
  if (!Array.isArray(res?.data)) throw new ChatError('Not an OpenAI /models response');
  return res.data.map(m => m.id);
}

/**
 * Schemes to try for a port, the one its name suggests first. Port names are not reliable:
 * KServe names the workload port "https" or "http" depending on its configuration, while the
 * server behind it may speak the other protocol.
 */
export function schemeOrder(preferred: 'http' | 'https'): Array<'http' | 'https'> {
  return preferred === 'https' ? ['https', 'http'] : ['http', 'https'];
}

/** Finds the proxy path and API prefix of a target and lists its models. */
export async function resolveTarget(cluster: string, target: ChatTarget): Promise<ResolvedTarget> {
  const candidates: Array<{ proxyBase: string; inClusterUrl: string }> = [];
  if (target.kind === 'Engine' && target.pod) {
    const { port } = target.pod;
    for (const scheme of schemeOrder(target.pod.scheme)) {
      candidates.push({
        proxyBase: podProxyPath(target.namespace, target.name, port, scheme),
        inClusterUrl: `${scheme}://<pod-ip>:${port}`,
      });
    }
  } else {
    const selector =
      target.kind === 'LLMInferenceService'
        ? `app.kubernetes.io/name=${target.name},app.kubernetes.io/part-of=llminferenceservice`
        : `serving.kserve.io/inferenceservice=${target.name}`;
    let services: ServiceJson[];
    try {
      services = await listServices(cluster, target.namespace, selector);
    } catch (err) {
      throw errorOf(err);
    }
    const svc = pickService(target, services);
    if (!svc) {
      throw new ChatError(
        target.kind === 'LLMInferenceService'
          ? 'The workload service of this LLM service does not exist yet.'
          : 'The predictor service of this inference service does not exist yet.'
      );
    }
    const port = svc.spec?.ports?.find(p => p.port === 8000) || svc.spec?.ports?.[0];
    const portNumber = port?.port || 80;
    for (const scheme of schemeOrder(serviceScheme(port))) {
      candidates.push({
        proxyBase: serviceProxyPath(target.namespace, svc.metadata.name, portNumber, scheme),
        inClusterUrl: `${scheme}://${svc.metadata.name}.${target.namespace}.svc:${portNumber}`,
      });
    }
  }

  const errors: string[] = [];
  for (const { proxyBase, inClusterUrl } of candidates) {
    const scheme = inClusterUrl.split(':')[0];
    for (const apiPrefix of ['/v1', '/openai/v1']) {
      try {
        const models = await fetchModels(cluster, `${proxyBase}${apiPrefix}/models`);
        return { proxyBase, apiPrefix, inClusterUrl, models };
      } catch (err) {
        errors.push(`${scheme} ${apiPrefix}/models: ${errorOf(err).message}`);
      }
    }
  }
  throw new ChatError(`No OpenAI-compatible API found (${errors.join('; ')})`);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  /**
   * Leave temperature and top P to the model server, which then uses the values recommended in
   * the model's generation_config.json (vLLM's default `--generation-config auto`).
   */
  modelDefaults: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  stream: boolean;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  usage: Usage;
  finishReason?: string;
  /** ms from send to the first content token (streaming only). */
  ttftMs?: number;
  totalMs: number;
  /** Streaming was requested but the whole answer arrived at once (buffering proxy). */
  buffered: boolean;
  streamed: boolean;
}

export interface ChatCallbacks {
  onDelta?: (content: string, reasoning: string) => void;
}

export function requestBody(
  model: string,
  messages: ChatMessage[],
  params: ChatParams,
  stream: boolean,
  streamUsage = true
) {
  return {
    model,
    messages,
    ...(params.modelDefaults ? {} : { temperature: params.temperature, top_p: params.topP }),
    max_tokens: params.maxTokens,
    stream,
    ...(stream && streamUsage ? { stream_options: { include_usage: true } } : {}),
  };
}

interface ChunkJson {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
}

/** Incremental Server-Sent Events parser for OpenAI streaming responses. */
export class SseParser {
  private buffer = '';

  /** Feeds text; returns the complete `data:` payloads (without "[DONE]"). */
  push(text: string): { events: string[]; done: boolean } {
    this.buffer += text.replace(/\r\n/g, '\n');
    const events: string[] = [];
    let done = false;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = block
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      if (data.trim() === '[DONE]') done = true;
      else events.push(data);
    }
    return { events, done };
  }

  /** Remaining payload when the stream ends without a trailing blank line. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest.startsWith('data:')) return [];
    const data = rest.slice(5).trim();
    return data && data !== '[DONE]' ? [data] : [];
  }
}

/** Applies a streamed or complete chunk to the accumulated result. */
export function applyChunk(
  acc: { content: string; reasoning: string; usage: Usage; finishReason?: string },
  json: ChunkJson
) {
  if (json.error) {
    throw new ChatError(
      typeof json.error === 'string' ? json.error : json.error.message || 'Model error'
    );
  }
  for (const choice of json.choices || []) {
    const part = choice.delta || choice.message || {};
    if (part.content) acc.content += part.content;
    const reasoning = part.reasoning_content || part.reasoning;
    if (reasoning) acc.reasoning += reasoning;
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
  }
  if (json.usage) {
    acc.usage = {
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
    };
  }
}

async function post(
  cluster: string,
  path: string,
  body: unknown,
  signal: AbortSignal,
  stream: boolean
): Promise<Response> {
  try {
    return await ApiProxy.request(
      path,
      clusterParams(cluster, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
        isJSON: false,
        signal,
      })
    );
  } catch (err) {
    throw errorOf(err);
  }
}

/**
 * Sends a chat completion. With `params.stream` it streams over SSE and falls back to a single
 * JSON response when the server (or a proxy) does not stream.
 */
export async function chatCompletion(
  cluster: string,
  resolved: ResolvedTarget,
  model: string,
  messages: ChatMessage[],
  params: ChatParams,
  signal: AbortSignal,
  callbacks: ChatCallbacks = {}
): Promise<ChatResult> {
  const path = `${resolved.proxyBase}${resolved.apiPrefix}/chat/completions`;
  const started = performance.now();
  const acc = {
    content: '',
    reasoning: '',
    usage: {} as Usage,
    finishReason: undefined as string | undefined,
  };

  let response: Response;
  if (params.stream) {
    try {
      response = await post(
        cluster,
        path,
        requestBody(model, messages, params, true),
        signal,
        true
      );
    } catch (err) {
      // Older servers reject stream_options; retry once without it.
      if ((err as ChatError).status === 400) {
        response = await post(
          cluster,
          path,
          requestBody(model, messages, params, true, false),
          signal,
          true
        );
      } else {
        throw err;
      }
    }
  } else {
    response = await post(
      cluster,
      path,
      requestBody(model, messages, params, false),
      signal,
      false
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!params.stream || !contentType.includes('text/event-stream') || !response.body) {
    const json = (await response.json()) as ChunkJson;
    applyChunk(acc, json);
    callbacks.onDelta?.(acc.content, acc.reasoning);
    return {
      ...acc,
      totalMs: performance.now() - started,
      buffered: params.stream,
      streamed: false,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let ttftMs: number | undefined;
  let firstChunkAt: number | undefined;
  let chunks = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const now = performance.now();
    firstChunkAt = firstChunkAt ?? now;
    const { events, done: finished } = parser.push(decoder.decode(value, { stream: true }));
    for (const data of events) {
      applyChunk(acc, JSON.parse(data) as ChunkJson);
      chunks++;
      if (ttftMs === undefined && (acc.content || acc.reasoning)) ttftMs = now - started;
    }
    callbacks.onDelta?.(acc.content, acc.reasoning);
    if (finished) break;
  }
  for (const data of parser.flush()) applyChunk(acc, JSON.parse(data) as ChunkJson);
  callbacks.onDelta?.(acc.content, acc.reasoning);
  const totalMs = performance.now() - started;
  // Everything arriving within the last few ms of a longer request means a proxy buffered it.
  const buffered =
    chunks > 2 &&
    firstChunkAt !== undefined &&
    totalMs - (firstChunkAt - started) < 50 &&
    totalMs > 500;
  return { ...acc, ttftMs: buffered ? undefined : ttftMs, totalMs, buffered, streamed: true };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** curl command for the same request. */
export function buildCurl(
  baseUrl: string,
  apiPrefix: string,
  model: string,
  messages: ChatMessage[],
  params: ChatParams
): string {
  const body = JSON.stringify(requestBody(model, messages, params, params.stream), null, 2);
  const url = `${baseUrl.replace(/\/$/, '')}${apiPrefix}/chat/completions`;
  return [
    `curl ${params.stream ? '-N ' : ''}${url.startsWith('https') ? '-k ' : ''}${shellQuote(
      url
    )} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(body)}`,
  ].join('\n');
}
