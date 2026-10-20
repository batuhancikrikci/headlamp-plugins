import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useCiliumList, useNodes } from '../../hooks/useClusterData';
import {
  BGPAdvertisementEntry,
  BGPClusterInstance,
  BGPClusterPeer,
  BGPFamily,
  BGPNodeInstance,
  BGPNodeOverrideInstance,
  BGPNodePeerStatus,
  BGPVirtualRouter,
  CiliumBGPAdvertisement,
  CiliumBGPClusterConfig,
  CiliumBGPNodeConfig,
  CiliumBGPNodeConfigOverride,
  CiliumBGPPeerConfig,
  CiliumBGPPeeringPolicy,
  familyLabel,
  peeringStateHealth,
  problemConditions,
  problemHealth,
} from '../../resources/bgp';
import { crd } from '../../resources/registry';
import { Condition } from '../../resources/types';
import { advertisementsForFamily, selectedNodes } from '../../utils/relations';
import { selectorToString } from '../../utils/selectors';
import { MatchingNodes } from '../common/MatchingNodes';
import { CiliumLink, ResourceRefLink, ResourceRefList } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray, useYesNo } from '../common/Shared';
import { CiliumDetailView, CiliumListView } from '../common/Views';

/** Status of a BGP resource whose conditions describe problems. */
function ProblemStatus({ conditions }: { conditions: Condition[] }) {
  const { t } = useText();
  const problems = problemConditions(conditions);
  const health = problemHealth(conditions);
  if (health === 'unknown') {
    return <HealthLabel health="unknown" label={t('No status')} />;
  }
  if (problems.length === 0) return <HealthLabel health="success" label={t('OK')} />;
  return (
    <HealthLabel
      health="error"
      label={problems.map(p => p.type).join(', ')}
      tooltip={problems.map(p => p.message || p.reason || p.type).join(' — ')}
    />
  );
}

function SessionStatus({ config }: { config: CiliumBGPNodeConfig }) {
  const { t } = useText();
  const { total, established } = config.sessions;
  if (total === 0) return <HealthLabel health="unknown" label={t('No peers')} />;
  return (
    <HealthLabel
      health={config.sessionHealth}
      label={t('{{established}}/{{total}} established', { established, total })}
    />
  );
}

export function BGPClusterConfigList() {
  const { t } = useText();
  const nodes = useNodes();
  return (
    <CiliumListView
      crd={crd('CiliumBGPClusterConfig')}
      columns={[
        {
          id: 'nodeSelector',
          label: t('Node selector'),
          render: (config: CiliumBGPClusterConfig) => (
            <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />
          ),
          getValue: (config: CiliumBGPClusterConfig) => selectorToString(config.spec.nodeSelector),
        },
        {
          id: 'instances',
          label: t('Instances'),
          render: (config: CiliumBGPClusterConfig) => (
            <StringArray
              items={config.instances.map(i => `${i.name} (AS ${i.localASN ?? '?'})`)}
              max={3}
            />
          ),
          getValue: (config: CiliumBGPClusterConfig) =>
            config.instances.map(i => `${i.name} ${i.localASN}`).join(', '),
        },
        {
          id: 'peers',
          label: t('Peers'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumBGPClusterConfig) => config.peerCount,
        },
        {
          id: 'nodes',
          label: t('Nodes'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumBGPClusterConfig) =>
            nodes.items ? selectedNodes(config.spec.nodeSelector, nodes.items).length : '…',
        },
        {
          id: 'status',
          label: t('Status'),
          gridTemplate: 'min-content',
          render: (config: CiliumBGPClusterConfig) => (
            <ProblemStatus conditions={config.conditions} />
          ),
          getValue: (config: CiliumBGPClusterConfig) =>
            problemConditions(config.conditions)
              .map(c => c.type)
              .join(', ') || 'ok',
        },
      ]}
    />
  );
}

