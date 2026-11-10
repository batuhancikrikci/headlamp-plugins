/**
 * OpenAI-compatible chat against model endpoints, reached through the Kubernetes API server
 * service (or pod) proxy via the Headlamp backend. Nothing leaves the cluster connection.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { gatewayServiceSelectors, GatewayVia, pickGatewayPort } from '../resources/gatewayTargets';
import { KubeJson } from '../resources/types';
import { clusterParams, podProxyPath, serviceProxyPath } from './paths';
import { requestHeaders } from './requestHeaders';

export type TargetKind = 'LLMInferenceService' | 'InferenceService' | 'Engine' | 'Gateway';

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
  /** Gateway targets: the gateway and route the requests go through. */
  gateway?: GatewayVia;
}

export interface ResolvedTarget {
  /** Proxy path up to the API root, e.g. /api/v1/namespaces/ai/services/x:8000/proxy */
  proxyBase: string;
  /** "/v1" (vLLM) or "/openai/v1" (KServe Hugging Face runtime). */
  apiPrefix: string;
  /** In-cluster base URL for curl, e.g. http://x.ai.svc:8000 */
  inClusterUrl: string;
  models: string[];
  /** Key of the extra request headers (gateway targets), read at every request. */
  headersKey?: string;
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

/** The prompt and max_tokens do not fit in the context length of the model (--max-model-len). */
export function isContextLengthError(message: string): boolean {
  return /maximum context length|max_tokens.{0,40}too large|max_completion_tokens.{0,40}too large/i.test(
    message
  );
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

async function listServicesEverywhere(cluster: string, selector: string): Promise<ServiceJson[]> {
  const res: { items?: ServiceJson[] } = await ApiProxy.request(
    `/api/v1/services?labelSelector=${encodeURIComponent(selector)}`,
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

async function fetchModels(cluster: string, path: string, headersKey?: string): Promise<string[]> {
  const headers = requestHeaders(headersKey);
  const res: { data?: Array<{ id: string }> } = await ApiProxy.request(
    path,
    clusterParams(cluster, {
      timeout: 15000,
      ...(Object.keys(headers).length ? { headers } : {}),
    })
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

/**
 * Finds the Service of the gateway a gateway target goes through, and the path its route
 * publishes the model API under. The models are listed when the route allows it; when it does
 * not (e.g. it only routes chat completions), the target's model is used.
 */
async function resolveGateway(cluster: string, target: ChatTarget): Promise<ResolvedTarget> {
  const via = target.gateway!;
  let services: ServiceJson[] = [];
  try {
    for (const { allNamespaces, selector } of gatewayServiceSelectors(via)) {
      services = allNamespaces
        ? await listServicesEverywhere(cluster, selector)
        : await listServices(cluster, via.namespace, selector);
      if (services.length) break;
    }
  } catch (err) {
    throw errorOf(err);
  }
  const svc = services.find(s => s.spec?.type !== 'ExternalName' && s.spec?.ports?.length);
  if (!svc) {
    throw new ChatError(
      `No Service of Gateway ${via.namespace}/${via.name} was found (looked for Envoy Gateway and Gateway API labels).`
    );
  }
  let gateway: KubeJson | undefined;
  try {
    gateway = await ApiProxy.request(
      `/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(
        via.namespace
      )}/gateways/${encodeURIComponent(via.name)}`,
      clusterParams(cluster)
    );
  } catch {
    // Without the Gateway object, the ports of the Service decide.
  }
  const picked = pickGatewayPort(gateway, svc.spec?.ports || []);
  if (!picked) throw new ChatError(`Service ${svc.metadata.name} has no ports.`);
  const svcNs = svc.metadata.namespace || via.namespace;
  const proxyBase = `${serviceProxyPath(svcNs, svc.metadata.name, picked.port, picked.scheme)}${
    via.pathPrefix
  }`;
  const inClusterUrl = `${picked.scheme}://${svc.metadata.name}.${svcNs}.svc:${picked.port}${via.pathPrefix}`;
  let models: string[];
  try {
    models = await fetchModels(cluster, `${proxyBase}/v1/models`, target.id);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new ChatError(
        `The gateway refused the request (HTTP ${status}). Add the headers its security policy expects.`,
        status
      );
    }
    models = [target.defaultModel];
  }
  return { proxyBase, apiPrefix: '/v1', inClusterUrl, models, headersKey: target.id };
}

/** Finds the proxy path and API prefix of a target and lists its models. */
export async function resolveTarget(cluster: string, target: ChatTarget): Promise<ResolvedTarget> {
  if (target.kind === 'Gateway' && target.gateway) return resolveGateway(cluster, target);
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

/** Part of a multimodal user message (OpenAI format). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** A function call the model asked for. */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON text as the model produced it; it may be invalid. */
  arguments: string;
}

/** A plain text message. */
export interface TextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatMessage =
  | TextMessage
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant';
      content: string;
      tool_calls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolChoice = 'auto' | 'none' | 'required';

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
  /**
   * false sends `enable_thinking: false` to the chat template (Qwen3 and other reasoning models
   * whose template reads it), so the model answers without thinking first.
   */
  thinking?: boolean;
  /** Function definitions (OpenAI `tools`); sent only when not empty. */
  tools?: unknown[];
  toolChoice?: ToolChoice;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
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
    ...(params.thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    ...(params.tools?.length
      ? { tools: params.tools, tool_choice: params.toolChoice || 'auto' }
      : {}),
    stream,
    ...(stream && streamUsage ? { stream_options: { include_usage: true } } : {}),
  };
}

interface ToolCallJson {
  index?: number;
  id?: string | null;
  function?: { name?: string | null; arguments?: string | null } | null;
}

interface ChunkJson {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: ToolCallJson[] | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: ToolCallJson[] | null;
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
  acc: {
    content: string;
    reasoning: string;
    usage: Usage;
    finishReason?: string;
    toolCalls?: ToolCall[];
  },
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
    // Streamed calls arrive in pieces keyed by index: the id and name first, then the arguments.
    (part.tool_calls || []).forEach((call, position) => {
      const calls = (acc.toolCalls = acc.toolCalls || []);
      const index = call.index ?? position;
      const current = (calls[index] = calls[index] || { id: '', name: '', arguments: '' });
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
    });
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
  stream: boolean,
  headersKey?: string
): Promise<Response> {
  try {
    return await ApiProxy.request(
      path,
      clusterParams(cluster, {
        method: 'POST',
        headers: {
          ...requestHeaders(headersKey),
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
    toolCalls: [] as ToolCall[],
  };

  let response: Response;
  if (params.stream) {
    try {
      response = await post(
        cluster,
        path,
        requestBody(model, messages, params, true),
        signal,
        true,
        resolved.headersKey
      );
    } catch (err) {
      // Older servers reject stream_options; retry once without it.
      if ((err as ChatError).status === 400) {
        response = await post(
          cluster,
          path,
          requestBody(model, messages, params, true, false),
          signal,
          true,
          resolved.headersKey
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
      false,
      resolved.headersKey
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!params.stream || !contentType.includes('text/event-stream') || !response.body) {
    const json = (await response.json()) as ChunkJson;
    applyChunk(acc, json);
    callbacks.onDelta?.(acc.content, acc.reasoning);
    return {
      ...acc,
      toolCalls: acc.toolCalls.filter(Boolean),
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
  return {
    ...acc,
    toolCalls: acc.toolCalls.filter(Boolean),
    ttftMs: buffered ? undefined : ttftMs,
    totalMs,
    buffered,
    streamed: true,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface PoolingJson {
  data?: Array<{ index?: number; embedding?: number[] | string }>;
  results?: Array<{ index?: number; relevance_score?: number }>;
  usage?: { prompt_tokens?: number } | null;
  error?: { message?: string } | string;
}

function poolingError(json: PoolingJson): ChatError | undefined {
  if (!json.error) return undefined;
  return new ChatError(
    typeof json.error === 'string' ? json.error : json.error.message || 'Model error'
  );
}

export interface EmbeddingsResult {
  /** One vector per input, in input order. */
  vectors: number[][];
  promptTokens?: number;
  totalMs: number;
}

/** Reads an /embeddings response (OpenAI format, float encoding). */
export function parseEmbeddings(json: PoolingJson, totalMs = 0): EmbeddingsResult {
  const error = poolingError(json);
  if (error) throw error;
  const data = [...(json.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length === 0 || data.some(d => !Array.isArray(d.embedding))) {
    throw new ChatError('The response contains no embeddings.');
  }
  return {
    vectors: data.map(d => d.embedding as number[]),
    promptTokens: json.usage?.prompt_tokens ?? undefined,
    totalMs,
  };
}

export interface RerankResult {
  /** Documents by relevance, best first. */
  results: Array<{ index: number; score: number }>;
  promptTokens?: number;
  totalMs: number;
}

/** Reads a /rerank response (Jina and Cohere compatible format that vLLM serves). */
export function parseRerank(json: PoolingJson, totalMs = 0): RerankResult {
  const error = poolingError(json);
  if (error) throw error;
  if (!Array.isArray(json.results)) throw new ChatError('The response contains no results.');
  return {
    results: json.results
      .map(r => ({ index: r.index ?? 0, score: Number(r.relevance_score) }))
      .sort((a, b) => b.score - a.score),
    promptTokens: json.usage?.prompt_tokens ?? undefined,
    totalMs,
  };
}

async function pooling(
  cluster: string,
  resolved: ResolvedTarget,
  endpoint: 'embeddings' | 'rerank',
  body: unknown,
  signal: AbortSignal
): Promise<{ json: PoolingJson; totalMs: number }> {
  const started = performance.now();
  const response = await post(
    cluster,
    `${resolved.proxyBase}${resolved.apiPrefix}/${endpoint}`,
    body,
    signal,
    false,
    resolved.headersKey
  );
  const json = (await response.json()) as PoolingJson;
  return { json, totalMs: performance.now() - started };
}

/** Embeds the texts with an embedding model (`/v1/embeddings`). */
export async function createEmbeddings(
  cluster: string,
  resolved: ResolvedTarget,
  model: string,
  inputs: string[],
  signal: AbortSignal
): Promise<EmbeddingsResult> {
  const { json, totalMs } = await pooling(
    cluster,
    resolved,
    'embeddings',
    { model, input: inputs, encoding_format: 'float' },
    signal
  );
  return parseEmbeddings(json, totalMs);
}

/** Orders the documents by relevance to the query with a reranker model (`/v1/rerank`). */
export async function rerankDocuments(
  cluster: string,
  resolved: ResolvedTarget,
  model: string,
  query: string,
  documents: string[],
  signal: AbortSignal
): Promise<RerankResult> {
  const { json, totalMs } = await pooling(
    cluster,
    resolved,
    'rerank',
    { model, query, documents },
    signal
  );
  return parseRerank(json, totalMs);
}

/** The model does not serve the pooling API asked for (a chat model, or the wrong task). */
export function isPoolingTaskError(message: string): boolean {
  return /does not support|not supported|404|not found|task|runner|pooling/i.test(message);
}

/** Messages with inline images replaced by a short placeholder, for display and copying. */
export function withoutImageData(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(
    (m): ChatMessage =>
      m.role === 'user' && Array.isArray(m.content)
        ? {
            role: 'user',
            content: m.content.map(part =>
              part.type === 'image_url' && part.image_url.url.startsWith('data:')
                ? { type: 'image_url' as const, image_url: { url: '<base64 image data URL>' } }
                : part
            ),
          }
        : m
  );
}

/** Messages for the model: the tool calls of the assistant in the OpenAI request format. */
export function toolCallMessage(content: string, calls: ToolCall[]): ChatMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: calls.map(c => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: c.arguments },
    })),
  };
}

/** The server rejected tools because tool calling is not set up (vLLM needs a parser). */
export function isToolSetupError(message: string): boolean {
  return /tool.?choice|tool.?call.?parser|auto.?tool|tools? (is|are) not supported/i.test(message);
}

/** Error of a model that does not accept images. */
export function isImageInputError(message: string): boolean {
  return /multi.?modal|image|vision|image_url/i.test(message);
}

/** curl command for the same request. */
export function buildCurl(
  baseUrl: string,
  apiPrefix: string,
  model: string,
  messages: ChatMessage[],
  params: ChatParams,
  /** Extra header names; their values are left as placeholders. */
  headers: string[] = []
): string {
  const body = JSON.stringify(
    requestBody(model, withoutImageData(messages), params, params.stream),
    null,
    2
  );
  const url = `${baseUrl.replace(/\/$/, '')}${apiPrefix}/chat/completions`;
  return [
    `curl ${params.stream ? '-N ' : ''}${url.startsWith('https') ? '-k ' : ''}${shellQuote(
      url
    )} \\`,
    ...headers.map(name => `  -H ${shellQuote(`${name}: <${name}>`)} \\`),
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(body)}`,
  ].join('\n');
}
