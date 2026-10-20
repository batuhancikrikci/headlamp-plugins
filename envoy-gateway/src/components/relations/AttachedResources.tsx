import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Chip } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { CRDInfo, CRDS } from '../../resources/registry';
import { API_GROUP, GATEWAY_API_GROUP, ObjectJson, ObjectRef } from '../../resources/types';
import { summarizeStatus } from '../../utils/conditions';
import {
  identityOf,
  policyTargets,
  ResourceIdentity,
  routeBackendRefs,
  routeExtensionRefs,
  routeParentGateways,
} from '../../utils/targets';
import { isAvailable, useEnvoyGatewayDiscovery } from '../../utils/versionDiscovery';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { StatusSummary } from '../common/SharedComponents';

const SUPPORTED_KINDS = ['Gateway', 'GatewayClass', 'HTTPRoute', 'GRPCRoute'];
const ROUTE_KINDS = ['HTTPRoute', 'GRPCRoute'];

interface Row {
  key: string;
  kind: string;
  name: string;
  namespace?: string;
  attachment: React.ReactNode;
  status: React.ReactNode;
}

function PolicyFetcher({
  crd,
  namespaces,
  onItems,
}: {
  crd: CRDInfo;
  namespaces?: string[];
  onItems: (kind: string, items: ObjectJson[]) => void;
}) {
  const [items, error] = crd.cls.useList(namespaces ? { namespace: namespaces } : {});
  React.useEffect(() => {
    if (items)
      onItems(
        crd.kind,
        (items as KubeObject[]).map(i => i.jsonData as ObjectJson)
      );
    else if (error) onItems(crd.kind, []);
  }, [items, error]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function envoyProxyRow(
  ref: (ObjectRef & { group?: string }) | undefined,
  ns: string | undefined,
  via: string
): Row | null {
  if (!ref || ref.kind !== 'EnvoyProxy' || (ref.group || '') !== API_GROUP) return null;
  const namespace = ref.namespace || ns;
  return {
    key: `ep-${namespace}-${ref.name}`,
    kind: 'EnvoyProxy',
    name: ref.name,
    namespace,
    attachment: via,
    status: '-',
  };
}

function Attachments({ json }: { json: ObjectJson }) {
  const { t } = useText();
  const discovery = useEnvoyGatewayDiscovery();
  const [byKind, setByKind] = React.useState<Record<string, ObjectJson[]>>({});
  const onItems = React.useCallback((kind: string, items: ObjectJson[]) => {
    setByKind(prev => ({ ...prev, [kind]: items }));
  }, []);

  if (discovery.status !== 'ready' || !discovery.availability.groupInstalled) return null;

  const target: ResourceIdentity = identityOf(json);
  const isRoute = ROUTE_KINDS.includes(target.kind);
  const parents = isRoute ? routeParentGateways(json) : [];
  const namespaces =
    target.kind === 'GatewayClass'
      ? undefined
      : Array.from(
          new Set([target.namespace, ...parents.map(p => p.namespace)].filter(Boolean) as string[])
        );
  const policyCrds = CRDS.filter(c => c.isPolicy && isAvailable(discovery.availability, c.plural));

  const rows: Row[] = [];
  for (const crd of policyCrds) {
    for (const policy of byKind[crd.kind] || []) {
      const status = <StatusSummary summary={summarizeStatus(policy.status)} />;
      const base = {
        kind: crd.kind,
        name: policy.metadata?.name || '',
        namespace: policy.metadata?.namespace,
        status,
      };
      const direct = policyTargets(policy, target);
      if (direct) {
        rows.push({
          ...base,
          key: `${crd.kind}-${base.namespace}-${base.name}`,
          attachment:
            direct.via === 'targetSelector'
              ? t('Label selector')
              : direct.sectionName
              ? t('Direct (section {{section}})', { section: direct.sectionName })
              : t('Direct'),
        });
        continue;
      }
      for (const gw of parents) {
        const viaGateway = policyTargets(policy, {
          group: GATEWAY_API_GROUP,
          kind: 'Gateway',
          name: gw.name,
          namespace: gw.namespace,
        });
        if (viaGateway) {
          rows.push({
            ...base,
            key: `${crd.kind}-${base.namespace}-${base.name}-via-${gw.name}`,
            attachment: (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {t('Inherited from')}
                <ResourceRefLink
                  group={GATEWAY_API_GROUP}
                  kind="Gateway"
                  name={gw.name}
                  namespace={gw.namespace}
                  hideKind
                />
              </Box>
            ),
          });
          break;
        }
      }
    }
  }

  if (target.kind === 'Gateway') {
    const row = envoyProxyRow(
      json.spec?.infrastructure?.parametersRef,
      target.namespace,
      'spec.infrastructure.parametersRef'
    );
    if (row) rows.push(row);
  }
  if (target.kind === 'GatewayClass') {
    const row = envoyProxyRow(json.spec?.parametersRef, undefined, 'spec.parametersRef');
    if (row) rows.push(row);
  }
  if (isRoute) {
    for (const ref of routeBackendRefs(json)) {
      if (ref.kind === 'Backend' && (ref.group || '') === API_GROUP) {
        const namespace = ref.namespace || target.namespace;
        rows.push({
          key: `be-${namespace}-${ref.name}-${ref.port || ''}`,
          kind: 'Backend',
          name: ref.name,
          namespace,
          attachment: 'backendRefs',
          status: '-',
        });
      }
    }
    for (const ref of routeExtensionRefs(json)) {
      if (ref.kind === 'HTTPRouteFilter' && (ref.group || '') === API_GROUP) {
        rows.push({
          key: `hrf-${ref.name}`,
          kind: 'HTTPRouteFilter',
          name: ref.name,
          namespace: target.namespace,
          attachment: 'filters[].extensionRef',
          status: '-',
        });
      }
    }
  }

  const unique = Array.from(new Map(rows.map(r => [r.key, r])).values());
  const loading = policyCrds.some(c => byKind[c.kind] === undefined);

  return (
    <>
      {policyCrds.map(crd => (
        <PolicyFetcher key={crd.kind} crd={crd} namespaces={namespaces} onItems={onItems} />
      ))}
      <SectionBox title={t('Envoy Gateway')}>
        <SimpleTable
          data={loading && unique.length === 0 ? null : unique}
          emptyMessage={t('No Envoy Gateway policy or extension applies to this resource.')}
          columns={[
            {
              label: t('Kind'),
              getter: (r: Row) => <Chip size="small" variant="outlined" label={r.kind} />,
            },
            {
              label: t('Name'),
              getter: (r: Row) => (
                <ResourceRefLink
                  group={API_GROUP}
                  kind={r.kind}
                  name={r.name}
                  namespace={r.namespace}
                  hideKind
                />
              ),
            },
            { label: t('Namespace'), getter: (r: Row) => r.namespace || '-' },
            { label: t('Attachment'), getter: (r: Row) => r.attachment },
            { label: t('Status'), getter: (r: Row) => r.status },
          ]}
        />
      </SectionBox>
    </>
  );
}

/**
 * Details view section for Gateway API resources: lists the Envoy Gateway policies attached
 * directly or inherited from the parent Gateway, and the EG resources the object references.
 */
export function EnvoyGatewayAttachmentsSection({ resource }: { resource: KubeObject }) {
  const json = resource?.jsonData as ObjectJson | undefined;
  if (!json || !SUPPORTED_KINDS.includes(json.kind || '')) return null;
  if (identityOf(json).group !== GATEWAY_API_GROUP) return null;
  return <Attachments json={json} />;
}
