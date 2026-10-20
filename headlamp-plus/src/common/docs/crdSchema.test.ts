import { describe, expect, it } from 'vitest';
import {
  childContainer,
  fieldMatches,
  findFields,
  pickSchemaVersion,
  resolveSchemaPath,
  schemaLimits,
  SchemaNode,
  splitApiVersion,
  typeLabel,
  valueAtSchemaPath,
} from './crdSchema';

const root: SchemaNode = {
  type: 'object',
  properties: {
    spec: {
      type: 'object',
      required: ['rules'],
      properties: {
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              backendRefs: {
                type: 'array',
                items: { type: 'object', properties: { weight: { type: 'integer', minimum: 0 } } },
              },
              timeouts: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
        port: { 'x-kubernetes-int-or-string': true },
      },
    },
  },
};

describe('resolveSchemaPath', () => {
  it('lists the root at the empty path', () => {
    expect(resolveSchemaPath(root, [])).toEqual({ node: undefined, container: root });
  });

  it('navigates into objects and array items', () => {
    const loc = resolveSchemaPath(root, ['spec', 'rules', 'backendRefs']);
    expect(loc.node?.type).toBe('array');
    expect(Object.keys(loc.container?.properties || {})).toEqual(['weight']);
  });

  it('returns nothing for unknown paths', () => {
    expect(resolveSchemaPath(root, ['spec', 'missing'])).toEqual({});
  });
});

describe('typeLabel', () => {
  it('describes arrays, maps and int-or-string', () => {
    const rules = root.properties!.spec.properties!.rules;
    expect(typeLabel(rules)).toBe('[]object');
    expect(typeLabel(rules.items!.properties!.timeouts)).toBe('map[string]string');
    expect(typeLabel(root.properties!.spec.properties!.port)).toBe('int-or-string');
    expect(childContainer(root.properties!.spec.properties!.port)).toBeUndefined();
  });
});

describe('valueAtSchemaPath', () => {
  it('follows arrays through their first element', () => {
    const value = { spec: { rules: [{ backendRefs: [{ weight: 2 }] }] } };
    expect(valueAtSchemaPath(value, ['spec', 'rules', 'backendRefs', 'weight'])).toBe(2);
    expect(valueAtSchemaPath({ spec: { rules: [] } }, ['spec', 'rules'])).toBeUndefined();
  });
});

describe('findFields', () => {
  it('finds fields breadth first', () => {
    expect(findFields(root, 'weight').map(m => m.path.join('.'))).toEqual([
      'spec.rules.backendRefs.weight',
    ]);
    expect(findFields(root, '')).toEqual([]);
  });
});

describe('fieldMatches', () => {
  it('matches the name or the description, ignoring case', () => {
    const node: SchemaNode = { description: 'Selects services by label' };
    expect(fieldMatches('serviceSelector', node, 'SELECTOR')).toBe(true);
    expect(fieldMatches('blocks', node, 'label')).toBe(true);
    expect(fieldMatches('blocks', node, 'cidr')).toBe(false);
    expect(fieldMatches('blocks', node, '  ')).toBe(true);
  });
});

describe('schemaLimits', () => {
  it('formats ranges and one-sided bounds', () => {
    expect(schemaLimits({ minimum: 1, maximum: 10, maxItems: 16, minLength: 3 })).toEqual([
      'value 1 – 10',
      'items ≤ 16',
      'length ≥ 3',
    ]);
    expect(schemaLimits({ minimum: 0 })).toEqual(['value ≥ 0']);
    expect(schemaLimits({ type: 'string' })).toEqual([]);
  });
});

describe('pickSchemaVersion', () => {
  const versions = [
    { name: 'v2alpha1', served: true },
    { name: 'v2', served: true, storage: true },
  ];

  it('prefers the requested version, then the storage version', () => {
    expect(pickSchemaVersion(versions, 'v2alpha1')?.name).toBe('v2alpha1');
    expect(pickSchemaVersion(versions, 'v3')?.name).toBe('v2');
    expect(pickSchemaVersion([{ name: 'v1' }], 'v9')?.name).toBe('v1');
    expect(pickSchemaVersion(undefined, 'v1')).toBeUndefined();
  });
});

describe('splitApiVersion', () => {
  it('separates group and version', () => {
    expect(splitApiVersion('cilium.io/v2')).toEqual({ group: 'cilium.io', version: 'v2' });
    expect(splitApiVersion('v1')).toEqual({ group: '', version: 'v1' });
  });
});
