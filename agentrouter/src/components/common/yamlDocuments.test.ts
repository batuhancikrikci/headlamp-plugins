import { describe, expect, it } from 'vitest';
import { distinctKinds, kindKey, parseYamlStream, pickKind, toYamlStream } from './yamlDocuments';

const route = { apiVersion: 'aigateway.envoyproxy.io/v1beta1', kind: 'AIGatewayRoute' };
const backend = { apiVersion: 'aigateway.envoyproxy.io/v1beta1', kind: 'AIServiceBackend' };

describe('toYamlStream / parseYamlStream', () => {
  it('round-trips several documents and drops undefined fields', () => {
    const text = toYamlStream([
      { ...route, metadata: { name: 'a', labels: undefined } },
      { ...backend, metadata: { name: 'b' } },
    ]);
    expect(text).toContain('---\n');
    expect(text).not.toContain('labels');
    expect(parseYamlStream(text)).toEqual({
      docs: [
        { ...route, metadata: { name: 'a' } },
        { ...backend, metadata: { name: 'b' } },
      ],
      error: null,
    });
  });

  it('skips empty documents and scalars', () => {
    expect(parseYamlStream('---\n---\nkind: A\n---\n42\n').docs).toEqual([{ kind: 'A' }]);
  });

  it('keeps strings that look like other types (JSON schema)', () => {
    expect(parseYamlStream('a: 2024-01-01\nb: "on"').docs).toEqual([{ a: '2024-01-01', b: 'on' }]);
  });

  it('reports syntax errors', () => {
    const result = parseYamlStream('a: [1, 2');
    expect(result.docs).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('distinctKinds / pickKind', () => {
  const kinds = distinctKinds([route, backend, { ...route }, { kind: 'NoVersion' }]);

  it('lists each apiVersion/kind once, in order', () => {
    expect(kinds).toEqual([route, backend]);
  });

  it('prefers the chosen kind, then the preferred kind, then the first', () => {
    expect(pickKind(kinds, kindKey(backend))).toEqual(backend);
    expect(pickKind(kinds, null, 'AIServiceBackend')).toEqual(backend);
    expect(pickKind(kinds, 'unknown|Kind', 'Missing')).toEqual(route);
    expect(pickKind([], null)).toBeUndefined();
  });
});
