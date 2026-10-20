import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  BackendObjectReference,
  Condition,
  CRDStatus,
  HTTPBodyMutation,
  HTTPHeaderMutation,
  VersionedAPISchema,
} from './common';

export interface AIServiceBackendInterface extends KubeObjectInterface {
  spec?: {
    schema: VersionedAPISchema;
    backendRef: BackendObjectReference;
    headerMutation?: HTTPHeaderMutation;
    bodyMutation?: HTTPBodyMutation;
  };
  status?: CRDStatus;
}

export class AIServiceBackend extends KubeObject<AIServiceBackendInterface> {
  static kind = 'AIServiceBackend';
  static apiName = 'aiservicebackends';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'Service Backends Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get schemaName(): string {
    return this.spec?.schema?.name || '-';
  }

  get schemaVersion(): string | undefined {
    return this.spec?.schema?.version;
  }

  get schemaPrefix(): string | undefined {
    return this.spec?.schema?.prefix;
  }

  get backendRefName(): string {
    return this.spec?.backendRef?.name || '-';
  }

  get backendRefGroup(): string {
    return this.spec?.backendRef?.group || '-';
  }

  get hasHeaderMutation(): boolean {
    const m = this.spec?.headerMutation;
    return !!m && ((m.set?.length || 0) > 0 || (m.remove?.length || 0) > 0);
  }

  get hasBodyMutation(): boolean {
    const m = this.spec?.bodyMutation;
    return !!m && ((m.set?.length || 0) > 0 || (m.remove?.length || 0) > 0);
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }
}
