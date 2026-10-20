import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject, KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { API_GROUP, GATEWAY_API_GROUP, ObjectJson } from '../../resources/types';
import { objectRefMatches, routeBackendRefs, routeExtensionRefs } from '../../utils/targets';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { StatusChip } from '../common/SharedComponents';
import { useEnvoyProxyReferences } from '../envoyProxy/status';

function resourceClass(kind: string): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

export interface UsageRow {
  key: string;
  kind: string;
  group: string;
  name: string;
  namespace?: string;
  how: string;
  status?: React.ReactNode;
}

export function UsageTable({
  title,
  rows,
  loading,
  emptyText,
}: {
  title: string;
  rows: UsageRow[];
  loading: boolean;
  emptyText: string;
}) {
  const { t } = useText();
  return (
    <SectionBox title={title}>
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          {t('Loading…')}
        </Typography>
      ) : (
        <SimpleTable
          data={rows}
          emptyMessage={emptyText}
          columns={[
            {
              label: t('Resource'),
              getter: (r: UsageRow) => (
                <ResourceRefLink
                  group={r.group}
                  kind={r.kind}
                  name={r.name}
                  namespace={r.namespace}
                />
              ),
            },
            { label: t('Namespace'), getter: (r: UsageRow) => r.namespace || '-' },
            { label: t('Reference'), getter: (r: UsageRow) => r.how },
            ...(rows.some(r => r.status !== undefined)
              ? [{ label: t('Status'), getter: (r: UsageRow) => r.status ?? '-' }]
              : []),
          ]}
        />
      )}
    </SectionBox>
  );
}

function json(item: KubeObject): ObjectJson {
  return item.jsonData as ObjectJson;
}

/** GatewayClasses and Gateways that use an EnvoyProxy as parameters. */
export function EnvoyProxyUsedBy({ name, namespace }: { name: string; namespace?: string }) {
  const { t } = useText();
  const { loading, referencesOf } = useEnvoyProxyReferences();
  const rows: UsageRow[] = referencesOf(name, namespace).map(r => ({
    key: `${r.kind}-${r.namespace || ''}-${r.name}`,
    kind: r.kind,
    group: GATEWAY_API_GROUP,
    name: r.name,
    namespace: r.namespace,
    how: r.kind === 'GatewayClass' ? 'spec.parametersRef' : 'spec.infrastructure.parametersRef',
    status: r.condition ? <StatusChip condition={r.condition} /> : t('No status reported yet'),
  }));

  return (
    <UsageTable
      title={t('Used By')}
      rows={rows}
      loading={loading}
      emptyText={t('No GatewayClass or Gateway references this EnvoyProxy.')}
    />
  );
}

function RouteUsage({
  kind,
  match,
  onRows,
}: {
  kind: 'HTTPRoute' | 'GRPCRoute';
  match: (route: ObjectJson) => string | null;
  onRows: (kind: string, rows: UsageRow[] | null) => void;
}) {
  const cls = resourceClass(kind);
  const [routes, error] = cls.useList();
  React.useEffect(() => {
    if (routes === null && !error) {
      onRows(kind, null);
      return;
    }
    const rows: UsageRow[] = [];
    for (const r of (routes as KubeObject[] | null) || []) {
      const how = match(json(r));
      if (how) {
        rows.push({
          key: `${kind}-${r.metadata.namespace}-${r.metadata.name}`,
          kind,
          group: GATEWAY_API_GROUP,
          name: r.metadata.name,
          namespace: r.metadata.namespace,
          how,
        });
      }
    }
    onRows(kind, rows);
  }, [routes, error]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function useRouteUsage(
  kinds: Array<'HTTPRoute' | 'GRPCRoute'>,
  match: (route: ObjectJson) => string | null
) {
  const [byKind, setByKind] = React.useState<Record<string, UsageRow[] | null>>({});
  const onRows = React.useCallback((kind: string, rows: UsageRow[] | null) => {
    setByKind(prev => ({ ...prev, [kind]: rows }));
  }, []);
  const fetchers = kinds.map(kind => (
    <RouteUsage key={kind} kind={kind} match={match} onRows={onRows} />
  ));
  const loading = kinds.some(k => byKind[k] === undefined || byKind[k] === null);
  const rows = kinds.flatMap(k => byKind[k] || []);
  return { fetchers, loading, rows };
}

/** Routes whose backendRefs point to an Envoy Gateway Backend. */
export function BackendUsedBy({ name, namespace }: { name: string; namespace?: string }) {
  const { t } = useText();
  const target = { group: API_GROUP, kind: 'Backend', name, namespace };
  const match = React.useCallback(
    (route: ObjectJson) =>
      routeBackendRefs(route).some(ref =>
        objectRefMatches(ref, target, route.metadata?.namespace, { kind: 'Service', group: '' })
      )
        ? 'backendRefs'
        : null,
    [name, namespace] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { fetchers, loading, rows } = useRouteUsage(['HTTPRoute', 'GRPCRoute'], match);
  return (
    <>
      {fetchers}
      <UsageTable
        title={t('Used By')}
        rows={rows}
        loading={loading}
        emptyText={t('No HTTPRoute or GRPCRoute references this Backend.')}
      />
    </>
  );
}

/** HTTPRoutes that use an HTTPRouteFilter through an ExtensionRef filter. */
export function HTTPRouteFilterUsedBy({ name, namespace }: { name: string; namespace?: string }) {
  const { t } = useText();
  const target = { group: API_GROUP, kind: 'HTTPRouteFilter', name, namespace };
  const match = React.useCallback(
    (route: ObjectJson) =>
      routeExtensionRefs(route).some(ref =>
        objectRefMatches(ref, target, route.metadata?.namespace)
      )
        ? 'filters[].extensionRef'
        : null,
    [name, namespace] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { fetchers, loading, rows } = useRouteUsage(['HTTPRoute'], match);
  return (
    <>
      {fetchers}
      <UsageTable
        title={t('Used By')}
        rows={rows}
        loading={loading}
        emptyText={t('No HTTPRoute uses this filter.')}
      />
    </>
  );
}
