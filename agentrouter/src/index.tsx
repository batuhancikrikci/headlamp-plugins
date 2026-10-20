/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import './common/icons';
import {
  DetailsViewDefaultHeaderActions,
  registerDetailsViewHeaderActionsProcessor,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { registerKindDocs } from './common/docs/kindDocs';
import { withBoundary } from './common/ErrorBoundary';
import {
  AIGatewayRouteCreateWizard,
  AIGatewayRouteEditWizard,
} from './components/aiGatewayRoute/CreateWizard';
import { AIGatewayRouteDetail } from './components/aiGatewayRoute/Detail';
import { AIGatewayRouteList } from './components/aiGatewayRoute/List';
import {
  AIServiceBackendCreateWizard,
  AIServiceBackendEditWizard,
} from './components/aiServiceBackend/CreateWizard';
import { AIServiceBackendDetail } from './components/aiServiceBackend/Detail';
import { AIServiceBackendList } from './components/aiServiceBackend/List';
import {
  BackendSecurityPolicyCreateForm,
  BackendSecurityPolicyEditForm,
} from './components/backendSecurityPolicy/CreateForm';
import { BackendSecurityPolicyDetail } from './components/backendSecurityPolicy/Detail';
import { BackendSecurityPolicyList } from './components/backendSecurityPolicy/List';
import { EditResourceAction, isAIGatewayResource } from './components/common/EditResourceAction';
import { EditWithFormAction, FORM_EDIT_ROUTES } from './components/common/EditWithFormAction';
import { Dashboard } from './components/dashboard/Dashboard';
import { KIND_DOCS } from './components/docs/kindDocs';
import {
  GatewayConfigCreateWizard,
  GatewayConfigEditWizard,
} from './components/gatewayConfig/CreateWizard';
import { GatewayConfigDetail } from './components/gatewayConfig/Detail';
import { GatewayConfigList } from './components/gatewayConfig/List';
import { MCPRouteCreateWizard, MCPRouteEditWizard } from './components/mcpRoute/CreateWizard';
import { MCPRouteDetail } from './components/mcpRoute/Detail';
import { MCPRouteList } from './components/mcpRoute/List';
import {
  QuotaPolicyCreateWizard,
  QuotaPolicyEditWizard,
} from './components/quotaPolicy/CreateWizard';
import { QuotaPolicyDetail } from './components/quotaPolicy/Detail';
import { QuotaPolicyList } from './components/quotaPolicy/List';
import { agentRouterIcon } from './icons/agentRouterIcon';
import { createRoute, detailRoute, editRoute, listRoute, PREFIX, ROUTE_NAMES } from './routes';
import { arrangeEditActions } from './utils/headerActions';

registerKindDocs(KIND_DOCS);

const SIDEBAR_ROOT = 'Agent Router';

type SidebarEntryProps = Parameters<typeof registerSidebarEntry>[0];

const sidebarEntries: SidebarEntryProps[] = [
  {
    parent: '',
    name: SIDEBAR_ROOT,
    label: SIDEBAR_ROOT,
    url: `${PREFIX}/dashboard`,
    icon: agentRouterIcon,
  },
  {
    parent: SIDEBAR_ROOT,
    name: ROUTE_NAMES.overview,
    label: ROUTE_NAMES.overview,
    url: `${PREFIX}/dashboard`,
  },
];

registerRoute({
  path: `${PREFIX}/dashboard`,
  sidebar: ROUTE_NAMES.overview,
  name: ROUTE_NAMES.overview,
  exact: true,
  component: withBoundary(Dashboard),
});

// ─── Helper: Register a CRD with sidebar, list, detail and optional create route ──
function registerCRD(
  sidebarName: string,
  pathSegment: string,
  ListComponent: React.ComponentType,
  DetailComponent: React.ComponentType,
  CreateComponent?: React.ComponentType,
  EditComponent?: React.ComponentType
) {
  sidebarEntries.push({
    parent: SIDEBAR_ROOT,
    name: sidebarName,
    label: sidebarName,
    url: `${PREFIX}/${pathSegment}`,
  });

  registerRoute({
    path: `${PREFIX}/${pathSegment}`,
    sidebar: sidebarName,
    name: listRoute(sidebarName),
    exact: true,
    component: withBoundary(ListComponent),
  });

  if (CreateComponent) {
    registerRoute({
      path: `${PREFIX}/${pathSegment}/create`,
      sidebar: sidebarName,
      name: createRoute(sidebarName),
      exact: true,
      component: withBoundary(CreateComponent),
    });
  }

  if (EditComponent) {
    registerRoute({
      path: `${PREFIX}/${pathSegment}/:namespace/:name/edit`,
      sidebar: sidebarName,
      name: editRoute(sidebarName),
      exact: true,
      component: withBoundary(EditComponent),
    });
  }

  registerRoute({
    path: `${PREFIX}/${pathSegment}/:namespace/:name`,
    sidebar: sidebarName,
    name: detailRoute(sidebarName),
    exact: true,
    component: withBoundary(DetailComponent),
  });
}

// ─── Register All CRDs ──────────────────────────────────────────────────────

// 1. AI Routes (AIGatewayRoute)
registerCRD(
  ROUTE_NAMES.routes,
  'routes',
  AIGatewayRouteList,
  AIGatewayRouteDetail,
  AIGatewayRouteCreateWizard,
  AIGatewayRouteEditWizard
);

// 2. Service Backends (AIServiceBackend)
registerCRD(
  ROUTE_NAMES.backends,
  'backends',
  AIServiceBackendList,
  AIServiceBackendDetail,
  AIServiceBackendCreateWizard,
  AIServiceBackendEditWizard
);

// 3. Security Policies (BackendSecurityPolicy)
registerCRD(
  ROUTE_NAMES.security,
  'security',
  BackendSecurityPolicyList,
  BackendSecurityPolicyDetail,
  BackendSecurityPolicyCreateForm,
  BackendSecurityPolicyEditForm
);

// 4. MCP Routes (MCPRoute)
registerCRD(
  ROUTE_NAMES.mcp,
  'mcp',
  MCPRouteList,
  MCPRouteDetail,
  MCPRouteCreateWizard,
  MCPRouteEditWizard
);

// 5. Quota Policies (QuotaPolicy)
registerCRD(
  ROUTE_NAMES.quotas,
  'quotas',
  QuotaPolicyList,
  QuotaPolicyDetail,
  QuotaPolicyCreateWizard,
  QuotaPolicyEditWizard
);

// 6. Gateway Config (GatewayConfig)
registerCRD(
  ROUTE_NAMES.config,
  'config',
  GatewayConfigList,
  GatewayConfigDetail,
  GatewayConfigCreateWizard,
  GatewayConfigEditWizard
);

sidebarEntries.forEach(entry => registerSidebarEntry(entry));

// ─── Detail view: replace Headlamp's Edit with the editor that has CRD docs ─────
registerDetailsViewHeaderActionsProcessor({
  id: 'agentrouter-edit-with-docs',
  processor: (resource, actions) =>
    isAIGatewayResource(resource)
      ? arrangeEditActions(
          actions,
          {
            edit: DetailsViewDefaultHeaderActions.EDIT,
            delete: DetailsViewDefaultHeaderActions.DELETE,
          },
          {
            id: DetailsViewDefaultHeaderActions.EDIT,
            action: <EditResourceAction resource={resource} />,
          },
          FORM_EDIT_ROUTES[resource.kind]
            ? { id: 'agentrouter-edit-form', action: <EditWithFormAction resource={resource} /> }
            : undefined
        )
      : actions,
});
