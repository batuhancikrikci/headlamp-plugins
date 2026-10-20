/**
 * Turns the rules of a Cilium network policy into a flat, display-oriented model:
 * for every rule who is selected, and per direction which peers are allowed or denied on which
 * ports. Used by the policy visualization and the detail pages.
 */
import {
  CIDRRule,
  Direction,
  EgressRule,
  IngressRule,
  PolicyRule,
  PortRule,
} from '../resources/models/policy';
import { LabelSelector } from '../resources/types';
import { ruleDefaultDeny } from './policyMatch';
import { isSelectorEmpty, selectorToString } from './selectors';

export type PeerType =
  | 'endpoints'
  | 'entity'
  | 'cidr'
  | 'cidrGroup'
  | 'fqdn'
  | 'service'
  | 'nodes'
  | 'group'
  | 'any'
  | 'none';

export interface PeerView {
  type: PeerType;
  label: string;
  /** Secondary text, e.g. CIDR exceptions. */
  detail?: string;
  /** Name of a referenced object (CIDR group or service) for linking. */
  ref?: { kind: 'CiliumCIDRGroup' | 'Service'; name: string; namespace?: string };
}

export interface PortView {
  /** "TCP 80", "UDP 53", "TCP 8000-8080", "ANY 443". */
  label: string;
}

export interface L7View {
  protocol: 'HTTP' | 'DNS' | 'Kafka' | string;
  label: string;
}

export type FlowAction = 'allow' | 'deny';

export interface FlowView {
  id: string;
  direction: Direction;
  action: FlowAction;
  peers: PeerView[];
  ports: PortView[];
  l7: L7View[];
  icmp: string[];
  /** Mutual authentication mode, when required. */
  auth?: string;
  tls: boolean;
}

export interface SubjectView {
  type: 'endpoints' | 'nodes';
  /** Readable selector; empty string means "all". */
  selector: string;
  all: boolean;
}

export interface RuleView {
  index: number;
  description?: string;
  subject: SubjectView;
  defaultDeny: { ingress: boolean; egress: boolean };
  flows: FlowView[];
}

function selectorPeer(selector: LabelSelector, type: 'endpoints' | 'nodes'): PeerView {
  if (isSelectorEmpty(selector)) {
    return { type, label: type === 'nodes' ? 'All nodes' : 'All endpoints' };
  }
  return { type, label: selectorToString(selector) };
}

function cidrPeer(rule: CIDRRule): PeerView {
  if (rule.cidrGroupRef) {
    return {
      type: 'cidrGroup',
      label: rule.cidrGroupRef,
      ref: { kind: 'CiliumCIDRGroup', name: rule.cidrGroupRef },
    };
  }
  if (rule.cidrGroupSelector) {
    return { type: 'cidrGroup', label: selectorToString(rule.cidrGroupSelector) || 'All groups' };
  }
  return {
    type: 'cidr',
    label: rule.cidr || '?',
    detail: rule.except?.length ? `except ${rule.except.join(', ')}` : undefined,
  };
}

export function portLabel(port: { port?: string; endPort?: number; protocol?: string }): string {
  const protocol = port.protocol && port.protocol !== 'ANY' ? port.protocol : 'ANY';
  const range = port.endPort ? `${port.port}-${port.endPort}` : port.port || '*';
  return `${protocol} ${range}`;
}

function l7Views(portRules: PortRule[]): L7View[] {
  const views: L7View[] = [];
  for (const portRule of portRules) {
    const rules = portRule.rules;
    if (!rules) continue;
    for (const http of rules.http || []) {
      const parts = [http.method || 'ANY', http.path || '/*'];
      if (http.host) parts.push(`host ${http.host}`);
      const headers = [
        ...(http.headers || []),
        ...(http.headerMatches || []).map(h => `${h.name}${h.value ? `=${h.value}` : ''}`),
      ];
      if (headers.length) parts.push(`headers ${headers.join(', ')}`);
      views.push({ protocol: 'HTTP', label: parts.join(' ') });
    }
    for (const dns of rules.dns || []) {
      views.push({ protocol: 'DNS', label: dns.matchName || dns.matchPattern || '*' });
    }
    for (const kafka of rules.kafka || []) {
      const parts = [
        kafka.role || kafka.apiKey || 'any',
        kafka.topic ? `topic ${kafka.topic}` : '',
      ];
      views.push({ protocol: 'Kafka', label: parts.filter(Boolean).join(' ') });
    }
    if (rules.l7proto) {
      views.push({ protocol: rules.l7proto, label: `${(rules.l7 || []).length} rule(s)` });
    }
  }
  return views;
}

function icmpLabels(rule: IngressRule | EgressRule): string[] {
  return (rule.icmps || []).flatMap(icmp =>
    (icmp.fields || []).map(field => `${field.family || 'IPv4'} type ${field.type}`)
  );
}

