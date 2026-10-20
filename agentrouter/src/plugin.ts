import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'agentrouter',
  title: 'Agent Router',
  product: 'Agent Router (Envoy AI Gateway)',
  docsUrl: 'https://aigateway.envoyproxy.io/docs',
  installHint:
    'The API group aigateway.envoyproxy.io was not found. Install Agent Router (Envoy AI Gateway) on top of Envoy Gateway to manage its resources here.',
  testedWith: 'Agent Router v1.1.0',
};
