import { describe, expect, it } from 'vitest';
import type { EventJson } from '../components/detail/EventsPanel';
import type { LocalModelCacheJson } from '../resources/catalog';
import type { ContainerStatus, PodJson } from '../resources/pod';
import { diagnose, DiagnosisInput, scanLogs, schedulingHint } from './diagnose';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function endpoint(overrides: Partial<DiagnosisInput['endpoint']> = {}): DiagnosisInput['endpoint'] {
  return {
    kind: 'LLMInferenceService',
    name: 'qwen',
    namespace: 'llm',
    modelUri: 'hf://Qwen/Qwen3-14B-FP8',
    status: { health: 'progressing', reason: 'Deploying' },
    createdAt: minutesAgo(30),
    raw: {
      metadata: { name: 'qwen', namespace: 'llm' },
      spec: {},
      status: { conditions: [{ type: 'Ready', status: 'False', reason: 'NotReady' }] },
    },
    ...overrides,
  };
}

function container(name: string, extra: Partial<ContainerStatus> = {}): ContainerStatus {
  return { name, ready: false, restartCount: 0, ...extra };
}

function pod(
  name: string,
  status: PodJson['status'],
  labels: Record<string, string> = {}
): PodJson {
  return {
    metadata: { name, namespace: 'llm', labels },
    spec: { nodeName: 'gpu-1' },
    status,
  };
}

function input(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    endpoint: endpoint(),
    pods: [],
    events: [],
    catalog: null,
    now: NOW,
    ...overrides,
  };
}

const ids = (d: ReturnType<typeof diagnose>) =>
  Object.fromEntries(d.findings.map(f => [f.id, f.status]));

