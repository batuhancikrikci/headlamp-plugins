import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Condition, CRDStatus, LLMRequestCost } from './common';

export interface GatewayConfigInterface extends KubeObjectInterface {
  spec?: {
    extProc?: {
      kubernetes?: Record<string, unknown>;
    };
    globalLLMRequestCosts?: LLMRequestCost[];
    forwardProxy?: {
      address: string;
    };
  };
  status?: CRDStatus;
}

export class GatewayConfig extends KubeObject<GatewayConfigInterface> {
  static kind = 'GatewayConfig';
  static apiName = 'gatewayconfigs';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'Gateway Config Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get hasExtProc(): boolean {
    return !!this.spec?.extProc;
  }

  get hasForwardProxy(): boolean {
    return !!this.spec?.forwardProxy;
  }

  get forwardProxyAddress(): string {
    return this.spec?.forwardProxy?.address || '-';
  }

  get costCount(): number {
    return this.spec?.globalLLMRequestCosts?.length || 0;
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }
}
