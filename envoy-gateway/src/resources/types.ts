/**
 * Shared TypeScript types used across all Envoy Gateway CRD resources.
 *
 * This file must stay free of Headlamp runtime imports so that it can be used
 * from pure utility modules and unit tests.
 */

export const API_GROUP = 'gateway.envoyproxy.io';
export const DEFAULT_API_VERSION = `${API_GROUP}/v1alpha1`;
export const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';

/** A reference to a Kubernetes Gateway API resource (LocalPolicyTargetReferenceWithSectionName). */
export interface TargetRef {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
  sectionName?: string;
}

/** A label selector for matching target resources dynamically. */
export interface TargetSelector {
  group?: string;
  kind: string;
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
}

/** A reference to another object (Secret, ConfigMap, Service, Backend...). */
export interface ObjectRef {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
}

/** A backend reference (Service or Backend) with an optional port. */
export interface BackendRef extends ObjectRef {
  port?: number;
  weight?: number;
}

/** A standard Kubernetes-style condition. */
export interface PolicyCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

/** Ancestor status for policy attachment. */
export interface PolicyAncestorStatus {
  ancestorRef: TargetRef;
  controllerName?: string;
  conditions?: PolicyCondition[];
}

/** Common status block for Envoy Gateway CRDs. */
export interface PolicyStatus {
  ancestors?: PolicyAncestorStatus[];
  conditions?: PolicyCondition[];
}

/** Spec fields shared by all policy-attachment CRDs. */
export interface PolicyTargetSpec {
  targetRef?: TargetRef;
  targetRefs?: TargetRef[];
  targetSelectors?: TargetSelector[];
}

/** An object as edited by the forms and the YAML editor. */
export type { KubeJson } from '../common/form/types';

/** Any Kubernetes object as plain JSON, as read from the cluster (all fields optional). */
export interface ObjectJson {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    uid?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  status?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  [key: string]: unknown;
}
