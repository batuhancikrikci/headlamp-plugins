import {
  applyChunk,
  buildCurl,
  ChatTarget,
  pickService,
  requestBody,
  SseParser,
  Usage,
} from './openai';

describe('SseParser', () => {
  it('splits events across chunk boundaries and detects [DONE]', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b"')).toEqual({ events: ['{"a":1}'], done: false });
    expect(p.push(':2}\r\n\r\n: keep-alive\n\ndata: [DONE]\n\n')).toEqual({
      events: ['{"b":2}'],
      done: true,
    });
  });

  it('flushes a trailing event without a blank line', () => {
    const p = new SseParser();
    p.push('data: {"x":1}');
    expect(p.flush()).toEqual(['{"x":1}']);
  });
});

describe('applyChunk', () => {
  const acc = () => ({
    content: '',
    reasoning: '',
    usage: {} as Usage,
    finishReason: undefined as string | undefined,
  });

  it('accumulates content, reasoning, usage and finish reason', () => {
    const a = acc();
    applyChunk(a, { choices: [{ delta: { reasoning_content: 'Think. ' } }] });
    applyChunk(a, { choices: [{ delta: { content: 'Hel' } }] });
    applyChunk(a, { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] });
    applyChunk(a, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } });
    expect(a).toEqual({
      content: 'Hello',
      reasoning: 'Think. ',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 2 },
    });
  });

  it('reads non-streaming responses and newer "reasoning" fields', () => {
    const a = acc();
    applyChunk(a, {
      choices: [{ message: { content: 'Hi', reasoning: 'r' }, finish_reason: 'length' }],
    });
    expect(a).toMatchObject({ content: 'Hi', reasoning: 'r', finishReason: 'length' });
  });

  it('raises model errors', () => {
    expect(() => applyChunk(acc(), { error: { message: 'context too long' } })).toThrow(
      'context too long'
    );
  });
});

describe('pickService', () => {
  const svc = (name: string, labels: Record<string, string>, type = 'ClusterIP') => ({
    metadata: { name, namespace: 'ai', labels },
    spec: { type, ports: [{ name: 'http', port: 8000 }] },
  });
  const llm: ChatTarget = {
    id: 'llm/ai/q',
    kind: 'LLMInferenceService',
    namespace: 'ai',
    name: 'q',
    defaultModel: 'q',
  };
  const isvc: ChatTarget = { ...llm, id: 'isvc/ai/q', kind: 'InferenceService' };

  it('prefers the LLMInferenceService workload service over the scheduler service', () => {
    const picked = pickService(llm, [
      svc('q-epp-service', {
        'app.kubernetes.io/component': 'llminferenceservice-router-scheduler',
      }),
      svc('q-kserve-workload-svc', {
        'app.kubernetes.io/component': 'llminferenceservice-workload',
      }),
    ]);
    expect(picked?.metadata.name).toBe('q-kserve-workload-svc');
  });

  it('skips Knative ExternalName services for InferenceServices', () => {
    const picked = pickService(isvc, [
      svc('q-predictor', { component: 'predictor' }, 'ExternalName'),
      svc('q-predictor-00001-private', { component: 'predictor' }),
    ]);
    expect(picked?.metadata.name).toBe('q-predictor-00001-private');
  });
});

describe('requests', () => {
  const params = {
    modelDefaults: false,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 256,
    stream: true,
  };

  it('asks for usage only when streaming', () => {
    expect(requestBody('m', [], params, true)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(requestBody('m', [], params, false)).not.toHaveProperty('stream_options');
    expect(requestBody('m', [], params, true, false)).not.toHaveProperty('stream_options');
  });

  it('sends temperature and top P only when the model defaults are not used', () => {
    expect(requestBody('m', [], params, false)).toMatchObject({ temperature: 0.7, top_p: 0.9 });
    const defaults = requestBody('m', [], { ...params, modelDefaults: true }, false);
    expect(defaults).not.toHaveProperty('temperature');
    expect(defaults).not.toHaveProperty('top_p');
    expect(defaults).toMatchObject({ max_tokens: 256 });
    expect(
      buildCurl('http://svc:8000', '/v1', 'm', [], { ...params, modelDefaults: true })
    ).not.toContain('temperature');
  });

  it('builds a shell-safe curl command', () => {
    const curl = buildCurl(
      'https://gw.example.com/ai/q/',
      '/v1',
      'q',
      [{ role: 'user', content: "it's" }],
      params
    );
    expect(curl).toContain("curl -N -k 'https://gw.example.com/ai/q/v1/chat/completions'");
    expect(curl).toContain(`it'\\''s`);
    expect(curl).toContain('"max_tokens": 256');
  });
});
