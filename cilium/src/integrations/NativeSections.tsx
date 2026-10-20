/**
 * "Cilium" sections appended to Headlamp's own Pod, Namespace, Node and Service detail pages.
 * They render nothing when Cilium is not installed or when there is nothing to show.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useText } from '../common/i18n';
import { EndpointState, EnforcementChips } from '../components/common/EndpointsTable';
import { CiliumLink, ResourceRefList } from '../components/common/ResourceRefLink';
import { HealthLabel, StringArray, UsageBar } from '../components/common/Shared';
import { PoliciesForSubject } from '../components/endpoints/Details';
import { useCiliumList, useNamespaceLabels } from '../hooks/useClusterData';
import { useCiliumDiscovery } from '../hooks/useDiscovery';
import {
  CiliumBGPAdvertisement,
  CiliumBGPClusterConfig,
  CiliumBGPNodeConfig,
} from '../resources/bgp';
import {
  CiliumClusterwideEnvoyConfig,
  CiliumEgressGatewayPolicy,
  CiliumEnvoyConfig,
  CiliumL2AnnouncementPolicy,
  CiliumLoadBalancerIPPool,
  CiliumLocalRedirectPolicy,
} from '../resources/network';
import { CiliumNetworkPolicy } from '../resources/networkPolicy';
import { CiliumEndpoint, CiliumNode } from '../resources/runtime';
import { NamespaceLike, NodeLike, PodLike, ServiceLike } from '../resources/types';
import { subjectFromIdentityLabels, subjectFromPod } from '../utils/policyMatch';
import {
  egressGatewayNodes,
  egressPolicySelectsPod,
  ipsFromPool,
  isLoadBalancer,
  l2LeaseName,
  l2PolicySelectsService,
  nodeSelectorMatches,
  poolSelectsService,
  redirectTargetsService,
  serviceLabelSet,
} from '../utils/relations';
import { matchesLabelSelector } from '../utils/selectors';

interface NativeResource<J> {
  kind: string;
  jsonData: J;
}

function refs(kind: string, items: Array<{ metadata: { name: string; namespace?: string } }>) {
  return items.map(item => ({
    group: 'cilium.io',
    kind,
    name: item.metadata.name,
    namespace: item.metadata.namespace,
  }));
}

function PodSection({ pod }: { pod: PodLike }) {
  const { t } = useText();
  const namespace = pod.metadata.namespace || '';
  const endpoints = useCiliumList<CiliumEndpoint>('CiliumEndpoint', namespace);
  const egress = useCiliumList<CiliumEgressGatewayPolicy>('CiliumEgressGatewayPolicy');
  const namespaceLabels = useNamespaceLabels();

  if (pod.spec?.hostNetwork) {
    return (
      <SectionBox title={t('Cilium')}>
        <Typography variant="body2" color="text.secondary">
          {t(
            'This pod uses the host network, so it has no Cilium endpoint. Its traffic is subject to host policies (clusterwide policies with a node selector).'
          )}
        </Typography>
      </SectionBox>
    );
  }

  const endpoint = (endpoints.items || []).find(e => e.metadata.name === pod.metadata.name);
  const labels = endpoint?.status.identity?.labels;
  // The endpoint's identity labels are what Cilium evaluates; fall back to the pod labels
  // while the endpoint does not exist yet.
  const subject = labels?.length
    ? subjectFromIdentityLabels(namespace, labels)
    : subjectFromPod(pod, namespaceLabels[namespace]);
  const egressPolicies = (egress.items || []).filter(policy =>
    egressPolicySelectsPod(policy.jsonData.spec, pod, namespaceLabels[namespace])
  );

  return (
    <SectionBox title={t('Cilium')}>
      <NameValueTable
        rows={[
          {
            name: t('Endpoint'),
            value: endpoint ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CiliumLink
                  kind="CiliumEndpoint"
                  name={endpoint.metadata.name}
                  namespace={namespace}
                />
                <EndpointState state={endpoint.state} />
              </Box>
            ) : endpoints.items ? (
              t('No Cilium endpoint exists for this pod yet')
            ) : endpoints.error ? (
              t('Cilium endpoints could not be listed')
            ) : (
              '…'
            ),
          },
          {
            name: t('Identity'),
            value:
              endpoint?.identityId !== undefined ? (
                <CiliumLink kind="CiliumIdentity" name={String(endpoint.identityId)} />
              ) : (
                '-'
              ),
            hide: !endpoint,
          },
          {
            name: t('Policy enforcement'),
            value: endpoint && (
              <EnforcementChips
                ingress={endpoint.ingressEnforcing}
                egress={endpoint.egressEnforcing}
              />
            ),
            hide: !endpoint,
          },
          {
            name: t('Egress gateway policies'),
            value: <ResourceRefList refs={refs('CiliumEgressGatewayPolicy', egressPolicies)} />,
            hide: egressPolicies.length === 0,
          },
        ]}
      />
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        {t('Network policies selecting this pod')}
      </Typography>
      <PoliciesForSubject
        subject={subject}
        emptyMessage={t('No Cilium policy selects this pod: all traffic is allowed.')}
      />
    </SectionBox>
  );
}

function NamespaceSection({ name }: { name: string }) {
  const { t } = useText();
  const policies = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy', name);
  const endpoints = useCiliumList<CiliumEndpoint>('CiliumEndpoint', name);
  const all = endpoints.items || [];
  const enforced = all.filter(e => e.ingressEnforcing || e.egressEnforcing).length;

  return (
    <SectionBox title={t('Cilium')}>
      <NameValueTable
        rows={[
          {
            name: t('Endpoints under policy'),
            value: endpoints.items ? (
              all.length ? (
                <UsageBar used={enforced} total={all.length} />
              ) : (
                t('No Cilium endpoints in this namespace')
              )
            ) : endpoints.error ? (
              t('Cilium endpoints could not be listed')
            ) : (
              '…'
            ),
          },
        ]}
      />
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        {t('Cilium network policies in this namespace')}
      </Typography>
      <SimpleTable
        emptyMessage={
          policies.error
            ? t('Cilium network policies could not be listed.')
            : t('No Cilium network policy in this namespace. Clusterwide policies may still apply.')
        }
        data={policies.items || []}
        columns={[
          {
            label: t('Policy'),
            getter: (policy: CiliumNetworkPolicy) => (
              <CiliumLink kind="CiliumNetworkPolicy" name={policy.metadata.name} namespace={name} />
            ),
          },
          {
            label: t('Ingress rules'),
            getter: (policy: CiliumNetworkPolicy) =>
              policy.features.ingressRules + policy.features.ingressDenyRules,
          },
          {
            label: t('Egress rules'),
            getter: (policy: CiliumNetworkPolicy) =>
              policy.features.egressRules + policy.features.egressDenyRules,
          },
          {
            label: t('Status'),
            getter: (policy: CiliumNetworkPolicy) => (
              <HealthLabel
                health={policy.validity.health}
                label={t(policy.validity.label)}
                tooltip={policy.validity.message}
              />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

function NodeSection({ node }: { node: NodeLike }) {
  const { t } = useText();
  const name = node.metadata.name;
  const ciliumNodes = useCiliumList<CiliumNode>('CiliumNode');
  const bgpNodeConfigs = useCiliumList<CiliumBGPNodeConfig>('CiliumBGPNodeConfig');
  const bgpClusterConfigs = useCiliumList<CiliumBGPClusterConfig>('CiliumBGPClusterConfig');
  const egress = useCiliumList<CiliumEgressGatewayPolicy>('CiliumEgressGatewayPolicy');
  const l2 = useCiliumList<CiliumL2AnnouncementPolicy>('CiliumL2AnnouncementPolicy');

  const ciliumNode = (ciliumNodes.items || []).find(n => n.metadata.name === name);
  const bgpNode = (bgpNodeConfigs.items || []).find(c => c.metadata.name === name);
  const clusterConfigs = (bgpClusterConfigs.items || []).filter(c =>
    nodeSelectorMatches(c.spec.nodeSelector, node)
  );
  const gatewayFor = (egress.items || []).filter(
    p => egressGatewayNodes(p.jsonData.spec, [node]).length > 0
  );
  const announces = (l2.items || []).filter(p => nodeSelectorMatches(p.spec.nodeSelector, node));

  if (ciliumNodes.items && !ciliumNode) {
    return (
      <SectionBox title={t('Cilium')}>
        <Typography variant="body2" color="text.secondary">
          {t('No CiliumNode exists for this node: the Cilium agent is not running on it.')}
        </Typography>
      </SectionBox>
    );
  }
  if (!ciliumNode) return null;

  return (
    <SectionBox title={t('Cilium')}>
      <NameValueTable
        rows={[
          { name: t('Cilium node'), value: <CiliumLink kind="CiliumNode" name={name} /> },
          { name: t('Cilium internal IP'), value: ciliumNode.ciliumInternalIP || '-' },
          { name: t('Pod CIDRs'), value: <StringArray items={ciliumNode.podCIDRs} monospace /> },
          {
            name: t('IPs in use'),
            value: ciliumNode.usedIPs,
            hide: !ciliumNode.status.ipam?.used,
          },
          {
            name: t('IPAM'),
            value: <HealthLabel health="error" label={ciliumNode.ipamError || ''} />,
            hide: !ciliumNode.ipamError,
          },
          {
            name: t('BGP sessions'),
            value: bgpNode && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HealthLabel
                  health={bgpNode.sessionHealth}
                  label={t('{{established}}/{{total}} established', { ...bgpNode.sessions })}
                />
                <CiliumLink kind="CiliumBGPNodeConfig" name={name} />
              </Box>
            ),
            hide: !bgpNode,
          },
          {
            name: t('BGP cluster configs'),
            value: <ResourceRefList refs={refs('CiliumBGPClusterConfig', clusterConfigs)} />,
            hide: clusterConfigs.length === 0,
          },
          {
            name: t('Egress gateway for'),
            value: <ResourceRefList refs={refs('CiliumEgressGatewayPolicy', gatewayFor)} />,
            hide: gatewayFor.length === 0,
          },
          {
            name: t('L2 announcement policies'),
            value: <ResourceRefList refs={refs('CiliumL2AnnouncementPolicy', announces)} />,
            hide: announces.length === 0,
          },
        ]}
      />
    </SectionBox>
  );
}

interface LeaseObject {
  jsonData: { metadata: { name: string }; spec?: { holderIdentity?: string } };
}

/** The node currently announcing a service over L2 (holder of its announcement lease). */
function L2LeaseHolder({ service }: { service: ServiceLike }) {
  const { t } = useText();
  const [leases] = K8s.ResourceClasses.Lease.useList();
  const lease = ((leases || []) as LeaseObject[]).find(
    l => l.jsonData.metadata.name === l2LeaseName(service)
  );
  const holder = lease?.jsonData.spec?.holderIdentity;
  if (!leases) return <>…</>;
  return holder ? (
    <ResourceRefList refs={[{ kind: 'Node', name: holder }]} />
  ) : (
    <Typography variant="body2" color="warning.main" component="span">
      {t('No node holds the announcement lease')}
    </Typography>
  );
}

