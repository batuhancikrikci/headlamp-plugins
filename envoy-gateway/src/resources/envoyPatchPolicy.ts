import { resolveTargetRefs } from '../utils/targets';
import { EnvoyGatewayObject, EnvoyGatewayObjectInterface } from './base';
import { TargetRef } from './types';

export interface JSONPatch {
  type: string;
  name: string;
  operation: {
    op: string;
    path?: string;
    jsonPath?: string;
    value?: unknown;
    from?: string;
  };
}

export interface EnvoyPatchPolicyInterface extends EnvoyGatewayObjectInterface {
  spec?: {
    targetRef?: TargetRef;
    targetRefs?: TargetRef[];
    type?: string;
    jsonPatches?: JSONPatch[];
    priority?: number;
  };
}

export class EnvoyPatchPolicy extends EnvoyGatewayObject<EnvoyPatchPolicyInterface> {
  static kind = 'EnvoyPatchPolicy';
  static apiName = 'envoypatchpolicies';

  static get detailsRoute() {
    return 'eg-envoypatchpolicy-detail';
  }

  get targetRefs(): TargetRef[] {
    return resolveTargetRefs(this.jsonData.spec);
  }

  get patchType(): string {
    return this.spec.type || 'JSONPatch';
  }

  get patchCount(): number {
    return this.spec.jsonPatches?.length || 0;
  }
}
