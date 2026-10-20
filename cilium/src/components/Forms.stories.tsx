// Storybook bundles the real Headlamp library; loading its entry point first initializes its
// modules in the right order before the resource classes extend KubeObject.
import '@kinvolk/headlamp-plugin/lib';
import { Box, Typography } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CodeBlock } from '../common/CodeBlock';
import { ResourceFormComponent } from '../common/form/ResourceEditor';
import { dumpYaml } from '../common/yaml';
import { KubeJson } from '../resources/types';
import { newResource } from '../utils/templates';
import { validateResource } from '../utils/validation';
import { BGPAdvertisementForm, BGPClusterConfigForm, BGPPeerConfigForm } from './bgp/Forms';
import { EgressGatewayPolicyForm } from './egress/Forms';
import { EnvoyConfigForm } from './envoy/Forms';
import { L2AnnouncementPolicyForm, LBIPPoolForm, PodIPPoolForm } from './lb/Forms';
import { CIDRGroupForm } from './policies/CIDRGroupForm';
import { NetworkPolicyForm } from './policies/Forms';

export default {
  title: 'Cilium/Forms',
  decorators: [
    Story => (
      <BrowserRouter>
        <Box sx={{ p: 3, maxWidth: 1100 }}>
          <Story />
        </Box>
      </BrowserRouter>
    ),
  ],
} as Meta;

/**
 * Renders a form the way the editor dialog does, with the resulting YAML and the validation
 * messages below it. Only cluster-scoped kinds are shown: namespace pickers need a cluster.
 */
function FormHarness({ Form, initial }: { Form: ResourceFormComponent; initial: KubeJson }) {
  const [value, setValue] = React.useState(initial);
  const errors = validateResource(value);
  return (
    <Box>
      <Form
        value={value}
        onChange={setValue}
        mode="create"
        errors={errors}
        onSubmit={() => undefined}
        submitting={false}
      />
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Validation
      </Typography>
      <Typography
        variant="body2"
        color={errors.length ? 'error.main' : 'success.main'}
        data-testid="validation"
      >
        {errors.length ? errors.map(e => e.key).join(' | ') : 'valid'}
      </Typography>
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        YAML
      </Typography>
      <CodeBlock value={dumpYaml(value)} />
    </Box>
  );
}

function named(kind: string, name: string, spec?: object, extra?: Partial<KubeJson>): KubeJson {
  const base = newResource(kind, 'cilium.io/v2');
  return { ...base, metadata: { ...base.metadata, name }, ...(spec ? { spec } : {}), ...extra };
}

export const ClusterwideNetworkPolicy: StoryFn = () => (
  <FormHarness
    Form={NetworkPolicyForm}
    initial={named('CiliumClusterwideNetworkPolicy', 'api-policy', {
      description: 'API tier',
      endpointSelector: {
        matchLabels: { app: 'api' },
        matchExpressions: [{ key: 'tier', operator: 'In', values: ['backend'] }],
      },
      ingress: [
        {
          fromEndpoints: [{ matchLabels: { app: 'web' } }],
          fromEntities: ['ingress'],
          toPorts: [
            {
              ports: [{ port: '8080', protocol: 'TCP' }],
              rules: { http: [{ method: 'GET', path: '/v1/.*' }] },
            },
          ],
        },
      ],
      ingressDeny: [{ fromCIDR: ['192.0.2.0/24'] }],
      egress: [
        {
          toEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': 'kube-system',
                'k8s:k8s-app': 'kube-dns',
              },
            },
          ],
          toPorts: [
            { ports: [{ port: '53', protocol: 'UDP' }], rules: { dns: [{ matchPattern: '*' }] } },
          ],
        },
        {
          toFQDNs: [{ matchName: 'api.example.com' }, { matchPattern: '*.cdn.example.com' }],
          toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }] }],
        },
        {
          toCIDRSet: [{ cidr: '10.0.0.0/8', except: ['10.96.0.0/12'] }],
          icmps: [{ fields: [{ family: 'IPv4', type: 8 }] }],
        },
      ],
      enableDefaultDeny: { egress: false },
    })}
  />
);

export const HostPolicyWithRuleSets: StoryFn = () => (
  <FormHarness
    Form={NetworkPolicyForm}
    initial={named('CiliumClusterwideNetworkPolicy', 'host-firewall', undefined, {
      spec: undefined,
      specs: [
        {
          description: 'Control plane',
          nodeSelector: { matchLabels: { 'node-role.kubernetes.io/control-plane': '' } },
          ingress: [
            {
              fromEntities: ['cluster'],
              toPorts: [{ ports: [{ port: '6443', protocol: 'TCP' }] }],
            },
          ],
        },
        { nodeSelector: {}, ingress: [{ fromEntities: ['health', 'remote-node'] }] },
      ],
    })}
  />
);

