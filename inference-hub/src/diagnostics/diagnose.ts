/**
 * "Why is my endpoint not ready?": a rule based diagnosis of a model endpoint.
 *
 * The checks walk the chain from the endpoint object to the model server and the router: the
 * conditions KServe reports, the model cache, the pods (scheduling, image pulls, crashes, the
 * model download, readiness), known failure patterns in the logs, and the llm-d router. Each
 * check reports its evidence and, when it fails, what usually fixes it.
 *
 * Everything here is pure: the caller collects the objects and logs.
 */
import type { EventJson } from '../components/detail/EventsPanel';
import type { LocalModelCacheJson } from '../resources/catalog';
import type { ModelEndpoint } from '../resources/endpoint';
import type { PodJson } from '../resources/pod';
import type { Condition } from '../resources/types';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'progress' | 'unknown' | 'skipped';

export interface Finding {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  /** Facts the result is based on: conditions, events, pod states, log lines. */
  evidence: string[];
  /** What usually fixes it. */
  hint?: string;
  /** Detail tab with more information. */
  tab?: 'pods' | 'events' | 'logs';
}

export interface LogSample {
  pod: string;
  container: string;
  /** Logs of the previous (crashed) instance of the container. */
  previous?: boolean;
  text: string;
}

export interface DiagnosisInput {
  endpoint: Pick<
    ModelEndpoint,
    'kind' | 'name' | 'namespace' | 'modelUri' | 'status' | 'raw' | 'createdAt'
  >;
  /** Pods of the endpoint; null when they cannot be listed. */
  pods: PodJson[] | null;
  /** Events of the endpoint's namespace; null when they cannot be listed. */
  events: EventJson[] | null;
  /** LocalModelCaches; null when the catalog is not installed or cannot be read. */
  catalog: LocalModelCacheJson[] | null;
  /** Log tails, when the user asked for them. */
  logs?: LogSample[];
  now: number;
}

export interface Diagnosis {
  findings: Finding[];
  /** The most important finding, or the healthy state. */
  verdict: { status: CheckStatus; summary: string };
}

const MINUTE = 60_000;
/** Loading a large model can take a while; after this the wait itself is worth a warning. */
export const SLOW_LOAD_MINUTES = 20;

const RANK: Record<CheckStatus, number> = {
  fail: 5,
  warn: 4,
  progress: 3,
  unknown: 2,
  pass: 1,
  skipped: 0,
};

