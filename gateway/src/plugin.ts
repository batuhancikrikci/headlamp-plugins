import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'gateway',
  title: 'Gateway API',
  product: 'Gateway API',
  installHint:
    'No resources of the API group gateway.networking.k8s.io are served. Install the Gateway API CRDs and a controller that implements them.',
  testedWith: 'Gateway API v1.6.1 (Envoy Gateway v1.9)',
};
