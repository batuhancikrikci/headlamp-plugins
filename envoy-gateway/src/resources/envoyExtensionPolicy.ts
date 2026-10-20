import { PolicyObject, PolicyObjectInterface } from './base';
import { BackendRef, ObjectRef, PolicyTargetSpec } from './types';

export interface WasmExtension {
  name?: string;
  rootID?: string;
  code: {
    type: 'HTTP' | 'Image' | string;
    http?: {
      url: string;
      sha256?: string;
    };
    image?: {
      url: string;
      sha256?: string;
      pullSecretRef?: ObjectRef;
    };
    pullPolicy?: string;
  };
  config?: unknown;
  failOpen?: boolean;
}

export interface ExtProcExtension {
  backendRef?: BackendRef;
  backendRefs?: BackendRef[];
  messageTimeout?: string;
  failOpen?: boolean;
  processingMode?: {
    request?: { body?: string };
    response?: { body?: string };
  };
}

export interface EnvoyExtensionPolicyInterface extends PolicyObjectInterface {
  spec?: PolicyTargetSpec & {
    wasm?: WasmExtension[];
    extProc?: ExtProcExtension[];
    lua?: Array<{ type?: string; inline?: string; valueRef?: ObjectRef }>;
  };
}

export class EnvoyExtensionPolicy extends PolicyObject<EnvoyExtensionPolicyInterface> {
  static kind = 'EnvoyExtensionPolicy';
  static apiName = 'envoyextensionpolicies';

  static get detailsRoute() {
    return 'eg-envoyextensionpolicy-detail';
  }

  get wasmCount(): number {
    return this.spec.wasm?.length || 0;
  }

  get extProcCount(): number {
    return this.spec.extProc?.length || 0;
  }

  get luaCount(): number {
    return this.spec.lua?.length || 0;
  }
}

/** ExtProc supports both the deprecated `backendRef` and `backendRefs`. */
export function extProcBackendRefs(p: ExtProcExtension): BackendRef[] {
  return [...(p.backendRef ? [p.backendRef] : []), ...(p.backendRefs || [])];
}