/** Session state of every node the cluster config applies to. */
function ClusterConfigNodes({ config }: { config: CiliumBGPClusterConfig }) {
  const { t } = useText();
  const nodes = useNodes();
  const nodeConfigs = useCiliumList<CiliumBGPNodeConfig>('CiliumBGPNodeConfig');
  const loading = nodes.items === null || nodeConfigs.items === null;
  const byName = new Map((nodeConfigs.items || []).map(c => [c.metadata.name, c]));
  const matched = selectedNodes(config.spec.nodeSelector, nodes.items || []);

  return (
    <ListState items={loading ? null : matched} error={nodes.error} what={t('nodes')} dense>
      {items => (
        <SimpleTable
          emptyMessage={t('No node matches the node selector, so no BGP session is configured.')}
          data={items}
          columns={[
            {
              label: t('Node'),
              getter: (node: (typeof matched)[number]) => (
                <ResourceRefLink kind="Node" name={node.metadata.name} />
              ),
            },
            {
              label: t('BGP node config'),
              getter: (node: (typeof matched)[number]) =>
                byName.has(node.metadata.name) ? (
                  <CiliumLink kind="CiliumBGPNodeConfig" name={node.metadata.name} />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('Not generated yet')}
                  </Typography>
                ),
            },
            {
              label: t('Sessions'),
              getter: (node: (typeof matched)[number]) => {
                const nodeConfig = byName.get(node.metadata.name);
                return nodeConfig ? <SessionStatus config={nodeConfig} /> : '-';
              },
            },
          ]}
        />
      )}
    </ListState>
  );
}

function InstancePeers({ instance }: { instance: BGPClusterInstance }) {
  const { t } = useText();
  return (
    <Box sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {instance.name} · AS {instance.localASN ?? '?'}
        {instance.localPort ? ` · ${t('port {{port}}', { port: instance.localPort })}` : ''}
      </Typography>
      <SimpleTable
        emptyMessage={t('This instance has no peers.')}
        data={instance.peers || []}
        columns={[
          { label: t('Peer'), getter: (peer: BGPClusterPeer) => peer.name },
          {
            label: t('Address'),
            getter: (peer: BGPClusterPeer) =>
              peer.peerAddress || (peer.autoDiscovery ? t('Auto-discovered') : '-'),
          },
          { label: t('Peer ASN'), getter: (peer: BGPClusterPeer) => peer.peerASN ?? '-' },
          {
            label: t('Peer config'),
            getter: (peer: BGPClusterPeer) =>
              peer.peerConfigRef?.name ? (
                <CiliumLink kind="CiliumBGPPeerConfig" name={peer.peerConfigRef.name} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('Defaults')}
                </Typography>
              ),
          },
        ]}
      />
    </Box>
  );
}

export function BGPClusterConfigDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPClusterConfig')}
      conditions="problem"
      extraInfo={(config: CiliumBGPClusterConfig) => [
        { name: t('Status'), value: <ProblemStatus conditions={config.conditions} /> },
        {
          name: t('Node selector'),
          value: <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />,
        },
        { name: t('Instances'), value: config.instances.length },
        { name: t('Peers'), value: config.peerCount },
      ]}
      sections={(config: CiliumBGPClusterConfig) => [
        {
          id: 'cilium-bgp-instances',
          section: (
            <SectionBox title={t('BGP instances')}>
              {config.instances.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('No BGP instances configured.')}
                </Typography>
              ) : (
                config.instances.map(instance => (
                  <InstancePeers key={instance.name} instance={instance} />
                ))
              )}
            </SectionBox>
          ),
        },
        {
          id: 'cilium-bgp-nodes',
          section: (
            <SectionBox title={t('Nodes')}>
              <ClusterConfigNodes config={config} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

function timersLabel(config: CiliumBGPPeerConfig): string {
  const timers = config.spec.timers;
  if (!timers?.holdTimeSeconds && !timers?.keepAliveTimeSeconds) return '-';
  return `${timers.holdTimeSeconds ?? '-'}s / ${timers.keepAliveTimeSeconds ?? '-'}s`;
}

export function BGPPeerConfigList() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumListView
      crd={crd('CiliumBGPPeerConfig')}
      columns={[
        {
          id: 'families',
          label: t('Address families'),
          render: (config: CiliumBGPPeerConfig) => (
            <StringArray items={config.families.map(familyLabel)} />
          ),
          getValue: (config: CiliumBGPPeerConfig) => config.families.map(familyLabel).join(', '),
        },
        {
          id: 'timers',
          label: t('Hold / keepalive'),
          getValue: timersLabel,
        },
        {
          id: 'auth',
          label: t('Authentication'),
          getValue: (config: CiliumBGPPeerConfig) => config.spec.authSecretRef || '-',
        },
        {
          id: 'gracefulRestart',
          label: t('Graceful restart'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumBGPPeerConfig) =>
            yesNo(config.spec.gracefulRestart?.enabled, true),
        },
        {
          id: 'multihop',
          label: t('eBGP multihop'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumBGPPeerConfig) => config.spec.ebgpMultihop ?? '-',
        },
        {
          id: 'status',
          label: t('Status'),
          gridTemplate: 'min-content',
          render: (config: CiliumBGPPeerConfig) => <ProblemStatus conditions={config.conditions} />,
          getValue: (config: CiliumBGPPeerConfig) =>
            problemConditions(config.conditions)
              .map(c => c.type)
              .join(', ') || 'ok',
        },
      ]}
    />
  );
}

