import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'multi-cluster',
  title: 'Multicluster Hub',
  product: 'Open Cluster Management',
  docsUrl: 'https://open-cluster-management.io/docs/getting-started/quick-start/',
  installHint:
    'No Open Cluster Management hub API was found. Switch to the hub cluster, or install the cluster manager (for example with clusteradm init).',
  testedWith: 'OCM v0.14.0 to v1.3.1',
};
