import { describe, expect, it } from 'vitest';
import { getIn, setIn } from './objects';
import { dumpAllYaml, dumpYaml, fromYaml, parseManifests, sameJson } from './yaml';

const widget = {
  apiVersion: 'example.com/v1',
  kind: 'Widget',
  metadata: { name: 'prod', namespace: 'apps' },
  spec: {
    sets: ['prod-set'],
    selector: { matchLabels: { env: 'prod' } },
    tolerations: [{ key: 'unreachable', operator: 'Exists' }],
  },
};

describe('form → YAML → form', () => {
  it('round-trips an object without changes', () => {
    const result = fromYaml(dumpYaml(widget), 'Widget');
    expect(result.error).toBeUndefined();
    expect(sameJson(result.value, widget)).toBe(true);
  });

  it('drops fields cleared in the form', () => {
    let next = setIn(widget, ['spec', 'tolerations'], undefined);
    next = setIn(next, ['spec', 'replicas'], 3);
    const text = dumpYaml(next);
    expect(text).not.toContain('tolerations');
    expect(text).toContain('replicas: 3');
    expect(getIn(fromYaml(text).value, ['spec', 'replicas'])).toBe(3);
  });

  it('keeps empty selectors, which select everything', () => {
    expect(dumpYaml(setIn(widget, ['spec', 'selector'], {}))).toContain('selector: {}');
  });
});

describe('YAML → form', () => {
  it('reports syntax errors instead of throwing', () => {
    const result = fromYaml('spec: [unclosed', 'Widget');
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('rejects documents that are not a single object', () => {
    expect(fromYaml('- a\n- b').error).toMatch(/single Kubernetes object/);
    expect(fromYaml('kind: Widget\napiVersion: x/v1').error).toMatch(/metadata/);
  });

  it('does not allow changing the kind of the edited object', () => {
    const text = dumpYaml({ ...widget, kind: 'Gadget' });
    expect(fromYaml(text, 'Widget').error).toMatch(/kind cannot be changed/);
  });
});

describe('multi-document YAML', () => {
  it('dumps and parses several objects', () => {
    const text = dumpAllYaml([widget, { ...widget, metadata: { name: 'b' } }]);
    expect(parseManifests(text).value?.map(d => (d.metadata as { name: string }).name)).toEqual([
      'prod',
      'b',
    ]);
    expect(parseManifests('kind: X\n').error).toMatch(/apiVersion and kind/);
  });
});

describe('sameJson', () => {
  it('ignores key order and undefined values', () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(
      true
    );
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