/** Advertisements each address family of a peer config picks up. */
function FamilyAdvertisements({ families }: { families: BGPFamily[] }) {
  const { t } = useText();
  const advertisements = useCiliumList<CiliumBGPAdvertisement>('CiliumBGPAdvertisement');
  return (
    <ListState
      items={advertisements.items}
      error={advertisements.error}
      what={t('BGP advertisements')}
      dense
    >
      {items => (
        <SimpleTable
          emptyMessage={t('No address families configured: IPv4 unicast is negotiated by default.')}
          data={families}
          columns={[
            { label: t('Family'), getter: (family: BGPFamily) => familyLabel(family) },
            {
              label: t('Advertisement selector'),
              getter: (family: BGPFamily) => (
                <SelectorView
                  selector={family.advertisements}
                  emptyLabel={t('All advertisements')}
                  nilLabel={t('None (nothing is advertised)')}
                />
              ),
            },
            {
              label: t('Matching advertisements'),
              getter: (family: BGPFamily) => {
                const matched = advertisementsForFamily(
                  family,
                  items.map(a => a.jsonData)
                );
                return matched.length === 0 ? (
                  <Typography variant="body2" color="warning.main">
                    {t('None')}
                  </Typography>
                ) : (
                  <ResourceRefList
                    refs={matched.map(a => ({
                      group: 'cilium.io',
                      kind: 'CiliumBGPAdvertisement',
                      name: a.metadata.name,
                    }))}
                  />
                );
              },
            },
          ]}
        />
      )}
    </ListState>
  );
}

function PeerConfigUsedBy({ name }: { name: string }) {
  const { t } = useText();
  const configs = useCiliumList<CiliumBGPClusterConfig>('CiliumBGPClusterConfig');
  return (
    <ListState items={configs.items} error={configs.error} what={t('BGP cluster configs')} dense>
      {items => {
        const rows = items.flatMap(config =>
          config.instances.flatMap(instance =>
            (instance.peers || [])
              .filter(peer => peer.peerConfigRef?.name === name)
              .map(peer => ({ config, instance, peer }))
          )
        );
        return (
          <SimpleTable
            emptyMessage={t('No BGP cluster config references this peer config.')}
            data={rows}
            columns={[
              {
                label: t('Cluster config'),
                getter: (row: (typeof rows)[number]) => (
                  <CiliumLink kind="CiliumBGPClusterConfig" name={row.config.metadata.name} />
                ),
              },
              { label: t('Instance'), getter: (row: (typeof rows)[number]) => row.instance.name },
              { label: t('Peer'), getter: (row: (typeof rows)[number]) => row.peer.name },
              {
                label: t('Address'),
                getter: (row: (typeof rows)[number]) => row.peer.peerAddress || '-',
              },
              {
                label: t('Peer ASN'),
                getter: (row: (typeof rows)[number]) => row.peer.peerASN ?? '-',
              },
            ]}
          />
        );
      }}
    </ListState>
  );
}

