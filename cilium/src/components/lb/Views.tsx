import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useCiliumList, useServices } from '../../hooks/useClusterData';
import {
  blockLabel,
  CiliumL2AnnouncementPolicy,
  CiliumLoadBalancerIPPool,
  CiliumPodIPPool,
  LBIPBlock,
} from '../../resources/network';
import { crd } from '../../resources/registry';
import { CiliumNode } from '../../resources/runtime';
import { ServiceLike } from '../../resources/types';
import { blockSize, formatCount } from '../../utils/cidr';
import {
  ipsFromPool,
  l2PolicySelectsService,
  loadBalancerIPs,
  poolSelectsService,
} from '../../utils/relations';
import { selectorToString } from '../../utils/selectors';
import { MatchingNodes } from '../common/MatchingNodes';
import { CiliumLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray, UsageBar, useYesNo } from '../common/Shared';
import { CiliumDetailView, CiliumListView } from '../common/Views';

function PoolStatus({ pool }: { pool: CiliumLoadBalancerIPPool }) {
  const { t } = useText();
  const usage = pool.usage;
  if (usage.conflict) {
    return <HealthLabel health="error" label={t('Conflict')} tooltip={usage.conflictMessage} />;
  }
  if (pool.spec.disabled) return <HealthLabel health="warning" label={t('Disabled')} />;
  if (usage.total === undefined) return <HealthLabel health="unknown" label={t('No status')} />;
  if (usage.available === 0) return <HealthLabel health="warning" label={t('Exhausted')} />;
  return <HealthLabel health="success" label={t('Ready')} />;
}

export function LBIPPoolList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumLoadBalancerIPPool')}
      columns={[
        {
          id: 'blocks',
          label: t('Blocks'),
          render: (pool: CiliumLoadBalancerIPPool) => (
            <StringArray items={pool.blocks.map(blockLabel)} max={3} monospace />
          ),
          getValue: (pool: CiliumLoadBalancerIPPool) => pool.blocks.map(blockLabel).join(', '),
        },
        {
          id: 'serviceSelector',
          label: t('Service selector'),
          render: (pool: CiliumLoadBalancerIPPool) => (
            <SelectorView selector={pool.spec.serviceSelector} emptyLabel={t('All services')} />
          ),
          getValue: (pool: CiliumLoadBalancerIPPool) => selectorToString(pool.spec.serviceSelector),
        },
        {
          id: 'usage',
          label: t('IPs used'),
          render: (pool: CiliumLoadBalancerIPPool) => (
            <UsageBar used={pool.usage.used} total={pool.usage.total} />
          ),
          getValue: (pool: CiliumLoadBalancerIPPool) => pool.usage.used ?? -1,
        },
        {
          id: 'available',
          label: t('Available'),
          gridTemplate: 'min-content',
          getValue: (pool: CiliumLoadBalancerIPPool) => pool.usage.available ?? '-',
        },
        {
          id: 'status',
          label: t('Status'),
          gridTemplate: 'min-content',
          render: (pool: CiliumLoadBalancerIPPool) => <PoolStatus pool={pool} />,
          getValue: (pool: CiliumLoadBalancerIPPool) =>
            pool.usage.conflict ? 'conflict' : pool.spec.disabled ? 'disabled' : 'ready',
        },
      ]}
    />
  );
}

function ServiceLink({ service }: { service: ServiceLike }) {
  return (
    <ResourceRefLink
      kind="Service"
      name={service.metadata.name}
      namespace={service.metadata.namespace}
    />
  );
}

/** LoadBalancer services the pool can serve, with the IPs they got from it. */
function PoolServices({ pool }: { pool: CiliumLoadBalancerIPPool }) {
  const { t } = useText();
  const services = useServices();
  return (
    <ListState items={services.items} error={services.error} what={t('services')} dense>
      {items => {
        const rows = items
          .filter(svc => poolSelectsService(pool.jsonData.spec, svc))
          .map(svc => ({ svc, ips: ipsFromPool(pool.jsonData.spec, svc) }));
        return (
          <SimpleTable
            emptyMessage={t('No LoadBalancer service matches the service selector of this pool.')}
            data={rows}
            columns={[
              {
                label: t('Service'),
                getter: (row: (typeof rows)[number]) => <ServiceLink service={row.svc} />,
              },
              {
                label: t('Namespace'),
                getter: (row: (typeof rows)[number]) => row.svc.metadata.namespace || '-',
              },
              {
                label: t('IPs from this pool'),
                getter: (row: (typeof rows)[number]) =>
                  row.ips.length ? (
                    <StringArray items={row.ips} monospace />
                  ) : loadBalancerIPs(row.svc).length ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('Allocated from another pool')}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="warning.main">
                      {t('Pending')}
                    </Typography>
                  ),
              },
              {
                label: t('Class'),
                getter: (row: (typeof rows)[number]) => row.svc.spec?.loadBalancerClass || '-',
              },
            ]}
          />
        );
      }}
    </ListState>
  );
}

