import { CiliumObjectInterface, Condition, Health, LabelSelector, Protocol } from '../types';

export interface PortProtocol {
  /** Port number or named port. */
  port?: string;
  endPort?: number;
  protocol?: Protocol;
}

export interface HTTPRule {
  path?: string;
  method?: string;
  host?: string;
  headers?: string[];
  headerMatches?: Array<{ name: string; value?: string; mismatch?: string }>;
}

export interface DNSRule {
  matchName?: string;
  matchPattern?: string;
}

export interface KafkaRule {
  role?: string;
  apiKey?: string;
  apiVersion?: string;
  clientID?: string;
  topic?: string;
}

export interface L7Rules {
  http?: HTTPRule[];
  dns?: DNSRule[];
  kafka?: KafkaRule[];
  l7proto?: string;
  l7?: Array<Record<string, string>>;
}

export interface TLSContext {
  secret?: { name: string; namespace?: string };
  trustedCA?: string;
  certificate?: string;
  privateKey?: string;
}

export interface PortRule {
  ports?: PortProtocol[];
  rules?: L7Rules;
  serverNames?: string[];
  terminatingTLS?: TLSContext;
  originatingTLS?: TLSContext;
  listener?: { envoyConfig?: { kind?: string; name?: string }; name?: string };
}

export interface CIDRRule {
  cidr?: string;
  except?: string[];
  cidrGroupRef?: string;
  cidrGroupSelector?: LabelSelector;
}

export interface FQDNSelector {
  matchName?: string;
  matchPattern?: string;
}

export interface ServiceSelector {
  k8sService?: { serviceName?: string; namespace?: string };
  k8sServiceSelector?: { selector?: LabelSelector; namespace?: string };
}

export interface ICMPRule {
  fields?: Array<{ family?: 'IPv4' | 'IPv6'; type: number | string }>;
}

export type Entity =
  | 'all'
  | 'world'
  | 'world-ipv4'
  | 'world-ipv6'
  | 'cluster'
  | 'host'
  | 'remote-node'
  | 'kube-apiserver'
  | 'ingress'
  | 'init'
  | 'health'
  | 'unmanaged'
  | 'none';

export const ENTITIES: Entity[] = [
  'world',
  'cluster',
  'host',
  'remote-node',
  'kube-apiserver',
  'ingress',
  'health',
  'init',
  'unmanaged',
  'world-ipv4',
  'world-ipv6',
  'all',
  'none',
];

export interface Authentication {
  mode?: 'disabled' | 'required' | 'test-always-fail';
}

interface CommonRule {
  toPorts?: PortRule[];
  icmps?: ICMPRule[];
  authentication?: Authentication;
}

export interface IngressRule extends CommonRule {
  fromEndpoints?: LabelSelector[];
  fromRequires?: LabelSelector[];
  fromCIDR?: string[];
  fromCIDRSet?: CIDRRule[];
  fromEntities?: Entity[];
  fromNodes?: LabelSelector[];
  fromGroups?: Array<Record<string, unknown>>;
}

export interface EgressRule extends CommonRule {
  toEndpoints?: LabelSelector[];
  toRequires?: LabelSelector[];
  toCIDR?: string[];
  toCIDRSet?: CIDRRule[];
  toEntities?: Entity[];
  toNodes?: LabelSelector[];
  toServices?: ServiceSelector[];
  toFQDNs?: FQDNSelector[];
  toGroups?: Array<Record<string, unknown>>;
}

/** One policy rule (api.Rule): `spec` holds one, `specs` a list of them. */
export interface PolicyRule {
  description?: string;
  endpointSelector?: LabelSelector;
  nodeSelector?: LabelSelector;
  ingress?: IngressRule[];
  ingressDeny?: IngressRule[];
  egress?: EgressRule[];
  egressDeny?: EgressRule[];
  enableDefaultDeny?: { ingress?: boolean; egress?: boolean };
  labels?: Array<{ key: string; value?: string; source?: string }>;
}

export type Direction = 'ingress' | 'egress';

export interface NetworkPolicyInterface extends CiliumObjectInterface {
  spec?: PolicyRule;
  specs?: PolicyRule[];
  status?: {
    conditions?: Condition[];
    derivedFromTime?: string;
  };
}

/** All rules of a policy, regardless of whether `spec` or `specs` is used. */
export function policyRules(json: { spec?: PolicyRule; specs?: PolicyRule[] }): PolicyRule[] {
  return [...(json.spec ? [json.spec] : []), ...(json.specs || [])];
}

export interface PolicyFeatures {
  ingressRules: number;
  egressRules: number;
  ingressDenyRules: number;
  egressDenyRules: number;
  l7: boolean;
  fqdn: boolean;
  entities: boolean;
  cidr: boolean;
  icmp: boolean;
  auth: boolean;
  hostPolicy: boolean;
}

/** Summarizes which policy capabilities a set of rules uses (list columns, overview). */
export function policyFeatures(rules: PolicyRule[]): PolicyFeatures {
  const f: PolicyFeatures = {
    ingressRules: 0,
    egressRules: 0,
    ingressDenyRules: 0,
    egressDenyRules: 0,
    l7: false,
    fqdn: false,
    entities: false,
    cidr: false,
    icmp: false,
    auth: false,
    hostPolicy: false,
  };
  const scan = (list: Array<IngressRule & EgressRule>) => {
    for (const r of list) {
      if (r.toFQDNs?.length) f.fqdn = true;
      if (r.fromEntities?.length || r.toEntities?.length) f.entities = true;
      if (r.fromCIDR?.length || r.fromCIDRSet?.length || r.toCIDR?.length || r.toCIDRSet?.length)
        f.cidr = true;
      if (r.icmps?.length) f.icmp = true;
      if (r.authentication?.mode && r.authentication.mode !== 'disabled') f.auth = true;
      for (const p of r.toPorts || []) {
        const l7 = p.rules;
        if (l7 && (l7.http?.length || l7.dns?.length || l7.kafka?.length || l7.l7proto))
          f.l7 = true;
        if (l7?.dns?.length) f.fqdn = true;
      }
    }
  };
  for (const rule of rules) {
    f.ingressRules += rule.ingress?.length || 0;
    f.egressRules += rule.egress?.length || 0;
    f.ingressDenyRules += rule.ingressDeny?.length || 0;
    f.egressDenyRules += rule.egressDeny?.length || 0;
    if (rule.nodeSelector) f.hostPolicy = true;
    scan([
      ...(rule.ingress || []),
      ...(rule.ingressDeny || []),
      ...(rule.egress || []),
      ...(rule.egressDeny || []),
    ]);
  }
  return f;
}

export interface PolicyValidity {
  health: Health;
  label: string;
  message?: string;
}

/** Cilium reports policy validation through the `Valid` condition. */
export function policyValidity(conditions: Condition[]): PolicyValidity {
  const valid = conditions.find(c => c.type === 'Valid');
  if (!valid) return { health: 'unknown', label: 'Unknown' };
  if (valid.status === 'True') return { health: 'success', label: 'Valid', message: valid.message };
  return { health: 'error', label: 'Invalid', message: valid.message || valid.reason };
}

export interface CIDRGroupInterface extends CiliumObjectInterface {
  spec?: { externalCIDRs?: string[] };
}
