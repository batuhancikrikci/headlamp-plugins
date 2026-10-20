import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PolicyVisualization } from './PolicyVisualization';

export default {
  title: 'Cilium/PolicyVisualization',
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

export const IngressAndEgress: StoryFn = () => (
  <PolicyVisualization
    namespace="shop"
    rules={[
      {
        description:
          'API accepts traffic from the web tier and talks to the database and one SaaS API.',
        endpointSelector: { matchLabels: { app: 'api' } },
        ingress: [
          {
            fromEndpoints: [{ matchLabels: { app: 'web' } }],
            toPorts: [
              {
                ports: [{ port: '8080', protocol: 'TCP' }],
                rules: {
                  http: [
                    { method: 'GET', path: '/v1/.*' },
                    { method: 'POST', path: '/v1/orders' },
                  ],
                },
              },
            ],
          },
          { fromEntities: ['ingress'] },
        ],
        egress: [
          {
            toEndpoints: [
              { matchLabels: { app: 'db', 'k8s:io.kubernetes.pod.namespace': 'data' } },
            ],
            toPorts: [{ ports: [{ port: '5432', protocol: 'TCP' }] }],
          },
          {
            toFQDNs: [{ matchName: 'api.payments.example.com' }],
            toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }] }],
          },
        ],
        egressDeny: [{ toCIDRSet: [{ cidr: '169.254.0.0/16' }] }],
      },
    ]}
  />
);

export const DefaultDenyOnly: StoryFn = () => (
  <PolicyVisualization namespace="shop" rules={[{ endpointSelector: {}, ingress: [{}] }]} />
);

export const HostPolicy: StoryFn = () => (
  <PolicyVisualization
    rules={[
      {
        nodeSelector: { matchLabels: { 'node-role.kubernetes.io/control-plane': '' } },
        ingress: [
          {
            fromEntities: ['cluster'],
            toPorts: [{ ports: [{ port: '6443', protocol: 'TCP' }] }],
          },
          {
            fromCIDR: ['198.51.100.0/24'],
            toPorts: [{ ports: [{ port: '22', protocol: 'TCP' }] }],
          },
        ],
      },
    ]}
  />
);

export const MultipleRuleSets: StoryFn = () => (
  <PolicyVisualization
    rules={[
      { endpointSelector: { matchLabels: { app: 'web' } }, ingress: [{ fromEntities: ['world'] }] },
      {
        endpointSelector: { matchLabels: { app: 'worker' } },
        egress: [{ toEntities: ['kube-apiserver'] }],
        enableDefaultDeny: { egress: false },
      },
    ]}
  />
);

export const NoRules: StoryFn = () => <PolicyVisualization rules={[]} />;
