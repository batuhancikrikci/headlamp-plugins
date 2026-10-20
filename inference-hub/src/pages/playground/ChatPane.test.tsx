import { PaneMessage, reasoningCutoffNotice } from './ChatPane';

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