function ServiceSection({ service }: { service: ServiceLike }) {
  const { t } = useText();
  const namespace = service.metadata.namespace;
  const pools = useCiliumList<CiliumLoadBalancerIPPool>('CiliumLoadBalancerIPPool');
  const l2 = useCiliumList<CiliumL2AnnouncementPolicy>('CiliumL2AnnouncementPolicy');
  const advertisements = useCiliumList<CiliumBGPAdvertisement>('CiliumBGPAdvertisement');
  const redirects = useCiliumList<CiliumLocalRedirectPolicy>('CiliumLocalRedirectPolicy');
  const envoy = useCiliumList<CiliumEnvoyConfig>('CiliumEnvoyConfig');
  const clusterEnvoy = useCiliumList<CiliumClusterwideEnvoyConfig>('CiliumClusterwideEnvoyConfig');

  const lb = isLoadBalancer(service);
  const matchingPools = (pools.items || []).filter(p =>
    poolSelectsService(p.jsonData.spec, service)
  );
  const sourcePools = matchingPools.filter(p => ipsFromPool(p.jsonData.spec, service).length > 0);
  const l2Policies = (l2.items || []).filter(p => l2PolicySelectsService(p.jsonData.spec, service));
  const labels = serviceLabelSet(service);
  const bgp = (advertisements.items || []).filter(ad =>
    ad.entries.some(
      e => e.advertisementType === 'Service' && matchesLabelSelector(e.selector, labels, 'none')
    )
  );
  const lrps = (redirects.items || []).filter(p => redirectTargetsService(p.jsonData, service));
  const envoyConfigs = [...(envoy.items || []), ...(clusterEnvoy.items || [])].filter(config =>
    [...(config.spec.services || []), ...(config.spec.backendServices || [])].some(
      s =>
        s.name === service.metadata.name && (s.namespace || config.metadata.namespace) === namespace
    )
  );

  const hasContent =
    (lb && (pools.items || []).length > 0) ||
    l2Policies.length + bgp.length + lrps.length + envoyConfigs.length > 0;
  if (!hasContent) return null;

  return (
    <SectionBox title={t('Cilium')}>
      <NameValueTable
        rows={[
          {
            name: t('LB IPAM pool'),
            value:
              sourcePools.length > 0 ? (
                <ResourceRefList refs={refs('CiliumLoadBalancerIPPool', sourcePools)} />
              ) : matchingPools.length > 0 ? (
                <Box>
                  <Typography variant="body2" color="warning.main">
                    {t('No address allocated yet. Pools that select this service:')}
                  </Typography>
                  <ResourceRefList refs={refs('CiliumLoadBalancerIPPool', matchingPools)} />
                </Box>
              ) : (
                <Typography variant="body2" color="warning.main">
                  {t('No LB IP pool selects this service')}
                </Typography>
              ),
            hide: !lb || (pools.items || []).length === 0,
          },
          {
            name: t('L2 announcement'),
            value: <ResourceRefList refs={refs('CiliumL2AnnouncementPolicy', l2Policies)} />,
            hide: l2Policies.length === 0,
          },
          {
            name: t('Announced by node'),
            value: <L2LeaseHolder service={service} />,
            hide: l2Policies.length === 0,
          },
          {
            name: t('BGP advertisements'),
            value: <ResourceRefList refs={refs('CiliumBGPAdvertisement', bgp)} />,
            hide: bgp.length === 0,
          },
          {
            name: t('Local redirect policies'),
            value: <ResourceRefList refs={refs('CiliumLocalRedirectPolicy', lrps)} />,
            hide: lrps.length === 0,
          },
          {
            name: t('Envoy configs'),
            value: (
              <ResourceRefList
                refs={envoyConfigs.map(c => ({
                  group: 'cilium.io',
                  kind: c.kind,
                  name: c.metadata.name,
                  namespace: c.metadata.namespace,
                }))}
              />
            ),
            hide: envoyConfigs.length === 0,
          },
        ]}
      />
    </SectionBox>
  );
}

