import {
  applyChunk,
  buildCurl,
  ChatMessage,
  isToolSetupError,
  parseEmbeddings,
  parseRerank,
  requestBody,
  ToolCall,
  toolCallMessage,
  Usage,
  withoutImageData,
} from './openai';

const params = { modelDefaults: true, temperature: 0.7, topP: 1, maxTokens: 64, stream: true };

describe('tool calling', () => {
  it('sends tools and the tool choice only when tools are set', () => {
    expect(requestBody('m', [], params, false)).not.toHaveProperty('tools');
    const tools = [{ type: 'function', function: { name: 'get_weather' } }];
    expect(requestBody('m', [], { ...params, tools, toolChoice: 'required' }, false)).toMatchObject(
      {
        tools,
        tool_choice: 'required',
      }
    );
    expect(requestBody('m', [], { ...params, tools }, false)).toMatchObject({
      tool_choice: 'auto',
    });
  });

  it('assembles streamed tool call pieces by index', () => {
    const acc = { content: '', reasoning: '', usage: {} as Usage, toolCalls: [] as ToolCall[] };
    const chunk = (call: object) =>
      applyChunk(acc, { choices: [{ delta: { tool_calls: [call] } }] });
    chunk({ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } });
    chunk({ index: 0, function: { arguments: '{"city": ' } });
    chunk({ index: 1, id: 'call_2', function: { name: 'get_time', arguments: '{}' } });
    chunk({ index: 0, function: { arguments: '"Ankara"}' } });
    applyChunk(acc, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    expect(acc.toolCalls).toEqual([
      { id: 'call_1', name: 'get_weather', arguments: '{"city": "Ankara"}' },
      { id: 'call_2', name: 'get_time', arguments: '{}' },
    ]);
  });

  it('reads tool calls of a complete response', () => {
    const acc = { content: '', reasoning: '', usage: {} as Usage, toolCalls: [] as ToolCall[] };
    applyChunk(acc, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"a":1}' } }],
          },
        },
      ],
    });
    expect(acc.toolCalls).toEqual([{ id: 'c', name: 'f', arguments: '{"a":1}' }]);
  });

  it('turns the calls back into an assistant message', () => {
    expect(toolCallMessage('', [{ id: 'c', name: 'f', arguments: '{}' }])).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }],
    });
  });

  it('recognizes a server without tool calling set up', () => {
    expect(
      isToolSetupError(
        '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set'
      )
    ).toBe(true);
    expect(isToolSetupError('maximum context length is 4096 tokens')).toBe(false);
  });
});

describe('images', () => {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
      ],
    },
  ];

  it('keeps image links and replaces inline data', () => {
    expect(withoutImageData(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: '<base64 image data URL>' } },
          { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
        ],
      },
    ]);
  });

  it('leaves the image data out of curl', () => {
    const curl = buildCurl('http://svc:8000', '/v1', 'm', messages, params);
    expect(curl).not.toContain('AAAA');
    expect(curl).toContain('<base64 image data URL>');
  });
});

describe('pooling responses', () => {
  it('orders embeddings by index', () => {
    expect(
      parseEmbeddings({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
        usage: { prompt_tokens: 9 },
      })
    ).toEqual({
      vectors: [
        [1, 0],
        [0, 1],
      ],
      promptTokens: 9,
      totalMs: 0,
    });
  });

  it('rejects an error or an empty answer', () => {
    expect(() =>
      parseEmbeddings({ error: { message: 'The model does not support Embeddings API' } })
    ).toThrow('does not support');
    expect(() => parseEmbeddings({ data: [] })).toThrow('no embeddings');
  });

  it('orders rerank results by relevance', () => {
    expect(
      parseRerank({
        results: [
          { index: 0, relevance_score: 0.2 },
          { index: 2, relevance_score: 0.9 },
        ],
        usage: { prompt_tokens: 30 },
      }).results
    ).toEqual([
      { index: 2, score: 0.9 },
      { index: 0, score: 0.2 },
    ]);
  });
});
