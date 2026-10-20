/** Minimal JSON shapes shared across Inference Hub. */

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  generation?: number;
  resourceVersion?: string;
  ownerReferences?: Array<{
    apiVersion: string;
    kind: string;
    name: string;
    uid: string;
    controller?: boolean;
  }>;
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  severity?: string;
  lastTransitionTime?: string;
}

export interface KubeJson<Spec = object, Status = object> {
  apiVersion?: string;
  kind?: string;
  metadata: ObjectMeta;
  spec?: Spec;
  status?: Status;
}

export interface KubeList<T> {
  items?: T[];
  metadata?: { resourceVersion?: string; continue?: string };
}
