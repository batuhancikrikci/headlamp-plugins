/** List and detail pages of GatewayClass, Gateway and ListenerSet. */
import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Chip, Stack, Typography } from '@mui/material';
import React from 'react';
import { GatewayApiDataValue } from '../../data/GatewayApiData';
import { Gateway, GatewayClass, ListenerSet } from '../../resources/classes';
import { KindName, ROUTE_KINDS } from '../../resources/registry';
import {
  GATEWAY_GROUP,
  GatewayStatusAddress,
  KubeGateway,
  KubeJson,
  KubeListenerSet,
  RouteParentStatus,
  SupportedFeature,
} from '../../resources/types';
import {
  evaluateAttachment,
  listenerSetAllowed,
  parentRefsFor,
  routesForParent,
  Tristate,
} from '../../utils/attachment';
import { computeHealth, conditionsHealth } from '../../utils/conditions';
import { asArray, asRecord } from '../../utils/objects';
import { checkReferences } from '../../utils/referenceGrants';
import { parentStatusFor, resolveParentRef } from '../../utils/refs';
import { RefLink } from '../common/RefLink';
import {
  attachedRouteCount,
  Hostnames,
  KeyValueChips,
  ListenerChips,
  ListenersTable,
  listenersText,
} from '../common/Renderers';
import { Dash, HealthChip } from '../common/Status';
import { ControllerName } from '../common/StatusSections';
import { KindDetailView, KindListView } from '../common/Views';
import { CreateMenu } from '../editor/EditActions';

const GATEWAY_RELATED: KindName[] = [
  'GatewayClass',
  'ListenerSet',
  'ReferenceGrant',
  ...ROUTE_KINDS,
];

function addressesText(addresses?: GatewayStatusAddress[]): string {
  return asArray<GatewayStatusAddress>(addresses)
    .map(address => address?.value)
    .filter(Boolean)
    .join(', ');
}

function gatewaysOfClass(className: string | undefined, data: GatewayApiDataValue): KubeJson[] {
  return (data.json('Gateway') || []).filter(
    gateway => asRecord(gateway.spec).gatewayClassName === className
  );
}

// ---------------------------------------------------------------------------------------------
// GatewayClass
// ---------------------------------------------------------------------------------------------

export function GatewayClassList() {
  return (
    <KindListView<GatewayClass>
      kind="GatewayClass"
      related={['Gateway']}
      columns={data => [
        {
          id: 'controller',
          label: 'Controller',
          gridTemplate: 2,
          getValue: item => item.spec?.controllerName,
          render: item => <ControllerName name={item.spec?.controllerName} />,
        },
        {
          id: 'description',
          label: 'Description',
          getValue: item => item.spec?.description || '',
        },
        {
          id: 'gateways',
          label: 'Gateways',
          getValue: item => gatewaysOfClass(item.metadata.name, data).length,
        },
      ]}
    />
  );
}

function featureName(feature: SupportedFeature | string): string {
  return typeof feature === 'string' ? feature : feature?.name;
}

export function SupportedFeatures({ features }: { features?: Array<SupportedFeature | string> }) {
  const names = asArray<SupportedFeature | string>(features)
    .map(featureName)
    .filter(Boolean)
    .sort();
  return (
    <SectionBox title={`Supported features (${names.length})`}>
      {names.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          The controller has not reported the Gateway API features it supports.
        </Typography>
      ) : (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ py: 1 }}>
          {names.map(name => (
            <Chip key={name} size="small" variant="outlined" label={name} />
          ))}
        </Stack>
      )}
    </SectionBox>
  );
}

