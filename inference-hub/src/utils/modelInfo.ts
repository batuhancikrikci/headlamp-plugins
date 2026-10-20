/**
 * Derives display information (provider, family, size, quantization) from a model URI and
 * name. Nothing here is authoritative: it only enriches what the cluster objects contain.
 */

export type UriScheme =
  | 'hf'
  | 's3'
  | 'gs'
  | 'pvc'
  | 'oci'
  | 'http'
  | 'https'
  | 'azure'
  | 'local'
  | 'unknown';

export interface Provider {
  id: string;
  label: string;
  icon: string;
}

export interface ModelInfo {
  uri: string;
  scheme: UriScheme;
  /** "org/name" for Hugging Face, the path for other schemes. */
  path: string;
  /** Hugging Face organization or publisher, when the URI has one. */
  publisher?: string;
  /** Last path segment, e.g. "Qwen2.5-7B-Instruct". */
  name: string;
  /** Creator of the model family (may differ from the publisher of a re-quantized copy). */
  provider?: Provider;
  /** Model family, e.g. "Llama-3.1", "Qwen2.5", "gpt-oss". */
  family?: string;
  /** Total parameters in billions. */
  paramsB?: number;
  /** Active parameters in billions for mixture-of-experts models. */
  activeParamsB?: number;
  /** Size label as written in the name, e.g. "8B", "8x7B", "30B-A3B". */
  sizeLabel?: string;
  quantization?: string;
  variant?: string;
}

export const SCHEME_INFO: Record<UriScheme, { label: string; icon: string }> = {
  hf: { label: 'Hugging Face', icon: 'simple-icons:huggingface' },
  s3: { label: 'S3', icon: 'simple-icons:amazons3' },
  gs: { label: 'Google Cloud Storage', icon: 'simple-icons:googlecloudstorage' },
  pvc: { label: 'Persistent volume', icon: 'mdi:harddisk' },
  oci: { label: 'OCI image', icon: 'simple-icons:docker' },
  http: { label: 'HTTP', icon: 'mdi:web' },
  https: { label: 'HTTPS', icon: 'mdi:web' },
  azure: { label: 'Azure Blob', icon: 'simple-icons:microsoftazure' },
  local: { label: 'Local path', icon: 'mdi:folder-outline' },
  unknown: { label: 'Other', icon: 'mdi:help-circle-outline' },
};

const P = (id: string, label: string, icon: string): Provider => ({ id, label, icon });

export const PROVIDERS = {
  meta: P('meta', 'Meta', 'simple-icons:meta'),
  qwen: P('qwen', 'Qwen', 'simple-icons:qwen'),
  mistral: P('mistral', 'Mistral AI', 'simple-icons:mistralai'),
  google: P('google', 'Google', 'simple-icons:google'),
  deepseek: P('deepseek', 'DeepSeek', 'simple-icons:deepseek'),
  microsoft: P('microsoft', 'Microsoft', 'simple-icons:microsoft'),
  nvidia: P('nvidia', 'NVIDIA', 'simple-icons:nvidia'),
  ibm: P('ibm', 'IBM', 'simple-icons:ibm'),
  openai: P('openai', 'OpenAI', 'simple-icons:openai'),
  redhat: P('redhat', 'Red Hat', 'simple-icons:redhat'),
  huggingface: P('huggingface', 'Hugging Face', 'simple-icons:huggingface'),
  minimax: P('minimax', 'MiniMax', 'simple-icons:minimax'),
  xiaomi: P('xiaomi', 'Xiaomi', 'simple-icons:xiaomi'),
  baidu: P('baidu', 'Baidu', 'simple-icons:baidu'),
  snowflake: P('snowflake', 'Snowflake', 'simple-icons:snowflake'),
  databricks: P('databricks', 'Databricks', 'simple-icons:databricks'),
  intel: P('intel', 'Intel', 'simple-icons:intel'),
  amd: P('amd', 'AMD', 'simple-icons:amd'),
  apple: P('apple', 'Apple', 'simple-icons:apple'),
  anthropic: P('anthropic', 'Anthropic', 'simple-icons:anthropic'),
  moonshot: P('moonshot', 'Moonshot AI', 'mdi:moon-waning-crescent'),
  zhipu: P('zhipu', 'Z.ai', 'mdi:alpha-z-circle-outline'),
  ai2: P('ai2', 'Ai2', 'mdi:school-outline'),
  tii: P('tii', 'TII', 'mdi:bird'),
  cohere: P('cohere', 'Cohere', 'mdi:alpha-c-circle-outline'),
  bigcode: P('bigcode', 'BigCode', 'mdi:code-braces'),
} satisfies Record<string, Provider>;

export const GENERIC_MODEL_ICON = 'mdi:robot-outline';

