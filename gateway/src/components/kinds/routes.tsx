/** List and detail pages of HTTPRoute, GRPCRoute, TLSRoute, TCPRoute and UDPRoute. */
import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Divider, Stack, Typography } from '@mui/material';
import React from 'react';
import { GatewayApiDataValue } from '../../data/GatewayApiData';
import {
  AnyRoute,
  GRPCRoute,
  HTTPRoute,
  TCPRoute,
  TLSRoute,
  UDPRoute,
} from '../../resources/classes';
import { KindName } from '../../resources/registry';
import {
  BackendRef,
  GRPCRouteMatch,
  HTTPRouteFilter,
  HTTPRouteMatch,
  HTTPRouteRule,
  KubeJson,
  SessionPersistence,
} from '../../resources/types';
import { describeFilter, describeGRPCMatch, describeHTTPMatch } from '../../utils/describe';
import { asArray, asRecord, isPlainObject } from '../../utils/objects';
import { CheckedRef, checkReferences } from '../../utils/referenceGrants';
import {
  BackendLinks,
  BackendRefsTable,
  backendsText,
  Hostnames,
  Mono,
  ParentLinks,
  parentsText,
} from '../common/Renderers';
import { Dash } from '../common/Status';
import { KindDetailView, KindListView, ListColumn } from '../common/Views';
import { ExposeServiceButton } from '../wizards/ExposeServiceWizard';

type RouteKind = 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute' | 'UDPRoute';

const ROUTE_RELATED: KindName[] = ['Gateway', 'ListenerSet', 'ReferenceGrant'];
const HOSTNAME_KINDS: RouteKind[] = ['HTTPRoute', 'GRPCRoute', 'TLSRoute'];

function hostnamesOf(route: KubeJson): string[] {
  return asArray<string>(asRecord(route.spec).hostnames).filter(h => typeof h === 'string');
}

function rulesOf(route: KubeJson): HTTPRouteRule[] {
  return asArray<HTTPRouteRule>(asRecord(route.spec).rules).filter(
    isPlainObject
  ) as unknown as HTTPRouteRule[];
}

function routeColumns<T extends AnyRoute>(
  kind: RouteKind,
  data: GatewayApiDataValue
): ListColumn<T>[] {
  const json = (item: T): KubeJson => item.json;
  const columns: ListColumn<T>[] = [];
  if (HOSTNAME_KINDS.includes(kind)) {
    columns.push({
      id: 'hostnames',
      label: 'Hostnames',
      gridTemplate: 1.5,
      getValue: item => hostnamesOf(json(item)).join(', '),
      render: item => <Hostnames hostnames={hostnamesOf(json(item))} />,
    });
  }
  columns.push({
    id: 'parents',
    label: 'Parents',
    gridTemplate: 1.5,
    getValue: item => parentsText(json(item)),
    render: item => <ParentLinks route={json(item)} />,
  });
  if (kind === 'HTTPRoute' || kind === 'GRPCRoute') {
    columns.push({
      id: 'rules',
      label: 'Rules',
      getValue: item => rulesOf(json(item)).length,
    });
  }
  columns.push({
    id: 'backends',
    label: 'Backends',
    gridTemplate: 1.5,
    getValue: item => backendsText(json(item)),
    render: item => (
      <BackendLinks route={json(item)} checked={checkReferences(json(item), data.grants)} />
    ),
  });
  return columns;
}

function RouteListView<T extends AnyRoute>({ kind }: { kind: RouteKind }) {
  return (
    <KindListView<T>
      kind={kind}
      related={['ReferenceGrant']}
      columns={data => routeColumns<T>(kind, data)}
      actions={kind === 'HTTPRoute' ? <ExposeServiceButton /> : undefined}
    />
  );
}

function Bullets({ items, empty }: { items: React.ReactNode[]; empty: string }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {items.map((item, index) => (
        <li key={index}>
          <Typography variant="body2" component="span">
            {item}
          </Typography>
        </li>
      ))}
    </Box>
  );
}

function describeSession(session?: SessionPersistence): string {
  if (!session) return '';
  const parts: string[] = [session.type ?? 'Cookie'];
  if (session.sessionName) parts.push(`name ${session.sessionName}`);
  if (session.cookieConfig?.lifetimeType) parts.push(`${session.cookieConfig.lifetimeType} cookie`);
  if (session.absoluteTimeout) parts.push(`absolute timeout ${session.absoluteTimeout}`);
  if (session.idleTimeout) parts.push(`idle timeout ${session.idleTimeout}`);
  return parts.join(', ');
}

