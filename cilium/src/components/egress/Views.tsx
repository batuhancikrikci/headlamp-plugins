import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useNamespaceLabels, useNodes, usePods } from '../../hooks/useClusterData';
import {
  CiliumEgressGatewayPolicy,
  CiliumLocalRedirectPolicy,
  EgressGateway,
  EgressRuleSelector,
  redirectPortLabel,
} from '../../resources/network';
import { crd } from '../../resources/registry';
import { PodLike } from '../../resources/types';
import {
  egressGatewayNodes,
  egressPolicySelectsPod,
  redirectSelectsPod,
} from '../../utils/relations';
import { selectorToString } from '../../utils/selectors';
import { ResourceRefLink, ResourceRefList } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray, useYesNo } from '../common/Shared';
import { CiliumDetailView, CiliumListView } from '../common/Views';

function gatewayLabel(gateway: EgressGateway): string {
  const via = gateway.egressIP || gateway.interface;
  return `${selectorToString(gateway.nodeSelector) || '*'}${via ? ` → ${via}` : ''}`;
}

export function EgressGatewayPolicyList() {
  const { t } = useText();
  const nodes = useNodes();
  return (
    <CiliumListView
      crd={crd('CiliumEgressGatewayPolicy')}
      columns={[
        {
          id: 'selectors',
          label: t('Source pods'),
          render: (policy: CiliumEgressGatewayPolicy) => (
            <StringArray
              items={(policy.spec.selectors || []).map(
                s => selectorToString(s.podSelector) || t('All pods')
              )}
              max={3}
              monospace
            />
          ),
          getValue: (policy: CiliumEgressGatewayPolicy) =>
            (policy.spec.selectors || []).map(s => selectorToString(s.podSelector)).join('; '),
        },
        {
          id: 'destinations',
          label: t('Destination CIDRs'),
          render: (policy: CiliumEgressGatewayPolicy) => (
            <StringArray items={policy.spec.destinationCIDRs} max={3} monospace />
          ),
          getValue: (policy: CiliumEgressGatewayPolicy) =>
            (policy.spec.destinationCIDRs || []).join(', '),
        },
        {
          id: 'gateway',
          label: t('Gateway'),
          render: (policy: CiliumEgressGatewayPolicy) => (
            <StringArray items={policy.gateways.map(gatewayLabel)} max={2} monospace />
          ),
          getValue: (policy: CiliumEgressGatewayPolicy) =>
            policy.gateways.map(gatewayLabel).join('; '),
        },
        {
          id: 'gatewayNodes',
          label: t('Gateway nodes'),
          gridTemplate: 'min-content',
          render: (policy: CiliumEgressGatewayPolicy) => {
            if (!nodes.items) return '…';
            const count = egressGatewayNodes(policy.jsonData.spec, nodes.items).length;
            return count === 0 ? (
              <HealthLabel
                health="error"
                label="0"
                tooltip={t('No node matches the gateway node selector: traffic is dropped')}
              />
            ) : (
              count
            );
          },
          getValue: (policy: CiliumEgressGatewayPolicy) =>
            nodes.items ? egressGatewayNodes(policy.jsonData.spec, nodes.items).length : -1,
        },
      ]}
    />
  );
}

function PodsTable({ pods, emptyMessage }: { pods: PodLike[]; emptyMessage: string }) {
  const { t } = useText();
  return (
    <SimpleTable
      rowsPerPage={[10, 25, 50]}
      emptyMessage={emptyMessage}
      data={pods}
      columns={[
        {
          label: t('Pod'),
          getter: (pod: PodLike) => (
            <ResourceRefLink
              kind="Pod"
              name={pod.metadata.name}
              namespace={pod.metadata.namespace}
            />
          ),
        },
        { label: t('Namespace'), getter: (pod: PodLike) => pod.metadata.namespace || '-' },
        { label: t('Pod IP'), getter: (pod: PodLike) => pod.status?.podIP || '-' },
        {
          label: t('Node'),
          getter: (pod: PodLike) =>
            pod.spec?.nodeName ? <ResourceRefLink kind="Node" name={pod.spec.nodeName} /> : '-',
        },
      ]}
    />
  );
}

