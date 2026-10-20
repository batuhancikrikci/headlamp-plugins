/** URL prefix and route names shared by index.tsx, the CRD classes and components. */
export const PREFIX = '/agent-router';

export const ROUTE_NAMES = {
  overview: 'Overview',
  routes: 'AI Routes',
  backends: 'Service Backends',
  security: 'Security Policies',
  mcp: 'MCP Routes',
  quotas: 'Quota Policies',
  config: 'Gateway Config',
} as const;

export const listRoute = (sidebarName: string) => `${sidebarName} List`;
export const detailRoute = (sidebarName: string) => `${sidebarName} Detail`;
export const createRoute = (sidebarName: string) => `${sidebarName} Create`;
export const editRoute = (sidebarName: string) => `${sidebarName} Edit`;
