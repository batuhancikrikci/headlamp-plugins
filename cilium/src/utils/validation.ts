/**
 * Client-side validation for the guided forms and wizards. The API server (and Cilium itself)
 * remain the source of truth; these checks catch the common mistakes before applying.
 */
import { ValidationError } from '../common/form/types';
import { isValidResourceName } from '../common/objects';
import { isNamespacedKind } from '../resources/kinds';
import {
  BGPAdvertisementEntry,
  BGPClusterInstance,
  BGPFamily,
  BGPNodeOverrideInstance,
} from '../resources/models/bgp';
import {
  EgressGateway,
  EgressRuleSelector,
  EnvoyResource,
  LBIPBlock,
  PodIPPoolFamily,
  RedirectPort,
} from '../resources/models/network';
import {
  CIDRRule,
  EgressRule,
  ENTITIES,
  IngressRule,
  PolicyRule,
  PortRule,
} from '../resources/models/policy';
import { KubeJson, LabelSelector } from '../resources/types';
import {
  blockRange,
  cidrContainsCIDR,
  isValidCIDR,
  isValidCIDROrIP,
  isValidIP,
  parseCIDR,
  parseIP,
} from './cidr';
import { selectorProblems } from './selectors';

type Errors = ValidationError[];

const MAX_ASN = 4294967295;
/** IANA service name: up to 15 characters, letters, digits and inner hyphens, at least a letter. */
const NAMED_PORT_RE = /^(?=.*[a-z])[a-z0-9]([a-z0-9-]{0,13}[a-z0-9])?$/i;
const FQDN_NAME_RE = /^([a-zA-Z0-9_]([-a-zA-Z0-9_]*[a-zA-Z0-9_])?\.?)+$/;
const FQDN_PATTERN_RE = /^[-a-zA-Z0-9_.*]+$/;
const DNS_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function isValidPortNumber(value: unknown): boolean {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** A policy port is a number, 0 (all ports) or a named port. */
export function isValidPolicyPort(value?: string): boolean {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value) <= 65535;
  return NAMED_PORT_RE.test(value);
}

export function isValidASN(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ASN;
}

export function isValidFQDNName(value?: string): boolean {
  return !!value && value.length <= 255 && FQDN_NAME_RE.test(value);
}

export function isValidFQDNPattern(value?: string): boolean {
  return !!value && value.length <= 255 && FQDN_PATTERN_RE.test(value);
}

