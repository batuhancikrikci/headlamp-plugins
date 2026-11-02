import { describe, expect, it } from 'vitest';
import { diagnose, DiagnosisInput } from './diagnose';
import {
  ASK_SYSTEM_PROMPT,
  askMessages,
  CONTINUE_PROMPT,
  conversationMessages,
  diagnosisReport,
  maskSecrets,
  maskTokens,
  MAX_REPORT_CHARS,
} from './report';

function input(): DiagnosisInput {
  return {
    endpoint: {
      kind: 'LLMInferenceService',
      name: 'qwen',
      namespace: 'llm',
      modelUri: 'hf://Qwen/Qwen3-14B',
      status: { health: 'failed', reason: 'CrashLoopBackOff' },
      createdAt: '2026-11-02T11:00:00Z',
      raw: {
        metadata: { name: 'qwen' },
        spec: {
          model: { uri: 'hf://Qwen/Qwen3-14B' },
          template: {
            containers: [
              {
                name: 'main',
                env: [
                  { name: 'HF_TOKEN', value: 'hf_abcdefghijklmnopqrstuvwxyz' },
                  { name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len=8192' },
                  { name: 'S3_KEY', valueFrom: { secretKeyRef: { name: 's3', key: 'key' } } },
                ],
              },
            ],
          },
        },
      },
    },
    pods: [],
    events: [],
    catalog: null,
    logs: [
      {
        pod: 'qwen-0',
        container: 'main',
        text: 'using token hf_abcdefghijklmnopqrstuvwxyz\ntorch.OutOfMemoryError: CUDA out of memory',
      },
    ],
    now: Date.parse('2026-11-02T12:00:00Z'),
  };
}

describe('maskSecrets', () => {
  it('hides env values except the vLLM arguments, and secret-like fields', () => {
    expect(
      maskSecrets({
        env: [
          { name: 'HF_TOKEN', value: 'x' },
          { name: 'VLLM_ADDITIONAL_ARGS', value: '--a' },
          { name: 'PASSWORD', valueFrom: { secretKeyRef: { name: 's' } } },
        ],
        auth: { apiKey: 'abc', token: 'def' },
        storageUri: 'hf://org/model',
      })
    ).toEqual({
      env: [
        { name: 'HF_TOKEN', value: '***' },
        { name: 'VLLM_ADDITIONAL_ARGS', value: '--a' },
        { name: 'PASSWORD', valueFrom: '***' },
      ],
      auth: { apiKey: '***', token: '***' },
      storageUri: 'hf://org/model',
    });
  });
});

describe('maskTokens', () => {
  it('hides token-looking strings', () => {
    expect(maskTokens('token hf_abcdefghijklmnopqrstuv end')).toBe('token hf_*** end');
    expect(maskTokens('Authorization: Bearer abc.def.ghi123')).toBe('Authorization: Bearer ***');
    expect(maskTokens('key=sk-abcdefghijklmnopqrstu')).toBe('key=sk-***');
    expect(maskTokens('password: hunter2secret')).toBe('password: ***');
    expect(maskTokens('INFO loading weights 12/30')).toBe('INFO loading weights 12/30');
  });
});

describe('diagnosisReport', () => {
  it('contains the findings, the masked spec and masked log lines', () => {
    const data = input();
    const report = diagnosisReport(data, diagnose(data));
    expect(report).toContain('Endpoint: LLMInferenceService llm/qwen');
    expect(report).toContain('Status: failed (CrashLoopBackOff)');
    expect(report).toContain('[fail] Logs: The GPU ran out of memory.');
    expect(report).toContain('--max-model-len=8192');
    expect(report).toContain('Log qwen-0/main, last 2 lines:');
    expect(report).not.toContain('hf_abcdefghijklmnopqrstuvwxyz');
    expect(report).not.toContain('secretKeyRef');
  });

  it('stays within the size limit', () => {
    const data = input();
    data.logs = [{ pod: 'p', container: 'c', text: 'x'.repeat(380) + '\n'.repeat(1) }];
    (data.endpoint.raw as { spec: Record<string, unknown> }).spec.big = 'y'.repeat(40000);
    const report = diagnosisReport(data, diagnose(data));
    expect(report.length).toBeLessThanOrEqual(MAX_REPORT_CHARS + 20);
    expect(report.endsWith('… (truncated)')).toBe(true);
  });
});

describe('askMessages', () => {
  it('puts the question before the report', () => {
    expect(askMessages('REPORT', '  ')).toEqual([
      { role: 'system', content: ASK_SYSTEM_PROMPT },
      {
        role: 'user',
        content: 'Why is this endpoint not working, and how do I fix it?\n\nREPORT',
      },
    ]);
    expect(askMessages('REPORT', 'Is it the GPU?')[1].content).toBe('Is it the GPU?\n\nREPORT');
  });
});

describe('conversationMessages', () => {
  const first = askMessages('REPORT', 'Why?');

  it('sends the report with the first question, then the answers and follow-ups', () => {
    expect(conversationMessages('REPORT', [{ question: 'Why?', answer: '' }])).toEqual(first);
    expect(
      conversationMessages('REPORT', [
        { question: 'Why?', answer: 'The GPU.' },
        { question: 'Which flag?', answer: '' },
      ])
    ).toEqual([
      ...first,
      { role: 'assistant', content: 'The GPU.' },
      { role: 'user', content: 'Which flag?' },
    ]);
  });

  it('asks to continue the last answer', () => {
    expect(
      conversationMessages('REPORT', [{ question: 'Why?', answer: 'Part one' }], true)
    ).toEqual([
      ...first,
      { role: 'assistant', content: 'Part one' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);
  });

  it('merges a question without an answer with the next one', () => {
    const messages = conversationMessages('REPORT', [
      { question: 'Why?', answer: '' },
      { question: 'Short answer please.', answer: '' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('Why?\n\nREPORT\n\nShort answer please.');
  });
});
