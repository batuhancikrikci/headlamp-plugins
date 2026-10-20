/**
 * Starting points for "Create from YAML". apiVersions come from discovery, never constants.
 */
import { KubeJson } from './types';

export function llmInferenceServiceTemplate(apiVersion: string, namespace: string): KubeJson {
  return {
    apiVersion,
    kind: 'LLMInferenceService',
    metadata: { name: 'qwen25-7b-instruct', namespace },
    spec: {
      model: { uri: 'hf://Qwen/Qwen2.5-7B-Instruct', name: 'Qwen/Qwen2.5-7B-Instruct' },
      replicas: 1,
      router: { scheduler: {}, route: {}, gateway: {} },
      template: {
        containers: [
          {
            name: 'main',
            resources: {
              limits: { cpu: '4', memory: '32Gi', 'nvidia.com/gpu': '1' },
              requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' },
            },
          },
        ],
      },
    },
  };
}

export function inferenceServiceTemplate(apiVersion: string, namespace: string): KubeJson {
  return {
    apiVersion,
    kind: 'InferenceService',
    metadata: { name: 'qwen25-05b-instruct', namespace },
    spec: {
      predictor: {
        model: {
          modelFormat: { name: 'huggingface' },
          storageUri: 'hf://Qwen/Qwen2.5-0.5B-Instruct',
          resources: {
            limits: { cpu: '4', memory: '16Gi', 'nvidia.com/gpu': '1' },
            requests: { cpu: '2', memory: '8Gi', 'nvidia.com/gpu': '1' },
          },
        },
      },
    },
  };
}

export function llmInferenceServiceConfigTemplate(apiVersion: string, namespace: string): KubeJson {
  return {
    apiVersion,
    kind: 'LLMInferenceServiceConfig',
    metadata: { name: 'vllm-long-context', namespace },
    spec: {
      template: {
        containers: [
          {
            name: 'main',
            env: [
              {
                name: 'VLLM_ADDITIONAL_ARGS',
                value: '--max-model-len=32768 --enable-prefix-caching',
              },
            ],
          },
        ],
      },
    },
  };
}

export function localModelNodeGroupTemplate(apiVersion: string): KubeJson {
  return {
    apiVersion,
    kind: 'LocalModelNodeGroup',
    metadata: { name: 'gpu-workers' },
    spec: {
      storageLimit: '1Ti',
      persistentVolumeClaimSpec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: '1Ti' } },
        storageClassName: 'local-storage',
        volumeMode: 'Filesystem',
      },
      persistentVolumeSpec: {
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
        capacity: { storage: '1Ti' },
        local: { path: '/mnt/models' },
        storageClassName: 'local-storage',
        nodeAffinity: {
          required: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'nvidia.com/gpu.present', operator: 'In', values: ['true'] },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

export function clusterStorageContainerTemplate(apiVersion: string): KubeJson {
  return {
    apiVersion,
    kind: 'ClusterStorageContainer',
    metadata: { name: 'custom-downloader' },
    spec: {
      container: {
        name: 'storage-initializer',
        image: 'registry.example.com/model-downloader:1.0',
        resources: {
          requests: { cpu: '100m', memory: '100Mi' },
          limits: { cpu: '1', memory: '1Gi' },
        },
      },
      supportedUriFormats: [{ prefix: 'custom://' }],
      workloadType: 'initContainer',
    },
  };
}

export function inferenceObjectiveTemplate(
  apiVersion: string,
  pool: { name: string; namespace: string; group: string }
): KubeJson {
  return {
    apiVersion,
    kind: 'InferenceObjective',
    metadata: { name: `${pool.name}-critical`, namespace: pool.namespace },
    spec: {
      // Higher priority requests are served first when the pool is saturated.
      priority: 10,
      poolRef: { group: pool.group, kind: 'InferencePool', name: pool.name },
    },
  };
}

export function inferenceModelRewriteTemplate(
  apiVersion: string,
  pool: { name: string; namespace: string; group: string },
  model: string
): KubeJson {
  return {
    apiVersion,
    kind: 'InferenceModelRewrite',
    metadata: { name: `${pool.name}-rewrite`, namespace: pool.namespace },
    spec: {
      poolRef: { group: pool.group, kind: 'InferencePool', name: pool.name },
      rules: [
        {
          matches: [{ model: { type: 'Exact', value: 'chat' } }],
          targets: [{ modelRewrite: model, weight: 100 }],
        },
      ],
    },
  };
}
