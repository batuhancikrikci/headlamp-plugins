/**
 * Headlamp resource classes for every Gateway API kind, derived from the kind registry.
 *
 * `apiVersion` starts as the list of versions known for the kind (Headlamp probes them in order)
 * and is narrowed to the version actually served once discovery has run for the cluster, see
 * `discovery/discovery.ts`.
 */
import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { kindInfo, KindName, KINDS } from './registry';
import {
  BackendTLSPolicyValidation,
  GatewayStatusAddress,
  GRPCRouteRule,
  HTTPRouteRule,
  KubeBackendTLSPolicy,
  KubeGateway,
  KubeGatewayClass,
  KubeGRPCRoute,
  KubeHTTPRoute,
  KubeJson,
  KubeListenerSet,
  KubeReferenceGrant,
  KubeTCPRoute,
  KubeTLSRoute,
  KubeUDPRoute,
  L4RouteRule,
  Listener,
  ListenerStatus,
  LocalPolicyTargetReference,
  ParentReference,
  ReferenceGrantFrom,
  ReferenceGrantTo,
  RouteParentStatus,
} from './types';

type WithSpecAndStatus = KubeObjectInterface & { spec?: unknown; status?: unknown };

/** Base class: typed `spec` / `status` accessors and route names owned by this plugin. */
export class GatewayApiObject<
  T extends WithSpecAndStatus = WithSpecAndStatus
> extends KubeObject<T> {
  static isNamespaced = true;
  /** Human readable singular / plural names; also used as route names. */
  static label = '';
  static labelPlural = '';

  /**
   * Route name of the detail page. It must differ from the kind: Headlamp only treats a class as
   * having its own detail page (instead of opening its built-in one in the details drawer) when
   * `detailsRoute` is not the kind.
   */
  static get detailsRoute(): string {
    return `${this.label || this.kind} Details`;
  }

  static get listRoute(): string {
    return this.labelPlural || this.apiName;
  }

  static get pluralName(): string {
    return this.apiName;
  }

  get spec(): T['spec'] {
    return this.jsonData.spec;
  }

  get status(): T['status'] {
    return this.jsonData.status;
  }

  /** The object as loosely typed JSON, the shape the relationship and validation helpers take. */
  get json(): KubeJson {
    return this.jsonData as unknown as KubeJson;
  }
}

/** Creates the base class of one kind, with its static metadata taken from the registry. */
function define<T extends WithSpecAndStatus>(kind: KindName) {
  const info = kindInfo(kind);
  return class extends GatewayApiObject<T> {
    static kind = info.kind as string;
    static apiName = info.plural;
    static apiVersion: string | string[] = info.knownVersions.map(v => `${info.group}/${v}`);
    static isNamespaced = info.namespaced;
    static label = info.label;
    static labelPlural = info.labelPlural;
  };
}

// The accessors below mirror those of Headlamp's built-in Gateway API classes. Both sets of
// classes read the same objects through the same query cache, so a built-in view (for example
// the details drawer or the resource map) can be handed an instance of one of these classes and
// must find the members it expects.

export class GatewayClass extends define<KubeGatewayClass>('GatewayClass') {
  get controllerName(): string {
    return this.jsonData.spec?.controllerName;
  }
}

export class Gateway extends define<KubeGateway>('Gateway') {
  getListeners(): Listener[] {
    return this.jsonData.spec?.listeners ?? [];
  }

  getAddresses(): GatewayStatusAddress[] {
    return this.jsonData.status?.addresses ?? [];
  }

  getListenerStatusByName(name: string): ListenerStatus | null {
    return this.jsonData.status?.listeners?.find(listener => listener.name === name) ?? null;
  }
}

export class ListenerSet extends define<KubeListenerSet>('ListenerSet') {}

export class HTTPRoute extends define<KubeHTTPRoute>('HTTPRoute') {
  get hostnames(): string[] {
    return this.jsonData.spec?.hostnames || [];
  }

  get rules(): HTTPRouteRule[] {
    return this.jsonData.spec?.rules || [];
  }

  get parentRefs(): ParentReference[] {
    return this.jsonData.spec?.parentRefs || [];
  }
}

