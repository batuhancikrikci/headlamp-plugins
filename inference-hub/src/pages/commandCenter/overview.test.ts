import { EventJson } from '../../components/detail/EventsPanel';
import { fromLLMInferenceService } from '../../resources/endpoint';
import { detectEngines } from '../../resources/engine';
import { PodJson } from '../../resources/pod';
import { aiWarnings, healthCounts, platformStatus, trafficByEndpoint } from './overview';

const qwen = fromLLMInferenceService({
  metadata: { name: 'qwen', namespace: 'ai' },
  spec: { model: { name: 'Qwen/Qwen3-8B', uri: 'hf://Qwen/Qwen3-8B' } },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
});

function enginePod(name: string, labels: Record<string, string> = {}): PodJson {
  return {
    metadata: { name, namespace: 'ai', labels },
    spec: { containers: [{ name: 'main', image: 'vllm/vllm-openai:v0.30.0' }] },
    status: { phase: 'Running' },
  };
}

describe('trafficByEndpoint', () => {
  it('groups engines per endpoint and sorts by throughput', () => {
    const labels = {
      'app.kubernetes.io/part-of': 'llminferenceservice',
      'app.kubernetes.io/name': 'qwen',
    };
    const engines = detectEngines([
      enginePod('qwen-0', labels),
      enginePod('qwen-1', labels),
      enginePod('solo'),
    ]);
    const metrics = new Map([
      ['ai/qwen-0', { running: 2, generationTps: 100, windowed: true }],
      ['ai/qwen-1', { running: 1, generationTps: 50, windowed: true }],
      ['ai/solo', { running: 0, generationTps: 200, windowed: true, modelName: 'my-model' }],
    ]);
    const rows = trafficByEndpoint(engines, metrics, [qwen]);
    expect(rows.map(r => [r.name, r.engines, r.metrics.generationTps, r.metrics.running])).toEqual([
      ['solo', 1, 200, 0],
      ['qwen', 2, 150, 3],
    ]);
    expect(rows[1].endpoint).toBe(qwen);
    expect(rows[1].model).toBe('Qwen/Qwen3-8B');
    expect(rows[0].model).toBe('my-model');
  });

  it('skips engines without metrics', () => {
    expect(trafficByEndpoint(detectEngines([enginePod('x')]), new Map(), [])).toEqual([]);
  });
});

describe('overview helpers', () => {
  it('counts endpoint health', () => {
    expect(healthCounts([qwen])).toMatchObject({ ready: 1, failed: 0 });
  });

  it('reports the worst endpoint state as the platform status', () => {
    const counts = { ready: 3, progressing: 0, failed: 0, stopped: 1, unknown: 0 };
    expect(platformStatus(counts, false)).toEqual({ tone: 'success', label: 'Healthy' });
    expect(platformStatus({ ...counts, progressing: 2 }, false)).toEqual({
      tone: 'info',
      label: '2 deploying',
    });
    expect(platformStatus({ ...counts, progressing: 2, failed: 1 }, false)).toEqual({
      tone: 'error',
      label: '1 failing',
    });
    expect(platformStatus(healthCounts([]), false).label).toBe('No endpoints');
    expect(platformStatus(healthCounts([]), true).label).toBe('Not installed');
  });

  it('keeps only warnings about the AI platform, newest first', () => {
    const ev = (
      name: string,
      kind: string,
      ns: string,
      time: string,
      type = 'Warning'
    ): EventJson => ({
      metadata: { name, namespace: ns },
      type,
      involvedObject: { kind, name, namespace: ns },
      lastTimestamp: time,
    });
    const events = [
      ev('qwen-kserve-abc', 'Pod', 'ai', '2026-01-01T00:02:00Z'),
      ev('pool', 'InferencePool', 'other', '2026-01-01T00:03:00Z'),
      ev('web-1', 'Pod', 'ai', '2026-01-01T00:04:00Z'),
      ev('qwen', 'LLMInferenceService', 'ai', '2026-01-01T00:01:00Z', 'Normal'),
      ev('qwen-old', 'Pod', 'other', '2026-01-01T00:05:00Z'),
    ];
    expect(aiWarnings(events, [qwen]).map(e => e.metadata.name)).toEqual([
      'pool',
      'qwen-kserve-abc',
    ]);
  });
});
