import { describe, expect, it } from 'vitest';
import {
  bestServicePort,
  formFromAISB,
  mergeAISBSpec,
  portUsesTLS,
  presetForSchema,
  serviceHostname,
} from './backendForm';

describe('bestServicePort', () => {
  it('uses the only port', () => {
    expect(bestServicePort([{ port: 9999 }])?.port).toBe(9999);
  });
  it('prefers well-named ports, then known inference ports', () => {
    expect(
      bestServicePort([
        { name: 'metrics', port: 9090 },
        { name: 'http', port: 8081 },
      ])?.port
    ).toBe(8081);
    expect(
      bestServicePort([
        { name: 'metrics', port: 9090 },
        { name: 'x', port: 11434 },
      ])?.port
    ).toBe(11434);
    expect(
      bestServicePort([
        { name: 'a', port: 1 },
        { name: 'b', port: 2 },
      ])?.port
    ).toBe(1);
  });
  it('ignores UDP ports and handles none', () => {
    expect(bestServicePort([{ port: 53, protocol: 'UDP' }, { port: 8000 }])?.port).toBe(8000);
    expect(bestServicePort([])).toBeUndefined();
  });
});

describe('service helpers', () => {
  it('builds the cluster DNS name and detects TLS ports', () => {
    expect(serviceHostname('vllm', 'models')).toBe('vllm.models.svc.cluster.local');
    expect(portUsesTLS({ port: 443 })).toBe(true);
    expect(portUsesTLS({ name: 'https-api', port: 9000 })).toBe(true);
    expect(portUsesTLS({ name: 'http', port: 8000 })).toBe(false);
  });
});

describe('AIServiceBackend edit support', () => {
  const existing = {
    metadata: { name: 'azure', namespace: 'ai' },
    spec: {
      schema: { name: 'AzureOpenAI', version: '2025-01-01-preview' },
      backendRef: {
        name: 'azure-backend',
        kind: 'Backend',
        group: 'gateway.envoyproxy.io',
        namespace: 'ai',
      },
      headerMutation: { set: [{ name: 'x-team', value: 'a' }] },
    },
  };

  it('pre-fills schema and the existing Backend', () => {
    const f = formFromAISB(existing);
    expect(f).toMatchObject({
      presetId: 'azure-openai',
      schema: 'AzureOpenAI',
      schemaVersion: '2025-01-01-preview',
      endpointMode: 'existing',
      envoyBackendName: 'azure-backend',
      configureAuth: false,
    });
    expect(presetForSchema('Unknown').id).toBe('openai');
  });

  it('round-trips unchanged and keeps mutations and backendRef extras', () => {
    const f = formFromAISB(existing);
    expect(mergeAISBSpec(existing.spec, f, f.envoyBackendName)).toEqual(existing.spec);
  });

  it('changes schema fields and the Backend', () => {
    const f = { ...formFromAISB(existing), schemaVersion: '', schemaPrefix: '/v1' };
    const spec = mergeAISBSpec(existing.spec, f, 'other');
    expect(spec.schema).toEqual({ name: 'AzureOpenAI', prefix: '/v1' });
    expect(spec.backendRef).toEqual({
      group: 'gateway.envoyproxy.io',
      kind: 'Backend',
      name: 'other',
    });
    expect(spec.headerMutation).toEqual(existing.spec.headerMutation);
  });
});
