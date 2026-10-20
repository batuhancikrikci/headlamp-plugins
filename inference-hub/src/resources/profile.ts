/**
 * Serving profiles: LLMInferenceServiceConfig objects that LLMInferenceServices build on
 * (spec.baseRefs) or that KServe applies as presets.
 */
import { ANNOTATION_PREFIX, readAnnotation } from './annotations';
import { ContainerSpec, LLMInferenceServiceSpec, ModelEndpoint } from './endpoint';
import { KubeJson } from './types';

/** Human description of a serving profile (set by the Inference Hub profile form). */
export const DESCRIPTION_ANNOTATION = `${ANNOTATION_PREFIX}description`;

export type ProfileJson = KubeJson<LLMInferenceServiceSpec & { tracing?: unknown }>;

export interface ProfileAspect {
  id: string;
  label: string;
  icon: string;
}

export interface ProfileSummary {
  name: string;
  namespace: string;
  /** Shipped with KServe (kserve-config-*). */
  builtIn: boolean;
  /** From the inference-hub.batuhancikrikci.github.io/description annotation. */
  description?: string;
  image?: string;
  extraArgs?: string;
  aspects: ProfileAspect[];
}

function main(containers?: ContainerSpec[]) {
  return containers?.find(c => c.name === 'main') || containers?.[0];
}

export function summarizeProfile(obj: ProfileJson): ProfileSummary {
  const spec = obj.spec || {};
  const container = main(spec.template?.containers);
  const schedulerContainers = (
    spec.router?.scheduler as { template?: { containers?: ContainerSpec[] } } | undefined
  )?.template?.containers;
  const aspects: ProfileAspect[] = [];
  const add = (cond: unknown, id: string, label: string, icon: string) => {
    if (cond) aspects.push({ id, label, icon });
  };
  add(spec.model, 'model', 'Model', 'mdi:brain');
  add(spec.template, 'server', 'Model server', 'mdi:server');
  add(spec.prefill, 'prefill', 'Prefill pool', 'mdi:call-split');
  add(spec.worker || spec.prefill?.worker, 'worker', 'Multi-node workers', 'mdi:server-network');
  add(spec.parallelism, 'parallelism', 'Parallelism', 'mdi:grid');
  add(spec.router?.scheduler, 'scheduler', 'Scheduler', 'mdi:source-branch');
  add(spec.router?.route, 'route', 'HTTP route', 'mdi:routes');
  add(spec.router?.gateway, 'gateway', 'Gateway', 'mdi:gate');
  add(spec.scaling, 'scaling', 'Autoscaling', 'mdi:arrow-expand-vertical');
  add(spec.kvCacheOffloading, 'kv', 'KV cache offloading', 'mdi:memory');
  add(spec.tracing, 'tracing', 'Tracing', 'mdi:chart-timeline-variant');
  return {
    name: obj.metadata.name,
    namespace: obj.metadata.namespace || '',
    builtIn: obj.metadata.name.startsWith('kserve-config-'),
    description: readAnnotation(obj.metadata.annotations, 'description'),
    image: container?.image || main(schedulerContainers)?.image,
    extraArgs: container?.env?.find(e => e.name === 'VLLM_ADDITIONAL_ARGS')?.value,
    aspects,
  };
}

/**
 * Endpoints that use a profile: referenced in spec.baseRefs (resolved in the endpoint's
 * namespace first, then the KServe system namespace) or applied as a preset.
 */
export function endpointsUsingProfile(
  profile: Pick<ProfileSummary, 'name' | 'namespace' | 'builtIn'>,
  endpoints: ModelEndpoint[]
): ModelEndpoint[] {
  return endpoints.filter(ep => {
    if (ep.kind !== 'LLMInferenceService') return false;
    const applied = (
      ep.raw.status as { appliedConfigs?: Array<{ name: string; namespace?: string }> } | undefined
    )?.appliedConfigs;
    if (applied?.length) {
      return applied.some(
        a => a.name === profile.name && (a.namespace || ep.namespace) === profile.namespace
      );
    }
    // Without status, assume a reference resolves locally, or to the system namespace for presets.
    return (
      ep.profiles.includes(profile.name) && (ep.namespace === profile.namespace || profile.builtIn)
    );
  });
}
