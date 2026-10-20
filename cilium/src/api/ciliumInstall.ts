/**
 * What is known about the Cilium installation itself: its components (agent, operator, Envoy,
 * Hubble), their health and version, and the features enabled in cilium-config. Everything is
 * derived from pods found by label, so no namespace or release name is assumed.
 */

export interface PodJson {
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: { nodeName?: string; containers?: Array<{ name: string; image?: string }> };
  status?: {
    phase?: string;
    conditions?: Array<{ type: string; status: string }>;
    containerStatuses?: Array<{ name: string; ready?: boolean; restartCount?: number }>;
  };
}

export type ComponentId = 'agent' | 'operator' | 'envoy' | 'hubbleRelay' | 'hubbleUI';

export interface ComponentInfo {
  id: ComponentId;
  label: string;
  icon: string;
  /** Whether Cilium works without this component. */
  optional: boolean;
}

export const COMPONENTS: ComponentInfo[] = [
  { id: 'agent', label: 'Agent', icon: 'mdi:hexagon-multiple', optional: false },
  { id: 'operator', label: 'Operator', icon: 'mdi:cog-outline', optional: false },
  { id: 'envoy', label: 'Envoy', icon: 'mdi:hexagon-slice-6', optional: true },
  {
    id: 'hubbleRelay',
    label: 'Hubble Relay',
    icon: 'mdi:transit-connection-variant',
    optional: true,
  },
  { id: 'hubbleUI', label: 'Hubble UI', icon: 'mdi:monitor-dashboard', optional: true },
];

/** Label selectors that find every Cilium component pod in two list requests. */
export const K8S_APP_SELECTOR = 'k8s-app in (cilium,cilium-envoy,hubble-relay,hubble-ui)';
export const OPERATOR_SELECTOR = 'io.cilium/app=operator';

export function componentOf(pod: PodJson): ComponentId | null {
  const labels = pod.metadata.labels || {};
  if (labels['io.cilium/app'] === 'operator' || labels.name === 'cilium-operator')
    return 'operator';
  switch (labels['k8s-app']) {
    case 'cilium':
      return 'agent';
    case 'cilium-envoy':
      return 'envoy';
    case 'hubble-relay':
      return 'hubbleRelay';
    case 'hubble-ui':
      return 'hubbleUI';
    default:
      return null;
  }
}

export function isPodReady(pod: PodJson): boolean {
  if (pod.status?.phase !== 'Running') return false;
  return (pod.status.conditions || []).some(c => c.type === 'Ready' && c.status === 'True');
}

/** "quay.io/cilium/cilium:v1.20.2@sha256:…" -> "v1.20.2". */
export function imageVersion(image?: string): string | undefined {
  if (!image) return undefined;
  const withoutDigest = image.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  if (colon === -1) return undefined;
  return withoutDigest.slice(colon + 1) || undefined;
}

export interface ComponentStatus {
  info: ComponentInfo;
  pods: PodJson[];
  ready: number;
  total: number;
  notReady: PodJson[];
  restarts: number;
  /** Distinct image versions; more than one means a rollout is in progress or stuck. */
  versions: string[];
  namespace?: string;
}

export interface InstallStatus {
  components: Record<ComponentId, ComponentStatus>;
  /** Namespace of the agent pods (falls back to the operator's). */
  namespace?: string;
  version?: string;
  found: boolean;
}

function mainImage(pod: PodJson, component: ComponentId): string | undefined {
  const containers = pod.spec?.containers || [];
  const preferred: Record<ComponentId, string[]> = {
    agent: ['cilium-agent'],
    operator: ['cilium-operator'],
    envoy: ['cilium-envoy'],
    hubbleRelay: ['hubble-relay'],
    hubbleUI: ['backend', 'frontend'],
  };
  const match = containers.find(c => preferred[component].includes(c.name));
  return (match || containers[0])?.image;
}