/** Family keywords in model names, checked in order. */
const FAMILY_PROVIDERS: Array<[RegExp, Provider]> = [
  [/llama|^opt-|\bopt\b/i, PROVIDERS.meta],
  [/qwen|qwq/i, PROVIDERS.qwen],
  [/mistral|mixtral|ministral|codestral|devstral|magistral|pixtral/i, PROVIDERS.mistral],
  [/gemma|t5gemma/i, PROVIDERS.google],
  [/deepseek/i, PROVIDERS.deepseek],
  [/\bphi[-_]?\d|^phi/i, PROVIDERS.microsoft],
  [/nemotron|nvidia/i, PROVIDERS.nvidia],
  [/granite/i, PROVIDERS.ibm],
  [/gpt-oss/i, PROVIDERS.openai],
  [/minimax/i, PROVIDERS.minimax],
  [/kimi|moonlight/i, PROVIDERS.moonshot],
  [/\bglm|chatglm/i, PROVIDERS.zhipu],
  [/olmo|tulu|molmo/i, PROVIDERS.ai2],
  [/falcon/i, PROVIDERS.tii],
  [/mimo/i, PROVIDERS.xiaomi],
  [/ernie/i, PROVIDERS.baidu],
  [/arctic/i, PROVIDERS.snowflake],
  [/dbrx/i, PROVIDERS.databricks],
  [/command-?r|aya/i, PROVIDERS.cohere],
  [/starcoder/i, PROVIDERS.bigcode],
  [/smollm/i, PROVIDERS.huggingface],
];

/** Publisher (Hugging Face organization) to provider. */
const ORG_PROVIDERS: Record<string, Provider> = {
  'meta-llama': PROVIDERS.meta,
  facebook: PROVIDERS.meta,
  qwen: PROVIDERS.qwen,
  mistralai: PROVIDERS.mistral,
  google: PROVIDERS.google,
  'deepseek-ai': PROVIDERS.deepseek,
  microsoft: PROVIDERS.microsoft,
  nvidia: PROVIDERS.nvidia,
  'ibm-granite': PROVIDERS.ibm,
  ibm: PROVIDERS.ibm,
  openai: PROVIDERS.openai,
  redhatai: PROVIDERS.redhat,
  neuralmagic: PROVIDERS.redhat,
  huggingfacetb: PROVIDERS.huggingface,
  minimaxai: PROVIDERS.minimax,
  moonshotai: PROVIDERS.moonshot,
  'zai-org': PROVIDERS.zhipu,
  thudm: PROVIDERS.zhipu,
  allenai: PROVIDERS.ai2,
  tiiuae: PROVIDERS.tii,
  xiaomimimo: PROVIDERS.xiaomi,
  baidu: PROVIDERS.baidu,
  snowflake: PROVIDERS.snowflake,
  databricks: PROVIDERS.databricks,
  intel: PROVIDERS.intel,
  amd: PROVIDERS.amd,
  apple: PROVIDERS.apple,
  coherelabs: PROVIDERS.cohere,
  coherforai: PROVIDERS.cohere,
  bigcode: PROVIDERS.bigcode,
};

const QUANT_PATTERNS: Array<[RegExp, string]> = [
  [/nvfp4/i, 'NVFP4'],
  [/mxfp4/i, 'MXFP4'],
  [/w4a16/i, 'W4A16'],
  [/w8a8/i, 'W8A8'],
  [/w8a16/i, 'W8A16'],
  [/fp8/i, 'FP8'],
  [/awq/i, 'AWQ'],
  [/gptq/i, 'GPTQ'],
  [/gguf/i, 'GGUF'],
  [/bnb|4bit|int4/i, 'INT4'],
  [/int8|8bit/i, 'INT8'],
  [/bf16/i, 'BF16'],
  [/fp16/i, 'FP16'],
];

const VARIANT_PATTERNS: Array<[RegExp, string]> = [
  [/embed/i, 'Embedding'],
  [/rerank/i, 'Reranker'],
  [/coder|code/i, 'Coder'],
  [/vl\b|vision|-vl-|omni/i, 'Vision'],
  [/instruct|-it\b|-it-/i, 'Instruct'],
  [/chat/i, 'Chat'],
  [/thinking|reason|-r1|qwq/i, 'Reasoning'],
  [/base/i, 'Base'],
];

export function uriScheme(uri: string): UriScheme {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(uri.trim());
  if (!match) return uri.startsWith('/') ? 'local' : 'unknown';
  const s = match[1].toLowerCase();
  if (s === 'hf' || s === 'huggingface') return 'hf';
  if (s === 's3' || s === 'gs' || s === 'pvc' || s === 'oci' || s === 'http' || s === 'https') {
    return s;
  }
  if (s === 'azure' || s === 'wasbs' || s === 'abfss') return 'azure';
  if (s === 'file') return 'local';
  return 'unknown';
}