function minutesSince(timestamp: string | undefined, now: number): number | undefined {
  const t = timestamp ? Date.parse(timestamp) : NaN;
  return isFinite(t) ? Math.max(0, Math.round((now - t) / MINUTE)) : undefined;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function conditionText(c: Condition): string {
  return `${c.type}=${c.status}${c.reason ? ` (${c.reason})` : ''}${
    c.message ? `: ${c.message}` : ''
  }`;
}

/** Conditions of the endpoint object. */
function checkConditions(input: DiagnosisInput): Finding {
  const raw = input.endpoint.raw as { status?: { conditions?: Condition[] } };
  const conditions = raw.status?.conditions || [];
  const base = { id: 'conditions', title: 'Endpoint conditions' };
  if (conditions.length === 0) {
    const age = minutesSince(input.endpoint.createdAt, input.now);
    return {
      ...base,
      status: age !== undefined && age < 2 ? 'progress' : 'unknown',
      summary: 'KServe has not reported any condition yet.',
      evidence: [],
      hint:
        age !== undefined && age >= 2
          ? 'Check that the KServe controller is running and watches this namespace.'
          : undefined,
    };
  }
  const failing = conditions.filter(c => c.type !== 'Ready' && c.status === 'False');
  const unknown = conditions.filter(c => c.type !== 'Ready' && c.status === 'Unknown');
  const ready = conditions.find(c => c.type === 'Ready');
  if (failing.length > 0) {
    return {
      ...base,
      status: 'fail',
      summary: `${plural(failing.length, 'condition')} failing: ${failing
        .map(c => c.type)
        .join(', ')}.`,
      evidence: failing.map(conditionText),
    };
  }
  if (ready?.status === 'True') {
    return { ...base, status: 'pass', summary: 'Every condition is true.', evidence: [] };
  }
  return {
    ...base,
    status: 'progress',
    summary: 'KServe is still reconciling the endpoint.',
    evidence: [...(ready ? [ready] : []), ...unknown].map(conditionText),
  };
}

/** The local model cache of the model, when the catalog has one. */
function checkCache(input: DiagnosisInput): Finding | null {
  if (!input.catalog) return null;
  const base = { id: 'cache', title: 'Model cache' };
  const entry = input.catalog.find(c => c.spec?.sourceModelUri === input.endpoint.modelUri);
  if (!entry) {
    return {
      ...base,
      status: 'pass',
      summary: 'The model is not in the catalog; KServe downloads it when a pod starts.',
      evidence: [],
    };
  }
  const nodes = Object.entries(entry.status?.nodeStatus || {});
  const failed = nodes.filter(([, s]) => s === 'NodeDownloadError');
  const busy = nodes.filter(([, s]) => s === 'NodeDownloading' || s === 'NodeDownloadPending');
  const evidence = nodes.map(([node, s]) => `${node}: ${s || 'no status'}`);
  if (failed.length > 0) {
    return {
      ...base,
      status: 'fail',
      summary: `The download of catalog entry ${entry.metadata.name} failed on ${plural(
        failed.length,
        'node'
      )}.`,
      evidence,
      hint: 'Check the download job logs in the model cache namespace (kserve-localmodel-jobs): a missing HF token, a wrong URI or a full disk are the usual causes.',
    };
  }
  if (busy.length > 0) {
    return {
      ...base,
      status: 'progress',
      summary: `Catalog entry ${entry.metadata.name} is still downloading on ${plural(
        busy.length,
        'node'
      )}.`,
      evidence,
    };
  }
  return {
    ...base,
    status: nodes.length ? 'pass' : 'unknown',
    summary: nodes.length
      ? `Catalog entry ${entry.metadata.name} is cached on ${plural(nodes.length, 'node')}.`
      : `Catalog entry ${entry.metadata.name} reports no node yet.`,
    evidence,
  };
}

type PodRole = 'server' | 'scheduler';

function roleOf(pod: PodJson): PodRole {
  return (pod.metadata.labels?.['app.kubernetes.io/component'] || '').endsWith('router-scheduler')
    ? 'scheduler'
    : 'server';
}

function podEvents(input: DiagnosisInput, pod: PodJson): EventJson[] {
  return (input.events || []).filter(
    e => e.involvedObject?.kind === 'Pod' && e.involvedObject?.name === pod.metadata.name
  );
}

/** Explains a FailedScheduling message. */
export function schedulingHint(message: string): string {
  if (/Insufficient [\w./-]*gpu/i.test(message)) {
    return 'Not enough free GPUs. Check GPU Fleet, lower the GPUs or replicas, or stop another endpoint.';
  }
  if (/Insufficient (cpu|memory)/i.test(message)) {
    return 'Not enough CPU or memory on the GPU nodes. Lower the requests in the Resources step.';
  }
  if (/node affinity|node selector|didn't match Pod's node/i.test(message)) {
    return 'No node matches the node selector or affinity. Check the node selector of the endpoint.';
  }
  if (/untolerated taint|had taint/i.test(message)) {
    return 'The GPU nodes have taints the pod does not tolerate. Add a toleration (Edit YAML) or use a serving profile that has it.';
  }
  if (/persistentvolumeclaim|unbound|volume/i.test(message)) {
    return 'A volume cannot be bound. Check the PVC of the model (pvc://) and its storage class.';
  }
  return 'Check the scheduling message and the GPU Fleet page.';
}

function checkPods(input: DiagnosisInput, stopped: boolean): Finding[] {
  if (stopped) return [];
  const base = { title: 'Model server pods', tab: 'pods' as const };
  if (input.pods === null) {
    return [
      {
        id: 'pods',
        ...base,
        status: 'unknown',
        summary: 'The pods of the endpoint cannot be listed with your permissions.',
        evidence: [],
      },
    ];
  }
  const servers = input.pods.filter(p => roleOf(p) === 'server' && !p.metadata.deletionTimestamp);
  if (servers.length === 0) {
    const age = minutesSince(input.endpoint.createdAt, input.now);
    return [
      {
        id: 'pods',
        ...base,
        status: age !== undefined && age < 3 ? 'progress' : 'fail',
        summary: 'There is no model server pod.',
        evidence: [],
        hint: 'KServe creates the pods once the endpoint is reconciled. A failing condition above, a missing serving runtime or a quota (check the namespace events) usually explains it.',
      },
    ];
  }

  const findings: Finding[] = [];
  const unschedulable = servers.filter(p =>
    p.status?.conditions?.some(c => c.type === 'PodScheduled' && c.status === 'False')
  );
  if (unschedulable.length > 0) {
    const messages = unschedulable.flatMap(p => {
      const condition = p.status?.conditions?.find(c => c.type === 'PodScheduled');
      const event = podEvents(input, p).find(e => e.reason === 'FailedScheduling');
      return [`${p.metadata.name}: ${event?.message || condition?.message || 'Unschedulable'}`];
    });
    findings.push({
      id: 'scheduling',
      title: 'Scheduling',
      tab: 'events',
      status: 'fail',
      summary: `${plural(unschedulable.length, 'pod')} cannot be scheduled.`,
      evidence: messages,
      hint: schedulingHint(messages.join(' ')),
    });
  } else {
    findings.push({
      id: 'scheduling',
      title: 'Scheduling',
      status: 'pass',
      summary: `${plural(servers.length, 'pod')} scheduled.`,
      evidence: servers.map(p => `${p.metadata.name} on ${p.spec?.nodeName || '?'}`),
    });
  }

  const pulls = servers.flatMap(p =>
    [...(p.status?.initContainerStatuses || []), ...(p.status?.containerStatuses || [])]
      .filter(c =>
        /ErrImagePull|ImagePullBackOff|InvalidImageName/.test(c.state?.waiting?.reason || '')
      )
      .map(c =>
        `${p.metadata.name}/${c.name}: ${c.state?.waiting?.reason} ${
          c.state?.waiting?.message || ''
        }`.trim()
      )
  );
  if (pulls.length > 0) {
    findings.push({
      id: 'images',
      title: 'Container images',
      tab: 'events',
      status: 'fail',
      summary: 'An image cannot be pulled.',
      evidence: pulls,
      hint: 'Check the image name and tag, and that the nodes can reach the registry (pull secret, proxy, mirror).',
    });
  }

  const downloads = servers.flatMap(p =>
    (p.status?.initContainerStatuses || [])
      .filter(c => c.name === 'storage-initializer')
      .map(c => ({ pod: p, status: c }))
  );
  const failedDownloads = downloads.filter(
    d =>
      d.status.state?.waiting?.reason === 'CrashLoopBackOff' ||
      (d.status.state?.terminated && d.status.state.terminated.exitCode !== 0) ||
      (d.status.lastState?.terminated && d.status.lastState.terminated.exitCode !== 0)
  );
  if (failedDownloads.length > 0) {
    findings.push({
      id: 'download',
      title: 'Model download',
      tab: 'logs',
      status: 'fail',
      summary: 'The storage initializer could not download the model.',
      evidence: failedDownloads.map(
        d =>
          `${d.pod.metadata.name}: ${
            d.status.state?.waiting?.reason ||
            d.status.state?.terminated?.reason ||
            d.status.lastState?.terminated?.reason ||
            'failed'
          } (restarts: ${d.status.restartCount})`
      ),
      hint: 'Scan the logs below: an HF token for gated models, a wrong URI, missing S3 credentials or a full disk are the usual causes.',
    });
  } else if (downloads.some(d => d.status.state?.running)) {
    findings.push({
      id: 'download',
      title: 'Model download',
      status: 'progress',
      summary: 'The storage initializer is downloading the model.',
      evidence: downloads.map(d => `${d.pod.metadata.name}: downloading`),
    });
  }

  const crashed = servers.flatMap(p =>
    (p.status?.containerStatuses || [])
      .filter(
        c =>
          c.state?.waiting?.reason === 'CrashLoopBackOff' ||
          (c.state?.terminated && c.state.terminated.exitCode !== 0) ||
          c.lastState?.terminated?.reason === 'OOMKilled'
      )
      .map(c => ({ pod: p, status: c }))
  );
  if (crashed.length > 0) {
    const oom = crashed.some(
      c =>
        c.status.lastState?.terminated?.reason === 'OOMKilled' ||
        c.status.state?.terminated?.reason === 'OOMKilled'
    );
    findings.push({
      id: 'crashes',
      title: 'Model server',
      tab: 'logs',
      status: 'fail',
      summary: oom
        ? 'The model server was killed for using more memory than its limit (OOMKilled).'
        : 'The model server keeps crashing.',
      evidence: crashed.map(c => {
        const last = c.status.lastState?.terminated || c.status.state?.terminated;
        return `${c.pod.metadata.name}/${c.status.name}: ${
          c.status.state?.waiting?.reason || last?.reason || 'Error'
        }${last?.exitCode !== undefined ? `, exit code ${last.exitCode}` : ''}, ${plural(
          c.status.restartCount,
          'restart'
        )}`;
      }),
      hint: oom
        ? 'Raise the memory limit in the Resources step: loading the weights needs CPU memory too.'
        : 'Scan the logs below for the cause.',
    });
  } else {
    const restarts = servers.reduce(
      (sum, p) => sum + (p.status?.containerStatuses || []).reduce((s, c) => s + c.restartCount, 0),
      0
    );
    if (restarts > 0) {
      findings.push({
        id: 'crashes',
        title: 'Model server',
        tab: 'logs',
        status: 'warn',
        summary: `The model server restarted ${plural(restarts, 'time')}.`,
        evidence: [],
        hint: 'Scan the logs (including the previous instance) for the cause.',
      });
    }
  }

  const running = servers.filter(p => p.status?.phase === 'Running');
  const notReady = running.filter(p => (p.status?.containerStatuses || []).some(c => !c.ready));
  if (running.length > 0 && notReady.length === 0) {
    findings.push({
      id: 'readiness',
      title: 'Readiness',
      status: 'pass',
      summary: `${plural(running.length, 'pod')} ready.`,
      evidence: [],
    });
  } else if (notReady.length > 0 && crashed.length === 0) {
    const longest = Math.max(
      ...notReady.map(
        p =>
          minutesSince(
            (p.status?.containerStatuses || []).find(c => !c.ready)?.state?.running?.startedAt,
            input.now
          ) ?? 0
      )
    );
    findings.push({
      id: 'readiness',
      title: 'Readiness',
      tab: 'logs',
      status: longest >= SLOW_LOAD_MINUTES ? 'warn' : 'progress',
      summary:
        longest >= SLOW_LOAD_MINUTES
          ? `The model server has not become ready in ${longest} minutes.`
          : `The model server is loading the model (${longest} min so far).`,
      evidence: notReady.map(p => `${p.metadata.name}: running, not ready`),
      hint:
        longest >= SLOW_LOAD_MINUTES
          ? 'Large models can take long to load, but check the logs: a stuck download or a failing compile step also looks like this.'
          : undefined,
    });
  }
  return findings;
}

function checkRouter(input: DiagnosisInput, stopped: boolean): Finding | null {
  if (stopped || input.endpoint.kind !== 'LLMInferenceService') return null;
  const raw = input.endpoint.raw as {
    spec?: { router?: { scheduler?: unknown } };
    status?: { workloads?: { scheduler?: { readyReplicas?: number } } };
  };
  if (!raw.spec?.router?.scheduler) return null;
  const base = { id: 'router', title: 'llm-d scheduler', tab: 'pods' as const };
  const schedulers = (input.pods || []).filter(p => roleOf(p) === 'scheduler');
  const ready =
    raw.status?.workloads?.scheduler?.readyReplicas ??
    schedulers.filter(p => (p.status?.containerStatuses || []).every(c => c.ready)).length;
  if (ready > 0) {
    return { ...base, status: 'pass', summary: 'The endpoint picker is running.', evidence: [] };
  }
  const failing = schedulers.filter(p =>
    (p.status?.containerStatuses || []).some(
      c =>
        c.state?.waiting?.reason === 'CrashLoopBackOff' ||
        /Err|BackOff/.test(c.state?.waiting?.reason || '')
    )
  );
  return {
    ...base,
    status: failing.length ? 'fail' : schedulers.length ? 'progress' : 'unknown',
    summary: failing.length
      ? 'The endpoint picker (EPP) is failing.'
      : schedulers.length
      ? 'The endpoint picker is starting.'
      : 'No endpoint picker pod was found.',
    evidence: schedulers.map(p => {
      const c = (p.status?.containerStatuses || [])[0];
      return `${p.metadata.name}: ${
        c?.state?.waiting?.reason || (c?.ready ? 'ready' : 'not ready')
      }`;
    }),
    hint: failing.length
      ? 'Check the scheduler logs; the Gateway API Inference Extension CRDs and the gateway class must match the llm-d version.'
      : undefined,
  };
}

interface LogRule {
  id: string;
  pattern: RegExp;
  summary: string;
  hint: string;
}

/** Known failure patterns of vLLM, the storage initializer and the model download. */
export const LOG_RULES: LogRule[] = [
  {
    id: 'cuda-oom',
    pattern: /CUDA out of memory|torch\.(cuda\.)?OutOfMemoryError|CUBLAS_STATUS_ALLOC_FAILED/i,
    summary: 'The GPU ran out of memory.',
    hint: 'Use more GPUs per replica (tensor parallelism), a quantized model, or lower --max-model-len / --gpu-memory-utilization.',
  },
  {
    id: 'kv-cache',
    pattern:
      /No available memory for the cache blocks|larger than the maximum number of tokens that can be stored in KV cache|insufficient .*KV cache/i,
    summary: 'There is not enough GPU memory left for the KV cache.',
    hint: 'Lower --max-model-len, raise --gpu-memory-utilization, or add GPUs (Capacity Planner shows what fits).',
  },
  {
    id: 'gated',
    pattern:
      /GatedRepoError|gated repo|Access to model .* is restricted|401 Client Error|Invalid user token/i,
    summary: 'The model repository needs a Hugging Face token.',
    hint: 'Create a secret with HF_TOKEN, attach it to a service account and select that service account in the Serving step.',
  },
  {
    id: 'not-found',
    pattern:
      /RepositoryNotFoundError|Repository Not Found|404 Client Error|NoSuchKey|NoSuchBucket/i,
    summary: 'The model was not found at its URI.',
    hint: 'Check the model URI (organization, name, revision) and the credentials of the storage.',
  },
  {
    id: 'disk',
    pattern: /No space left on device/i,
    summary: 'A disk is full.',
    hint: 'Give the model more disk (ephemeral storage or the model cache node group) or use the local model cache.',
  },
  {
    id: 'args',
    pattern: /unrecognized arguments|error: argument [-\w]+|invalid choice:/i,
    summary: 'vLLM rejected an argument.',
    hint: 'Fix the extra vLLM arguments of the endpoint; flag names change between vLLM versions.',
  },
  {
    id: 'architecture',
    pattern:
      /Model architectures? \[.*\] (are|is) not supported|not supported for now|Unknown quantization method/i,
    summary: 'This vLLM version does not support the model.',
    hint: 'Use a newer vLLM image or a model / quantization this version supports.',
  },
  {
    id: 'nccl',
    pattern: /NCCL (error|WARN.*failed)|ncclSystemError|ncclInternalError/i,
    summary: 'The GPUs failed to communicate (NCCL).',
    hint: 'Multi-GPU serving needs working GPU interconnect and enough shared memory (/dev/shm).',
  },
  {
    id: 'network',
    pattern:
      /Temporary failure in name resolution|Name or service not known|Connection refused|ConnectTimeout|Max retries exceeded/i,
    summary: 'The pod could not reach a network service.',
    hint: 'Air-gapped clusters need a model mirror or the local model cache; also check HTTP proxy settings and HF_HUB_OFFLINE.',
  },
];

/** The first line of each log rule that matches, per container. */
export function scanLogs(samples: LogSample[]): Finding[] {
  const hits = new Map<string, { rule: LogRule; lines: string[] }>();
  for (const sample of samples) {
    const lines = sample.text.split('\n');
    for (const rule of LOG_RULES) {
      const line = [...lines].reverse().find(l => rule.pattern.test(l));
      if (!line) continue;
      const hit = hits.get(rule.id) || { rule, lines: [] };
      hit.lines.push(
        `${sample.pod}/${sample.container}${sample.previous ? ' (previous)' : ''}: ${line
          .trim()
          .slice(0, 300)}`
      );
      hits.set(rule.id, hit);
    }
  }
  return [...hits.values()].map(({ rule, lines }) => ({
    id: `log-${rule.id}`,
    title: 'Logs',
    tab: 'logs',
    status: 'fail',
    summary: rule.summary,
    evidence: lines,
    hint: rule.hint,
  }));
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  const stopped = input.endpoint.status.health === 'stopped';
  const findings: Finding[] = [];
  if (stopped) {
    findings.push({
      id: 'stopped',
      title: 'Endpoint',
      status: 'skipped',
      summary:
        'The endpoint is stopped: KServe keeps no model server pods. Resume it to serve again.',
      evidence: [],
    });
  }
  findings.push(checkConditions(input));
  const cache = checkCache(input);
  if (cache) findings.push(cache);
  findings.push(...checkPods(input, stopped));
  const router = checkRouter(input, stopped);
  if (router) findings.push(router);
  if (input.logs) {
    const logFindings = scanLogs(input.logs);
    findings.push(
      ...(logFindings.length
        ? logFindings
        : [
            {
              id: 'logs',
              title: 'Logs',
              status: 'pass' as const,
              summary: `No known failure pattern in ${plural(input.logs.length, 'log')}.`,
              evidence: [],
            },
          ])
    );
  }

  const worst = findings.reduce<Finding | undefined>(
    (w, f) => (!w || RANK[f.status] > RANK[w.status] ? f : w),
    undefined
  );
  let verdict: Diagnosis['verdict'];
  if (stopped) verdict = { status: 'skipped', summary: 'The endpoint is stopped.' };
  else if (!worst || worst.status === 'pass') {
    verdict = { status: 'pass', summary: 'No problem found: the endpoint is ready.' };
  } else {
    verdict = { status: worst.status, summary: worst.summary };
  }
  return { findings, verdict };
}
