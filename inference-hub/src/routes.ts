/** URLs and route names of Inference Hub pages. */
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { EndpointSlug } from './resources/endpoint';

export const URL_PREFIX = '/inference-hub';
export const SIDEBAR_ROOT = 'inference-hub';

export const PAGES = {
  commandCenter: { name: 'inference-hub-command-center', path: `${URL_PREFIX}/command-center` },
  catalog: { name: 'inference-hub-catalog', path: `${URL_PREFIX}/catalog` },
  storage: { name: 'inference-hub-storage', path: `${URL_PREFIX}/model-storage` },
  endpoints: { name: 'inference-hub-endpoints', path: `${URL_PREFIX}/endpoints` },
  gateway: { name: 'inference-hub-gateway', path: `${URL_PREFIX}/inference-gateway` },
  playground: { name: 'inference-hub-playground', path: `${URL_PREFIX}/playground` },
  profiles: { name: 'inference-hub-profiles', path: `${URL_PREFIX}/serving-profiles` },
  engines: { name: 'inference-hub-engines', path: `${URL_PREFIX}/vllm-engines` },
  gpuFleet: { name: 'inference-hub-gpu-fleet', path: `${URL_PREFIX}/gpu-fleet` },
  settings: { name: 'inference-hub-settings', path: `${URL_PREFIX}/settings` },
} as const;

/** Detail routes; they highlight the sidebar entry of their list page. */
export const DETAIL_PAGES = {
  endpoint: {
    name: 'inference-hub-endpoint',
    path: `${URL_PREFIX}/endpoints/:slug/:namespace/:name`,
    sidebar: PAGES.endpoints.name,
  },
  catalogEntry: {
    name: 'inference-hub-catalog-entry',
    path: `${URL_PREFIX}/catalog/:name`,
    sidebar: PAGES.catalog.name,
  },
  deploy: {
    name: 'inference-hub-deploy',
    path: `${URL_PREFIX}/deploy`,
    sidebar: PAGES.endpoints.name,
  },
  profile: {
    name: 'inference-hub-profile',
    path: `${URL_PREFIX}/serving-profiles/:namespace/:name`,
    sidebar: PAGES.profiles.name,
  },
} as const;

export function endpointUrl(slug: EndpointSlug, namespace: string, name: string, tab?: string) {
  const url = Router.createRouteURL(DETAIL_PAGES.endpoint.name, { slug, namespace, name });
  return tab ? `${url}?tab=${tab}` : url;
}

export function playgroundUrl(targetId: string) {
  return `${Router.createRouteURL(PAGES.playground.name)}?target=${encodeURIComponent(targetId)}`;
}

/** Deploy wizard, optionally preselecting a catalog entry (LocalModelCache) or a model URI. */
export function deployUrl(opts: { cache?: string; uri?: string; namespace?: string } = {}) {
  const params = new URLSearchParams();
  Object.entries(opts).forEach(([k, v]) => v && params.set(k, v));
  const q = params.toString();
  return `${Router.createRouteURL(DETAIL_PAGES.deploy.name)}${q ? `?${q}` : ''}`;
}
