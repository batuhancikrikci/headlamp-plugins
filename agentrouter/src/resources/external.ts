/**
 * Minimal models for non-AI-Gateway resources the wizards read or create.
 * Only the fields the plugin uses are typed.
 */
import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { INFERENCE_POOL_GROUP, INFERENCE_POOL_KIND } from './common';

export const ENVOY_GATEWAY_GROUP = 'gateway.envoyproxy.io';
export const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';

export interface EnvoyBackendInterface extends KubeObjectInterface {
  spec?: {
    endpoints?: Array<{
      fqdn?: { hostname: string; port: number };
      ip?: { address: string; port: number };
      unix?: { path: string };
    }>;
  };
}

/** Envoy Gateway `Backend` (gateway.envoyproxy.io/v1alpha1). */
export class EnvoyBackend extends KubeObject<EnvoyBackendInterface> {
  static kind = 'Backend';
  static apiName = 'backends';
  static apiVersion = `${ENVOY_GATEWAY_GROUP}/v1alpha1`;
  static isNamespaced = true;

  get endpointSummary(): string {
    return (
      (this.jsonData.spec?.endpoints || [])
        .map(e =>
          e.fqdn
            ? `${e.fqdn.hostname}:${e.fqdn.port}`
            : e.ip
            ? `${e.ip.address}:${e.ip.port}`
            : e.unix?.path || ''
        )
        .filter(Boolean)
        .join(', ') || '-'
    );
  }
}

export interface InferencePoolInterface extends KubeObjectInterface {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    targetPorts?: Array<{ number: number }>;
    endpointPickerRef?: { name: string; port?: { number: number } };
  };
}

/** Gateway API Inference Extension `InferencePool` (inference.networking.k8s.io/v1). */
export class InferencePool extends KubeObject<InferencePoolInterface> {
  static kind = INFERENCE_POOL_KIND;
  static apiName = 'inferencepools';
  static apiVersion = `${INFERENCE_POOL_GROUP}/v1`;
  static isNamespaced = true;

  get summary(): string {
    const spec = this.jsonData.spec;
    const labels = Object.entries(spec?.selector?.matchLabels || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const ports = (spec?.targetPorts || []).map(p => p.number).join(',');
    const epp = spec?.endpointPickerRef?.name;
    return [labels && `selector ${labels}`, ports && `port ${ports}`, epp && `EPP ${epp}`]
      .filter(Boolean)
      .join(' · ');
  }
}
