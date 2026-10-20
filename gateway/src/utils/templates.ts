/**
 * Starting points for new resources. The defaults are valid, minimal objects that follow the
 * conventions of Envoy Gateway's examples, while staying portable across implementations.
 */
import { KindName } from '../resources/registry';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';

/** `controllerName` of Envoy Gateway, the reference implementation this plugin is tested with. */
export const ENVOY_GATEWAY_CONTROLLER = 'gateway.envoyproxy.io/gatewayclass-controller';

/** Controller names of well-known implementations, offered as suggestions. */
export const KNOWN_CONTROLLERS: Array<{ name: string; label: string }> = [
  { name: ENVOY_GATEWAY_CONTROLLER, label: 'Envoy Gateway' },
  { name: 'istio.io/gateway-controller', label: 'Istio' },
  { name: 'io.cilium/gateway-controller', label: 'Cilium' },
  { name: 'gateway.nginx.org/nginx-gateway-controller', label: 'NGINX Gateway Fabric' },
  { name: 'traefik.io/gateway-controller', label: 'Traefik' },
  { name: 'konghq.com/kic-gateway-controller', label: 'Kong' },
  { name: 'kgateway.dev/kgateway', label: 'kgateway' },
];

/** Friendly name of a controller, when it is a well-known one. */
export function controllerLabel(controllerName?: string): string | undefined {
  return KNOWN_CONTROLLERS.find(c => c.name === controllerName)?.label;
}

export interface TemplateHints {
  /** GatewayClass to preselect for a new Gateway. */
  gatewayClassName?: string;
  /** Parent Gateway to preselect for new routes and ListenerSets. */
  parent?: { name: string; namespace?: string };
}

function specFor(kind: KindName, namespace: string, hints: TemplateHints): Record<string, unknown> {
  const parentRef = hints.parent
    ? {
        name: hints.parent.name,
        ...(hints.parent.namespace && hints.parent.namespace !== namespace
          ? { namespace: hints.parent.namespace }
          : {}),
      }
    : { name: '' };

  switch (kind) {
    case 'GatewayClass':
      return { controllerName: ENVOY_GATEWAY_CONTROLLER };
    case 'Gateway':
      return {
        gatewayClassName: hints.gatewayClassName || '',
        listeners: [
          {
            name: 'http',
            protocol: 'HTTP',
            port: 80,
            allowedRoutes: { namespaces: { from: 'Same' } },
          },
        ],
      };
    case 'ListenerSet':
      return {
        parentRef,
        listeners: [{ name: 'http', protocol: 'HTTP', port: 8080 }],
      };
    case 'HTTPRoute':
      return {
        parentRefs: [parentRef],
        rules: [
          {
            matches: [{ path: { type: 'PathPrefix', value: '/' } }],
            backendRefs: [{ name: '', port: 80 }],
          },
        ],
      };
    case 'GRPCRoute':
      return {
        parentRefs: [parentRef],
        rules: [{ backendRefs: [{ name: '', port: 50051 }] }],
      };
    case 'TLSRoute':
      return {
        parentRefs: [parentRef],
        hostnames: [''],
        rules: [{ backendRefs: [{ name: '', port: 443 }] }],
      };
    case 'TCPRoute':
    case 'UDPRoute':
      return {
        parentRefs: [parentRef],
        rules: [{ backendRefs: [{ name: '', port: kind === 'UDPRoute' ? 53 : 8080 }] }],
      };
    case 'ReferenceGrant':
      return {
        from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: '' }],
        to: [{ group: '', kind: 'Service' }],
      };
    case 'BackendTLSPolicy':
      return {
        targetRefs: [{ group: '', kind: 'Service', name: '' }],
        validation: { hostname: '', wellKnownCACertificates: 'System' },
      };
    default:
      return {};
  }
}

/** Builds a new, minimal resource of the given kind. */
export function newResource(
  kind: KindName,
  apiVersion: string,
  options: { namespace?: string; namespaced: boolean; hints?: TemplateHints }
): KubeJson {
  const namespace = options.namespace || 'default';
  return {
    apiVersion,
    kind,
    metadata: {
      name: '',
      ...(options.namespaced ? { namespace } : {}),
    },
    spec: specFor(kind, namespace, options.hints || {}),
  };
}