export const EmptyNetworkPolicy: StoryFn = () => (
  <FormHarness
    Form={NetworkPolicyForm}
    initial={newResource('CiliumClusterwideNetworkPolicy', 'cilium.io/v2')}
  />
);

export const CIDRGroup: StoryFn = () => (
  <FormHarness
    Form={CIDRGroupForm}
    initial={named('CiliumCIDRGroup', 'offices', {
      externalCIDRs: ['198.51.100.0/24', 'not-a-cidr'],
    })}
  />
);

export const BGPClusterConfig: StoryFn = () => (
  <FormHarness
    Form={BGPClusterConfigForm}
    initial={named('CiliumBGPClusterConfig', 'rack-1', {
      nodeSelector: { matchLabels: { rack: 'rack-1' } },
      bgpInstances: [
        {
          name: 'instance-65000',
          localASN: 65000,
          peers: [{ name: 'tor-1', peerAddress: '10.0.0.1', peerASN: 65001 }],
        },
      ],
    })}
  />
);

export const BGPPeerConfig: StoryFn = () => (
  <FormHarness Form={BGPPeerConfigForm} initial={named('CiliumBGPPeerConfig', 'tor-peers')} />
);

export const BGPAdvertisement: StoryFn = () => (
  <FormHarness
    Form={BGPAdvertisementForm}
    initial={named(
      'CiliumBGPAdvertisement',
      'bgp-advertisements',
      {
        advertisements: [
          {
            advertisementType: 'PodCIDR',
            attributes: { communities: { standard: ['65000:100'] } },
          },
          {
            advertisementType: 'Service',
            service: { addresses: ['LoadBalancerIP', 'ClusterIP'] },
            selector: { matchLabels: { announce: 'bgp' } },
          },
          { advertisementType: 'Interface', interface: { name: 'lo' } },
        ],
      },
      { metadata: { name: 'bgp-advertisements', labels: { advertise: 'bgp' } } }
    )}
  />
);

export const LoadBalancerIPPool: StoryFn = () => (
  <FormHarness
    Form={LBIPPoolForm}
    initial={named('CiliumLoadBalancerIPPool', 'lb-pool', {
      blocks: [{ cidr: '192.168.10.0/24' }, { start: '192.168.20.10', stop: '192.168.20.50' }],
      serviceSelector: { matchLabels: { 'io.kubernetes.service.namespace': 'shop' } },
      allowFirstLastIPs: 'No',
    })}
  />
);

export const L2AnnouncementPolicy: StoryFn = () => (
  <FormHarness
    Form={L2AnnouncementPolicyForm}
    initial={named('CiliumL2AnnouncementPolicy', 'l2', {
      loadBalancerIPs: true,
      interfaces: ['^eth[0-9]+'],
      nodeSelector: {
        matchExpressions: [
          { key: 'node-role.kubernetes.io/control-plane', operator: 'DoesNotExist' },
        ],
      },
    })}
  />
);

export const PodIPPool: StoryFn = () => (
  <FormHarness
    Form={PodIPPoolForm}
    initial={named('CiliumPodIPPool', 'tenant-a', {
      ipv4: { cidrs: ['10.20.0.0/16'], maskSize: 27 },
    })}
  />
);

export const EgressGatewayPolicy: StoryFn = () => (
  <FormHarness
    Form={EgressGatewayPolicyForm}
    initial={named('CiliumEgressGatewayPolicy', 'egress-shop', {
      selectors: [{ podSelector: { matchLabels: { 'io.kubernetes.pod.namespace': 'shop' } } }],
      destinationCIDRs: ['0.0.0.0/0'],
      excludedCIDRs: ['10.0.0.0/8'],
      egressGateway: {
        nodeSelector: { matchLabels: { role: 'egress' } },
        egressIP: '192.168.10.50',
      },
    })}
  />
);

export const ClusterwideEnvoyConfig: StoryFn = () => (
  <FormHarness
    Form={EnvoyConfigForm}
    initial={named('CiliumClusterwideEnvoyConfig', 'envoy-lb', {
      backendServices: [{ name: 'web', namespace: 'shop', number: ['80'] }],
      resources: [
        {
          '@type': 'type.googleapis.com/envoy.config.listener.v3.Listener',
          name: 'envoy-lb-listener',
        },
      ],
    })}
  />
);