export class GRPCRoute extends define<KubeGRPCRoute>('GRPCRoute') {
  get hostnames(): string[] {
    return this.jsonData.spec?.hostnames || [];
  }

  get rules(): GRPCRouteRule[] {
    return this.jsonData.spec?.rules || [];
  }

  get parentRefs(): ParentReference[] {
    return this.jsonData.spec?.parentRefs || [];
  }
}

/** Base of the route kinds without L7 matching: a single list of backends per rule. */
function defineL4Route<T extends KubeTLSRoute | KubeTCPRoute | KubeUDPRoute>(kind: KindName) {
  return class extends define<T>(kind) {
    get rules(): L4RouteRule[] {
      return this.jsonData.spec?.rules || [];
    }

    get parentRefs(): ParentReference[] {
      return this.jsonData.spec?.parentRefs || [];
    }

    get parents(): RouteParentStatus[] {
      return this.jsonData.status?.parents || [];
    }
  };
}

export class TLSRoute extends defineL4Route<KubeTLSRoute>('TLSRoute') {}
export class TCPRoute extends defineL4Route<KubeTCPRoute>('TCPRoute') {}
export class UDPRoute extends defineL4Route<KubeUDPRoute>('UDPRoute') {}

export class ReferenceGrant extends define<KubeReferenceGrant>('ReferenceGrant') {
  get from(): ReferenceGrantFrom[] {
    return this.jsonData.spec?.from || [];
  }

  get to(): ReferenceGrantTo[] {
    return this.jsonData.spec?.to || [];
  }
}

export class BackendTLSPolicy extends define<KubeBackendTLSPolicy>('BackendTLSPolicy') {
  get targetRefs(): LocalPolicyTargetReference[] {
    return this.jsonData.spec?.targetRefs ?? [];
  }

  get validation(): BackendTLSPolicyValidation {
    return this.jsonData.spec?.validation ?? { caCertificateRefs: [], hostname: '' };
  }
}

/** Any route class instance. */
export type AnyRoute = HTTPRoute | GRPCRoute | TLSRoute | TCPRoute | UDPRoute;

export type GatewayApiClass = typeof GatewayApiObject & {
  kind: string;
  apiName: string;
  apiVersion: string | string[];
};

export const CLASSES: Record<KindName, GatewayApiClass> = {
  GatewayClass: GatewayClass as GatewayApiClass,
  Gateway: Gateway as GatewayApiClass,
  ListenerSet: ListenerSet as GatewayApiClass,
  HTTPRoute: HTTPRoute as GatewayApiClass,
  GRPCRoute: GRPCRoute as GatewayApiClass,
  TLSRoute: TLSRoute as GatewayApiClass,
  TCPRoute: TCPRoute as GatewayApiClass,
  UDPRoute: UDPRoute as GatewayApiClass,
  ReferenceGrant: ReferenceGrant as GatewayApiClass,
  BackendTLSPolicy: BackendTLSPolicy as GatewayApiClass,
};

/**
 * Returns the object as an instance of this plugin's class of its kind.
 *
 * Headlamp's built-in Gateway API classes share the query cache with the classes above, so a list
 * or a detail page can receive an instance of the built-in class, which lacks the accessors the
 * views of this plugin use. Such instances are re-wrapped; everything else is returned as is.
 */
export function ensureInstance<T extends GatewayApiObject>(kind: KindName, item: KubeObject): T {
  const cls = CLASSES[kind];
  if (item instanceof cls) return item as unknown as T;
  const Constructor = cls as unknown as new (json: unknown, cluster?: string) => T;
  return new Constructor(item.jsonData, item.cluster);
}

export function classOf(kind: KindName): GatewayApiClass {
  return CLASSES[kind];
}

/** Sets the API version(s) every class of the given kinds reads and writes. */
export function setApiVersions(versions: Partial<Record<KindName, string>>): void {
  for (const info of KINDS) {
    CLASSES[info.kind].apiVersion =
      versions[info.kind] || info.knownVersions.map(v => `${info.group}/${v}`);
  }
}
