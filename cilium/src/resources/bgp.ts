import { CiliumObject } from './base';
import { isNamespacedKind } from './kinds';
import {
  BGPAdvertisementEntry,
  BGPAdvertisementInterface,
  BGPClusterConfigInterface,
  BGPClusterInstance,
  BGPFamily,
  BGPNodeConfigInterface,
  BGPNodeConfigOverrideInterface,
  BGPNodeInstance,
  BGPNodeOverrideInstance,
  BGPNodePeerStatus,
  BGPPeerConfigInterface,
  BGPPeeringPolicyInterface,
  BGPVirtualRouter,
  isEstablished,
  SessionCounts,
} from './models/bgp';
import { Health } from './types';

export * from './models/bgp';

export class CiliumBGPClusterConfig extends CiliumObject<BGPClusterConfigInterface> {
  static kind = 'CiliumBGPClusterConfig';
  static apiName = 'ciliumbgpclusterconfigs';
  static isNamespaced = isNamespacedKind('CiliumBGPClusterConfig');

  static get detailsRoute() {
    return 'cilium-ciliumbgpclusterconfigs-detail';
  }

  get instances(): BGPClusterInstance[] {
    return this.spec.bgpInstances || [];
  }

  get peerCount(): number {
    return this.instances.reduce((n, i) => n + (i.peers?.length || 0), 0);
  }

  get peerConfigNames(): string[] {
    const names = new Set<string>();
    for (const instance of this.instances) {
      for (const peer of instance.peers || []) {
        if (peer.peerConfigRef?.name) names.add(peer.peerConfigRef.name);
      }
    }
    return Array.from(names);
  }
}

export class CiliumBGPPeerConfig extends CiliumObject<BGPPeerConfigInterface> {
  static kind = 'CiliumBGPPeerConfig';
  static apiName = 'ciliumbgppeerconfigs';
  static isNamespaced = isNamespacedKind('CiliumBGPPeerConfig');

  static get detailsRoute() {
    return 'cilium-ciliumbgppeerconfigs-detail';
  }

  get families(): BGPFamily[] {
    return this.spec.families || [];
  }
}

export class CiliumBGPAdvertisement extends CiliumObject<BGPAdvertisementInterface> {
  static kind = 'CiliumBGPAdvertisement';
  static apiName = 'ciliumbgpadvertisements';
  static isNamespaced = isNamespacedKind('CiliumBGPAdvertisement');

  static get detailsRoute() {
    return 'cilium-ciliumbgpadvertisements-detail';
  }

  get entries(): BGPAdvertisementEntry[] {
    return this.spec.advertisements || [];
  }

  get types(): string[] {
    return Array.from(new Set(this.entries.map(e => e.advertisementType)));
  }
}

export class CiliumBGPNodeConfig extends CiliumObject<BGPNodeConfigInterface> {
  static kind = 'CiliumBGPNodeConfig';
  static apiName = 'ciliumbgpnodeconfigs';
  static isNamespaced = isNamespacedKind('CiliumBGPNodeConfig');

  static get detailsRoute() {
    return 'cilium-ciliumbgpnodeconfigs-detail';
  }

  get instances(): BGPNodeInstance[] {
    return this.spec.bgpInstances || [];
  }

  get peerStatuses(): BGPNodePeerStatus[] {
    return (this.status.bgpInstances || []).flatMap(i => i.peers || []);
  }

  /** Configured peers versus peers whose session is established. */
  get sessions(): SessionCounts {
    const total = this.instances.reduce((n, i) => n + (i.peers?.length || 0), 0);
    const established = this.peerStatuses.filter(p => isEstablished(p.peeringState)).length;
    return { total, established };
  }

  get sessionHealth(): Health {
    const { total, established } = this.sessions;
    if (total === 0) return 'unknown';
    if (established === total) return 'success';
    return established === 0 ? 'error' : 'warning';
  }
}

export class CiliumBGPNodeConfigOverride extends CiliumObject<BGPNodeConfigOverrideInterface> {
  static kind = 'CiliumBGPNodeConfigOverride';
  static apiName = 'ciliumbgpnodeconfigoverrides';
  static isNamespaced = isNamespacedKind('CiliumBGPNodeConfigOverride');

  static get detailsRoute() {
    return 'cilium-ciliumbgpnodeconfigoverrides-detail';
  }

  get instances(): BGPNodeOverrideInstance[] {
    return this.spec.bgpInstances || [];
  }
}

/** Legacy BGP configuration, superseded by CiliumBGPClusterConfig. */
export class CiliumBGPPeeringPolicy extends CiliumObject<BGPPeeringPolicyInterface> {
  static kind = 'CiliumBGPPeeringPolicy';
  static apiName = 'ciliumbgppeeringpolicies';
  static apiVersion: string | string[] = 'cilium.io/v2alpha1';
  static isNamespaced = isNamespacedKind('CiliumBGPPeeringPolicy');

  static get detailsRoute() {
    return 'cilium-ciliumbgppeeringpolicies-detail';
  }

  get virtualRouters(): BGPVirtualRouter[] {
    return this.spec.virtualRouters || [];
  }
}