export function isValidRegex(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function selectorErrors(selector: LabelSelector | undefined | null, where: string): Errors {
  return selectorProblems(selector).map(problem => ({
    key: '{{where}}: {{problem}}',
    params: { where, problem },
  }));
}

function portRuleErrors(portRules: PortRule[] | undefined, where: string, deny: boolean): Errors {
  const errors: Errors = [];
  for (const portRule of portRules || []) {
    for (const port of portRule.ports || []) {
      if (!isValidPolicyPort(port.port)) {
        errors.push({
          key: '{{where}}: "{{port}}" is not a valid port (number or named port)',
          params: { where, port: port.port ?? '' },
        });
      } else if (port.endPort !== undefined) {
        if (!/^\d+$/.test(port.port || '') || port.endPort <= Number(port.port)) {
          errors.push({
            key: '{{where}}: the end port must be greater than the start port {{port}}',
            params: { where, port: port.port },
          });
        } else if (!isValidPortNumber(port.endPort)) {
          errors.push({ key: '{{where}}: the end port must be at most 65535', params: { where } });
        }
      }
    }
    const l7 = portRule.rules;
    const hasL7 = !!l7 && (l7.http?.length || l7.dns?.length || l7.kafka?.length || l7.l7proto);
    if (hasL7 && deny) {
      errors.push({ key: '{{where}}: deny rules cannot have L7 rules', params: { where } });
    }
    if (hasL7 && !(portRule.ports || []).length) {
      errors.push({ key: '{{where}}: L7 rules need at least one port', params: { where } });
    }
    for (const dns of l7?.dns || []) {
      if (!dns.matchName && !dns.matchPattern) {
        errors.push({ key: '{{where}}: a DNS rule needs a name or a pattern', params: { where } });
      }
    }
  }
  return errors;
}

function cidrSetErrors(sets: CIDRRule[] | undefined, where: string): Errors {
  const errors: Errors = [];
  for (const set of sets || []) {
    const sources = [set.cidr, set.cidrGroupRef, set.cidrGroupSelector].filter(Boolean).length;
    if (sources !== 1) {
      errors.push({
        key: '{{where}}: a CIDR entry needs exactly one of CIDR, CIDR group or group selector',
        params: { where },
      });
      continue;
    }
    if (set.cidr && !isValidCIDR(set.cidr)) {
      errors.push({
        key: '{{where}}: "{{cidr}}" is not a valid CIDR',
        params: { where, cidr: set.cidr },
      });
      continue;
    }
    for (const except of set.except || []) {
      if (!isValidCIDR(except)) {
        errors.push({
          key: '{{where}}: "{{cidr}}" is not a valid CIDR',
          params: { where, cidr: except },
        });
      } else if (set.cidr && !cidrContainsCIDR(set.cidr, except)) {
        errors.push({
          key: '{{where}}: the exception {{except}} is not inside {{cidr}}',
          params: { where, except, cidr: set.cidr },
        });
      }
    }
  }
  return errors;
}

function directionErrors(
  rules: Array<IngressRule & EgressRule> | undefined,
  direction: 'ingress' | 'egress',
  deny: boolean,
  prefix: string
): Errors {
  const errors: Errors = [];
  (rules || []).forEach((rule, index) => {
    const where = `${prefix}${deny ? `${direction} deny` : direction} rule #${index + 1}`;
    const from = direction === 'ingress';
    const endpoints = from ? rule.fromEndpoints : rule.toEndpoints;
    const cidrs = from ? rule.fromCIDR : rule.toCIDR;
    const cidrSets = from ? rule.fromCIDRSet : rule.toCIDRSet;
    const entities = from ? rule.fromEntities : rule.toEntities;
    const nodes = from ? rule.fromNodes : rule.toNodes;

    for (const selector of [...(endpoints || []), ...(nodes || [])]) {
      errors.push(...selectorErrors(selector, where));
    }
    for (const cidr of cidrs || []) {
      if (!isValidCIDROrIP(cidr)) {
        errors.push({ key: '{{where}}: "{{cidr}}" is not a valid CIDR', params: { where, cidr } });
      }
    }
    errors.push(...cidrSetErrors(cidrSets, where));
    for (const entity of entities || []) {
      if (!ENTITIES.includes(entity)) {
        errors.push({
          key: '{{where}}: "{{entity}}" is not a known entity',
          params: { where, entity },
        });
      }
    }
    for (const fqdn of rule.toFQDNs || []) {
      if (!!fqdn.matchName === !!fqdn.matchPattern) {
        errors.push({
          key: '{{where}}: an FQDN entry needs either a name or a pattern',
          params: { where },
        });
      } else if (fqdn.matchName && !isValidFQDNName(fqdn.matchName)) {
        errors.push({
          key: '{{where}}: "{{name}}" is not a valid DNS name',
          params: { where, name: fqdn.matchName },
        });
      } else if (fqdn.matchPattern && !isValidFQDNPattern(fqdn.matchPattern)) {
        errors.push({
          key: '{{where}}: "{{name}}" is not a valid DNS pattern',
          params: { where, name: fqdn.matchPattern },
        });
      }
    }
    if (rule.toFQDNs?.length) {
      const otherL3 =
        (endpoints || []).length +
        (cidrs || []).length +
        (cidrSets || []).length +
        (entities || []).length +
        (rule.toServices || []).length +
        (nodes || []).length;
      if (otherL3 > 0) {
        errors.push({
          key: '{{where}}: FQDN destinations cannot be combined with other destinations in the same rule',
          params: { where },
        });
      }
      if (deny) {
        errors.push({ key: '{{where}}: deny rules cannot use FQDNs', params: { where } });
      }
    }
    for (const service of rule.toServices || []) {
      if (!service.k8sService?.serviceName && !service.k8sServiceSelector) {
        errors.push({
          key: '{{where}}: a service destination needs a service name or a selector',
          params: { where },
        });
      }
    }
    for (const icmp of rule.icmps || []) {
      if (!(icmp.fields || []).length) {
        errors.push({ key: '{{where}}: an ICMP entry needs at least one type', params: { where } });
      }
    }
    errors.push(...portRuleErrors(rule.toPorts, where, deny));
  });
  return errors;
}

/** Validates one policy rule. `clusterwide` allows node selectors (host policies). */
export function validatePolicyRule(rule: PolicyRule, clusterwide: boolean, prefix = ''): Errors {
  const errors: Errors = [];
  const hasEndpoint = rule.endpointSelector !== undefined && rule.endpointSelector !== null;
  const hasNode = rule.nodeSelector !== undefined && rule.nodeSelector !== null;
  if (hasEndpoint === hasNode) {
    errors.push({
      key: clusterwide
        ? '{{prefix}}Select either endpoints or nodes'
        : '{{prefix}}An endpoint selector is required',
      params: { prefix },
    });
  }
  if (hasNode && !clusterwide) {
    errors.push({
      key: '{{prefix}}Node selectors are only allowed in clusterwide policies',
      params: { prefix },
    });
  }
  errors.push(...selectorErrors(rule.endpointSelector, `${prefix}endpoint selector`));
  errors.push(...selectorErrors(rule.nodeSelector, `${prefix}node selector`));
  errors.push(...directionErrors(rule.ingress, 'ingress', false, prefix));
  errors.push(...directionErrors(rule.ingressDeny, 'ingress', true, prefix));
  errors.push(...directionErrors(rule.egress, 'egress', false, prefix));
  errors.push(...directionErrors(rule.egressDeny, 'egress', true, prefix));
  return errors;
}

function validatePolicy(json: KubeJson, clusterwide: boolean): Errors {
  const errors: Errors = [];
  const specs: PolicyRule[] = Array.isArray(json.specs) ? json.specs : [];
  if (!json.spec && specs.length === 0) {
    errors.push({ key: 'The policy needs a rule (spec)' });
  }
  if (json.spec) errors.push(...validatePolicyRule(json.spec, clusterwide));
  specs.forEach((rule, i) =>
    errors.push(...validatePolicyRule(rule, clusterwide, `Rule set #${i + 1}: `))
  );
  return errors;
}

function validateBlocks(blocks: LBIPBlock[] | undefined): Errors {
  const errors: Errors = [];
  if (!blocks?.length) return [{ key: 'Add at least one IP block' }];
  blocks.forEach((block, i) => {
    const index = i + 1;
    if (!!block.cidr === !!block.start) {
      errors.push({
        key: 'Block #{{index}} needs either a CIDR or a start address',
        params: { index },
      });
    } else if (block.cidr && !isValidCIDR(block.cidr)) {
      errors.push({
        key: 'Block #{{index}}: "{{value}}" is not a valid CIDR',
        params: { index, value: block.cidr },
      });
    } else if (block.start && !isValidIP(block.start)) {
      errors.push({
        key: 'Block #{{index}}: "{{value}}" is not a valid IP address',
        params: { index, value: block.start },
      });
    } else if (block.stop && !isValidIP(block.stop)) {
      errors.push({
        key: 'Block #{{index}}: "{{value}}" is not a valid IP address',
        params: { index, value: block.stop },
      });
    } else if (!blockRange(block)) {
      errors.push({
        key: 'Block #{{index}}: the stop address must not be lower than the start address',
        params: { index },
      });
    }
    if (block.cidr && block.stop) {
      errors.push({
        key: 'Block #{{index}}: a stop address requires a start address',
        params: { index },
      });
    }
  });
  return errors;
}

function validatePodPoolFamily(family: PodIPPoolFamily | undefined, version: 4 | 6): Errors {
  if (!family) return [];
  const errors: Errors = [];
  const label = `IPv${version}`;
  const bits = version === 4 ? 32 : 128;
  if (!family.cidrs?.length)
    errors.push({ key: '{{label}}: add at least one CIDR', params: { label } });
  for (const cidr of family.cidrs || []) {
    const parsed = parseCIDR(cidr);
    if (!parsed || parsed.family !== version) {
      errors.push({
        key: '{{label}}: "{{cidr}}" is not a valid {{label}} CIDR',
        params: { label, cidr },
      });
    } else if (family.maskSize !== undefined && family.maskSize < parsed.prefix) {
      errors.push({
        key: '{{label}}: the mask size /{{mask}} is larger than the pool CIDR {{cidr}}',
        params: { label, mask: family.maskSize, cidr },
      });
    }
  }
  if (family.maskSize === undefined) {
    errors.push({ key: '{{label}}: a mask size is required', params: { label } });
  } else if (family.maskSize < 1 || family.maskSize > bits) {
    errors.push({
      key: '{{label}}: the mask size must be between 1 and {{bits}}',
      params: { label, bits },
    });
  }
  return errors;
}

function validateRedirectPorts(ports: RedirectPort[] | undefined, where: string): Errors {
  const errors: Errors = [];
  if (!ports?.length) return [{ key: '{{where}}: add at least one port', params: { where } }];
  for (const port of ports) {
    if (!isValidPortNumber(port.port)) {
      errors.push({
        key: '{{where}}: "{{port}}" is not a valid port number',
        params: { where, port: port.port ?? '' },
      });
    }
  }
  if (ports.length > 1 && ports.some(p => !p.name)) {
    errors.push({
      key: '{{where}}: ports need names when there is more than one',
      params: { where },
    });
  }
  return errors;
}

function validateBGPInstances(instances: BGPClusterInstance[] | undefined): Errors {
  const errors: Errors = [];
  if (!instances?.length) return [{ key: 'Add at least one BGP instance' }];
  const names = new Set<string>();
  instances.forEach((instance, i) => {
    const label = instance.name || `#${i + 1}`;
    if (!instance.name)
      errors.push({ key: 'BGP instance #{{index}} needs a name', params: { index: i + 1 } });
    else if (names.has(instance.name)) {
      errors.push({
        key: 'BGP instance name "{{name}}" is used twice',
        params: { name: instance.name },
      });
    }
    names.add(instance.name);
    if (instance.localASN !== undefined && !isValidASN(instance.localASN)) {
      errors.push({
        key: 'Instance {{label}}: the local ASN must be between 1 and 4294967295',
        params: { label },
      });
    }
    if (instance.localPort !== undefined && !isValidPortNumber(instance.localPort)) {
      errors.push({ key: 'Instance {{label}}: the local port is not valid', params: { label } });
    }
    const peerNames = new Set<string>();
    (instance.peers || []).forEach((peer, p) => {
      const peerLabel = peer.name || `#${p + 1}`;
      if (!peer.name) {
        errors.push({
          key: 'Instance {{label}}: peer #{{index}} needs a name',
          params: { label, index: p + 1 },
        });
      } else if (peerNames.has(peer.name)) {
        errors.push({
          key: 'Instance {{label}}: peer name "{{name}}" is used twice',
          params: { label, name: peer.name },
        });
      }
      peerNames.add(peer.name);
      if (!peer.autoDiscovery) {
        if (!peer.peerAddress) {
          errors.push({
            key: 'Peer {{peer}}: a peer address is required',
            params: { peer: peerLabel },
          });
        } else if (!isValidIP(peer.peerAddress)) {
          errors.push({
            key: 'Peer {{peer}}: "{{value}}" is not a valid IP address',
            params: { peer: peerLabel, value: peer.peerAddress },
          });
        }
      }
      if (peer.peerASN !== undefined && !isValidASN(peer.peerASN)) {
        errors.push({
          key: 'Peer {{peer}}: the peer ASN must be between 1 and 4294967295',
          params: { peer: peerLabel },
        });
      }
      if (peer.peerConfigRef && !peer.peerConfigRef.name) {
        errors.push({
          key: 'Peer {{peer}}: choose a peer config or clear the reference',
          params: { peer: peerLabel },
        });
      }
    });
  });
  return errors;
}

function validateFamilies(families: BGPFamily[] | undefined): Errors {
  const errors: Errors = [];
  const seen = new Set<string>();
  for (const family of families || []) {
    if (!family.afi || !family.safi) {
      errors.push({ key: 'Each address family needs an AFI and a SAFI' });
      continue;
    }
    const key = `${family.afi}/${family.safi}`;
    if (seen.has(key))
      errors.push({ key: 'Address family {{family}} is listed twice', params: { family: key } });
    seen.add(key);
    errors.push(...selectorErrors(family.advertisements, `Family ${key}`));
  }
  return errors;
}

function validateAdvertisements(entries: BGPAdvertisementEntry[] | undefined): Errors {
  const errors: Errors = [];
  if (!entries?.length) return [{ key: 'Add at least one advertisement' }];
  entries.forEach((entry, i) => {
    const index = i + 1;
    if (!entry.advertisementType) {
      errors.push({ key: 'Advertisement #{{index}} needs a type', params: { index } });
      return;
    }
    if (entry.advertisementType === 'Service') {
      if (!entry.service?.addresses?.length) {
        errors.push({
          key: 'Advertisement #{{index}}: choose which service addresses to advertise',
          params: { index },
        });
      }
      if (!entry.selector) {
        errors.push({
          key: 'Advertisement #{{index}}: a service selector is required (an empty selector matches all services)',
          params: { index },
        });
      }
    }
    if (entry.advertisementType === 'CiliumPodIPPool' && !entry.selector) {
      errors.push({
        key: 'Advertisement #{{index}}: a pool selector is required (an empty selector matches all pools)',
        params: { index },
      });
    }
    if (entry.advertisementType === 'Interface' && !entry.interface?.name) {
      errors.push({
        key: 'Advertisement #{{index}}: an interface name is required',
        params: { index },
      });
    }
    errors.push(...selectorErrors(entry.selector, `Advertisement #${index}`));
    const pref = entry.attributes?.localPreference;
    if (pref !== undefined && (pref < 0 || pref > MAX_ASN)) {
      errors.push({
        key: 'Advertisement #{{index}}: the local preference is out of range',
        params: { index },
      });
    }
    for (const community of entry.attributes?.communities?.standard || []) {
      if (!/^(\d+|\d+:\d+)$/.test(community)) {
        errors.push({
          key: 'Advertisement #{{index}}: "{{value}}" is not a standard community (ASN:value)',
          params: { index, value: community },
        });
      }
    }
    for (const community of entry.attributes?.communities?.large || []) {
      if (!/^\d+:\d+:\d+$/.test(community)) {
        errors.push({
          key: 'Advertisement #{{index}}: "{{value}}" is not a large community (ASN:value:value)',
          params: { index, value: community },
        });
      }
    }
  });
  return errors;
}

function validateEgressSelectors(selectors: EgressRuleSelector[] | undefined): Errors {
  const errors: Errors = [];
  if (!selectors?.length) return [{ key: 'Add at least one pod selector' }];
  selectors.forEach((selector, i) => {
    const where = `Selector #${i + 1}`;
    if (!selector.podSelector && !selector.namespaceSelector) {
      errors.push({ key: '{{where}}: a pod or namespace selector is required', params: { where } });
    }
    errors.push(...selectorErrors(selector.podSelector, where));
    errors.push(...selectorErrors(selector.namespaceSelector, where));
    errors.push(...selectorErrors(selector.nodeSelector, where));
  });
  return errors;
}

function validateEgressGateway(gateway: EgressGateway | undefined, where: string): Errors {
  const errors: Errors = [];
  if (!gateway?.nodeSelector) {
    return [{ key: '{{where}}: a gateway node selector is required', params: { where } }];
  }
  errors.push(...selectorErrors(gateway.nodeSelector, where));
  if (gateway.interface && gateway.egressIP) {
    errors.push({
      key: '{{where}}: set either an interface or an egress IP, not both',
      params: { where },
    });
  }
  if (gateway.egressIP && parseIP(gateway.egressIP)?.family !== 4) {
    errors.push({ key: '{{where}}: the egress IP must be an IPv4 address', params: { where } });
  }
  return errors;
}

function validateCIDRList(cidrs: string[] | undefined, what: string, required: boolean): Errors {
  const errors: Errors = [];
  if (required && !cidrs?.length)
    errors.push({ key: 'Add at least one {{what}}', params: { what } });
  for (const cidr of cidrs || []) {
    if (!isValidCIDR(cidr)) {
      errors.push({ key: '"{{cidr}}" is not a valid CIDR ({{what}})', params: { cidr, what } });
    }
  }
  return errors;
}

// The spec shape depends on the kind; each validator documents the fields it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const specValidators: Record<string, (spec: Spec, json: KubeJson) => Errors> = {
  CiliumCIDRGroup(spec) {
    return validateCIDRList(spec.externalCIDRs, 'external CIDR', true);
  },

  CiliumNodeConfig(spec) {
    const errors: Errors = [];
    if (!spec.nodeSelector) errors.push({ key: 'A node selector is required' });
    errors.push(...selectorErrors(spec.nodeSelector, 'Node selector'));
    if (!spec.defaults || Object.keys(spec.defaults).length === 0) {
      errors.push({ key: 'Add at least one configuration override' });
    }
    for (const [key, value] of Object.entries(spec.defaults || {})) {
      if (!key) errors.push({ key: 'Configuration keys must not be empty' });
      if (typeof value !== 'string') {
        errors.push({ key: 'The value of "{{key}}" must be a string', params: { key } });
      }
    }
    return errors;
  },

  CiliumBGPClusterConfig(spec) {
    return [
      ...selectorErrors(spec.nodeSelector, 'Node selector'),
      ...validateBGPInstances(spec.bgpInstances),
    ];
  },

  CiliumBGPPeerConfig(spec) {
    const errors: Errors = [];
    const timers = spec.timers || {};
    if (timers.holdTimeSeconds !== undefined && timers.holdTimeSeconds < 3) {
      errors.push({ key: 'The hold time must be at least 3 seconds' });
    }
    if (
      timers.holdTimeSeconds !== undefined &&
      timers.keepAliveTimeSeconds !== undefined &&
      timers.keepAliveTimeSeconds >= timers.holdTimeSeconds
    ) {
      errors.push({ key: 'The keepalive time must be lower than the hold time' });
    }
    if (spec.transport?.peerPort !== undefined && !isValidPortNumber(spec.transport.peerPort)) {
      errors.push({ key: 'The peer port is not valid' });
    }
    if (spec.ebgpMultihop !== undefined && (spec.ebgpMultihop < 1 || spec.ebgpMultihop > 255)) {
      errors.push({ key: 'The eBGP multihop TTL must be between 1 and 255' });
    }
    const restart = spec.gracefulRestart?.restartTimeSeconds;
    if (restart !== undefined && (restart < 1 || restart > 4095)) {
      errors.push({ key: 'The graceful restart time must be between 1 and 4095 seconds' });
    }
    errors.push(...validateFamilies(spec.families));
    return errors;
  },

  CiliumBGPAdvertisement(spec) {
    return validateAdvertisements(spec.advertisements);
  },

  CiliumBGPNodeConfigOverride(spec) {
    const errors: Errors = [];
    const instances: BGPNodeOverrideInstance[] = spec.bgpInstances || [];
    if (!instances.length) errors.push({ key: 'Add at least one BGP instance' });
    instances.forEach((instance, i) => {
      const label = instance.name || `#${i + 1}`;
      if (!instance.name)
        errors.push({ key: 'BGP instance #{{index}} needs a name', params: { index: i + 1 } });
      if (instance.routerID && parseIP(instance.routerID)?.family !== 4) {
        errors.push({
          key: 'Instance {{label}}: the router ID must be an IPv4 address',
          params: { label },
        });
      }
      if (instance.localPort !== undefined && !isValidPortNumber(instance.localPort)) {
        errors.push({ key: 'Instance {{label}}: the local port is not valid', params: { label } });
      }
      if (instance.localASN !== undefined && !isValidASN(instance.localASN)) {
        errors.push({
          key: 'Instance {{label}}: the local ASN must be between 1 and 4294967295',
          params: { label },
        });
      }
      for (const peer of instance.peers || []) {
        if (!peer.name)
          errors.push({
            key: 'Instance {{label}}: every peer override needs a name',
            params: { label },
          });
        if (peer.localAddress && !isValidIP(peer.localAddress)) {
          errors.push({
            key: 'Peer {{peer}}: "{{value}}" is not a valid IP address',
            params: { peer: peer.name, value: peer.localAddress },
          });
        }
      }
    });
    return errors;
  },

  CiliumLoadBalancerIPPool(spec) {
    return [
      ...validateBlocks(spec.blocks),
      ...selectorErrors(spec.serviceSelector, 'Service selector'),
    ];
  },

  CiliumL2AnnouncementPolicy(spec) {
    const errors: Errors = [];
    if (!spec.loadBalancerIPs && !spec.externalIPs) {
      errors.push({ key: 'Announce LoadBalancer IPs, external IPs or both' });
    }
    for (const iface of spec.interfaces || []) {
      if (!isValidRegex(iface)) {
        errors.push({
          key: '"{{value}}" is not a valid interface expression',
          params: { value: iface },
        });
      }
    }
    errors.push(...selectorErrors(spec.nodeSelector, 'Node selector'));
    errors.push(...selectorErrors(spec.serviceSelector, 'Service selector'));
    return errors;
  },

  CiliumPodIPPool(spec) {
    const errors: Errors = [];
    if (!spec.ipv4 && !spec.ipv6)
      errors.push({ key: 'Configure an IPv4 pool, an IPv6 pool or both' });
    errors.push(...validatePodPoolFamily(spec.ipv4, 4), ...validatePodPoolFamily(spec.ipv6, 6));
    errors.push(...selectorErrors(spec.podSelector, 'Pod selector'));
    errors.push(...selectorErrors(spec.namespaceSelector, 'Namespace selector'));
    return errors;
  },

  CiliumEgressGatewayPolicy(spec) {
    const errors: Errors = [
      ...validateEgressSelectors(spec.selectors),
      ...validateCIDRList(spec.destinationCIDRs, 'destination CIDR', true),
      ...validateCIDRList(spec.excludedCIDRs, 'excluded CIDR', false),
    ];
    const gateways: EgressGateway[] = spec.egressGateways || [];
    if (!spec.egressGateway && gateways.length === 0) {
      errors.push({ key: 'Gateway: a gateway node selector is required' });
    }
    if (spec.egressGateway) errors.push(...validateEgressGateway(spec.egressGateway, 'Gateway'));
    gateways.forEach((gateway, i) =>
      errors.push(...validateEgressGateway(gateway, `Gateway #${i + 1}`))
    );
    return errors;
  },

  CiliumLocalRedirectPolicy(spec) {
    const errors: Errors = [];
    const frontend = spec.redirectFrontend || {};
    if (!!frontend.addressMatcher === !!frontend.serviceMatcher) {
      errors.push({ key: 'Choose either an address or a service as the frontend' });
    }
    if (frontend.addressMatcher) {
      if (!isValidIP(frontend.addressMatcher.ip)) {
        errors.push({ key: 'Frontend: a valid IP address is required' });
      }
      errors.push(...validateRedirectPorts(frontend.addressMatcher.toPorts, 'Frontend'));
    }
    if (frontend.serviceMatcher) {
      if (!frontend.serviceMatcher.serviceName)
        errors.push({ key: 'Frontend: a service name is required' });
      if (!frontend.serviceMatcher.namespace)
        errors.push({ key: 'Frontend: the service namespace is required' });
    }
    const backend = spec.redirectBackend || {};
    if (!backend.localEndpointSelector)
      errors.push({ key: 'Backend: an endpoint selector is required' });
    errors.push(...selectorErrors(backend.localEndpointSelector, 'Backend selector'));
    errors.push(...validateRedirectPorts(backend.toPorts, 'Backend'));
    return errors;
  },

  CiliumEnvoyConfig: validateEnvoyConfig,
  CiliumClusterwideEnvoyConfig: validateEnvoyConfig,
};