const SUPPORTED_KINDS = ['Pod', 'Namespace', 'Node', 'Service'];

function Sections({ resource }: { resource: NativeResource<unknown> }) {
  const discovery = useCiliumDiscovery();
  if (discovery.status !== 'ready' || !discovery.availability.groupInstalled) return null;
  switch (resource.kind) {
    case 'Pod':
      return <PodSection pod={resource.jsonData as PodLike} />;
    case 'Namespace':
      return <NamespaceSection name={(resource.jsonData as NamespaceLike).metadata.name} />;
    case 'Node':
      return <NodeSection node={resource.jsonData as NodeLike} />;
    case 'Service':
      return <ServiceSection service={resource.jsonData as ServiceLike} />;
    default:
      return null;
  }
}

/** Entry point registered with `registerDetailsViewSection`. */
export function CiliumNativeSection({ resource }: { resource?: NativeResource<unknown> | null }) {
  if (!resource || !SUPPORTED_KINDS.includes(resource.kind)) return null;
  // Only core objects: other API groups reuse kind names such as "Service".
  const apiVersion = (resource.jsonData as { apiVersion?: string } | undefined)?.apiVersion;
  if (apiVersion && apiVersion !== 'v1') return null;
  return (
    <ErrorBoundary>
      <Sections resource={resource} />
    </ErrorBoundary>
  );
}
