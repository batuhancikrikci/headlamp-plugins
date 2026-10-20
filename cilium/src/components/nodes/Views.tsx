import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useCiliumList, useNodes } from '../../hooks/useClusterData';
import { crd } from '../../resources/registry';
import {
  CiliumEndpoint,
  CiliumNode,
  CiliumNodeConfig,
  NodeAddress,
  NodeIPAMPoolAllocation,
} from '../../resources/runtime';
import { selectedNodes } from '../../utils/relations';
import { EndpointsTable } from '../common/EndpointsTable';
import { MatchingNodes } from '../common/MatchingNodes';
import { CiliumLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray } from '../common/Shared';
import { CiliumDetailView, CiliumListView } from '../common/Views';

export function CiliumNodeList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumNode')}
      columns={[
        {
          id: 'internalIP',
          label: t('Internal IP'),
          getValue: (node: CiliumNode) => node.internalIP || '-',
        },
        {
          id: 'ciliumIP',
          label: t('Cilium internal IP'),
          getValue: (node: CiliumNode) => node.ciliumInternalIP || '-',
        },
        {
          id: 'podCIDRs',
          label: t('Pod CIDRs'),
          render: (node: CiliumNode) => <StringArray items={node.podCIDRs} max={3} monospace />,
          getValue: (node: CiliumNode) => node.podCIDRs.join(', '),
        },
        {
          id: 'usedIPs',
          label: t('IPs in use'),
          gridTemplate: 'min-content',
          getValue: (node: CiliumNode) => (node.status.ipam?.used ? node.usedIPs : '-'),
        },
        {
          id: 'encryption',
          label: t('Encryption key'),
          gridTemplate: 'min-content',
          getValue: (node: CiliumNode) => node.spec.encryption?.key || '-',
          show: false,
        },
        {
          id: 'ipam',
          label: t('IPAM'),
          gridTemplate: 'min-content',
          render: (node: CiliumNode) =>
            node.ipamError ? (
              <HealthLabel health="error" label={t('Error')} tooltip={node.ipamError} />
            ) : (
              <HealthLabel health="success" label={t('OK')} />
            ),
          getValue: (node: CiliumNode) => (node.ipamError ? 'error' : 'ok'),
        },
      ]}
    />
  );
}

/** Endpoints running on the node (matched through the node's addresses). */
function NodeEndpoints({ node }: { node: CiliumNode }) {
  const { t } = useText();
  const endpoints = useCiliumList<CiliumEndpoint>('CiliumEndpoint');
  const ips = new Set((node.spec.addresses || []).map(a => a.ip).filter(Boolean));
  return (
    <ListState items={endpoints.items} error={endpoints.error} what={t('Cilium endpoints')} dense>
      {items => (
        <EndpointsTable
          endpoints={items.filter(e => !!e.nodeIP && ips.has(e.nodeIP))}
          emptyMessage={t('No Cilium endpoints on this node.')}
        />
      )}
    </ListState>
  );
}

