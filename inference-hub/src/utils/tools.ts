/**
 * Function definitions for tool calling in the Playground, in the OpenAI `tools` format.
 */

export const EXAMPLE_TOOLS = JSON.stringify(
  [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Current weather in a city.',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name, e.g. Istanbul' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['city'],
        },
      },
    },
  ],
  null,
  2
);

export interface ParsedTools {
  tools?: unknown[];
  /** Function names, for display. */
  names: string[];
  error?: string;
}

/** Parses and checks the tools JSON: an array (or a single object) of function definitions. */
export function parseTools(text: string): ParsedTools {
  if (!text.trim()) return { names: [], error: 'Enter at least one function definition.' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { names: [], error: `Not valid JSON: ${(err as Error).message}` };
  }
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return { names: [], error: 'Enter at least one function definition.' };
  const names: string[] = [];
  for (const [i, item] of list.entries()) {
    const fn = (item as { type?: unknown; function?: { name?: unknown } })?.function;
    if ((item as { type?: unknown })?.type !== 'function' || typeof fn?.name !== 'string') {
      return {
        names: [],
        error: `Tool ${i + 1} must look like {"type": "function", "function": {"name": …}}.`,
      };
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fn.name)) {
      return {
        names: [],
        error: `Function name "${fn.name}" may only use letters, digits, _ and - (up to 64).`,
      };
    }
    names.push(fn.name);
  }
  return { tools: list, names };
}