/** Parses the parameter count ("7B", "8x7B", "30B-A3B", "125m") out of a model name. */
export function parseSize(
  name: string
): Pick<ModelInfo, 'paramsB' | 'activeParamsB' | 'sizeLabel'> {
  const moe = /(?:^|[-_.])(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)([bm])(?=$|[-_.])/i.exec(name);
  if (moe) {
    const unit = moe[3].toLowerCase() === 'm' ? 0.001 : 1;
    const each = Number(moe[2]) * unit;
    return {
      paramsB: Number(moe[1]) * each,
      sizeLabel: `${moe[1]}x${moe[2]}${moe[3].toUpperCase()}`,
    };
  }
  const plain = /(?:^|[-_.])(\d+(?:\.\d+)?)([bm])(?:[-_.]a(\d+(?:\.\d+)?)b)?(?=$|[-_.])/i.exec(
    name
  );
  if (!plain) return {};
  const unit = plain[2].toLowerCase() === 'm' ? 0.001 : 1;
  const result: Pick<ModelInfo, 'paramsB' | 'activeParamsB' | 'sizeLabel'> = {
    paramsB: Number(plain[1]) * unit,
    sizeLabel: `${plain[1]}${plain[2].toUpperCase()}`,
  };
  if (plain[3]) {
    result.activeParamsB = Number(plain[3]);
    result.sizeLabel += `-A${plain[3]}B`;
  }
  return result;
}

/** Family: the part of the name before the size, variant or quantization tokens. */
function parseFamily(name: string): string | undefined {
  const tokens = name.split(/[-_]/);
  const stop = tokens.findIndex(
    (tok, i) =>
      i > 0 &&
      (/^\d+(\.\d+)?[bm]$/i.test(tok) ||
        /^\d+x\d+[bm]$/i.test(tok) ||
        /^(instruct|chat|base|it|hf|awq|gptq|fp8|fp16|bf16|gguf|w\d+a\d+|v\d.*|preview)$/i.test(
          tok
        ))
  );
  let family = (stop > 0 ? tokens.slice(0, stop) : tokens).join('-');
  family = family.replace(/^meta-/i, '');
  return family || undefined;
}

export function providerFor(publisher: string | undefined, name: string): Provider | undefined {
  const byFamily = FAMILY_PROVIDERS.find(([re]) => re.test(name))?.[1];
  if (byFamily) return byFamily;
  return publisher ? ORG_PROVIDERS[publisher.toLowerCase()] : undefined;
}

/**
 * Parses a model storage URI (hf://, s3://, gs://, pvc://, oci://, https://, ...).
 * `servedName` (e.g. LLMInferenceService spec.model.name) is used when the URI does not
 * carry a meaningful model name (pvc:// and oci:// URIs usually do not).
 */
export function parseModelUri(uri: string, servedName?: string): ModelInfo {
  const trimmed = (uri || '').trim();
  const scheme = uriScheme(trimmed);
  const withoutScheme = trimmed.replace(/^[a-z0-9+.-]+:\/\//i, '');
  // Drop tags/revisions ("org/model@rev", "image:tag") for naming purposes.
  const path = withoutScheme.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  let publisher: string | undefined;
  let name = segments[segments.length - 1] || '';
  if (scheme === 'hf') {
    publisher = segments.length > 1 ? segments[0] : undefined;
    name = (segments[1] || segments[0] || '').split('@')[0].split(':')[0];
  } else if (scheme === 'oci') {
    name = name.split('@')[0].split(':')[0];
  }

  // Served names are often "org/model"; they identify the model better than a PVC name.
  if (servedName && (scheme === 'pvc' || scheme === 'oci' || scheme === 'local' || !name)) {
    const served = servedName.split('/');
    name = served[served.length - 1];
    publisher = publisher || (served.length > 1 ? served[0] : undefined);
  }

  const quantization = QUANT_PATTERNS.find(([re]) => re.test(name))?.[1];
  const variant = VARIANT_PATTERNS.find(([re]) => re.test(name))?.[1];
  return {
    uri: trimmed,
    scheme,
    path,
    publisher,
    name,
    provider: providerFor(publisher, name),
    family: parseFamily(name),
    quantization,
    variant,
    ...parseSize(name),
  };
}

export function formatParams(paramsB?: number): string {
  if (paramsB === undefined) return '';
  if (paramsB < 1) return `${Math.round(paramsB * 1000)}M`;
  return `${Number.isInteger(paramsB) ? paramsB : paramsB.toFixed(1)}B`;
}