export function CiliumNodeDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumNode')}
      extraInfo={(node: CiliumNode) => [
        {
          name: t('Kubernetes node'),
          value: <ResourceRefLink kind="Node" name={node.metadata.name} />,
        },
        {
          name: t('BGP node config'),
          value: <CiliumLink kind="CiliumBGPNodeConfig" name={node.metadata.name} />,
        },
        { name: t('Pod CIDRs'), value: <StringArray items={node.podCIDRs} monospace /> },
        {
          name: t('Health IPs'),
          value: [node.spec.health?.ipv4, node.spec.health?.ipv6].filter(Boolean).join(', ') || '-',
        },
        {
          name: t('Ingress IPs'),
          value: [node.spec.ingress?.ipv4, node.spec.ingress?.ipv6].filter(Boolean).join(', '),
          hide: !node.spec.ingress?.ipv4 && !node.spec.ingress?.ipv6,
        },
        { name: t('Node identity'), value: node.spec.nodeidentity, hide: !node.spec.nodeidentity },
        {
          name: t('Encryption key'),
          value: node.spec.encryption?.key,
          hide: !node.spec.encryption?.key,
        },
        {
          name: t('Instance ID'),
          value: node.spec['instance-id'],
          hide: !node.spec['instance-id'],
        },
      ]}
      sections={(node: CiliumNode) => {
        const allocated = node.spec.ipam?.pools?.allocated || [];
        return [
          {
            id: 'cilium-node-addresses',
            section: (
              <SectionBox title={t('Addresses')}>
                <SimpleTable
                  emptyMessage={t('No addresses reported.')}
                  data={node.spec.addresses || []}
                  columns={[
                    { label: t('Type'), getter: (a: NodeAddress) => a.type || '-' },
                    { label: t('IP'), getter: (a: NodeAddress) => a.ip || '-' },
                  ]}
                />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-node-ipam',
            section: (
              <SectionBox title={t('IPAM')}>
                {node.ipamError && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    {node.ipamError}
                  </Alert>
                )}
                <NameValueTable
                  rows={[
                    {
                      name: t('Pod CIDRs'),
                      value: <StringArray items={node.spec.ipam?.podCIDRs} monospace />,
                    },
                    {
                      name: t('IPs in use'),
                      value: node.status.ipam?.used ? node.usedIPs : '-',
                    },
                    {
                      name: t('Pre-allocate'),
                      value: node.spec.ipam?.['pre-allocate'],
                      hide: node.spec.ipam?.['pre-allocate'] === undefined,
                    },
                    {
                      name: t('Min / max allocate'),
                      value: `${node.spec.ipam?.['min-allocate'] ?? '-'} / ${
                        node.spec.ipam?.['max-allocate'] ?? '-'
                      }`,
                      hide:
                        node.spec.ipam?.['min-allocate'] === undefined &&
                        node.spec.ipam?.['max-allocate'] === undefined,
                    },
                  ]}
                />
                {allocated.length > 0 && (
                  <SimpleTable
                    data={allocated}
                    columns={[
                      {
                        label: t('Pod IP pool'),
                        getter: (a: NodeIPAMPoolAllocation) =>
                          a.pool ? <CiliumLink kind="CiliumPodIPPool" name={a.pool} /> : '-',
                      },
                      {
                        label: t('Allocated CIDRs'),
                        getter: (a: NodeIPAMPoolAllocation) => (
                          <StringArray items={a.cidrs} monospace />
                        ),
                      },
                    ]}
                  />
                )}
              </SectionBox>
            ),
          },
          {
            id: 'cilium-node-endpoints',
            section: (
              <SectionBox title={t('Endpoints on this node')}>
                <NodeEndpoints node={node} />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}

export function NodeConfigList() {
  const { t } = useText();
  const nodes = useNodes();
  return (
    <CiliumListView
      crd={crd('CiliumNodeConfig')}
      columns={[
        {
          id: 'nodeSelector',
          label: t('Node selector'),
          render: (config: CiliumNodeConfig) => (
            <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />
          ),
          getValue: (config: CiliumNodeConfig) => JSON.stringify(config.spec.nodeSelector || {}),
        },
        {
          id: 'overrides',
          label: t('Overrides'),
          render: (config: CiliumNodeConfig) => (
            <StringArray items={Object.keys(config.defaults)} max={4} monospace />
          ),
          getValue: (config: CiliumNodeConfig) => Object.keys(config.defaults).join(', '),
        },
        {
          id: 'nodes',
          label: t('Nodes'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumNodeConfig) =>
            nodes.items ? selectedNodes(config.spec.nodeSelector, nodes.items).length : '…',
        },
      ]}
    />
  );
}

export function NodeConfigDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumNodeConfig')}
      extraInfo={(config: CiliumNodeConfig) => [
        {
          name: t('Node selector'),
          value: <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />,
        },
        { name: t('Overrides'), value: Object.keys(config.defaults).length },
      ]}
      sections={(config: CiliumNodeConfig) => [
        {
          id: 'cilium-nodeconfig-defaults',
          section: (
            <SectionBox title={t('Configuration overrides')}>
              <Alert severity="info" sx={{ mb: 1 }}>
                {t(
                  'These keys override cilium-config on the matching nodes. Agents read them at startup, so restart the Cilium pods on those nodes to apply changes.'
                )}
              </Alert>
              <NameValueTable
                rows={Object.entries(config.defaults).map(([name, value]) => ({ name, value }))}
              />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-nodeconfig-nodes',
          section: (
            <SectionBox title={t('Matching nodes')}>
              <MatchingNodes selector={config.spec.nodeSelector} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
