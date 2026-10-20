import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'monitoring',
  title: 'Monitoring',
  product: 'Prometheus Operator',
  docsUrl: 'https://prometheus-operator.dev/docs/',
  installHint:
    'The API group monitoring.coreos.com was not found. Install the Prometheus Operator, for example with the kube-prometheus-stack Helm chart.',
};