export function LBIPPoolDetail() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumDetailView
      crd={crd('CiliumLoadBalancerIPPool')}
      conditions="positive"
      extraInfo={(pool: CiliumLoadBalancerIPPool) => [
        { name: t('Status'), value: <PoolStatus pool={pool} /> },
        {
          name: t('IPs used'),
          value: <UsageBar used={pool.usage.used} total={pool.usage.total} />,
        },
        { name: t('IPs available'), value: pool.usage.available ?? '-' },
        {
          name: t('Service selector'),
          value: (
            <SelectorView selector={pool.spec.serviceSelector} emptyLabel={t('All services')} />
          ),
        },
        {
          name: t('Allow first and last IPs'),
          value: pool.spec.allowFirstLastIPs || t('Default'),
        },
        { name: t('Disabled'), value: yesNo(pool.spec.disabled, true) },
      ]}
      sections={(pool: CiliumLoadBalancerIPPool) => {
        const allowFirstLast = pool.spec.allowFirstLastIPs !== 'No';
        return [
          {
            id: 'cilium-pool-conflict',
            section: pool.usage.conflict && (
              <Alert severity="error">
                {t('This pool conflicts with another pool and is not used: {{message}}', {
                  message: pool.usage.conflictMessage || '',
                })}
              </Alert>
            ),
          },
          {
            id: 'cilium-pool-blocks',
            section: (
              <SectionBox title={t('IP blocks')}>
                <SimpleTable
                  emptyMessage={t('No blocks configured.')}
                  data={pool.blocks}
                  columns={[
                    {
                      label: t('Block'),
                      getter: (block: LBIPBlock) => (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {blockLabel(block)}
                        </Typography>
                      ),
                    },
                    {
                      label: t('Type'),
                      getter: (block: LBIPBlock) => (block.cidr ? 'CIDR' : t('Range')),
                    },
                    {
                      label: t('Usable addresses'),
                      getter: (block: LBIPBlock) => formatCount(blockSize(block, allowFirstLast)),
                    },
                  ]}
                />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-pool-services',
            section: (
              <SectionBox title={t('Services')}>
                <PoolServices pool={pool} />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}

export function L2AnnouncementPolicyList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumL2AnnouncementPolicy')}
      columns={[
        {
          id: 'announces',
          label: t('Announces'),
          render: (policy: CiliumL2AnnouncementPolicy) => (
            <StringArray items={policy.announces.map(a => t(a))} />
          ),
          getValue: (policy: CiliumL2AnnouncementPolicy) => policy.announces.join(', '),
        },
        {
          id: 'interfaces',
          label: t('Interfaces'),
          render: (policy: CiliumL2AnnouncementPolicy) =>
            policy.spec.interfaces?.length ? (
              <StringArray items={policy.spec.interfaces} monospace />
            ) : (
              t('All')
            ),
          getValue: (policy: CiliumL2AnnouncementPolicy) =>
            (policy.spec.interfaces || []).join(', '),
        },
        {
          id: 'nodeSelector',
          label: t('Node selector'),
          render: (policy: CiliumL2AnnouncementPolicy) => (
            <SelectorView selector={policy.spec.nodeSelector} emptyLabel={t('All nodes')} />
          ),
          getValue: (policy: CiliumL2AnnouncementPolicy) =>
            selectorToString(policy.spec.nodeSelector),
        },
        {
          id: 'serviceSelector',
          label: t('Service selector'),
          render: (policy: CiliumL2AnnouncementPolicy) => (
            <SelectorView selector={policy.spec.serviceSelector} emptyLabel={t('All services')} />
          ),
          getValue: (policy: CiliumL2AnnouncementPolicy) =>
            selectorToString(policy.spec.serviceSelector),
        },
      ]}
    />
  );
}

function L2Services({ policy }: { policy: CiliumL2AnnouncementPolicy }) {
  const { t } = useText();
  const services = useServices();
  return (
    <ListState items={services.items} error={services.error} what={t('services')} dense>
      {items => {
        const rows = items.filter(svc => l2PolicySelectsService(policy.jsonData.spec, svc));
        return (
          <SimpleTable
            emptyMessage={t(
              'No service is announced by this policy. Only services with a LoadBalancer or external IP that match the selector are announced.'
            )}
            data={rows}
            columns={[
              { label: t('Service'), getter: (svc: ServiceLike) => <ServiceLink service={svc} /> },
              {
                label: t('Namespace'),
                getter: (svc: ServiceLike) => svc.metadata.namespace || '-',
              },
              {
                label: t('LoadBalancer IPs'),
                getter: (svc: ServiceLike) => (
                  <StringArray items={loadBalancerIPs(svc)} monospace />
                ),
              },
              {
                label: t('External IPs'),
                getter: (svc: ServiceLike) => (
                  <StringArray items={svc.spec?.externalIPs} monospace />
                ),
              },
            ]}
          />
        );
      }}
    </ListState>
  );
}

export function L2AnnouncementPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumDetailView
      crd={crd('CiliumL2AnnouncementPolicy')}
      extraInfo={(policy: CiliumL2AnnouncementPolicy) => [
        { name: t('LoadBalancer IPs'), value: yesNo(policy.spec.loadBalancerIPs, true) },
        { name: t('External IPs'), value: yesNo(policy.spec.externalIPs, true) },
        {
          name: t('Interfaces'),
          value: policy.spec.interfaces?.length ? (
            <StringArray items={policy.spec.interfaces} monospace />
          ) : (
            t('All interfaces')
          ),
        },
        {
          name: t('Node selector'),
          value: <SelectorView selector={policy.spec.nodeSelector} emptyLabel={t('All nodes')} />,
        },
        {
          name: t('Service selector'),
          value: (
            <SelectorView selector={policy.spec.serviceSelector} emptyLabel={t('All services')} />
          ),
        },
      ]}
      sections={(policy: CiliumL2AnnouncementPolicy) => [
        {
          id: 'cilium-l2-nodes',
          section: (
            <SectionBox title={t('Announcing nodes')}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t(
                  'One of these nodes answers ARP/NDP for each announced IP. The active node holds a lease named cilium-l2announce-<namespace>-<service>.'
                )}
              </Typography>
              <MatchingNodes selector={policy.spec.nodeSelector} />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-l2-services',
          section: (
            <SectionBox title={t('Announced services')}>
              <L2Services policy={policy} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

function familyLabel(family?: { cidrs?: string[]; maskSize?: number }): string {
  if (!family?.cidrs?.length) return '-';
  return `${family.cidrs.join(', ')} (/${family.maskSize ?? '?'})`;
}

export function PodIPPoolList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumPodIPPool')}
      columns={[
        {
          id: 'ipv4',
          label: t('IPv4 CIDRs (mask)'),
          getValue: (pool: CiliumPodIPPool) => familyLabel(pool.spec.ipv4),
        },
        {
          id: 'ipv6',
          label: t('IPv6 CIDRs (mask)'),
          getValue: (pool: CiliumPodIPPool) => familyLabel(pool.spec.ipv6),
        },
      ]}
    />
  );
}

/** Nodes that received CIDRs from the pool (multi-pool IPAM). */
function PodPoolNodes({ name }: { name: string }) {
  const { t } = useText();
  const nodes = useCiliumList<CiliumNode>('CiliumNode');
  return (
    <ListState items={nodes.items} error={nodes.error} what={t('Cilium nodes')} dense>
      {items => {
        const rows = items
          .map(node => ({
            node,
            cidrs: (node.spec.ipam?.pools?.allocated || [])
              .filter(a => a.pool === name)
              .flatMap(a => a.cidrs || []),
          }))
          .filter(row => row.cidrs.length > 0);
        return (
          <SimpleTable
            emptyMessage={t('No node has CIDRs allocated from this pool.')}
            data={rows}
            columns={[
              {
                label: t('Node'),
                getter: (row: (typeof rows)[number]) => (
                  <CiliumLink kind="CiliumNode" name={row.node.metadata.name} />
                ),
              },
              {
                label: t('Allocated CIDRs'),
                getter: (row: (typeof rows)[number]) => <StringArray items={row.cidrs} monospace />,
              },
            ]}
          />
        );
      }}
    </ListState>
  );
}

export function PodIPPoolDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumPodIPPool')}
      sections={(pool: CiliumPodIPPool) => [
        {
          id: 'cilium-podpool-cidrs',
          section: (
            <SectionBox title={t('Address ranges')}>
              <NameValueTable
                rows={[
                  {
                    name: t('IPv4 CIDRs'),
                    value: <StringArray items={pool.spec.ipv4?.cidrs} monospace />,
                  },
                  {
                    name: t('IPv4 per-node mask size'),
                    value: pool.spec.ipv4?.maskSize ? `/${pool.spec.ipv4.maskSize}` : '-',
                  },
                  {
                    name: t('IPv6 CIDRs'),
                    value: <StringArray items={pool.spec.ipv6?.cidrs} monospace />,
                  },
                  {
                    name: t('IPv6 per-node mask size'),
                    value: pool.spec.ipv6?.maskSize ? `/${pool.spec.ipv6.maskSize}` : '-',
                  },
                  {
                    name: t('Pod selector'),
                    value: <SelectorView selector={pool.spec.podSelector} />,
                    hide: !pool.spec.podSelector,
                  },
                  {
                    name: t('Namespace selector'),
                    value: <SelectorView selector={pool.spec.namespaceSelector} />,
                    hide: !pool.spec.namespaceSelector,
                  },
                ]}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t(
                  'Pods use this pool when they or their namespace carry the annotation ipam.cilium.io/ip-pool with the pool name.'
                )}
              </Typography>
            </SectionBox>
          ),
        },
        {
          id: 'cilium-podpool-nodes',
          section: (
            <SectionBox title={t('Node allocations')}>
              <PodPoolNodes name={pool.metadata.name} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
