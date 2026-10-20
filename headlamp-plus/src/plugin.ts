import type { PluginInfo } from './common/pluginInfo';
import { PLUGIN_NAME, PRODUCT_NAME } from './config';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: PLUGIN_NAME,
  title: PRODUCT_NAME,
  product: 'Headlamp',
};