function validateEnvoyConfig(spec: Spec): Errors {
  const errors: Errors = [];
  const resources: EnvoyResource[] = spec.resources || [];
  if (!resources.length) errors.push({ key: 'Add at least one Envoy resource' });
  resources.forEach((resource, i) => {
    if (!resource || typeof resource !== 'object' || !resource['@type']) {
      errors.push({ key: 'Envoy resource #{{index}} needs an "@type"', params: { index: i + 1 } });
    }
  });
  for (const service of [...(spec.services || []), ...(spec.backendServices || [])]) {
    if (!service?.name) errors.push({ key: 'Every service reference needs a name' });
  }
  errors.push(...selectorErrors(spec.nodeSelector, 'Node selector'));
  return errors;
}

/** Validates a resource being created or edited. Unknown kinds only get the metadata checks. */
export function validateResource(json: KubeJson): ValidationError[] {
  const errors: Errors = [];
  const name = json?.metadata?.name;
  if (!name) errors.push({ key: 'A name is required' });
  else if (!isValidResourceName(name)) {
    errors.push({
      key: 'The name must consist of lower case letters, digits, "-" or ".", and start and end with a letter or digit',
    });
  }
  if (isNamespacedKind(json?.kind)) {
    const namespace = json.metadata?.namespace;
    if (!namespace) errors.push({ key: 'A namespace is required' });
    else if (!DNS_LABEL_RE.test(namespace)) errors.push({ key: 'The namespace name is not valid' });
  }
  if (json?.kind === 'CiliumNetworkPolicy') errors.push(...validatePolicy(json, false));
  else if (json?.kind === 'CiliumClusterwideNetworkPolicy')
    errors.push(...validatePolicy(json, true));
  else {
    const validator = specValidators[json?.kind];
    if (validator) errors.push(...validator(json.spec || {}, json));
  }
  // Identical messages (e.g. the same typo in two rules) are reported once.
  const seen = new Set<string>();
  return errors.filter(e => {
    const id = `${e.key}|${JSON.stringify(e.params || {})}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
