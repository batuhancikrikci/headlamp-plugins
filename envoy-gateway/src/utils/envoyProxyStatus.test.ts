import { describe, expect, it } from 'vitest';
import { envoyProxyHealth, envoyProxyReferences } from './envoyProxyStatus';

const proxy = { name: 'gateway-config', namespace: 'kube-gateway' };
const paramsRef = {
  group: 'gateway.envoyproxy.io',
  kind: 'EnvoyProxy',
  name: 'gateway-config',
  namespace: 'kube-gateway',
};
const cond = (type: string, status: string, reason?: string) => ({ type, status, reason });

describe('envoyProxyReferences', () => {
  it('finds GatewayClasses and Gateways that use the proxy', () => {
    const refs = envoyProxyReferences(
      proxy,
      [
        {
          metadata: { name: 'envoy' },
          spec: { parametersRef: paramsRef },
          status: { conditions: [cond('Accepted', 'True')] },
        },
        { metadata: { name: 'other' }, spec: {} },
      ],
      [
        {
          metadata: { name: 'gw', namespace: 'kube-gateway' },
          spec: {
            infrastructure: {
              parametersRef: {
                group: 'gateway.envoyproxy.io',
                kind: 'EnvoyProxy',
                name: 'gateway-config',
              },
            },
          },
          status: {
            conditions: [
              cond('Accepted', 'True'),
              cond('Programmed', 'False', 'AddressNotAssigned'),
            ],
          },
        },
      ]
    );
    expect(refs.map(r => `${r.kind}/${r.name}`)).toEqual(['GatewayClass/envoy', 'Gateway/gw']);
    expect(refs[1].condition?.type).toBe('Programmed');
  });
});

describe('envoyProxyHealth', () => {
  it('is unknown when nothing references the proxy', () => {
    expect(envoyProxyHealth([])).toMatchObject({ health: 'unknown', key: 'Not in use' });
  });

  it('is healthy when a referencing GatewayClass accepted it', () => {
    expect(
      envoyProxyHealth([
        { kind: 'GatewayClass', name: 'envoy', condition: cond('Accepted', 'True') },
      ])
    ).toMatchObject({ health: 'success', params: { n: 1 } });
  });

  it('reports the referencing object that rejected it', () => {
    const h = envoyProxyHealth([
      { kind: 'GatewayClass', name: 'envoy', condition: cond('Accepted', 'True') },
      {
        kind: 'GatewayClass',
        name: 'bad',
        condition: cond('Accepted', 'False', 'InvalidParameters'),
      },
    ]);
    expect(h).toMatchObject({ health: 'error', params: { kind: 'GatewayClass', name: 'bad' } });
  });

  it('waits while referencing objects have no status', () => {
    expect(envoyProxyHealth([{ kind: 'Gateway', name: 'gw' }]).health).toBe('warning');
  });
});
