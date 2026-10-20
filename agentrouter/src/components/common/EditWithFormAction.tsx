import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  AuthVisible,
  Loader,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { editRoute, ROUTE_NAMES } from '../../routes';

/** Sidebar/route name per kind for resources that can be edited with the form. */
export const FORM_EDIT_ROUTES: Record<string, string> = {
  AIGatewayRoute: ROUTE_NAMES.routes,
  AIServiceBackend: ROUTE_NAMES.backends,
  BackendSecurityPolicy: ROUTE_NAMES.security,
  MCPRoute: ROUTE_NAMES.mcp,
  QuotaPolicy: ROUTE_NAMES.quotas,
  GatewayConfig: ROUTE_NAMES.config,
};

/** Detail-view header action that opens the resource's form in edit mode. */
export function EditWithFormAction({ resource }: { resource: KubeObject }) {
  const history = useHistory();
  const sidebar = FORM_EDIT_ROUTES[resource.kind];
  if (!sidebar) return null;
  return (
    <AuthVisible item={resource} authVerb="update">
      <ActionButton
        description="Edit with form"
        icon="mdi:form-select"
        onClick={() =>
          history.push(
            Router.createRouteURL(editRoute(sidebar), {
              namespace: resource.metadata.namespace || '',
              name: resource.metadata.name,
            })
          )
        }
      />
    </AuthVisible>
  );
}

/**
 * Loads the object named in the edit route (/:namespace/:name/edit) and renders the
 * editor once it is available.
 */
export function EditObjectLoader<T extends KubeObject>({
  resourceClass,
  title,
  children,
}: {
  resourceClass: KubeObjectClass;
  title: string;
  children: (object: T) => React.ReactNode;
}) {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [object, error] = resourceClass.useGet(name, namespace) as [T | null, Error | null];
  if (error) {
    return (
      <SectionBox title={title}>
        <Alert severity="error">
          Could not load {namespace}/{name}: {error.message}
        </Alert>
      </SectionBox>
    );
  }
  if (!object) return <Loader title={`Loading ${namespace}/${name}`} />;
  return <>{children(object)}</>;
}

/** Deep copy of an object's JSON without status and managedFields, ready for an update. */
export function editableJson<T>(object: KubeObject): T {
  const copy = JSON.parse(JSON.stringify(object.jsonData));
  delete copy.status;
  delete copy.metadata?.managedFields;
  return copy as T;
}
