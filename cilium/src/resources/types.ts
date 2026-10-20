/**
 * Shared types for the Cilium (cilium.io) API group.
 *
 * This module and everything under resources/models is free of runtime imports from Headlamp,
 * so the logic built on it can be unit tested without the Headlamp runtime.
 */
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export const API_GROUP = 'cilium.io';

export type Labels = Record<string, string>;

export type SelectorOperator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';

export interface LabelSelectorRequirement {
  key: string;
  operator: SelectorOperator;
  values?: string[];
}

/** Kubernetes label selector; Cilium's EndpointSelector uses the same shape. */
export interface LabelSelector {
  matchLabels?: Labels;
  matchExpressions?: LabelSelectorRequirement[];
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export type Health = 'success' | 'warning' | 'error' | 'unknown';

export type { KubeJson, KubeMetadataJson } from '../common/form/types';

export type Protocol = 'TCP' | 'UDP' | 'SCTP' | 'ANY';

/** Minimal shapes of the core objects the plugin correlates with Cilium resources. */
export interface PodLike {
  metadata: { name: string; namespace?: string; labels?: Labels; uid?: string };
  spec?: { nodeName?: string; hostNetwork?: boolean; serviceAccountName?: string };
  status?: { podIP?: string; phase?: string };
}

export interface NodeLike {
  metadata: { name: string; labels?: Labels };
}

export interface ServiceLike {
  metadata: { name: string; namespace?: string; labels?: Labels; annotations?: Labels };
  spec?: {
    type?: string;
    loadBalancerClass?: string;
    externalIPs?: string[];
    ports?: Array<{ name?: string; port: number; protocol?: string }>;
  };
  status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
}

export interface NamespaceLike {
  metadata: { name: string; labels?: Labels };
}

/** JSON shape shared by every Cilium object. */
export interface CiliumObjectInterface extends KubeObjectInterface {
  spec?: object;
  status?: object;
}