function flowView(
  rule: IngressRule & EgressRule,
  direction: Direction,
  action: FlowAction,
  id: string
): FlowView {
  const peers: PeerView[] = [];
  const endpoints = direction === 'ingress' ? rule.fromEndpoints : rule.toEndpoints;
  const cidrs = direction === 'ingress' ? rule.fromCIDR : rule.toCIDR;
  const cidrSets = direction === 'ingress' ? rule.fromCIDRSet : rule.toCIDRSet;
  const entities = direction === 'ingress' ? rule.fromEntities : rule.toEntities;
  const nodes = direction === 'ingress' ? rule.fromNodes : rule.toNodes;
  const groups = direction === 'ingress' ? rule.fromGroups : rule.toGroups;

  for (const selector of endpoints || []) peers.push(selectorPeer(selector, 'endpoints'));
  for (const selector of nodes || []) peers.push(selectorPeer(selector, 'nodes'));
  for (const entity of entities || []) peers.push({ type: 'entity', label: entity });
  for (const cidr of cidrs || []) peers.push({ type: 'cidr', label: cidr });
  for (const set of cidrSets || []) peers.push(cidrPeer(set));
  for (const fqdn of rule.toFQDNs || []) {
    peers.push({ type: 'fqdn', label: fqdn.matchName || fqdn.matchPattern || '?' });
  }
  for (const service of rule.toServices || []) {
    if (service.k8sService) {
      const { serviceName, namespace } = service.k8sService;
      peers.push({
        type: 'service',
        label: `${namespace ? `${namespace}/` : ''}${serviceName || '?'}`,
        ref: serviceName ? { kind: 'Service', name: serviceName, namespace } : undefined,
      });
    } else if (service.k8sServiceSelector) {
      peers.push({
        type: 'service',
        label: selectorToString(service.k8sServiceSelector.selector) || 'All services',
        detail: service.k8sServiceSelector.namespace,
      });
    }
  }
  for (const group of groups || []) {
    peers.push({ type: 'group', label: Object.keys(group).join(', ') || 'cloud group' });
  }

  const portRules = rule.toPorts || [];
  const ports = portRules.flatMap(p => (p.ports || []).map(port => ({ label: portLabel(port) })));
  const icmp = icmpLabels(rule);
  if (peers.length === 0) {
    // A rule without any L3 peer is either L4-only (any peer on these ports) or the empty rule
    // that only switches the endpoints into default deny.
    const hasL4 = ports.length > 0 || icmp.length > 0;
    peers.push(
      hasL4
        ? { type: 'any', label: direction === 'ingress' ? 'Any source' : 'Any destination' }
        : { type: 'none', label: 'Nothing (default deny only)' }
    );
  }

  const auth = rule.authentication?.mode;
  return {
    id,
    direction,
    action,
    peers,
    ports,
    l7: l7Views(portRules),
    icmp,
    auth: auth && auth !== 'disabled' ? auth : undefined,
    tls: portRules.some(p => !!p.terminatingTLS || !!p.originatingTLS),
  };
}

export function ruleView(rule: PolicyRule, index: number): RuleView {
  const subjectSelector = rule.nodeSelector || rule.endpointSelector;
  const flows: FlowView[] = [];
  const add = (
    list: Array<IngressRule & EgressRule> | undefined,
    direction: Direction,
    action: FlowAction
  ) => {
    (list || []).forEach((r, i) =>
      flows.push(flowView(r, direction, action, `${index}-${direction}-${action}-${i}`))
    );
  };
  add(rule.ingressDeny, 'ingress', 'deny');
  add(rule.ingress, 'ingress', 'allow');
  add(rule.egressDeny, 'egress', 'deny');
  add(rule.egress, 'egress', 'allow');

  return {
    index,
    description: rule.description,
    subject: {
      type: rule.nodeSelector ? 'nodes' : 'endpoints',
      selector: selectorToString(subjectSelector),
      all: isSelectorEmpty(subjectSelector),
    },
    defaultDeny: ruleDefaultDeny(rule),
    flows,
  };
}

export function policyView(rules: PolicyRule[]): RuleView[] {
  return rules.map(ruleView);
}

/** One-line summary of a flow, used in tables and wizard reviews. */
export function flowSummary(flow: FlowView): string {
  const peers = flow.peers.map(p => p.label).join('; ');
  const ports = flow.ports.map(p => p.label).join(', ');
  const verb = flow.action === 'allow' ? 'Allow' : 'Deny';
  const preposition = flow.direction === 'ingress' ? 'from' : 'to';
  return `${verb} ${flow.direction} ${preposition} ${peers}${ports ? ` on ${ports}` : ''}`;
}