function RuleCard({
  kind,
  rule,
  index,
  route,
  checked,
  data,
}: {
  kind: RouteKind;
  rule: HTTPRouteRule;
  index: number;
  route: KubeJson;
  checked: CheckedRef[];
  data: GatewayApiDataValue;
}) {
  const isL7 = kind === 'HTTPRoute' || kind === 'GRPCRoute';
  const matches = asArray<HTTPRouteMatch | GRPCRouteMatch>(rule.matches);
  const filters = asArray<HTTPRouteFilter>(rule.filters);
  const backendFilters = asArray<BackendRef & { filters?: HTTPRouteFilter[] }>(rule.backendRefs)
    .filter(isPlainObject)
    .flatMap(ref =>
      asArray<HTTPRouteFilter>((ref as { filters?: HTTPRouteFilter[] }).filters).map(
        filter => `${describeFilter(filter)} (backend ${(ref as { name?: string }).name})`
      )
    );
  const redirects = filters.some(f => f?.type === 'RequestRedirect');

  const matchItems =
    kind === 'HTTPRoute'
      ? matches.map(match => <Mono>{describeHTTPMatch(match as HTTPRouteMatch)}</Mono>)
      : matches.map(match => <Mono>{describeGRPCMatch(match as GRPCRouteMatch)}</Mono>);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1">Rule {index + 1}</Typography>
        {rule.name && <Chip size="small" variant="outlined" label={rule.name} />}
      </Stack>
      {isL7 && (
        <NameValueTable
          rows={[
            {
              name: 'Matches',
              value: (
                <Bullets
                  items={matchItems}
                  empty={kind === 'HTTPRoute' ? 'Every request (PathPrefix /)' : 'Every gRPC call'}
                />
              ),
            },
            {
              name: 'Filters',
              value: (
                <Bullets items={[...filters.map(describeFilter), ...backendFilters]} empty="None" />
              ),
              hide: filters.length === 0 && backendFilters.length === 0,
            },
            {
              name: 'Timeouts',
              value: [
                rule.timeouts?.request ? `request ${rule.timeouts.request}` : '',
                rule.timeouts?.backendRequest
                  ? `backend request ${rule.timeouts.backendRequest}`
                  : '',
              ]
                .filter(Boolean)
                .join(', '),
              hide: !rule.timeouts,
            },
            {
              name: 'Retry',
              value: [
                rule.retry?.attempts !== undefined ? `${rule.retry.attempts} attempts` : '',
                rule.retry?.backoff ? `backoff ${rule.retry.backoff}` : '',
                asArray(rule.retry?.codes).length
                  ? `on ${asArray(rule.retry?.codes).join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join(', '),
              hide: !rule.retry,
            },
            {
              name: 'Session persistence',
              value: describeSession(rule.sessionPersistence),
              hide: !rule.sessionPersistence,
            },
          ]}
        />
      )}
      {!(redirects && asArray(rule.backendRefs).length === 0) && (
        <Box sx={{ mt: 1 }}>
          <BackendRefsTable
            backendRefs={rule.backendRefs}
            basePath={`spec.rules.${index}.backendRefs`}
            namespace={route.metadata?.namespace}
            checked={checked}
            data={data}
          />
        </Box>
      )}
    </Box>
  );
}

function RulesSection({
  kind,
  route,
  data,
}: {
  kind: RouteKind;
  route: KubeJson;
  data: GatewayApiDataValue;
}) {
  const rules = rulesOf(route);
  const checked = checkReferences(route, data.grants);
  return (
    <SectionBox title={`Rules (${rules.length})`}>
      {rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          This route has no rules.
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={2} sx={{ py: 1 }}>
          {rules.map((rule, index) => (
            <RuleCard
              key={index}
              kind={kind}
              rule={rule}
              index={index}
              route={route}
              checked={checked}
              data={data}
            />
          ))}
        </Stack>
      )}
    </SectionBox>
  );
}

function RouteDetailView<T extends AnyRoute>({ kind }: { kind: RouteKind }) {
  return (
    <KindDetailView<T>
      kind={kind}
      related={ROUTE_RELATED}
      core={['Namespace', 'Service']}
      extraInfo={item => {
        const json = item.json;
        return [
          {
            name: 'Hostnames',
            value: <Hostnames hostnames={hostnamesOf(json)} max={8} />,
            hide: !HOSTNAME_KINDS.includes(kind),
          },
          {
            name: 'Parents',
            value: asArray(asRecord(json.spec).parentRefs).length ? (
              <ParentLinks route={json} max={8} />
            ) : (
              <Dash />
            ),
          },
        ];
      }}
      sections={(item, data) => [
        {
          id: 'gwapi-route-rules',
          section: <RulesSection kind={kind} route={item.json} data={data} />,
        },
      ]}
    />
  );
}

export const HTTPRouteList = () => <RouteListView<HTTPRoute> kind="HTTPRoute" />;
export const HTTPRouteDetail = () => <RouteDetailView<HTTPRoute> kind="HTTPRoute" />;
export const GRPCRouteList = () => <RouteListView<GRPCRoute> kind="GRPCRoute" />;
export const GRPCRouteDetail = () => <RouteDetailView<GRPCRoute> kind="GRPCRoute" />;
export const TLSRouteList = () => <RouteListView<TLSRoute> kind="TLSRoute" />;
export const TLSRouteDetail = () => <RouteDetailView<TLSRoute> kind="TLSRoute" />;
export const TCPRouteList = () => <RouteListView<TCPRoute> kind="TCPRoute" />;
export const TCPRouteDetail = () => <RouteDetailView<TCPRoute> kind="TCPRoute" />;
export const UDPRouteList = () => <RouteListView<UDPRoute> kind="UDPRoute" />;
export const UDPRouteDetail = () => <RouteDetailView<UDPRoute> kind="UDPRoute" />;
