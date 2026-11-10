import { EXAMPLE_TOOLS, parseTools } from './tools';

describe('parseTools', () => {
  it('accepts the example', () => {
    expect(parseTools(EXAMPLE_TOOLS)).toMatchObject({ names: ['get_weather'] });
    expect(parseTools(EXAMPLE_TOOLS).error).toBeUndefined();
  });

  it('accepts a single definition', () => {
    const one = parseTools('{"type": "function", "function": {"name": "lookup"}}');
    expect(one.tools).toHaveLength(1);
    expect(one.names).toEqual(['lookup']);
  });

  it('explains what is wrong', () => {
    expect(parseTools('').error).toMatch(/at least one/);
    expect(parseTools('[').error).toMatch(/Not valid JSON/);
    expect(parseTools('[{"name": "x"}]').error).toMatch(/Tool 1 must look like/);
    expect(parseTools('[{"type": "function", "function": {"name": "a b"}}]').error).toMatch(
      /may only use/
    );
  });
});
