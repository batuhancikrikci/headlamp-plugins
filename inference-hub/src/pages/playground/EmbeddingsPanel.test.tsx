import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { EmbeddingsPanel } from './EmbeddingsPanel';

// The model server is the external dependency; the response parsing and the tables are real.
const server = vi.hoisted(() => ({
  sent: [] as Array<{ path: string; body: Record<string, unknown> }>,
  reply: {} as Record<string, unknown>,
}));

vi.mock('../../api/openai', async importOriginal => {
  const real = await importOriginal<typeof import('../../api/openai')>();
  return {
    ...real,
    resolveTarget: async () => ({
      proxyBase: '/proxy',
      apiPrefix: '/v1',
      inClusterUrl: 'http://embed',
      models: ['bge-m3'],
    }),
    createEmbeddings: async (_c: string, _r: unknown, model: string, input: string[]) => {
      server.sent.push({ path: 'embeddings', body: { model, input } });
      return real.parseEmbeddings(server.reply);
    },
    rerankDocuments: async (
      _c: string,
      _r: unknown,
      model: string,
      query: string,
      documents: string[]
    ) => {
      server.sent.push({ path: 'rerank', body: { model, query, documents } });
      return real.parseRerank(server.reply);
    },
  };
});
vi.mock('../../hooks/useCluster', () => ({ useCurrentCluster: () => 'test' }));
vi.mock('../../components/playground/GatewayAccess', () => ({ GatewayAccess: () => null }));

const targets = [
  {
    id: 'llm/ai/embed',
    kind: 'LLMInferenceService',
    namespace: 'ai',
    name: 'embed',
    label: 'embed',
    defaultModel: 'bge-m3',
    status: { health: 'ready' },
  },
] as unknown as PlaygroundTarget[];

beforeEach(() => {
  server.sent = [];
});

describe('EmbeddingsPanel', () => {
  it('embeds every line and compares them', async () => {
    server.reply = {
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [0.8, 0.6] },
        { index: 2, embedding: [0, 1] },
        { index: 3, embedding: [0.1, 0.99] },
      ],
      usage: { prompt_tokens: 40 },
    };
    render(<EmbeddingsPanel targets={targets} />);
    const embed = await screen.findByRole('button', { name: 'Embed' });
    await waitFor(() => expect(embed.hasAttribute('disabled')).toBe(false));
    fireEvent.click(embed);
    expect(await screen.findByText(/4 vectors of 2 dimensions/)).toBeTruthy();
    expect(server.sent[0].body).toMatchObject({ model: 'bge-m3' });
    expect((server.sent[0].body.input as string[]).length).toBe(4);
    expect(screen.getByText(/Most similar: #3 and #4/)).toBeTruthy();
  });

  it('ranks the documents for a query', async () => {
    server.reply = {
      results: [
        { index: 0, relevance_score: 0.97 },
        { index: 2, relevance_score: 0.6 },
      ],
    };
    render(<EmbeddingsPanel targets={targets} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rerank' }));
    const run = screen.getAllByRole('button', { name: 'Rerank' }).at(-1)!;
    await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false));
    fireEvent.click(run);
    expect(await screen.findByText('0.970')).toBeTruthy();
    expect(server.sent[0]).toMatchObject({
      path: 'rerank',
      body: { query: 'Which GPU has the most memory?' },
    });
  });

  it('explains a model that does not serve embeddings', async () => {
    server.reply = { error: { message: 'The model does not support Embeddings API' } };
    render(<EmbeddingsPanel targets={targets} />);
    const embed = await screen.findByRole('button', { name: 'Embed' });
    await waitFor(() => expect(embed.hasAttribute('disabled')).toBe(false));
    fireEvent.click(embed);
    expect(await screen.findByText(/use an embedding model/)).toBeTruthy();
  });
});