export function summarizeInstall(pods: PodJson[]): InstallStatus {
  const components = {} as Record<ComponentId, ComponentStatus>;
  for (const info of COMPONENTS) {
    components[info.id] = {
      info,
      pods: [],
      ready: 0,
      total: 0,
      notReady: [],
      restarts: 0,
      versions: [],
    };
  }
  const seen = new Set<string>();
  for (const pod of pods) {
    const id = componentOf(pod);
    const key = `${pod.metadata.namespace}/${pod.metadata.name}`;
    if (!id || seen.has(key)) continue;
    seen.add(key);
    const status = components[id];
    status.pods.push(pod);
    status.total++;
    if (isPodReady(pod)) status.ready++;
    else status.notReady.push(pod);
    status.restarts += (pod.status?.containerStatuses || []).reduce(
      (n, c) => n + (c.restartCount || 0),
      0
    );
    const version = imageVersion(mainImage(pod, id));
    if (version && !status.versions.includes(version)) status.versions.push(version);
    status.namespace = status.namespace || pod.metadata.namespace;
  }
  const agent = components.agent;
  const operator = components.operator;
  return {
    components,
    namespace: agent.namespace || operator.namespace,
    version: agent.versions[0] || operator.versions[0],
    found: agent.total + operator.total > 0,
  };
}

export interface ConfigFeature {
  id: string;
  label: string;
  value: string;
  /** undefined for informational values that are neither on nor off. */
  enabled?: boolean;
}

function isTrue(value?: string): boolean {
  return (value || '').toLowerCase() === 'true';
}

/** The settings of cilium-config an operator usually wants to see at a glance. */
export function configFeatures(config: Record<string, string> = {}): ConfigFeature[] {
  const features: ConfigFeature[] = [];
  const info = (id: string, label: string, value?: string) => {
    if (value) features.push({ id, label, value });
  };
  const toggle = (id: string, label: string, ...keys: string[]) => {
    const present = keys.filter(key => config[key] !== undefined);
    if (present.length === 0) return;
    const enabled = present.some(key => isTrue(config[key]));
    features.push({ id, label, value: enabled ? 'Enabled' : 'Disabled', enabled });
  };

  info('cluster', 'Cluster name', config['cluster-name']);
  const routing = config['routing-mode'] || config['tunnel'];
  info(
    'routing',
    'Routing',
    routing === 'native'
      ? 'Native'
      : routing
      ? `Tunnel (${config['tunnel-protocol'] || (routing === 'tunnel' ? 'vxlan' : routing)})`
      : undefined
  );
  info('ipam', 'IPAM', config['ipam']);
  const kpr = config['kube-proxy-replacement'];
  if (kpr !== undefined) {
    const enabled = isTrue(kpr) || kpr === 'strict';
    features.push({
      id: 'kpr',
      label: 'kube-proxy replacement',
      value: enabled ? 'Enabled' : kpr === 'false' || kpr === 'disabled' ? 'Disabled' : kpr,
      enabled,
    });
  }
  info('policy', 'Policy enforcement', config['enable-policy']);
  toggle('auditMode', 'Policy audit mode', 'policy-audit-mode');
  toggle('ipv4', 'IPv4', 'enable-ipv4');
  toggle('ipv6', 'IPv6', 'enable-ipv6');
  toggle('bgp', 'BGP control plane', 'enable-bgp-control-plane');
  toggle('l2', 'L2 announcements', 'enable-l2-announcements');
  toggle('egress', 'Egress gateway', 'enable-egress-gateway', 'enable-ipv4-egress-gateway');
  toggle('lrp', 'Local redirect policy', 'enable-local-redirect-policy');
  toggle('l7', 'L7 proxy', 'enable-l7-proxy');
  toggle('envoyConfig', 'Envoy config', 'enable-envoy-config');
  toggle('gatewayAPI', 'Gateway API', 'enable-gateway-api');
  toggle('ingress', 'Ingress controller', 'enable-ingress-controller');
  toggle('hubble', 'Hubble', 'enable-hubble');
  toggle('wireguard', 'WireGuard encryption', 'enable-wireguard');
  toggle('ipsec', 'IPsec encryption', 'enable-ipsec');
  toggle('ces', 'Endpoint slices', 'enable-cilium-endpoint-slice');
  info('identity', 'Identity allocation', config['identity-allocation-mode']);
  return features;
}
