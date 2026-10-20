import { readAnnotation } from './annotations';
import {
  catalogEntry,
  LocalModelCacheJson,
  matchesQuery,
  nodeGroupUsage,
  storageContainerFor,
} from './catalog';
import { fromLLMInferenceService } from './endpoint';

const lmc: LocalModelCacheJson = {
  apiVersion: 'serving.kserve.io/v1alpha1',
  kind: 'LocalModelCache',
  metadata: {
    name: 'llama3-8b',
    annotations: {
      'inference-hub.batuhancikrikci.github.io/display-name': 'Llama 3.1 8B Instruct',
      'inference-hub.batuhancikrikci.github.io/tags': 'chat, general ,',
      'inference-hub.batuhancikrikci.github.io/license': 'Llama 3.1 Community',
    },
  },
  spec: {
    sourceModelUri: 'hf://meta-llama/Llama-3.1-8B-Instruct',
    modelSize: '16Gi',
    nodeGroups: ['gpu-workers'],
  },
  status: {
    copies: { available: 1, total: 2, failed: 0 },
    nodeStatus: { 'gpu-2': 'NodeDownloading', 'gpu-1': 'NodeDownloaded' },
    llmInferenceServices: [{ name: 'llama', namespace: 'ai' }],
  },
};

describe('catalogEntry', () => {
  it('combines the cache object, annotations and URI enrichment', () => {
    const entry = catalogEntry(lmc);
    expect(entry).toMatchObject({
      name: 'llama3-8b',
      displayName: 'Llama 3.1 8B Instruct',
      license: 'Llama 3.1 Community',
      tags: ['chat', 'general'],
      modelSize: '16Gi',
      sizeBytes: 16 * 2 ** 30,
      copies: { available: 1, total: 2, failed: 0 },
      health: { health: 'progressing' },
    });
    expect(entry.model.provider?.id).toBe('meta');
    expect(entry.nodes.map(n => [n.node, n.health.health])).toEqual([
      ['gpu-1', 'ready'],
      ['gpu-2', 'progressing'],
    ]);
  });

  it('links users from status and exact URI matches', () => {
    const reported = fromLLMInferenceService({
      metadata: { name: 'llama', namespace: 'ai' },
      spec: { model: { uri: 'hf://meta-llama/Llama-3.1-8B-Instruct' } },
    });
    const unreported = fromLLMInferenceService({
      metadata: { name: 'llama-canary', namespace: 'team' },
      spec: { model: { uri: 'hf://meta-llama/Llama-3.1-8B-Instruct' } },
    });
    const other = fromLLMInferenceService({
      metadata: { name: 'qwen', namespace: 'ai' },
      spec: { model: { uri: 'hf://Qwen/Qwen2.5-7B-Instruct' } },
    });
    const users = catalogEntry(lmc, [reported, unreported, other]).users;
    expect(users.map(u => `${u.namespace}/${u.name}`)).toEqual(['ai/llama', 'team/llama-canary']);
    expect(users[0].endpoint).toBe(reported);
  });

  it('reports failures and fully cached models', () => {
    expect(
      catalogEntry({ ...lmc, status: { copies: { available: 1, total: 2, failed: 1 } } }).health
        .health
    ).toBe('failed');
    expect(
      catalogEntry({ ...lmc, status: { copies: { available: 2, total: 2 } } }).health.health
    ).toBe('ready');
    expect(catalogEntry({ ...lmc, status: undefined }).health.reason).toBe(
      'Waiting for the controller'
    );
  });

  it('searches names, provider, tags and URIs', () => {
    const entry = catalogEntry(lmc);
    expect(matchesQuery(entry, 'meta')).toBe(true);
    expect(matchesQuery(entry, 'GENERAL')).toBe(true);
    expect(matchesQuery(entry, 'qwen')).toBe(false);
  });
});

describe('storage', () => {
  it('computes node group usage and placement', () => {
    const usage = nodeGroupUsage({
      metadata: { name: 'workers' },
      spec: {
        storageLimit: '1.7T',
        persistentVolumeSpec: {
          storageClassName: 'local-storage',
          local: { path: '/mnt/models' },
          nodeAffinity: {
            required: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: 'nvidia.com/gpu.product',
                      operator: 'In',
                      values: ['NVIDIA-A100-SXM4-80GB'],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      status: { used: '200Gi', available: '1400G' },
    });
    expect(usage).toMatchObject({
      limitBytes: 1.7e12,
      usedBytes: 200 * 2 ** 30,
      availableBytes: 1.4e12,
      storageClass: 'local-storage',
      path: '/mnt/models',
      placement: ['nvidia.com/gpu.product In NVIDIA-A100-SXM4-80GB'],
    });
  });

  it('finds the storage container for a URI', () => {
    const containers = [
      {
        metadata: { name: 'default' },
        spec: {
          supportedUriFormats: [
            { prefix: 's3://' },
            { prefix: 'hf://' },
            { regex: 'https?://(.+)/(.+)' },
          ],
        },
      },
      {
        metadata: { name: 'custom' },
        spec: { supportedUriFormats: [{ prefix: 'custom://' }, { regex: '([' }] },
      },
    ];
    expect(storageContainerFor('hf://org/model', containers)?.metadata.name).toBe('default');
    expect(storageContainerFor('https://host/model.bin', containers)?.metadata.name).toBe(
      'default'
    );
    expect(storageContainerFor('custom://x', containers)?.metadata.name).toBe('custom');
    expect(storageContainerFor('pvc://x', containers)).toBeUndefined();
  });
});

describe('annotations', () => {
  it('reads annotations with the Inference Hub prefix only', () => {
    expect(
      readAnnotation({ 'inference-hub.batuhancikrikci.github.io/license': 'MIT' }, 'license')
    ).toBe('MIT');
    expect(readAnnotation({ license: 'MIT' }, 'license')).toBeUndefined();
    expect(readAnnotation(undefined, 'license')).toBeUndefined();
  });
});