function EgressPods({ policy }: { policy: CiliumEgressGatewayPolicy }) {
  const { t } = useText();
  const pods = usePods();
  const namespaceLabels = useNamespaceLabels();
  return (
    <ListState items={pods.items} error={pods.error} what={t('pods')} dense>
      {items => (
        <PodsTable
          emptyMessage={t('No pod currently matches the selectors of this policy.')}
          pods={items.filter(
            pod =>
              !pod.spec?.hostNetwork &&
              egressPolicySelectsPod(
                policy.jsonData.spec,
                pod,
                namespaceLabels[pod.metadata.namespace || '']
              )
          )}
        />
      )}
    </ListState>
  );
}

function GatewayNodes({ policy }: { policy: CiliumEgressGatewayPolicy }) {
  const { t } = useText();
  const nodes = useNodes();
  return (
    <ListState items={nodes.items} error={nodes.error} what={t('nodes')} dense>
      {items => {
        const matched = egressGatewayNodes(policy.jsonData.spec, items);
        return matched.length === 0 ? (
          <Typography variant="body2" color="error.main">
            {t(
              'No node matches the gateway node selector. Traffic selected by this policy is dropped until a gateway node exists.'
            )}
          </Typography>
        ) : (
          <ResourceRefList
            max={50}
            refs={matched.map(n => ({ kind: 'Node', name: n.metadata.name }))}
          />
        );
      }}
    </ListState>
  );
}

