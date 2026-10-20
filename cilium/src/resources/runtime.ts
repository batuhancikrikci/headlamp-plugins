import { CiliumObject } from './base';
import { isNamespacedKind } from './kinds';
import {
  addressList,
  CiliumNodeInterface,
  CoreEndpoint,
  EndpointInterface,
  EndpointSliceInterface,
  IdentityInterface,
  NodeConfigInterface,
  POD_NAMESPACE_LABEL,
  stripLabelSource,
} from './models/runtime';
import { Labels } from './types';

export * from './models/runtime';

export class CiliumEndpoint extends CiliumObject<EndpointInterface> {
  static kind = 'CiliumEndpoint';
  static apiName = 'ciliumendpoints';
  static isNamespaced = isNamespacedKind('CiliumEndpoint');

  static get detailsRoute() {
    return 'cilium-ciliumendpoints-detail';
  }

  get identityId(): number | undefined {
    return this.status.identity?.id;
  }

  get addresses(): string[] {
    return addressList(this.status.networking);
  }

  get nodeIP(): string | undefined {
    return this.status.networking?.node;
  }

  get state(): string {
    return this.status.state || 'unknown';
  }

  get ingressEnforcing(): boolean {
    return !!this.status.policy?.ingress?.enforcing;
  }

  get egressEnforcing(): boolean {
    return !!this.status.policy?.egress?.enforcing;
  }
}

export class CiliumEndpointSlice extends CiliumObject<EndpointSliceInterface> {
  static kind = 'CiliumEndpointSlice';
  static apiName = 'ciliumendpointslices';
  static apiVersion: string | string[] = 'cilium.io/v2alpha1';
  static isNamespaced = isNamespacedKind('CiliumEndpointSlice');

  static get detailsRoute() {
    return 'cilium-ciliumendpointslices-detail';
  }

  get endpoints(): CoreEndpoint[] {
    return this.jsonData.endpoints || [];
  }

  /** The namespace whose endpoints are batched in this (cluster-scoped) slice. */
  get targetNamespace(): string {
    return this.jsonData.namespace || '';
  }
}

export class CiliumIdentity extends CiliumObject<IdentityInterface> {
  static kind = 'CiliumIdentity';
  static apiName = 'ciliumidentities';
  static isNamespaced = isNamespacedKind('CiliumIdentity');

  static get detailsRoute() {
    return 'cilium-ciliumidentities-detail';
  }

  get securityLabels(): Labels {
    return this.jsonData['security-labels'] || {};
  }

  /** The namespace the identity belongs to, taken from its security labels. */
  get identityNamespace(): string {
    for (const [key, value] of Object.entries(this.securityLabels)) {
      if (stripLabelSource(key) === POD_NAMESPACE_LABEL) return value;
    }
    return this.jsonData.metadata.labels?.[POD_NAMESPACE_LABEL] || '';
  }

  /** Security labels without the namespace-derived and bookkeeping labels. */
  get workloadLabels(): Labels {
    const out: Labels = {};
    for (const [key, value] of Object.entries(this.securityLabels)) {
      const bare = stripLabelSource(key);
      if (bare.startsWith('io.cilium.k8s.namespace.labels.')) continue;
      if (bare.startsWith('io.cilium.k8s.policy.')) continue;
      if (bare === POD_NAMESPACE_LABEL) continue;
      out[bare] = value;
    }
    return out;
  }
}

export class CiliumNode extends CiliumObject<CiliumNodeInterface> {
  static kind = 'CiliumNode';
  static apiName = 'ciliumnodes';
  static isNamespaced = isNamespacedKind('CiliumNode');

  static get detailsRoute() {
    return 'cilium-ciliumnodes-detail';
  }

  address(type: string): string | undefined {
    return (this.spec.addresses || []).find(a => a.type === type)?.ip;
  }

  get internalIP(): string | undefined {
    return this.address('InternalIP');
  }

  get ciliumInternalIP(): string | undefined {
    return this.address('CiliumInternalIP');
  }

  /** Pod CIDRs from cluster-pool / kubernetes IPAM and from multi-pool allocations. */
  get podCIDRs(): string[] {
    const multiPool = (this.spec.ipam?.pools?.allocated || []).flatMap(a => a.cidrs || []);
    return [...(this.spec.ipam?.podCIDRs || []), ...multiPool];
  }

  get usedIPs(): number {
    return Object.keys(this.status.ipam?.used || {}).length;
  }

  get ipamError(): string | undefined {
    return this.status.ipam?.['operator-status']?.error || undefined;
  }
}

export class CiliumNodeConfig extends CiliumObject<NodeConfigInterface> {
  static kind = 'CiliumNodeConfig';
  static apiName = 'ciliumnodeconfigs';
  static isNamespaced = isNamespacedKind('CiliumNodeConfig');

  static get detailsRoute() {
    return 'cilium-ciliumnodeconfigs-detail';
  }

  get defaults(): Record<string, string> {
    return this.spec.defaults || {};
  }
}