function GatewaysTable({ gateways, loading }: { gateways: KubeJson[]; loading: boolean }) {
  return (
    <SimpleTable
      data={loading ? null : gateways}
      emptyMessage="No Gateways use this class yet."
      columns={[
        {
          label: 'Name',
          getter: (gateway: KubeJson) => (
            <RefLink
              target={{
                group: GATEWAY_GROUP,
                kind: 'Gateway',
                namespace: gateway.metadata?.namespace,
                name: gateway.metadata?.name || '',
              }}
              fromNamespace={gateway.metadata?.namespace}
            />
          ),
        },
        { label: 'Namespace', getter: (gateway: KubeJson) => gateway.metadata?.namespace },
        {
          label: 'Listeners',
          getter: (gateway: KubeJson) => (
            <ListenerChips listeners={(gateway as unknown as KubeGateway).spec?.listeners} />
          ),
        },
        {
          label: 'Addresses',
          getter: (gateway: KubeJson) =>
            addressesText((gateway as unknown as KubeGateway).status?.addresses) || <Dash />,
        },
        {
          label: 'Status',
          getter: (gateway: KubeJson) => <HealthChip health={computeHealth(gateway)} />,
        },
      ]}
    />
  );
}

export function GatewayClassDetail() {
  return (
    <KindDetailView<GatewayClass>
      kind="GatewayClass"
      related={['Gateway']}
      extraInfo={item => [
        { name: 'Controller', value: <ControllerName name={item.spec?.controllerName} /> },
        { name: 'Description', value: item.spec?.description || <Dash /> },
        {
          name: 'Parameters',
          value: item.spec?.parametersRef ? (
            <RefLink target={item.spec.parametersRef} showKind />
          ) : (
            <Dash />
          ),
        },
      ]}
      sections={(item, data) => [
        {
          id: 'gwapi-class-gateways',
          section: (
            <SectionBox
              title="Gateways"
              headerProps={{
                actions: [
                  <CreateMenu
                    key="create"
                    kind="Gateway"
                    hints={{ gatewayClassName: item.metadata.name }}
                    label="Create Gateway"
                  />,
                ],
              }}
            >
              <GatewaysTable
                gateways={gatewaysOfClass(item.metadata.name, data)}
                loading={data.list('Gateway') === null}
              />
            </SectionBox>
          ),
        },
        {
          id: 'gwapi-class-features',
          section: <SupportedFeatures features={item.status?.supportedFeatures} />,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------------------------

export function GatewayList() {
  return (
    <KindListView<Gateway>
      kind="Gateway"
      columns={() => [
        {
          id: 'class',
          label: 'Class',
          getValue: item => item.spec?.gatewayClassName,
          render: item =>
            item.spec?.gatewayClassName ? (
              <RefLink
                target={{
                  group: GATEWAY_GROUP,
                  kind: 'GatewayClass',
                  name: item.spec.gatewayClassName,
                }}
              />
            ) : (
              <Dash />
            ),
        },
        {
          id: 'addresses',
          label: 'Addresses',
          getValue: item => addressesText(item.status?.addresses),
          render: item => addressesText(item.status?.addresses) || <Dash />,
        },
        {
          id: 'listeners',
          label: 'Listeners',
          gridTemplate: 1.5,
          getValue: item => listenersText(item.spec?.listeners),
          render: item => <ListenerChips listeners={item.spec?.listeners} />,
        },
        {
          id: 'routes',
          label: 'Attached routes',
          getValue: item => attachedRouteCount(item.json) ?? 0,
        },
      ]}
    />
  );
}

const TRISTATE_LABEL: Record<Tristate, string> = {
  yes: 'Allowed',
  no: 'Not allowed',
  unknown: 'Unknown',
};

/** Routes that reference a Gateway or ListenerSet, with what the spec and the controller say. */
function AttachedRoutesSection({ parent, data }: { parent: KubeJson; data: GatewayApiDataValue }) {
  const routes = routesForParent(data.routes, parent);
  const rows = routes.flatMap(route => parentRefsFor(route, parent).map(ref => ({ route, ref })));
  type Row = (typeof rows)[number];
  const loading = ROUTE_KINDS.some(kind => data.kinds.includes(kind) && data.list(kind) === null);

  return (
    <SectionBox
      title={`Routes (${routes.length})`}
      headerProps={{
        actions: [
          <CreateMenu
            key="create"
            kind="HTTPRoute"
            hints={{
              parent: {
                name: parent.metadata?.name || '',
                namespace: parent.metadata?.namespace,
              },
            }}
            label="Create HTTPRoute"
          />,
        ],
      }}
    >
      <SimpleTable
        data={loading ? null : rows}
        emptyMessage="No routes reference this resource."
        columns={[
          { label: 'Kind', getter: (row: Row) => row.route.kind },
          {
            label: 'Route',
            gridTemplate: 1.5,
            getter: (row: Row) => (
              <RefLink
                target={{
                  group: GATEWAY_GROUP,
                  kind: row.route.kind || '',
                  namespace: row.route.metadata?.namespace,
                  name: row.route.metadata?.name || '',
                }}
                fromNamespace={parent.metadata?.namespace}
              />
            ),
          },
          {
            label: 'Listener',
            getter: (row: Row) =>
              row.ref.sectionName || (row.ref.port !== undefined ? `:${row.ref.port}` : 'All'),
          },
          {
            label: 'Hostnames',
            gridTemplate: 1.5,
            getter: (row: Row) => (
              <Hostnames hostnames={asRecord(row.route.spec).hostnames as string[] | undefined} />
            ),
          },
          {
            label: 'Allowed by listeners',
            getter: (row: Row) =>
              TRISTATE_LABEL[
                evaluateAttachment(row.route, row.ref, parent, data.namespaceLabels).attaches
              ],
          },
          {
            label: 'Status',
            getter: (row: Row) => {
              const status = parentStatusFor<RouteParentStatus>(row.route, row.ref);
              return status ? (
                <HealthChip
                  health={conditionsHealth(
                    status.conditions,
                    ['Accepted', 'ResolvedRefs'],
                    row.route.metadata?.generation
                  )}
                />
              ) : (
                <Typography component="span" variant="body2" color="text.secondary">
                  Not reported
                </Typography>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}

function ListenerSetsSection({ gateway, data }: { gateway: KubeJson; data: GatewayApiDataValue }) {
  const sets = (data.json('ListenerSet') || []).filter(set => {
    const ref = resolveParentRef(
      asRecord(set.spec).parentRef as { name: string },
      set.metadata?.namespace
    );
    return ref.name === gateway.metadata?.name && ref.namespace === gateway.metadata?.namespace;
  });
  const allowedFrom =
    asRecord<{ namespaces?: { from?: string } }>(asRecord(gateway.spec).allowedListeners).namespaces
      ?.from ?? 'None';
  if (sets.length === 0 && allowedFrom === 'None') return null;

  return (
    <SectionBox title={`Listener sets (${sets.length})`}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        This Gateway accepts ListenerSets from:{' '}
        {allowedFrom === 'Same' ? 'its own namespace' : allowedFrom}.
      </Typography>
      <SimpleTable
        data={sets}
        emptyMessage="No ListenerSets are attached to this Gateway."
        columns={[
          {
            label: 'Name',
            getter: (set: KubeJson) => (
              <RefLink
                target={{
                  group: (set.apiVersion || '').split('/')[0],
                  kind: set.kind || 'ListenerSet',
                  namespace: set.metadata?.namespace,
                  name: set.metadata?.name || '',
                }}
                fromNamespace={gateway.metadata?.namespace}
              />
            ),
          },
          {
            label: 'Listeners',
            getter: (set: KubeJson) => (
              <ListenerChips listeners={(set as unknown as KubeListenerSet).spec?.listeners} />
            ),
          },
          {
            label: 'Allowed by Gateway',
            getter: (set: KubeJson) =>
              TRISTATE_LABEL[
                listenerSetAllowed(gateway, set.metadata?.namespace, data.namespaceLabels)
              ],
          },
          {
            label: 'Status',
            getter: (set: KubeJson) => <HealthChip health={computeHealth(set)} />,
          },
        ]}
      />
    </SectionBox>
  );
}

function GatewayExtras({ gateway }: { gateway: KubeGateway }) {
  const { infrastructure, addresses, tls } = gateway.spec || {};
  const requested = asArray<{ type?: string; value?: string }>(addresses);
  if (!infrastructure && requested.length === 0 && !tls) return null;
  const namespace = gateway.metadata?.namespace;
  const clientCertificate = tls?.backend?.clientCertificateRef;
  const frontendMode = tls?.frontend?.default?.validation?.mode;

  return (
    <SectionBox title="Infrastructure and TLS">
      <NameValueTable
        rows={[
          {
            name: 'Requested addresses',
            value: requested
              .map(a => `${a.value || '(any)'} (${a.type || 'IPAddress'})`)
              .join(', '),
            hide: requested.length === 0,
          },
          {
            name: 'Infrastructure labels',
            value: <KeyValueChips values={infrastructure?.labels} />,
            hide: !infrastructure?.labels,
          },
          {
            name: 'Infrastructure annotations',
            value: <KeyValueChips values={infrastructure?.annotations} />,
            hide: !infrastructure?.annotations,
          },
          {
            name: 'Infrastructure parameters',
            value: infrastructure?.parametersRef ? (
              <RefLink target={{ ...infrastructure.parametersRef, namespace }} showKind />
            ) : null,
            hide: !infrastructure?.parametersRef,
          },
          {
            name: 'Backend client certificate',
            value: clientCertificate ? (
              <RefLink
                target={{
                  group: clientCertificate.group ?? '',
                  kind: clientCertificate.kind ?? 'Secret',
                  namespace: clientCertificate.namespace || namespace,
                  name: clientCertificate.name,
                }}
                fromNamespace={namespace}
                showKind
              />
            ) : null,
            hide: !clientCertificate,
          },
          {
            name: 'Client certificate validation',
            value: `${
              asArray(tls?.frontend?.default?.validation?.caCertificateRefs).length
            } CA reference(s)${frontendMode ? `, mode ${frontendMode}` : ''}`,
            hide: !tls?.frontend,
          },
        ]}
      />
    </SectionBox>
  );
}

export function GatewayDetail() {
  return (
    <KindDetailView<Gateway>
      kind="Gateway"
      related={GATEWAY_RELATED}
      core={['Namespace']}
      extraInfo={(item, data) => {
        const className = item.spec?.gatewayClassName;
        const cls = (data.json('GatewayClass') || []).find(c => c.metadata?.name === className);
        return [
          {
            name: 'Class',
            value: className ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <RefLink target={{ group: GATEWAY_GROUP, kind: 'GatewayClass', name: className }} />
                {!data.loading && !cls && (
                  <Chip size="small" color="error" variant="outlined" label="Class not found" />
                )}
              </Stack>
            ) : (
              <Dash />
            ),
          },
          {
            name: 'Controller',
            value: (
              <ControllerName name={asRecord(cls?.spec).controllerName as string | undefined} />
            ),
            hide: !cls,
          },
          {
            name: 'Addresses',
            value: addressesText(item.status?.addresses) || (
              <Typography component="span" variant="body2" color="text.secondary">
                None assigned
              </Typography>
            ),
          },
        ];
      }}
      sections={(item, data) => {
        const json = item.json;
        const checked = checkReferences(json, data.grants);
        return [
          {
            id: 'gwapi-gateway-listeners',
            section: (
              <SectionBox title="Listeners">
                <ListenersTable
                  listeners={item.spec?.listeners}
                  statuses={item.status?.listeners}
                  namespace={item.metadata.namespace}
                  generation={item.metadata.generation}
                  checked={checked}
                />
              </SectionBox>
            ),
          },
          {
            id: 'gwapi-gateway-routes',
            section: <AttachedRoutesSection parent={json} data={data} />,
          },
          {
            id: 'gwapi-gateway-listenersets',
            section: <ListenerSetsSection gateway={json} data={data} />,
          },
          {
            id: 'gwapi-gateway-extras',
            section: <GatewayExtras gateway={item.jsonData} />,
          },
        ];
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// ListenerSet
// ---------------------------------------------------------------------------------------------

function listenerSetParent(item: ListenerSet) {
  return resolveParentRef(item.spec?.parentRef || { name: '' }, item.metadata.namespace);
}

function ListenerSetListView({ kind }: { kind: 'ListenerSet' }) {
  return (
    <KindListView<ListenerSet>
      kind={kind}
      columns={() => [
        {
          id: 'gateway',
          label: 'Gateway',
          getValue: item => {
            const ref = listenerSetParent(item);
            return `${ref.namespace}/${ref.name}`;
          },
          render: item => (
            <RefLink target={listenerSetParent(item)} fromNamespace={item.metadata.namespace} />
          ),
        },
        {
          id: 'listeners',
          label: 'Listeners',
          gridTemplate: 1.5,
          getValue: item => listenersText(item.spec?.listeners),
          render: item => <ListenerChips listeners={item.spec?.listeners} />,
        },
        {
          id: 'routes',
          label: 'Attached routes',
          getValue: item => attachedRouteCount(item.json) ?? 0,
        },
      ]}
    />
  );
}

function ListenerSetDetailView({ kind }: { kind: 'ListenerSet' }) {
  return (
    <KindDetailView<ListenerSet>
      kind={kind}
      related={['Gateway', 'ReferenceGrant', ...ROUTE_KINDS]}
      core={['Namespace']}
      extraInfo={(item, data) => {
        const ref = listenerSetParent(item);
        const gateway = (data.json('Gateway') || []).find(
          g => g.metadata?.name === ref.name && g.metadata?.namespace === ref.namespace
        );
        const allowed = gateway
          ? listenerSetAllowed(gateway, item.metadata.namespace, data.namespaceLabels)
          : undefined;
        return [
          {
            name: 'Parent Gateway',
            value: (
              <Stack direction="row" spacing={1} alignItems="center">
                <RefLink target={ref} fromNamespace={item.metadata.namespace} />
                {!data.loading && !gateway && (
                  <Chip size="small" color="error" variant="outlined" label="Gateway not found" />
                )}
                {allowed === 'no' && (
                  <Chip
                    size="small"
                    color="error"
                    variant="outlined"
                    label="Not allowed by the Gateway"
                  />
                )}
              </Stack>
            ),
          },
        ];
      }}
      sections={(item, data) => {
        const json = item.json;
        const ref = listenerSetParent(item);
        const gateway = (data.json('Gateway') || []).find(
          g => g.metadata?.name === ref.name && g.metadata?.namespace === ref.namespace
        );
        const notAllowed =
          gateway &&
          listenerSetAllowed(gateway, item.metadata.namespace, data.namespaceLabels) === 'no';
        return [
          {
            id: 'gwapi-listenerset-listeners',
            section: (
              <SectionBox title="Listeners">
                {notAllowed && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    The parent Gateway does not accept ListenerSets from namespace "
                    {item.metadata.namespace}". Set spec.allowedListeners on the Gateway to allow
                    it.
                  </Alert>
                )}
                <ListenersTable
                  listeners={item.spec?.listeners}
                  statuses={item.status?.listeners}
                  namespace={item.metadata.namespace}
                  generation={item.metadata.generation}
                  checked={checkReferences(json, data.grants)}
                />
              </SectionBox>
            ),
          },
          {
            id: 'gwapi-listenerset-routes',
            section: <AttachedRoutesSection parent={json} data={data} />,
          },
        ];
      }}
    />
  );
}

export const ListenerSetList = () => <ListenerSetListView kind="ListenerSet" />;
export const ListenerSetDetail = () => <ListenerSetDetailView kind="ListenerSet" />;
