import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'envoy-gateway',
  title: 'Envoy Gateway',
  product: 'Envoy Gateway',
  docsUrl: 'https://gateway.envoyproxy.io/docs/',
  installHint:
    'The API group gateway.envoyproxy.io was not found. Install Envoy Gateway (for example with the gateway-helm chart) to manage its resources here.',
  kindHint:
    'The API group gateway.envoyproxy.io is served, but this resource type is missing. It may be disabled in the Envoy Gateway configuration or require a newer Envoy Gateway version.',
  testedWith: 'Envoy Gateway v1.x',
};
