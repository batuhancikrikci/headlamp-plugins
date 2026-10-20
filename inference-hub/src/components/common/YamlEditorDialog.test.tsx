import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { YamlEditorDialog } from './YamlEditorDialog';

// Monaco does not run in jsdom; a textarea stands in for it.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="yaml" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));
vi.mock('../../hooks/useCluster', () => ({ useCurrentCluster: () => 'c1' }));

function endpoint(resourceVersion: string) {
  return {
    apiVersion: 'serving.kserve.io/v1alpha2',
    kind: 'LLMInferenceService',
    metadata: { name: 'qwen', namespace: 'ai', resourceVersion },
    spec: { replicas: 1 },
  };
}

describe('YamlEditorDialog', () => {
  it('keeps the user edits when the live object is refreshed (regression)', () => {
    const props = { open: true, mode: 'edit' as const, title: 'Edit', onClose: () => {} };
    const { rerender } = render(<YamlEditorDialog {...props} initial={endpoint('1')} />);
    const editor = screen.getByLabelText('yaml') as HTMLTextAreaElement;
    expect(editor.value).toContain('replicas: 1');

    fireEvent.change(editor, {
      target: { value: editor.value.replace('replicas: 1', 'replicas: 3') },
    });
    // Background polling hands over a new object.
    rerender(<YamlEditorDialog {...props} initial={endpoint('2')} />);

    expect((screen.getByLabelText('yaml') as HTMLTextAreaElement).value).toContain('replicas: 3');
  });

  it('loads the current object again when reopened', () => {
    const props = { mode: 'edit' as const, title: 'Edit', onClose: () => {} };
    const { rerender } = render(<YamlEditorDialog {...props} open initial={endpoint('1')} />);
    rerender(<YamlEditorDialog {...props} open={false} initial={endpoint('1')} />);
    const next = endpoint('2');
    next.spec.replicas = 2;
    rerender(<YamlEditorDialog {...props} open initial={next} />);
    expect((screen.getByLabelText('yaml') as HTMLTextAreaElement).value).toContain('replicas: 2');
  });
});
