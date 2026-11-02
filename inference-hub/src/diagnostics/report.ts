/**
 * The diagnosis as a prompt for a language model running in the cluster ("Ask a model").
 *
 * The text contains the findings with their evidence, the endpoint spec and log excerpts.
 * Values that may be secrets are masked: env values (except the vLLM arguments), fields with
 * secret-like names and token-looking strings in logs. The user sees and can edit the text
 * before it is sent.
 */
import type { ChatMessage } from '../api/openai';
import type { Diagnosis, DiagnosisInput, LogSample } from './diagnose';

/** Upper bound of the prompt, to fit small context windows. */
export const MAX_REPORT_CHARS = 14000;
const LOG_LINES_PER_SAMPLE = 40;

export const ASK_SYSTEM_PROMPT = [
  'You are an expert in running LLMs on Kubernetes with KServe, vLLM, llm-d and the NVIDIA GPU Operator.',
  'You get the automatic diagnosis of a model endpoint that is not working as expected.',
  'Explain the most likely root cause in plain words, then give concrete steps to fix it,',
  'such as which field of the LLMInferenceService or InferenceService to change, or which',
  'vLLM argument to set. Say so when the evidence is not enough, and what to check next.',
  'Be concise and use Markdown.',
].join(' ');

const SECRET_KEY = /token|secret|password|passwd|apikey|api_key|credential|auth/i;
const KEEP_ENV = new Set(['VLLM_ADDITIONAL_ARGS']);

/** Masks env values and anything that looks like a credential in a Kubernetes object. */
export function maskSecrets(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map(v => maskSecrets(v, key));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // An env entry: keep the name, hide the value.
    if (typeof obj.name === 'string' && ('value' in obj || 'valueFrom' in obj)) {
      return {
        name: obj.name,
        ...('value' in obj ? { value: KEEP_ENV.has(obj.name) ? obj.value : '***' } : {}),
        ...('valueFrom' in obj ? { valueFrom: '***' } : {}),
      };
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, maskSecrets(v, k)]));
  }
  if (typeof value === 'string' && SECRET_KEY.test(key)) return '***';
  return value;
}

/** Masks token-looking strings: Hugging Face and OpenAI style keys, bearer tokens, JWTs. */
export function maskTokens(text: string): string {
  return text
    .replace(/\bhf_[A-Za-z0-9]{16,}/g, 'hf_***')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***jwt***')
    .replace(/((?:token|password|secret|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',]{6,}/gi, '$1***');
}

function logExcerpts(logs: LogSample[] | undefined): string[] {
  if (!logs || logs.length === 0) return [];
  return logs.flatMap(sample => {
    const lines = sample.text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    return [
      '',
      `Log ${sample.pod}/${sample.container}${
        sample.previous ? ' (previous instance)' : ''
      }, last ${Math.min(lines.length, LOG_LINES_PER_SAMPLE)} lines:`,
      ...lines.slice(-LOG_LINES_PER_SAMPLE).map(l => `  ${maskTokens(l).slice(0, 400)}`),
    ];
  });
}

/** The diagnosis, the masked spec and log excerpts as plain text. */
export function diagnosisReport(
  input: Pick<DiagnosisInput, 'endpoint' | 'logs'>,
  diagnosis: Diagnosis
): string {
  const { endpoint } = input;
  const spec = maskSecrets((endpoint.raw as { spec?: unknown }).spec || {});
  const sections = [
    `Endpoint: ${endpoint.kind} ${endpoint.namespace}/${endpoint.name}`,
    `Model: ${endpoint.modelUri}`,
    `Status: ${endpoint.status.health}${
      endpoint.status.reason ? ` (${endpoint.status.reason})` : ''
    }${endpoint.status.message ? `: ${endpoint.status.message}` : ''}`,
    '',
    'Automatic findings:',
    ...diagnosis.findings.flatMap(f => [
      `- [${f.status}] ${f.title}: ${f.summary}`,
      ...f.evidence.slice(0, 8).map(e => `    ${maskTokens(e)}`),
    ]),
    '',
    'Spec (env values and secrets masked):',
    JSON.stringify(spec, null, 2),
    ...logExcerpts(input.logs),
  ];
  const text = sections.join('\n');
  return text.length > MAX_REPORT_CHARS
    ? `${text.slice(0, MAX_REPORT_CHARS)}\n… (truncated)`
    : text;
}

export const DEFAULT_QUESTION = 'Why is this endpoint not working, and how do I fix it?';

export const CONTINUE_PROMPT =
  'Continue your answer exactly where it stopped. Do not repeat what you already wrote.';

/** Chat messages for the question about a report. */
export function askMessages(report: string, question?: string): ChatMessage[] {
  const ask = question?.trim() || DEFAULT_QUESTION;
  return [
    { role: 'system', content: ASK_SYSTEM_PROMPT },
    { role: 'user', content: `${ask}\n\n${report}` },
  ];
}

/** One question of a conversation and the answer so far. */
export interface AskTurn {
  question: string;
  answer: string;
}

/**
 * Messages of a conversation about a report: the report goes with the first question, then
 * each answer and follow-up question. The answer of the last turn is not sent unless
 * `continueLast` asks the model to continue it (it was cut off by the token limit). A turn
 * without an answer (all its tokens went to thinking) is merged with the next question, so
 * that user messages never follow each other.
 */
export function conversationMessages(
  report: string,
  turns: AskTurn[],
  continueLast = false
): ChatMessage[] {
  const messages = askMessages(report, turns[0]?.question);
  const add = (role: 'user' | 'assistant', content: string) => {
    const previous = messages[messages.length - 1];
    if (role === 'user' && previous.role === 'user') previous.content += `\n\n${content}`;
    else messages.push({ role, content });
  };
  turns.forEach((turn, index) => {
    if (index > 0) add('user', turn.question);
    const last = index === turns.length - 1;
    if (turn.answer && (!last || continueLast)) add('assistant', turn.answer);
  });
  if (continueLast) add('user', CONTINUE_PROMPT);
  return messages;
}
