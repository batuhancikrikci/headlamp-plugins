import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { EndpointPicker, filterTargets, namespaceCounts } from './EndpointPicker';

const target = (
  namespace: string,
  name: string,
  model: string,
  extra: Partial<PlaygroundTarget> = {}
) =>
  ({
    id: `llm/${namespace}/${name}`,
    kind: 'LLMInferenceService',
    namespace,
    name,
    label: name,
    defaultModel: model,
    model: {},
    status: { health: 'ready' },
    ...extra,
  } as unknown as PlaygroundTarget);

const targets = () => [
  target('ai', 'qwen-chat', 'Qwen/Qwen3-8B'),
  target('ai', 'llama', 'meta-llama/Llama-3.1-8B', { status: { health: 'failed' } as never }),
  target('team-b', 'qwen-vl', 'Qwen/Qwen2.5-VL-7B'),
  target('team-b', 'pod-1', 'gemma', { id: 'pod/team-b/pod-1', kind: 'Engine' }),
];

describe('filterTargets', () => {
  it('filters by namespace, words, kind and readiness', () => {
    const all = targets();
    const base = { namespace: '', search: '', group: '' as const, readyOnly: false };
    expect(filterTargets(all, { ...base, namespace: 'ai' }).map(x => x.name)).toEqual([
      'qwen-chat',
      'llama',
    ]);
    expect(filterTargets(all, { ...base, search: 'qwen vl' }).map(x => x.name)).toEqual([
      'qwen-vl',
    ]);
    expect(filterTargets(all, { ...base, group: 'engine' }).map(x => x.name)).toEqual(['pod-1']);
    expect(filterTargets(all, { ...base, readyOnly: true })).toHaveLength(3);
    expect(namespaceCounts(all)).toEqual([
      ['ai', 2],
      ['team-b', 2],
    ]);
  });
});

describe('EndpointPicker', () => {
  it('shows the chosen server and picks another one from a namespace', () => {
    const onChange = vi.fn();
    render(<EndpointPicker targets={targets()} value="llm/ai/qwen-chat" onChange={onChange} />);
    const field = screen.getByRole('button', { name: 'Endpoint' });
    expect(within(field).getByText('qwen-chat')).toBeTruthy();

    fireEvent.click(field);
    fireEvent.mouseDown(screen.getByLabelText('Namespace'));
    fireEvent.click(screen.getByRole('option', { name: 'team-b (2)' }));
    expect(screen.queryByText('llama')).toBeNull();
    fireEvent.click(screen.getByText('qwen-vl'));
    expect(onChange).toHaveBeenCalledWith('llm/team-b/qwen-vl');
  });

  it('keeps the search and stays open when the list refreshes', () => {
    const { rerender } = render(
      <EndpointPicker targets={targets()} value={null} onChange={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Endpoint' }));
    const search = screen.getByLabelText('Search name or model') as HTMLInputElement;
    // The namespace chosen in the test before is remembered for the session.
    expect(screen.getByLabelText('Namespace').textContent).toContain('team-b');
    fireEvent.change(search, { target: { value: 'vl' } });
    // A background refresh hands over new objects with the same content.
    rerender(<EndpointPicker targets={targets()} value={null} onChange={() => undefined} />);
    expect((screen.getByLabelText('Search name or model') as HTMLInputElement).value).toBe('vl');
    expect(screen.getByText('qwen-vl')).toBeTruthy();
    expect(screen.queryByText('pod-1')).toBeNull();
  });
});
