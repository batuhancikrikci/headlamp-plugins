import { CiliumObject } from './base';
import { isNamespacedKind } from './kinds';
import {
  EgressGateway,
  EgressGatewayPolicyInterface,
  egressGateways,
  EnvoyConfigInterface,
  EnvoyResource,
  envoyResourceKinds,
  L2AnnouncementPolicyInterface,
  LBIPBlock,
  LBIPPoolInterface,
  LocalRedirectPolicyInterface,
  PodIPPoolInterface,
  poolHealth,
  PoolUsage,
  poolUsage,
} from './models/network';
import { Health } from './types';

export * from './models/network';

export class CiliumLoadBalancerIPPool extends CiliumObject<LBIPPoolInterface> {
  static kind = 'CiliumLoadBalancerIPPool';
  static apiName = 'ciliumloadbalancerippools';
  static isNamespaced = isNamespacedKind('CiliumLoadBalancerIPPool');

  static get detailsRoute() {
    return 'cilium-ciliumloadbalancerippools-detail';
  }

  get blocks(): LBIPBlock[] {
    return this.spec.blocks || [];
  }

  get usage(): PoolUsage {
    return poolUsage(this.conditions);
  }

  get health(): Health {
    return poolHealth(this.usage, this.spec.disabled);
  }
}

export class CiliumL2AnnouncementPolicy extends CiliumObject<L2AnnouncementPolicyInterface> {
  static kind = 'CiliumL2AnnouncementPolicy';
  static apiName = 'ciliuml2announcementpolicies';
  static apiVersion: string | string[] = 'cilium.io/v2alpha1';
  static isNamespaced = isNamespacedKind('CiliumL2AnnouncementPolicy');

  static get detailsRoute() {
    return 'cilium-ciliuml2announcementpolicies-detail';
  }

  get announces(): string[] {
    return [
      ...(this.spec.loadBalancerIPs ? ['LoadBalancer IPs'] : []),
      ...(this.spec.externalIPs ? ['External IPs'] : []),
    ];
  }
}

export class CiliumPodIPPool extends CiliumObject<PodIPPoolInterface> {
  static kind = 'CiliumPodIPPool';
  static apiName = 'ciliumpodippools';
  static apiVersion: string | string[] = 'cilium.io/v2alpha1';
  static isNamespaced = isNamespacedKind('CiliumPodIPPool');

  static get detailsRoute() {
    return 'cilium-ciliumpodippools-detail';
  }
}

export class CiliumEgressGatewayPolicy extends CiliumObject<EgressGatewayPolicyInterface> {
  static kind = 'CiliumEgressGatewayPolicy';
  static apiName = 'ciliumegressgatewaypolicies';
  static isNamespaced = isNamespacedKind('CiliumEgressGatewayPolicy');

  static get detailsRoute() {
    return 'cilium-ciliumegressgatewaypolicies-detail';
  }

  get gateways(): EgressGateway[] {
    return egressGateways(this.jsonData.spec);
  }
}

export class CiliumLocalRedirectPolicy extends CiliumObject<LocalRedirectPolicyInterface> {
  static kind = 'CiliumLocalRedirectPolicy';
  static apiName = 'ciliumlocalredirectpolicies';
  static isNamespaced = isNamespacedKind('CiliumLocalRedirectPolicy');

  static get detailsRoute() {
    return 'cilium-ciliumlocalredirectpolicies-detail';
  }

  get frontendType(): 'Address' | 'Service' | '-' {
    const frontend = this.spec.redirectFrontend;
    if (frontend?.addressMatcher) return 'Address';
    if (frontend?.serviceMatcher) return 'Service';
    return '-';
  }

  get frontendLabel(): string {
    const frontend = this.spec.redirectFrontend;
    if (frontend?.addressMatcher) return frontend.addressMatcher.ip || '-';
    if (frontend?.serviceMatcher) {
      const { serviceName, namespace } = frontend.serviceMatcher;
      return `${namespace || this.jsonData.metadata.namespace || ''}/${serviceName || ''}`;
    }
    return '-';
  }
}

class EnvoyConfigBase extends CiliumObject<EnvoyConfigInterface> {
  get resources(): EnvoyResource[] {
    return this.spec.resources || [];
  }

  get resourceKinds(): Record<string, number> {
    return envoyResourceKinds(this.resources);
  }
}

export class CiliumEnvoyConfig extends EnvoyConfigBase {
  static kind = 'CiliumEnvoyConfig';
  static apiName = 'ciliumenvoyconfigs';
  static isNamespaced = isNamespacedKind('CiliumEnvoyConfig');

  static get detailsRoute() {
    return 'cilium-ciliumenvoyconfigs-detail';
  }
}

export class CiliumClusterwideEnvoyConfig extends EnvoyConfigBase {
  static kind = 'CiliumClusterwideEnvoyConfig';
  static apiName = 'ciliumclusterwideenvoyconfigs';
  static isNamespaced = isNamespacedKind('CiliumClusterwideEnvoyConfig');

  static get detailsRoute() {
    return 'cilium-ciliumclusterwideenvoyconfigs-detail';
  }
}
