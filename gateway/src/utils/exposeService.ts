/**
 * "Expose a Service": turns a few answers (which Service, through which Gateway, under which
 * hostname and path) into the resources that make it reachable: an HTTPRoute, optionally a new
 * Gateway, and the ReferenceGrants needed when namespaces differ.
 */
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import { evaluateAttachment, NamespaceLabels } from './attachment';
import { hostnameError } from './hostnames';
import { asArray, asRecord, asString } from './objects';
import { findGrant, OutgoingRef } from './referenceGrants';
import { isValidPort, ValidationIssue } from './validation';

export interface ExposeDraft {
  service: { namespace: string; name: string; port?: number };
  gatewayMode: 'existing' | 'new';
  /** The Gateway to attach to when `gatewayMode` is `existing`. */
  existing: { name: string; namespace: string; sectionName?: string };
  /** The Gateway to create when `gatewayMode` is `new`. */
  create: {
    name: string;
    namespace: string;
    gatewayClassName: string;
    protocol: 'HTTP' | 'HTTPS';
    port?: number;
    hostname?: string;
    certificateName?: string;
    certificateNamespace?: string;
  };
  route: {
    name: string;
    namespace: string;
    hostnames?: string[];
    pathType: 'PathPrefix' | 'Exact';
    path: string;
  };
}

export function newExposeDraft(namespace = 'default'): ExposeDraft {
  return {
    service: { namespace, name: '' },
    gatewayMode: 'existing',
    existing: { name: '', namespace },
    create: { name: '', namespace, gatewayClassName: '', protocol: 'HTTP', port: 80 },
    route: { name: '', namespace, pathType: 'PathPrefix', path: '/' },
  };
}

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function checkName(issues: ValidationIssue[], value: unknown, path: string, label: string) {
  if (!value) {
    issues.push({ path, message: `${label} is required`, severity: 'error' });
  } else if (typeof value !== 'string' || !DNS_SUBDOMAIN.test(value)) {
    issues.push({
      path,
      message: `${label} must consist of lowercase letters, digits, "-" or "."`,
      severity: 'error',
    });
  }
}

function checkNamespace(issues: ValidationIssue[], value: unknown, path: string) {
  if (!value) {
    issues.push({ path, message: 'Namespace is required', severity: 'error' });
  } else if (typeof value !== 'string' || !DNS_LABEL.test(value)) {
    issues.push({ path, message: 'Namespace must be a valid DNS label', severity: 'error' });
  }
}

/** Validates the answers of the wizard. Paths are relative to the draft (`service.name`, …). */
export function validateExposeDraft(draft: ExposeDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) =>
    issues.push({ path, message, severity: 'error' });

  checkNamespace(issues, draft.service?.namespace, 'service.namespace');
  checkName(issues, draft.service?.name, 'service.name', 'Service');
  if (draft.service?.port === undefined || draft.service.port === null) {
    error('service.port', 'Port is required');
  } else if (!isValidPort(draft.service.port)) {
    error('service.port', 'Port must be a whole number between 1 and 65535');
  }

  if (draft.gatewayMode === 'existing') {
    checkName(issues, draft.existing?.name, 'existing.name', 'Gateway');
    checkNamespace(issues, draft.existing?.namespace, 'existing.namespace');
  } else {
    const gateway = draft.create;
    checkName(issues, gateway?.name, 'create.name', 'Gateway name');
    checkNamespace(issues, gateway?.namespace, 'create.namespace');
    if (!gateway?.gatewayClassName) error('create.gatewayClassName', 'Gateway class is required');
    if (gateway?.port === undefined || gateway.port === null) {
      error('create.port', 'Port is required');
    } else if (!isValidPort(gateway.port)) {
      error('create.port', 'Port must be a whole number between 1 and 65535');
    }
    if (gateway?.hostname) {
      const problem = hostnameError(gateway.hostname, { allowWildcard: true });
      if (problem) error('create.hostname', problem);
    }
    if (gateway?.protocol === 'HTTPS') {
      checkName(issues, gateway.certificateName, 'create.certificateName', 'TLS secret');
      if (gateway.certificateNamespace && !DNS_LABEL.test(gateway.certificateNamespace)) {
        error('create.certificateNamespace', 'Namespace must be a valid DNS label');
      }
    }
  }

  checkName(issues, draft.route?.name, 'route.name', 'Route name');
  checkNamespace(issues, draft.route?.namespace, 'route.namespace');
  const seen = new Set<string>();
  asArray<string>(draft.route?.hostnames).forEach((hostname, index) => {
    const problem = hostnameError(asString(hostname), { allowWildcard: true });
    if (problem) error(`route.hostnames.${index}`, problem);
    else if (seen.has(hostname)) error(`route.hostnames.${index}`, 'Duplicate hostname');
    seen.add(hostname);
  });
  const path = draft.route?.path;
  if (!path) error('route.path', 'Path is required');
  else if (!path.startsWith('/')) error('route.path', 'Path must start with "/"');
  else if (path.includes('//')) error('route.path', 'Path must not contain "//"');

  return issues;
}