export function EgressGatewayPolicyDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumEgressGatewayPolicy')}
      extraInfo={(policy: CiliumEgressGatewayPolicy) => [
        {
          name: t('Destination CIDRs'),
          value: <StringArray items={policy.spec.destinationCIDRs} max={20} monospace />,
        },
        {
          name: t('Excluded CIDRs'),
          value: <StringArray items={policy.spec.excludedCIDRs} max={20} monospace />,
          hide: !policy.spec.excludedCIDRs?.length,
        },
      ]}
      sections={(policy: CiliumEgressGatewayPolicy) => [
        {
          id: 'cilium-egress-selectors',
          section: (
            <SectionBox title={t('Source selectors')}>
              <SimpleTable
                emptyMessage={t('No selectors configured.')}
                data={policy.spec.selectors || []}
                columns={[
                  {
                    label: t('Pod selector'),
                    getter: (s: EgressRuleSelector) => (
                      <SelectorView selector={s.podSelector} emptyLabel={t('All pods')} />
                    ),
                  },
                  {
                    label: t('Namespace selector'),
                    getter: (s: EgressRuleSelector) => (
                      <SelectorView
                        selector={s.namespaceSelector}
                        emptyLabel={t('All namespaces')}
                      />
                    ),
                  },
                  {
                    label: t('Node selector'),
                    getter: (s: EgressRuleSelector) => (
                      <SelectorView selector={s.nodeSelector} emptyLabel={t('All nodes')} />
                    ),
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-egress-gateways',
          section: (
            <SectionBox title={t('Egress gateway')}>
              <SimpleTable
                emptyMessage={t('No gateway configured.')}
                data={policy.gateways}
                columns={[
                  {
                    label: t('Node selector'),
                    getter: (g: EgressGateway) => (
                      <SelectorView selector={g.nodeSelector} nilLabel={t('Not set')} />
                    ),
                  },
                  {
                    label: t('Source address'),
                    getter: (g: EgressGateway) =>
                      g.egressIP
                        ? t('Egress IP {{ip}}', { ip: g.egressIP })
                        : g.interface
                        ? t('First IPv4 of interface {{name}}', { name: g.interface })
                        : t('IP of the default route interface'),
                  },
                ]}
              />
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                {t('Gateway nodes')}
              </Typography>
              <GatewayNodes policy={policy} />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-egress-pods',
          section: (
            <SectionBox title={t('Selected pods')}>
              <EgressPods policy={policy} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

export function LocalRedirectPolicyList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumLocalRedirectPolicy')}
      columns={[
        {
          id: 'frontendType',
          label: t('Frontend type'),
          gridTemplate: 'min-content',
          getValue: (policy: CiliumLocalRedirectPolicy) => policy.frontendType,
        },
        {
          id: 'frontend',
          label: t('Frontend'),
          getValue: (policy: CiliumLocalRedirectPolicy) => policy.frontendLabel,
        },
        {
          id: 'backend',
          label: t('Backend selector'),
          render: (policy: CiliumLocalRedirectPolicy) => (
            <SelectorView
              selector={policy.spec.redirectBackend?.localEndpointSelector}
              emptyLabel={t('All pods')}
              nilLabel="-"
            />
          ),
          getValue: (policy: CiliumLocalRedirectPolicy) =>
            selectorToString(policy.spec.redirectBackend?.localEndpointSelector),
        },
        {
          id: 'backendPorts',
          label: t('Backend ports'),
          render: (policy: CiliumLocalRedirectPolicy) => (
            <StringArray
              items={(policy.spec.redirectBackend?.toPorts || []).map(redirectPortLabel)}
            />
          ),
          getValue: (policy: CiliumLocalRedirectPolicy) =>
            (policy.spec.redirectBackend?.toPorts || []).map(redirectPortLabel).join(', '),
        },
      ]}
    />
  );
}

function RedirectBackends({ policy }: { policy: CiliumLocalRedirectPolicy }) {
  const { t } = useText();
  const pods = usePods(policy.metadata.namespace);
  return (
    <ListState items={pods.items} error={pods.error} what={t('pods')} dense>
      {items => (
        <PodsTable
          emptyMessage={t(
            'No pod in this namespace matches the backend selector. Traffic is only redirected on nodes that run a matching pod.'
          )}
          pods={items.filter(pod => redirectSelectsPod(policy.jsonData, pod))}
        />
      )}
    </ListState>
  );
}

export function LocalRedirectPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumDetailView
      crd={crd('CiliumLocalRedirectPolicy')}
      extraInfo={(policy: CiliumLocalRedirectPolicy) => [
        { name: t('Description'), value: policy.spec.description, hide: !policy.spec.description },
        { name: t('Frontend type'), value: policy.frontendType },
        {
          name: t('Skip redirect from backend'),
          value: yesNo(policy.spec.skipRedirectFromBackend, true),
        },
      ]}
      sections={(policy: CiliumLocalRedirectPolicy) => {
        const frontend = policy.spec.redirectFrontend;
        const service = frontend?.serviceMatcher;
        return [
          {
            id: 'cilium-lrp-frontend',
            section: (
              <SectionBox title={t('Frontend')}>
                <NameValueTable
                  rows={[
                    {
                      name: t('IP address'),
                      value: frontend?.addressMatcher?.ip,
                      hide: !frontend?.addressMatcher,
                    },
                    {
                      name: t('Service'),
                      value: service?.serviceName && (
                        <ResourceRefLink
                          kind="Service"
                          name={service.serviceName}
                          namespace={service.namespace || policy.metadata.namespace}
                          qualified
                        />
                      ),
                      hide: !service,
                    },
                    {
                      name: t('Ports'),
                      value: (
                        <StringArray
                          items={(frontend?.addressMatcher?.toPorts || service?.toPorts || []).map(
                            redirectPortLabel
                          )}
                        />
                      ),
                    },
                  ]}
                />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-lrp-backend',
            section: (
              <SectionBox title={t('Backend')}>
                <NameValueTable
                  rows={[
                    {
                      name: t('Endpoint selector'),
                      value: (
                        <SelectorView
                          selector={policy.spec.redirectBackend?.localEndpointSelector}
                          emptyLabel={t('All pods')}
                          nilLabel="-"
                        />
                      ),
                    },
                    {
                      name: t('Ports'),
                      value: (
                        <StringArray
                          items={(policy.spec.redirectBackend?.toPorts || []).map(
                            redirectPortLabel
                          )}
                        />
                      ),
                    },
                  ]}
                />
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                  {t('Backend pods')}
                </Typography>
                <RedirectBackends policy={policy} />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}
