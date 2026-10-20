import type { PluginInfo } from './common/pluginInfo';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: 'inference-hub',
  title: 'Inference Hub',
  product: 'Inference Hub',
  installHint:
    'None of the AI serving APIs (KServe, llm-d, Gateway API Inference Extension, NVIDIA GPU Operator) are served by this cluster.',
};
