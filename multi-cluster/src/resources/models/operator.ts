/**
 * ClusterManager and Klusterlet (operator.open-cluster-management.io).
 */
import { Condition, conditionPolarity, findCondition, Health, KubeJson } from './common';

export interface FeatureGate {
  feature: string;
  mode?: 'Enable' | 'Disable' | string;
}

export interface ClusterManagerJson extends KubeJson {
  spec?: {
    registrationImagePullSpec?: string;
    workImagePullSpec?: string;
    placementImagePullSpec?: string;
    addOnManagerImagePullSpec?: string;
    deployOption?: { mode?: string };
    registrationConfiguration?: {
      featureGates?: FeatureGate[];
      autoApproveUsers?: string[];
      registrationDrivers?: Array<{ authType?: string }>;
    };
    workConfiguration?: { featureGates?: FeatureGate[]; workDriver?: string };
    addOnManagerConfiguration?: { featureGates?: FeatureGate[] };
    placementConfiguration?: { featureGates?: FeatureGate[] };
    nodePlacement?: { nodeSelector?: Record<string, string> };
  };
  status?: {
    conditions?: Condition[];
    relatedResources?: Array<{
      group: string;
      resource: string;
      name: string;
      namespace?: string;
      version: string;
    }>;
    observedGeneration?: number;
  };
}

export interface KlusterletJson extends KubeJson {
  spec?: {
    clusterName?: string;
    namespace?: string;
    deployOption?: { mode?: string };
    registrationImagePullSpec?: string;
    workImagePullSpec?: string;
    imagePullSpec?: string;
    externalServerURLs?: Array<{ url: string }>;
  };
  status?: { conditions?: Condition[] };
}

/**
 * Overall health from operator conditions: any problem condition (…Degraded=True) is an error,
 * Applied/Available=False is an error, Progressing=True is a warning.
 */
export function operatorHealth(conditions: Condition[] | undefined): Health {
  const list = conditions || [];
  if (list.length === 0) return 'unknown';
  for (const condition of list) {
    if (conditionPolarity(condition.type) === 'problem' && condition.status === 'True') {
      return 'error';
    }
  }
  const applied = findCondition(list, 'Applied');
  const available = findCondition(list, 'Available');
  if (applied?.status === 'False' || available?.status === 'False') return 'error';
  if (findCondition(list, 'Progressing')?.status === 'True') return 'warning';
  if (applied?.status === 'True' || available?.status === 'True') return 'success';
  return 'unknown';
}

/** Problem conditions that are currently true. */
export function activeProblems(conditions: Condition[] | undefined): Condition[] {
  return (conditions || []).filter(
    c =>
      (conditionPolarity(c.type) === 'problem' && c.status === 'True') ||
      ((c.type === 'Applied' || c.type === 'Available') && c.status === 'False')
  );
}

/** Tag of an image reference ("quay.io/x/registration:v1.3.1" → "v1.3.1"). */
export function imageTag(image: string | undefined): string | undefined {
  if (!image) return undefined;
  const withoutDigest = image.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon <= lastSlash) return undefined;
  return withoutDigest.slice(lastColon + 1) || undefined;
}

/**
 * OCM version hint from the hub component images. The cluster manager does not report its
 * version; the image tags set by the operator are the best available indication.
 */
export function hubVersionHint(cm: ClusterManagerJson | undefined): string | undefined {
  const spec = cm?.spec;
  if (!spec) return undefined;
  return (
    imageTag(spec.registrationImagePullSpec) ||
    imageTag(spec.workImagePullSpec) ||
    imageTag(spec.placementImagePullSpec)
  );
}

/** All feature gates of a cluster manager, grouped by component. */
export function featureGates(
  cm: ClusterManagerJson
): Array<{ component: string; gates: FeatureGate[] }> {
  const spec = cm.spec || {};
  return [
    { component: 'Registration', gates: spec.registrationConfiguration?.featureGates || [] },
    { component: 'Work', gates: spec.workConfiguration?.featureGates || [] },
    { component: 'Add-on manager', gates: spec.addOnManagerConfiguration?.featureGates || [] },
    { component: 'Placement', gates: spec.placementConfiguration?.featureGates || [] },
  ].filter(g => g.gates.length > 0);
}