export function BGPPeerConfigDetail() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPPeerConfig')}
      conditions="problem"
      extraInfo={(config: CiliumBGPPeerConfig) => {
        const { transport, timers, gracefulRestart } = config.spec;
        return [
          { name: t('Status'), value: <ProblemStatus conditions={config.conditions} /> },
          { name: t('Peer port'), value: transport?.peerPort ?? t('179 (default)') },
          {
            name: t('Source interface'),
            value: transport?.sourceInterface,
            hide: !transport?.sourceInterface,
          },
          {
            name: t('Hold time'),
            value: timers?.holdTimeSeconds ? `${timers.holdTimeSeconds}s` : t('Default'),
          },
          {
            name: t('Keepalive time'),
            value: timers?.keepAliveTimeSeconds ? `${timers.keepAliveTimeSeconds}s` : t('Default'),
          },
          {
            name: t('Connect retry time'),
            value: `${timers?.connectRetryTimeSeconds}s`,
            hide: !timers?.connectRetryTimeSeconds,
          },
          {
            name: t('Authentication secret'),
            value: config.spec.authSecretRef || t('None'),
          },
          {
            name: t('Graceful restart'),
            value: gracefulRestart?.enabled
              ? t('Enabled ({{seconds}}s restart time)', {
                  seconds: gracefulRestart.restartTimeSeconds ?? 120,
                })
              : yesNo(false),
          },
          {
            name: t('eBGP multihop TTL'),
            value: config.spec.ebgpMultihop,
            hide: !config.spec.ebgpMultihop,
          },
        ];
      }}
      sections={(config: CiliumBGPPeerConfig) => [
        {
          id: 'cilium-bgp-families',
          section: (
            <SectionBox title={t('Address families and advertisements')}>
              <FamilyAdvertisements families={config.families} />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-bgp-peerconfig-usedby',
          section: (
            <SectionBox title={t('Used by')}>
              <PeerConfigUsedBy name={config.metadata.name} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

function advertisementDetail(entry: BGPAdvertisementEntry): string {
  switch (entry.advertisementType) {
    case 'Service':
      return (entry.service?.addresses || []).join(', ') || '-';
    case 'Interface':
      return entry.interface?.name || '-';
    default:
      return '-';
  }
}

export function BGPAdvertisementList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumBGPAdvertisement')}
      columns={[
        {
          id: 'types',
          label: t('Advertises'),
          render: (ad: CiliumBGPAdvertisement) => <StringArray items={ad.types} />,
          getValue: (ad: CiliumBGPAdvertisement) => ad.types.join(', '),
        },
        {
          id: 'serviceAddresses',
          label: t('Service addresses'),
          getValue: (ad: CiliumBGPAdvertisement) =>
            Array.from(new Set(ad.entries.flatMap(e => e.service?.addresses || []))).join(', ') ||
            '-',
        },
        {
          id: 'labels',
          label: t('Labels'),
          render: (ad: CiliumBGPAdvertisement) => (
            <StringArray
              items={Object.entries(ad.metadata.labels || {}).map(([k, v]) => `${k}=${v}`)}
              max={3}
              monospace
            />
          ),
          getValue: (ad: CiliumBGPAdvertisement) =>
            Object.entries(ad.metadata.labels || {})
              .map(([k, v]) => `${k}=${v}`)
              .join(', '),
        },
      ]}
    />
  );
}

function AdvertisementSelectedBy({ advertisement }: { advertisement: CiliumBGPAdvertisement }) {
  const { t } = useText();
  const peerConfigs = useCiliumList<CiliumBGPPeerConfig>('CiliumBGPPeerConfig');
  return (
    <ListState
      items={peerConfigs.items}
      error={peerConfigs.error}
      what={t('BGP peer configs')}
      dense
    >
      {items => {
        const rows = items.flatMap(config =>
          config.families
            .filter(family => advertisementsForFamily(family, [advertisement.jsonData]).length > 0)
            .map(family => ({ config, family }))
        );
        if (rows.length === 0) {
          return (
            <Typography variant="body2" color="warning.main">
              {t(
                'No BGP peer config selects this advertisement, so it is not announced to any peer. Peer configs select advertisements by label.'
              )}
            </Typography>
          );
        }
        return (
          <SimpleTable
            data={rows}
            columns={[
              {
                label: t('Peer config'),
                getter: (row: (typeof rows)[number]) => (
                  <CiliumLink kind="CiliumBGPPeerConfig" name={row.config.metadata.name} />
                ),
              },
              {
                label: t('Family'),
                getter: (row: (typeof rows)[number]) => familyLabel(row.family),
              },
            ]}
          />
        );
      }}
    </ListState>
  );
}

export function BGPAdvertisementDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPAdvertisement')}
      extraInfo={(ad: CiliumBGPAdvertisement) => [
        { name: t('Advertises'), value: <StringArray items={ad.types} /> },
      ]}
      sections={(ad: CiliumBGPAdvertisement) => [
        {
          id: 'cilium-bgp-advertisements',
          section: (
            <SectionBox title={t('Advertisements')}>
              <SimpleTable
                emptyMessage={t('No advertisements configured.')}
                data={ad.entries}
                columns={[
                  { label: t('Type'), getter: (e: BGPAdvertisementEntry) => e.advertisementType },
                  { label: t('Details'), getter: advertisementDetail },
                  {
                    label: t('Selector'),
                    getter: (e: BGPAdvertisementEntry) =>
                      e.advertisementType === 'PodCIDR' || e.advertisementType === 'Interface' ? (
                        '-'
                      ) : (
                        <SelectorView
                          selector={e.selector}
                          emptyLabel={t('All')}
                          nilLabel={t('None (nothing selected)')}
                        />
                      ),
                  },
                  {
                    label: t('Communities'),
                    getter: (e: BGPAdvertisementEntry) => {
                      const c = e.attributes?.communities;
                      return (
                        <StringArray
                          items={[
                            ...(c?.standard || []),
                            ...(c?.large || []),
                            ...(c?.wellKnown || []),
                          ]}
                        />
                      );
                    },
                  },
                  {
                    label: t('Local preference'),
                    getter: (e: BGPAdvertisementEntry) => e.attributes?.localPreference ?? '-',
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-bgp-advertisement-selectedby',
          section: (
            <SectionBox title={t('Selected by')}>
              <AdvertisementSelectedBy advertisement={ad} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

export function BGPNodeConfigList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumBGPNodeConfig')}
      columns={[
        {
          id: 'instances',
          label: t('Instances'),
          render: (config: CiliumBGPNodeConfig) => (
            <StringArray items={config.instances.map(i => `${i.name} (AS ${i.localASN ?? '?'})`)} />
          ),
          getValue: (config: CiliumBGPNodeConfig) =>
            config.instances.map(i => `${i.name} ${i.localASN}`).join(', '),
        },
        {
          id: 'routerID',
          label: t('Router ID'),
          getValue: (config: CiliumBGPNodeConfig) =>
            config.instances
              .map(i => i.routerID)
              .filter(Boolean)
              .join(', ') || '-',
        },
        {
          id: 'peers',
          label: t('Peers'),
          gridTemplate: 'min-content',
          getValue: (config: CiliumBGPNodeConfig) => config.sessions.total,
        },
        {
          id: 'sessions',
          label: t('Sessions'),
          gridTemplate: 'min-content',
          render: (config: CiliumBGPNodeConfig) => <SessionStatus config={config} />,
          getValue: (config: CiliumBGPNodeConfig) =>
            `${config.sessions.established}/${config.sessions.total}`,
        },
      ]}
    />
  );
}

function NodeInstance({
  instance,
  statuses,
}: {
  instance: BGPNodeInstance;
  statuses: BGPNodePeerStatus[];
}) {
  const { t } = useText();
  const rows = (instance.peers || []).map(peer => ({
    peer,
    status: statuses.find(s => s.name === peer.name),
  }));
  return (
    <Box sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {instance.name} · AS {instance.localASN ?? '?'}
        {instance.routerID ? ` · ${t('router ID {{id}}', { id: instance.routerID })}` : ''}
      </Typography>
      <SimpleTable
        emptyMessage={t('This instance has no peers.')}
        data={rows}
        columns={[
          { label: t('Peer'), getter: (row: (typeof rows)[number]) => row.peer.name },
          {
            label: t('Address'),
            getter: (row: (typeof rows)[number]) => row.peer.peerAddress || '-',
          },
          { label: t('Peer ASN'), getter: (row: (typeof rows)[number]) => row.peer.peerASN ?? '-' },
          {
            label: t('State'),
            getter: (row: (typeof rows)[number]) => (
              <HealthLabel
                health={peeringStateHealth(row.status?.peeringState)}
                label={row.status?.peeringState || t('unknown')}
              />
            ),
          },
          {
            label: t('Established since'),
            getter: (row: (typeof rows)[number]) => row.status?.establishedTime || '-',
          },
          {
            label: t('Routes (received / advertised)'),
            getter: (row: (typeof rows)[number]) =>
              (row.status?.routeCount || [])
                .map(r => `${familyLabel(r)}: ${r.received ?? 0} / ${r.advertised ?? 0}`)
                .join(' · ') || '-',
          },
          {
            label: t('Peer config'),
            getter: (row: (typeof rows)[number]) =>
              row.peer.peerConfigRef?.name ? (
                <CiliumLink kind="CiliumBGPPeerConfig" name={row.peer.peerConfigRef.name} />
              ) : (
                '-'
              ),
          },
        ]}
      />
    </Box>
  );
}

export function BGPNodeConfigDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPNodeConfig')}
      conditions="problem"
      extraInfo={(config: CiliumBGPNodeConfig) => [
        { name: t('Sessions'), value: <SessionStatus config={config} /> },
        { name: t('Node'), value: <ResourceRefLink kind="Node" name={config.metadata.name} /> },
        {
          name: t('Override'),
          value: <CiliumLink kind="CiliumBGPNodeConfigOverride" name={config.metadata.name} />,
        },
        {
          name: t('Managed by'),
          value: (
            <ResourceRefList
              refs={(config.metadata.ownerReferences || []).map(owner => ({
                group: 'cilium.io',
                kind: owner.kind,
                name: owner.name,
                showKind: true,
              }))}
            />
          ),
          hide: !config.metadata.ownerReferences?.length,
        },
      ]}
      sections={(config: CiliumBGPNodeConfig) => [
        {
          id: 'cilium-bgp-node-peers',
          section: (
            <SectionBox title={t('BGP sessions')}>
              {config.instances.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('No BGP instances configured for this node.')}
                </Typography>
              ) : (
                config.instances.map(instance => (
                  <NodeInstance
                    key={instance.name}
                    instance={instance}
                    statuses={
                      (config.status.bgpInstances || []).find(s => s.name === instance.name)
                        ?.peers || []
                    }
                  />
                ))
              )}
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

export function BGPNodeConfigOverrideList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumBGPNodeConfigOverride')}
      columns={[
        {
          id: 'instances',
          label: t('Instances'),
          render: (override: CiliumBGPNodeConfigOverride) => (
            <StringArray items={override.instances.map(i => i.name)} />
          ),
          getValue: (override: CiliumBGPNodeConfigOverride) =>
            override.instances.map(i => i.name).join(', '),
        },
        {
          id: 'routerID',
          label: t('Router ID'),
          getValue: (override: CiliumBGPNodeConfigOverride) =>
            override.instances
              .map(i => i.routerID)
              .filter(Boolean)
              .join(', ') || '-',
        },
        {
          id: 'localPort',
          label: t('Local port'),
          getValue: (override: CiliumBGPNodeConfigOverride) =>
            override.instances
              .map(i => i.localPort)
              .filter(Boolean)
              .join(', ') || '-',
        },
      ]}
    />
  );
}

export function BGPNodeConfigOverrideDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPNodeConfigOverride')}
      extraInfo={(override: CiliumBGPNodeConfigOverride) => [
        { name: t('Node'), value: <ResourceRefLink kind="Node" name={override.metadata.name} /> },
        {
          name: t('BGP node config'),
          value: <CiliumLink kind="CiliumBGPNodeConfig" name={override.metadata.name} />,
        },
      ]}
      sections={(override: CiliumBGPNodeConfigOverride) => [
        {
          id: 'cilium-bgp-override-instances',
          section: (
            <SectionBox title={t('Instance overrides')}>
              {override.instances.map((instance: BGPNodeOverrideInstance) => (
                <Box key={instance.name} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
                  <Typography variant="subtitle2">{instance.name}</Typography>
                  <NameValueTable
                    rows={[
                      { name: t('Router ID'), value: instance.routerID || '-' },
                      { name: t('Local port'), value: instance.localPort ?? '-' },
                      { name: t('Local ASN'), value: instance.localASN, hide: !instance.localASN },
                      {
                        name: t('Peer overrides'),
                        value:
                          (instance.peers || [])
                            .map(
                              p =>
                                `${p.name}: ${p.localAddress || '-'}${
                                  p.localPort ? `:${p.localPort}` : ''
                                }`
                            )
                            .join(' · ') || '-',
                      },
                    ]}
                  />
                </Box>
              ))}
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

export function BGPPeeringPolicyList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumBGPPeeringPolicy')}
      columns={[
        {
          id: 'nodeSelector',
          label: t('Node selector'),
          render: (policy: CiliumBGPPeeringPolicy) => (
            <SelectorView selector={policy.spec.nodeSelector} emptyLabel={t('All nodes')} />
          ),
          getValue: (policy: CiliumBGPPeeringPolicy) => selectorToString(policy.spec.nodeSelector),
        },
        {
          id: 'asns',
          label: t('Local ASNs'),
          getValue: (policy: CiliumBGPPeeringPolicy) =>
            policy.virtualRouters.map(r => r.localASN).join(', ') || '-',
        },
        {
          id: 'neighbors',
          label: t('Neighbors'),
          gridTemplate: 'min-content',
          getValue: (policy: CiliumBGPPeeringPolicy) =>
            policy.virtualRouters.reduce((n, r) => n + (r.neighbors?.length || 0), 0),
        },
      ]}
    />
  );
}

export function BGPPeeringPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();
  return (
    <CiliumDetailView
      crd={crd('CiliumBGPPeeringPolicy')}
      extraInfo={(policy: CiliumBGPPeeringPolicy) => [
        {
          name: t('Node selector'),
          value: <SelectorView selector={policy.spec.nodeSelector} emptyLabel={t('All nodes')} />,
        },
      ]}
      sections={(policy: CiliumBGPPeeringPolicy) => [
        {
          id: 'cilium-bgp-virtual-routers',
          section: (
            <SectionBox title={t('Virtual routers')}>
              <SimpleTable
                emptyMessage={t('No virtual routers configured.')}
                data={policy.virtualRouters}
                columns={[
                  { label: t('Local ASN'), getter: (r: BGPVirtualRouter) => r.localASN ?? '-' },
                  {
                    label: t('Export pod CIDR'),
                    getter: (r: BGPVirtualRouter) => yesNo(r.exportPodCIDR, true),
                  },
                  {
                    label: t('Neighbors'),
                    getter: (r: BGPVirtualRouter) => (
                      <StringArray
                        items={(r.neighbors || []).map(n => `${n.peerAddress} (AS ${n.peerASN})`)}
                      />
                    ),
                  },
                  {
                    label: t('Service selector'),
                    getter: (r: BGPVirtualRouter) => (
                      <SelectorView selector={r.serviceSelector} nilLabel={t('None')} />
                    ),
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-bgp-policy-nodes',
          section: (
            <SectionBox title={t('Matching nodes')}>
              <MatchingNodes selector={policy.spec.nodeSelector} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
