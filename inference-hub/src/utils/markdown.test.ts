import { parseInline, parseMarkdown, splitThinking } from './markdown';

describe('parseInline', () => {
  it('parses code, bold, italic and web links only', () => {
    expect(
      parseInline(
        'Use `kubectl` **now** and _then_ [docs](https://kserve.github.io) [x](javascript:alert(1))'
      )
    ).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'kubectl' },
      { type: 'text', text: ' ' },
      { type: 'bold', children: [{ type: 'text', text: 'now' }] },
      { type: 'text', text: ' and ' },
      { type: 'italic', children: [{ type: 'text', text: 'then' }] },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'docs', href: 'https://kserve.github.io' },
      { type: 'text', text: ' ' },
      { type: 'text', text: '[x](javascript:alert(1)' },
      { type: 'text', text: ')' },
    ]);
  });

  it('keeps HTML as text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('parses the common block types', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        'Some text',
        'continued',
        '',
        '- one',
        '- two',
        '1. first',
        '> quoted',
        '---',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '```python',
        'print("hi")',
        '```',
      ].join('\n')
    );
    expect(blocks.map(b => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'hr',
      'table',
      'code',
    ]);
    expect(blocks[7]).toEqual({ type: 'code', lang: 'python', code: 'print("hi")' });
    expect(blocks[2]).toMatchObject({
      ordered: false,
      items: [[{ text: 'one' }], [{ text: 'two' }]],
    });
  });

  it('renders an unterminated fence as code while streaming', () => {
    expect(parseMarkdown('```bash\nkubectl get pods')).toEqual([
      { type: 'code', lang: 'bash', code: 'kubectl get pods' },
    ]);
  });
});

describe('splitThinking', () => {
  it('handles complete, open and close-only think tags', () => {
    expect(splitThinking('<think>plan</think>Answer')).toEqual({
      reasoning: 'plan',
      answer: 'Answer',
    });
    expect(splitThinking('<think>still thinking')).toEqual({
      reasoning: 'still thinking',
      answer: '',
    });
    expect(splitThinking('plan</think>\nAnswer')).toEqual({ reasoning: 'plan', answer: 'Answer' });
    expect(splitThinking('plain')).toEqual({ reasoning: '', answer: 'plain' });
  });
});

describe('robustness', () => {
  it('terminates on nested emphasis and indented hashes', () => {
    expect(parseInline('**bold with `code` inside** and *more*')).toHaveLength(3);
    expect(parseMarkdown('   # not a heading\ntext').map(b => b.type)).toEqual(['paragraph']);
  });
});
