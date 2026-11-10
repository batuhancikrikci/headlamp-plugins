import { paneHistory, PaneMessage, reasoningCutoffNotice } from './ChatPane';

function reply(patch: Partial<PaneMessage> = {}): PaneMessage {
  return {
    id: 1,
    role: 'assistant',
    content: '',
    reasoning: 'Wait, keep it short.',
    result: {
      usage: { promptTokens: 12, completionTokens: 1024 },
      finishReason: 'length',
      totalMs: 2960,
      buffered: false,
      streamed: true,
    },
    ...patch,
  };
}

describe('reasoningCutoffNotice', () => {
  it('explains a reply that ran out of tokens while reasoning', () => {
    expect(reasoningCutoffNotice(reply(), '', 'Wait, keep it short.')).toBe(
      'The model spent all 1024 tokens on reasoning and was cut off before it could answer. Increase Max tokens and try again.'
    );
  });

  it('still explains it when the server reports no usage', () => {
    const message = reply();
    message.result!.usage = {};
    expect(reasoningCutoffNotice(message, '', 'Thinking')).toMatch(/reached the Max tokens limit/);
  });

  it('stays quiet while streaming, after an answer, or when the reply finished normally', () => {
    expect(reasoningCutoffNotice(reply({ pending: true }), '', 'Thinking')).toBeNull();
    expect(reasoningCutoffNotice(reply(), 'Selam!', 'Thinking')).toBeNull();
    expect(reasoningCutoffNotice(reply(), '', '')).toBeNull();
    const finished = reply();
    finished.result!.finishReason = 'stop';
    expect(reasoningCutoffNotice(finished, '', 'Thinking')).toBeNull();
  });
});

describe('paneHistory', () => {
  it('sends images as content parts and keeps tool calls with their results', () => {
    const list: PaneMessage[] = [
      { id: 1, role: 'user', content: 'Weather here?', images: ['data:image/png;base64,AA'] },
      {
        id: 2,
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_weather', arguments: '{"city":"Izmir"}' }],
      },
      {
        id: 3,
        role: 'tool',
        content: '{"temperature": 21}',
        toolCallId: 'c1',
        toolName: 'get_weather',
      },
      { id: 4, role: 'assistant', content: 'It is 21 °C.' },
      { id: 5, role: 'user', content: 'ignored', error: 'failed' },
    ];
    expect(paneHistory('Be brief.', list)).toEqual([
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Weather here?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Izmir"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"temperature": 21}' },
      { role: 'assistant', content: 'It is 21 °C.' },
    ]);
  });
});