export interface ExposeContext {
  apiVersions: { gateway: string; httpRoute: string; referenceGrant: string };
  /** The existing Gateway object, when attaching to one and it is known. */
  existingGateway?: KubeJson;
  /** ReferenceGrants of the cluster, or `null` when unknown. */
  grants: KubeJson[] | null;
  namespaceLabels?: NamespaceLabels;
  /** Whether ReferenceGrant can be created in this cluster. */
  referenceGrantAvailable: boolean;
}

export interface ExposePlan {
  /** Resources to create, in apply order. */
  resources: KubeJson[];
  /** Explanations of what was generated and why. */
  notes: string[];
  /** Things that will keep the Service unreachable unless addressed. */
  warnings: string[];
}

function grantName(prefix: string, kind: string, target: string): string {
  return `${prefix}-${kind}-${target}`
    .toLowerCase()
    .slice(0, 253)
    .replace(/[^a-z0-9]+$/, '');
}

/** Builds the resources that expose the Service described by the draft. */
export function buildExposePlan(draft: ExposeDraft, context: ExposeContext): ExposePlan {
  const resources: KubeJson[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const { service, route } = draft;
  const creating = draft.gatewayMode === 'new';
  const gatewayName = creating ? draft.create.name : draft.existing.name;
  const gatewayNamespace = creating ? draft.create.namespace : draft.existing.namespace;
  const hostnames = asArray<string>(route.hostnames).filter(Boolean);

  // --- Gateway -----------------------------------------------------------------------------
  let gateway: KubeJson | undefined;
  if (creating) {
    const { protocol, hostname, certificateName, certificateNamespace } = draft.create;
    const listenerName = protocol.toLowerCase();
    const sameNamespace = route.namespace === gatewayNamespace;
    const listener: Record<string, unknown> = {
      name: listenerName,
      protocol,
      port: draft.create.port,
      ...(hostname ? { hostname } : {}),
    };
    if (protocol === 'HTTPS') {
      const crossNamespaceCert =
        !!certificateNamespace && certificateNamespace !== gatewayNamespace;
      listener.tls = {
        mode: 'Terminate',
        certificateRefs: [
          {
            name: certificateName || '',
            ...(crossNamespaceCert ? { namespace: certificateNamespace } : {}),
          },
        ],
      };
    }
    listener.allowedRoutes = sameNamespace
      ? { namespaces: { from: 'Same' } }
      : {
          // Least privilege: admit only the namespace of the route, via the label every
          // namespace carries automatically.
          namespaces: {
            from: 'Selector',
            selector: { matchLabels: { 'kubernetes.io/metadata.name': route.namespace } },
          },
        };
    if (!sameNamespace) {
      notes.push(
        `The new listener only admits routes from namespace "${route.namespace}" (namespace selector).`
      );
    }
    gateway = {
      apiVersion: context.apiVersions.gateway,
      kind: 'Gateway',
      metadata: { name: gatewayName, namespace: gatewayNamespace },
      spec: { gatewayClassName: draft.create.gatewayClassName, listeners: [listener] },
    };
    resources.push(gateway);
  } else {
    gateway = context.existingGateway;
  }

  // --- HTTPRoute ---------------------------------------------------------------------------
  const sectionName = creating ? undefined : draft.existing.sectionName || undefined;
  const httpRoute: KubeJson = {
    apiVersion: context.apiVersions.httpRoute,
    kind: 'HTTPRoute',
    metadata: { name: route.name, namespace: route.namespace },
    spec: {
      parentRefs: [
        {
          name: gatewayName,
          ...(gatewayNamespace !== route.namespace ? { namespace: gatewayNamespace } : {}),
          ...(sectionName ? { sectionName } : {}),
        },
      ],
      ...(hostnames.length > 0 ? { hostnames } : {}),
      rules: [
        {
          matches: [{ path: { type: route.pathType, value: route.path } }],
          backendRefs: [
            {
              name: service.name,
              ...(service.namespace !== route.namespace ? { namespace: service.namespace } : {}),
              port: service.port,
            },
          ],
        },
      ],
    },
  };

  // --- ReferenceGrants ---------------------------------------------------------------------
  const requireGrant = (ref: OutgoingRef, name: string, what: string) => {
    const existing = context.grants ? findGrant(ref, context.grants) : undefined;
    if (existing) {
      notes.push(`${what} is already permitted by ReferenceGrant "${existing.metadata?.name}".`);
      return;
    }
    if (!context.referenceGrantAvailable) {
      warnings.push(
        `${what} crosses namespaces, but the ReferenceGrant kind is not installed in this cluster, so it cannot be permitted.`
      );
      return;
    }
    resources.push({
      apiVersion: context.apiVersions.referenceGrant,
      kind: 'ReferenceGrant',
      metadata: { name, namespace: ref.to.namespace },
      spec: {
        from: [{ group: ref.from.group, kind: ref.from.kind, namespace: ref.from.namespace }],
        to: [{ group: ref.to.group, kind: ref.to.kind, name: ref.to.name }],
      },
    });
    notes.push(
      `A ReferenceGrant in "${ref.to.namespace}" lets ${ref.from.kind} resources from "${ref.from.namespace}" reference ${ref.to.kind} "${ref.to.name}".`
    );
  };

  if (creating && draft.create.protocol === 'HTTPS') {
    const certNamespace = draft.create.certificateNamespace || gatewayNamespace;
    if (certNamespace !== gatewayNamespace) {
      requireGrant(
        {
          from: {
            group: GATEWAY_GROUP,
            kind: 'Gateway',
            namespace: gatewayNamespace,
            name: gatewayName,
          },
          to: {
            group: '',
            kind: 'Secret',
            namespace: certNamespace,
            name: draft.create.certificateName || '',
          },
          path: 'spec.listeners.0.tls.certificateRefs.0',
          purpose: 'TLS certificate',
        },
        grantName(gatewayName, 'gateway', draft.create.certificateName || 'secret'),
        `Using TLS secret "${certNamespace}/${draft.create.certificateName}" from the Gateway`
      );
    }
  }

  if (service.namespace !== route.namespace) {
    requireGrant(
      {
        from: {
          group: GATEWAY_GROUP,
          kind: 'HTTPRoute',
          namespace: route.namespace,
          name: route.name,
        },
        to: { group: '', kind: 'Service', namespace: service.namespace, name: service.name },
        path: 'spec.rules.0.backendRefs.0',
        purpose: 'Backend',
      },
      grantName(route.name, 'httproute', service.name),
      `Forwarding to Service "${service.namespace}/${service.name}" from the route`
    );
  }

  resources.push(httpRoute);

  // --- Will the route attach? --------------------------------------------------------------
  if (gateway) {
    const verdict = evaluateAttachment(
      httpRoute,
      { sectionName },
      gateway,
      context.namespaceLabels
    );
    if (verdict.attaches === 'no') {
      const reasons = verdict.listeners
        .map(l => `${l.listener.name}: ${l.reasons.join('; ')}`)
        .join(' · ');
      warnings.push(
        `Gateway "${gatewayNamespace}/${gatewayName}" will not accept this route. ${
          verdict.summary || ''
        }${reasons ? ` (${reasons})` : ''}`
      );
    } else if (verdict.attaches === 'unknown') {
      notes.push(
        'Whether the Gateway accepts the route depends on a namespace selector that could not be evaluated.'
      );
    }
    const protocols = asArray<Record<string, unknown>>(asRecord(gateway.spec).listeners)
      .filter(l => !sectionName || l?.name === sectionName)
      .map(l => asString(l?.protocol));
    if (protocols.length > 0 && !protocols.some(p => p === 'HTTP' || p === 'HTTPS')) {
      warnings.push(
        'The selected listener does not serve HTTP, so an HTTPRoute cannot attach to it.'
      );
    }
  } else if (!creating) {
    notes.push(
      `Gateway "${gatewayNamespace}/${gatewayName}" could not be inspected; the route attaches only if its listeners allow routes from "${route.namespace}".`
    );
  }

  return { resources, notes, warnings };
}

/** URLs under which the Service becomes reachable, for the summary. */
export function exposedUrls(draft: ExposeDraft, gateway?: KubeJson): string[] {
  const hostnames = asArray<string>(draft.route.hostnames).filter(Boolean);
  const creating = draft.gatewayMode === 'new';
  const listeners = creating
    ? [
        {
          protocol: draft.create.protocol,
          port: draft.create.port,
          hostname: draft.create.hostname,
        },
      ]
    : asArray<Record<string, unknown>>(asRecord(gateway?.spec).listeners).filter(
        l =>
          (!draft.existing.sectionName || l?.name === draft.existing.sectionName) &&
          (l?.protocol === 'HTTP' || l?.protocol === 'HTTPS')
      );
  const addresses = asArray<{ value?: string }>(asRecord(gateway?.status).addresses)
    .map(a => a?.value)
    .filter(Boolean) as string[];

  const urls = new Set<string>();
  for (const listener of listeners) {
    const scheme = listener.protocol === 'HTTPS' ? 'https' : 'http';
    const port = Number(listener.port);
    const defaultPort = scheme === 'https' ? 443 : 80;
    const portText = port && port !== defaultPort ? `:${port}` : '';
    const hosts =
      hostnames.length > 0
        ? hostnames
        : listener.hostname
        ? [asString(listener.hostname)]
        : addresses.length > 0
        ? addresses
        : ['<gateway-address>'];
    for (const host of hosts) {
      urls.add(`${scheme}://${host}${portText}${draft.route.path}`);
    }
  }
  return [...urls];
}

/**
 * Keeps the fields that default to the Service in step with it: the route takes the name and
 * namespace of the Service, and a new Gateway its namespace, until the user changes them.
 */
export function followService(previous: ExposeDraft, next: ExposeDraft): ExposeDraft {
  let result = next;
  const follows = (current: string, before: string) => current === '' || current === before;

  if (previous.service.name !== next.service.name) {
    if (follows(next.route.name, previous.service.name)) {
      result = { ...result, route: { ...result.route, name: next.service.name } };
    }
  }
  if (previous.service.namespace !== next.service.namespace) {
    const before = previous.service.namespace;
    const namespace = next.service.namespace;
    if (follows(next.route.namespace, before)) {
      result = { ...result, route: { ...result.route, namespace } };
    }
    if (follows(next.create.namespace, before)) {
      result = { ...result, create: { ...result.create, namespace } };
    }
    if (next.existing.name === '' && follows(next.existing.namespace, before)) {
      result = { ...result, existing: { ...result.existing, namespace } };
    }
  }
  return result;
}
