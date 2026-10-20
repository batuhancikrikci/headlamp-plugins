import {
  buildCatalogEntry,
  CatalogEntryForm,
  catalogNameFor,
  defaultCatalogForm,
  suggestModelSize,
  validateCatalogForm,
} from './catalogEntryModel';

const form = (patch: Partial<CatalogEntryForm> = {}): CatalogEntryForm => ({
  ...defaultCatalogForm(),
  uri: 'hf://Qwen/Qwen2.5-7B-Instruct',
  name: 'qwen2-5-7b-instruct',
  modelSize: '16Gi',
  nodeGroups: ['gpu-workers'],
  ...patch,
});

describe('catalog entry form', () => {
  it('validates required fields and duplicates', () => {
    expect(validateCatalogForm(form())).toEqual({});
    expect(validateCatalogForm(form({ nodeGroups: [], modelSize: '' }))).toMatchObject({
      nodeGroups: expect.any(String),
      modelSize: expect.any(String),
    });
    expect(validateCatalogForm(form(), ['qwen2-5-7b-instruct']).name).toMatch(/already exists/);
    expect(validateCatalogForm(form({ uri: 'hf://Qwen' })).uri).toBeDefined();
  });

  it('suggests names and sizes', () => {
    expect(catalogNameFor('hf://Qwen/Qwen2.5-7B-Instruct')).toBe('qwen25-7b-instruct');
    expect(catalogNameFor('hf://Qwen/Qwen3.8-27B')).toBe('qwen38-27b');
    expect(suggestModelSize(14.9)).toBe('17Gi');
    expect(suggestModelSize(undefined)).toBe('');
  });

  it('builds a LocalModelCache with presentation annotations', () => {
    expect(
      buildCatalogEntry(
        form({
          displayName: 'Qwen 2.5 7B',
          tags: 'chat, multilingual,',
          serviceAccountName: 'hf-reader',
        }),
        'serving.kserve.io/v1alpha1'
      )
    ).toEqual({
      apiVersion: 'serving.kserve.io/v1alpha1',
      kind: 'LocalModelCache',
      metadata: {
        name: 'qwen2-5-7b-instruct',
        labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
        annotations: {
          'inference-hub.batuhancikrikci.github.io/display-name': 'Qwen 2.5 7B',
          'inference-hub.batuhancikrikci.github.io/tags': 'chat,multilingual',
        },
      },
      spec: {
        sourceModelUri: 'hf://Qwen/Qwen2.5-7B-Instruct',
        modelSize: '16Gi',
        nodeGroups: ['gpu-workers'],
        serviceAccountName: 'hf-reader',
      },
    });
  });
});