describe('diagnose', () => {
  it('reports a ready endpoint as healthy', () => {
    const d = diagnose(
      input({
        endpoint: endpoint({
          status: { health: 'ready' },
          raw: {
            metadata: { name: 'qwen' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] },
          },
        }),
        pods: [
          pod('qwen-0', {
            phase: 'Running',
            containerStatuses: [container('main', { ready: true, state: { running: {} } })],
          }),
        ],
      })
    );
    expect(d.verdict).toEqual({
      status: 'pass',
      summary: 'No problem found: the endpoint is ready.',
    });
    expect(ids(d)).toMatchObject({ conditions: 'pass', scheduling: 'pass', readiness: 'pass' });
  });

  it('explains pods that wait for GPUs, using the FailedScheduling event', () => {
    const events: EventJson[] = [
      {
        metadata: { name: 'e1' },
        reason: 'FailedScheduling',
        message: '0/4 nodes are available: 4 Insufficient nvidia.com/gpu.',
        involvedObject: { kind: 'Pod', name: 'qwen-0' },
      },
    ];
    const d = diagnose(
      input({
        events,
        pods: [
          pod('qwen-0', {
            phase: 'Pending',
            conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }],
          }),
        ],
      })
    );
    const scheduling = d.findings.find(f => f.id === 'scheduling')!;
    expect(scheduling.status).toBe('fail');
    expect(scheduling.evidence[0]).toContain('Insufficient nvidia.com/gpu');
    expect(scheduling.hint).toMatch(/Not enough free GPUs/);
    expect(d.verdict.status).toBe('fail');
  });

  it('gives a hint per scheduling failure', () => {
    expect(schedulingHint("didn't match Pod's node affinity/selector")).toMatch(/node selector/);
    expect(schedulingHint('1 node(s) had untolerated taint {gpu: true}')).toMatch(/taints/);
    expect(schedulingHint('Insufficient memory')).toMatch(/CPU or memory/);
    expect(schedulingHint('pod has unbound immediate PersistentVolumeClaims')).toMatch(/PVC/);
  });

  it('reports image pull failures', () => {
    const d = diagnose(
      input({
        pods: [
          pod('qwen-0', {
            phase: 'Pending',
            containerStatuses: [
              container('main', {
                state: { waiting: { reason: 'ImagePullBackOff', message: 'not found' } },
              }),
            ],
          }),
        ],
      })
    );
    expect(ids(d).images).toBe('fail');
  });

  it('recognizes OOMKilled model servers', () => {
    const d = diagnose(
      input({
        pods: [
          pod('qwen-0', {
            phase: 'Running',
            containerStatuses: [
              container('main', {
                restartCount: 3,
                state: { waiting: { reason: 'CrashLoopBackOff' } },
                lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
              }),
            ],
          }),
        ],
      })
    );
    const crashes = d.findings.find(f => f.id === 'crashes')!;
    expect(crashes.status).toBe('fail');
    expect(crashes.summary).toMatch(/OOMKilled/);
    expect(crashes.evidence[0]).toContain('exit code 137, 3 restarts');
  });

  it('reports a failing model download', () => {
    const d = diagnose(
      input({
        pods: [
          pod('qwen-0', {
            phase: 'Pending',
            initContainerStatuses: [
              container('storage-initializer', {
                restartCount: 2,
                state: { waiting: { reason: 'CrashLoopBackOff' } },
                lastState: { terminated: { reason: 'Error', exitCode: 1 } },
              }),
            ],
          }),
        ],
      })
    );
    expect(ids(d).download).toBe('fail');
  });

  it('tells loading from stuck', () => {
    const loading = (minutes: number) =>
      diagnose(
        input({
          pods: [
            pod('qwen-0', {
              phase: 'Running',
              containerStatuses: [
                container('main', { state: { running: { startedAt: minutesAgo(minutes) } } }),
              ],
            }),
          ],
        })
      ).findings.find(f => f.id === 'readiness')!;
    expect(loading(4)).toMatchObject({ status: 'progress' });
    expect(loading(4).summary).toContain('4 min');
    expect(loading(45)).toMatchObject({ status: 'warn' });
  });

  it('reports failing conditions with their reasons', () => {
    const d = diagnose(
      input({
        endpoint: endpoint({
          raw: {
            metadata: { name: 'qwen' },
            status: {
              conditions: [
                { type: 'Ready', status: 'False' },
                {
                  type: 'PresetsCombined',
                  status: 'False',
                  reason: 'CombineBaseError',
                  message: 'config "missing" not found',
                },
              ],
            },
          },
        }),
      })
    );
    const conditions = d.findings.find(f => f.id === 'conditions')!;
    expect(conditions.status).toBe('fail');
    expect(conditions.evidence[0]).toBe(
      'PresetsCombined=False (CombineBaseError): config "missing" not found'
    );
  });

  it('checks the model cache of catalog models', () => {
    const cache = (nodeStatus: Record<string, string>): LocalModelCacheJson => ({
      metadata: { name: 'qwen3-14b' },
      spec: { sourceModelUri: 'hf://Qwen/Qwen3-14B-FP8' },
      status: { nodeStatus: nodeStatus as never },
    });
    expect(
      ids(diagnose(input({ catalog: [cache({ a: 'NodeDownloaded', b: 'NodeDownloadError' })] })))
        .cache
    ).toBe('fail');
    expect(ids(diagnose(input({ catalog: [cache({ a: 'NodeDownloading' })] }))).cache).toBe(
      'progress'
    );
    expect(ids(diagnose(input({ catalog: [] }))).cache).toBe('pass');
    expect(ids(diagnose(input({ catalog: null }))).cache).toBeUndefined();
  });

  it('checks the llm-d endpoint picker', () => {
    const raw = {
      metadata: { name: 'qwen' },
      spec: { router: { scheduler: {} } },
      status: { conditions: [], workloads: { scheduler: { readyReplicas: 0 } } },
    };
    const d = diagnose(
      input({
        endpoint: endpoint({ raw }),
        pods: [
          pod(
            'qwen-epp',
            {
              phase: 'Running',
              containerStatuses: [
                container('main', { state: { waiting: { reason: 'CrashLoopBackOff' } } }),
              ],
            },
            { 'app.kubernetes.io/component': 'llminferenceservice-router-scheduler' }
          ),
        ],
      })
    );
    expect(ids(d).router).toBe('fail');
    // The scheduler pod is not a model server.
    expect(d.findings.find(f => f.id === 'pods')?.summary).toBe('There is no model server pod.');
  });

  it('skips pod checks of stopped endpoints', () => {
    const d = diagnose(input({ endpoint: endpoint({ status: { health: 'stopped' } }) }));
    expect(d.verdict.status).toBe('skipped');
    expect(ids(d).pods).toBeUndefined();
  });

  it('reports pods it may not list as unknown', () => {
    expect(ids(diagnose(input({ pods: null }))).pods).toBe('unknown');
  });
});

describe('scanLogs', () => {
  const sample = (text: string, previous = false) => ({
    pod: 'qwen-0',
    container: 'main',
    previous,
    text,
  });

  it('finds known failures with the matching line', () => {
    const findings = scanLogs([
      sample(
        'INFO loading\ntorch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB',
        true
      ),
      sample(
        "ValueError: The model's max seq len (131072) is larger than the maximum number of tokens that can be stored in KV cache (42000)."
      ),
    ]);
    expect(findings.map(f => f.id)).toEqual(['log-cuda-oom', 'log-kv-cache']);
    expect(findings[0].evidence[0]).toMatch(/^qwen-0\/main \(previous\): torch\.OutOfMemoryError/);
  });

  it('recognizes download and argument errors', () => {
    const ids = (text: string) => scanLogs([sample(text)]).map(f => f.id);
    expect(ids('huggingface_hub.errors.GatedRepoError: 401 Client Error')).toContain('log-gated');
    expect(ids('RepositoryNotFoundError: 404 Client Error')).toContain('log-not-found');
    expect(ids('api_server.py: error: unrecognized arguments: --foo')).toEqual(['log-args']);
    expect(ids('OSError: [Errno 28] No space left on device')).toEqual(['log-disk']);
    expect(ids('Temporary failure in name resolution')).toEqual(['log-network']);
    expect(ids('INFO: Application startup complete.')).toEqual([]);
  });

  it('reports clean logs as a pass in the diagnosis', () => {
    const d = diagnose(input({ logs: [sample('INFO all good')] }));
    expect(ids(d).logs).toBe('pass');
  });
});
