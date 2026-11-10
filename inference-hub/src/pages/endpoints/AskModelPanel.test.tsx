import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatMessage, ChatParams, ChatResult } from '../../api/openai';
import { CONTINUE_PROMPT } from '../../diagnostics/report';
import { AskModelPanel } from './AskModelPanel';

// The model server is the external dependency: each call answers from a queue of replies and
// records the messages it was sent. The rest of the panel (report, conversation) is real.
const server = vi.hoisted(() => ({
  calls: [] as Array<{ messages: ChatMessage[]; params: ChatParams }>,
  replies: [] as Array<Partial<ChatResult> | Error>,
}));

vi.mock('../../api/openai', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/openai')>()),
  resolveTarget: async () => ({
    proxyBase: '/proxy',
    apiPrefix: '/v1',
    inClusterUrl: 'http://helper',
    models: ['helper-model'],
  }),
  chatCompletion: async (
    _cluster: string,
    _resolved: unknown,
    _model: string,
    messages: ChatMessage[],
    params: ChatParams
  ) => {
    server.calls.push({ messages, params });
    const reply = server.replies.shift() || {};
    if (reply instanceof Error) throw reply;
    return {
      content: '',
      reasoning: '',
      usage: {},
      totalMs: 1,
      buffered: false,
      streamed: true,
      ...reply,
    };
  },
}));
vi.mock('../../hooks/useCluster', () => ({ useCurrentCluster: () => 'test' }));
// Gateway access has its own tests; the targets here are not behind a gateway.
vi.mock('../../components/playground/GatewayAccess', () => ({ GatewayAccess: () => null }));
vi.mock('../../hooks/usePlaygroundTargets', () => ({
  endpointIdOf: (target: { id: string }) => target.id,
  usePlaygroundTargets: () => ({
    loading: false,
    targets: [
      {
        id: 'llm/ai/helper',
        kind: 'LLMInferenceService',
        namespace: 'ai',
        name: 'helper',
        label: 'helper',
        defaultModel: 'helper-model',
        status: { health: 'ready' },
      },
    ],
  }),
}));
vi.mock('../../diagnostics/report', async importOriginal => ({
  ...(await importOriginal<typeof import('../../diagnostics/report')>()),
  diagnosisReport: () => 'REPORT',
}));

const endpoint = { slug: 'llm', namespace: 'ai', name: 'broken' } as never;
const diagnosis = { findings: [], verdict: { status: 'error', summary: '' } } as never;

function renderPanel() {
  render(<AskModelPanel endpoint={endpoint} diagnosis={diagnosis} />);
}

const lastCall = () => server.calls[server.calls.length - 1];

beforeEach(() => {
  server.calls = [];
  server.replies = [];
});

describe('AskModelPanel', () => {
  it('sends the report with the question and shows the answer', async () => {
    server.replies.push({ content: 'The GPU is too small.', finishReason: 'stop' });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Question (optional)'), {
      target: { value: 'Why?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('The GPU is too small.')).toBeTruthy();
    expect(lastCall().messages[1]).toEqual({ role: 'user', content: 'Why?\n\nREPORT' });
    expect(lastCall().params.maxTokens).toBe(16384);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('continues a cut-off answer and sends follow-ups with the whole conversation', async () => {
    server.replies.push(
      { content: 'Part one', finishReason: 'length' },
      { content: ', part two.', finishReason: 'stop' },
      { content: 'Use --max-model-len.', finishReason: 'stop' }
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Part one, part two.')).toBeTruthy();
    expect(lastCall().messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Part one' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);

    fireEvent.change(screen.getByLabelText('Follow-up question'), {
      target: { value: 'Which flag?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Use --max-model-len.')).toBeTruthy();
    expect(lastCall().messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Part one, part two.' },
      { role: 'user', content: 'Which flag?' },
    ]);
  });

  it('keeps Continue after a failed continuation and returns a failed follow-up', async () => {
    server.replies.push(
      { content: 'Part one', finishReason: 'length' },
      new Error("This model's maximum context length is 8192 tokens.")
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Lower Max tokens/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();

    server.replies.push(new Error('HTTP 503'));
    fireEvent.change(screen.getByLabelText('Follow-up question'), {
      target: { value: 'Still there?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Follow-up question') as HTMLTextAreaElement).value).toBe(
        'Still there?'
      )
    );
    expect(screen.queryByText('Still there?', { selector: 'p' })).toBeNull();
  });

  it('turns thinking off in the request', async () => {
    server.replies.push({ content: 'Short.', finishReason: 'stop' });
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Short.');
    expect(lastCall().params.thinking).toBe(false);
  });
});
