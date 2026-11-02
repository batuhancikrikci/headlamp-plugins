import { Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Link, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Discovery, isServed, locationsOf } from '../../api/discovery';
import { t } from '../../common/i18n';
import { GuardedButton } from '../../components/common/GuardedButton';
import { useResourceList } from '../../hooks/useLive';
import { routesUsingEndpoint, RouteUse } from '../../resources/agentRouter';
import { ModelEndpoint } from '../../resources/endpoint';
import { KubeJson } from '../../resources/types';
import { PublishDialog } from './PublishDialog';

/** Detail route of the Agent Router plugin; empty when that plugin is not installed. */
function agentRouterRouteUrl(route: KubeJson): string {
  try {
    return Router.createRouteURL('AI Routes Detail', {
      namespace: route.metadata.namespace || '',
      name: route.metadata.name,
    });
  } catch {
    return '';
  }
}

/** AIGatewayRoutes that send traffic to the endpoint; empty when Agent Router is not installed. */
export function useAgentRouterUses(endpoint: ModelEndpoint, served: boolean): RouteUse[] {
  const routes = useResourceList<KubeJson>('aigatewayroutes', served ? {} : null);
  const backends = useResourceList<KubeJson>(
    'aiservicebackends',
    served ? { namespace: endpoint.namespace } : null
  );
  return React.useMemo(
    () => (served ? routesUsingEndpoint(routes.items, endpoint.raw, backends.items) : []),
    [served, routes.items, backends.items, endpoint.raw]
  );
}

/** "Agent Router" section of an endpoint: the routes that publish it, and publishing it. */
export function AgentRouterSection({
  endpoint,
  discovery,
}: {
  endpoint: ModelEndpoint;
  discovery: Discovery;
}) {
  const history = useHistory();
  const served = isServed(discovery, 'aigatewayroutes');
  const uses = useAgentRouterUses(endpoint, served);
  const [open, setOpen] = React.useState(false);
  if (!served) return null;
  const group = locationsOf(discovery, 'aigatewayroutes')[0]?.group || 'aigateway.envoyproxy.io';

  return (
    <SectionBox
      title={t('Agent Router')}
      headerProps={{
        titleSideActions: [
          <GuardedButton
            key="publish"
            check={{
              verb: 'create',
              group,
              resource: 'aigatewayroutes',
              namespace: endpoint.namespace,
            }}
            label={t('Publish to Agent Router')}
            icon="mdi:router-network"
            variant="outlined"
            size="small"
            disabled={endpoint.status.health === 'stopped'}
            onClick={() => setOpen(true)}
          />,
        ],
      }}
    >
      {uses.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t(
            'No AI route sends requests to this endpoint. Publishing it adds a rule for its model name to an AIGatewayRoute, so clients reach it through Agent Router with its credentials, quotas and fallbacks.'
          )}
        </Typography>
      ) : (
        <SimpleTable
          data={uses}
          columns={[
            {
              label: t('AIGatewayRoute'),
              getter: (use: RouteUse) => {
                const label = `${use.route.metadata.namespace}/${use.route.metadata.name}`;
                const url = agentRouterRouteUrl(use.route);
                return url ? (
                  <Link component="button" onClick={() => history.push(url)}>
                    {label}
                  </Link>
                ) : (
                  label
                );
              },
            },
            {
              label: t('Model names'),
              getter: (use: RouteUse) => use.models.join(', ') || t('(all requests)'),
            },
          ]}
        />
      )}
      {open && (
        <PublishDialog
          open={open}
          onClose={() => setOpen(false)}
          endpoint={endpoint}
          discovery={discovery}
        />
      )}
    </SectionBox>
  );
}
