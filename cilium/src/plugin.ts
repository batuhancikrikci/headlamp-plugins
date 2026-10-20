import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'cilium',
  title: 'Cilium',
  product: 'Cilium',
  docsUrl: 'https://docs.cilium.io/en/stable/',
  installHint:
    'The API group cilium.io was not found. This plugin manages clusters that use Cilium as their CNI.',
  kindHint:
    'The API group cilium.io is served, but this resource type is missing. Cilium registers some CRDs only when the related feature is enabled (for example BGP control plane, L2 announcements, egress gateway or multi-pool IPAM).',
  testedWith: 'Cilium 1.20',
};
