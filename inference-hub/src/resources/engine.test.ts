import { detectEngine, detectEngines, imageVersion } from './engine';
import { PodJson } from './pod';

function pod(containers: object[], labels: Record<string, string> = {}): PodJson {
  return {
    metadata: { name: 'p-0', namespace: 'ai', labels },
    spec: {
      nodeName: 'gpu-1',
      containers: containers as PodJson['spec'] extends { containers?: infer C } ? C : never,
    },
    status: { phase: 'Running' },
  };
}

describe('detectEngine', () => {
  it('detects a KServe LLMInferenceService decode pod behind the routing sidecar', () => {
    const engine = detectEngine(
      pod(
        [
          {
            name: 'llm-d-routing-sidecar',
            image: 'ghcr.io/llm-d/llm-d-router-disagg-sidecar:v0.9.0',
            ports: [{ containerPort: 8000 }],
          },
          {
            name: 'main',
            image: 'ghcr.io/llm-d/llm-d-cuda:v0.8.0',
            command: [
              '/bin/bash',
              '-c',
              'exec vllm serve /mnt/models --served-model-name "Qwen/Qwen3-8B" --port 8000',
            ],
            ports: [{ containerPort: 8001 }],
            readinessProbe: { httpGet: { scheme: 'HTTPS', port: 8001 } },
            resources: { limits: { 'nvidia.com/gpu': '1' } },
          },
        ],
        {
          'app.kubernetes.io/part-of': 'llminferenceservice',
          'app.kubernetes.io/name': 'qwen3',
          'app.kubernetes.io/component': 'llminferenceservice-workload',
          'llm-d.ai/role': 'decode',
        }
      )
    );
    expect(engine).toMatchObject({
      container: 'main',
      flavor: 'vllm',
      port: 8001,
      scheme: 'https',
      version: 'v0.8.0',
      servedModelName: 'Qwen/Qwen3-8B',
      role: 'Decode',
      gpus: 1,
      endpoint: { slug: 'llm', name: 'qwen3' },
    });
  });

  it('detects upstream vLLM images with args', () => {
    const engine = detectEngine(
      pod([
        {
          name: 'vllm',
          image: 'docker.io/vllm/vllm-openai:v0.30.0',
          args: ['--model', 'meta-llama/Llama-3.1-8B-Instruct', '--port=9000'],
        },
      ])
    );
    expect(engine).toMatchObject({
      port: 9000,
      scheme: 'http',
      servedModelName: 'meta-llama/Llama-3.1-8B-Instruct',
    });
  });

  it('detects the KServe Hugging Face runtime', () => {
    const engine = detectEngine(
      pod(
        [
          {
            name: 'kserve-container',
            image: 'kserve/huggingfaceserver:v0.20.0-gpu',
            args: ['--model_name=qwen'],
          },
        ],
        {
          'serving.kserve.io/inferenceservice': 'qwen',
          component: 'predictor',
        }
      )
    );
    expect(engine).toMatchObject({
      flavor: 'kserve-hf',
      port: 8080,
      servedModelName: 'qwen',
      endpoint: { slug: 'isvc' },
    });
  });

  it('ignores schedulers, sidecars and unrelated pods', () => {
    expect(
      detectEngines([
        pod([{ name: 'epp', image: 'ghcr.io/llm-d/llm-d-router-endpoint-picker:v0.9.0' }]),
        pod([{ name: 'tok', image: 'ghcr.io/llm-d/llm-d-uds-tokenizer:vllm-v0.19.1' }]),
        pod([{ name: 'web', image: 'nginx:1.27' }]),
      ])
    ).toEqual([]);
  });

  it('parses image tags', () => {
    expect(imageVersion('registry:5000/vllm/vllm-openai:v0.30.0')).toBe('v0.30.0');
    expect(imageVersion('registry:5000/vllm/vllm-openai')).toBeUndefined();
    expect(imageVersion('vllm/vllm-openai:v0.30.0@sha256:abc')).toBe('v0.30.0');
  });
});
