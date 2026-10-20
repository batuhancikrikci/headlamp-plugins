import { describe, expect, it } from 'vitest';
import { prune } from '../../utils/forms';
import {
  basicsErrors,
  formFromMCPRoute,
  newMCPForm,
  newSecrets,
  serverErrors,
  toMCPSpec,
} from './mcpForm';

const existing = {
  metadata: { name: 'tools', namespace: 'ai' },
  spec: {
    parentRefs: [{ name: 'gw', kind: 'Gateway', group: 'gateway.networking.k8s.io' }],
    path: '/mcp',
    headers: [{ name: 'x-team', value: 'a' }],
    backendRefs: [
      {
        name: 'github',
        kind: 'Backend',
        group: 'gateway.envoyproxy.io',
        path: '/mcp/readonly',
        toolSelector: { includeRegex: ['.*issues?.*'], excludeRegex: ['.*delete.*'] },
        securityPolicy: { apiKey: { secretRef: { name: 'github-token' } } },
        forwardHeaders: [{ name: 'x-user', backendHeader: 'x-github-user' }],
      },
      {
        name: 'kiwi',
        port: 8080,
        securityPolicy: { apiKey: { inline: 'abc', queryParam: 'key' } },
      },
    ],
    securityPolicy: {
      oauth: {
        issuer: 'https://auth.example.com',
        jwks: { localJWKS: { type: 'ValueRef' } },
        protectedResourceMetadata: {
          resource: 'https://api.example.com/mcp',
          resourceName: 'Tools',
        },
        claimToHeaders: [{ claim: 'sub', header: 'x-sub' }],
      },
      authorization: { defaultAction: 'Deny' },
    },
    backendSelector: { defaultAction: 'Allow' },
  },
};

describe('MCP form', () => {
  it('builds a minimal create spec', () => {
    const f = {
      ...newMCPForm(),
      name: 'm',
      gateways: [{ name: 'gw', namespace: '', sectionName: '' }],
    };
    f.servers[0].name = 'srv';
    expect(prune(toMCPSpec(f))).toEqual({
      parentRefs: [{ group: 'gateway.networking.k8s.io', kind: 'Gateway', name: 'gw' }],
      backendRefs: [{ name: 'srv', group: 'gateway.envoyproxy.io', kind: 'Backend' }],
    });
    expect(basicsErrors(f)).toEqual([]);
    expect(serverErrors(f)).toEqual([]);
  });

  it('creates Secrets for new API keys', () => {
    const f = { ...newMCPForm(), name: 'm' };
    f.servers[0] = { ...f.servers[0], name: 'srv', authMode: 'new', apiKey: 'k' };
    expect(newSecrets(f)).toEqual([
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'm-srv-apikey', namespace: 'default' },
        type: 'Opaque',
        stringData: { apiKey: 'k' },
      },
    ]);
  });

  it('pre-fills an existing route and marks inline keys as kept', () => {
    const f = formFromMCPRoute(existing);
    expect(f.servers.map(s => [s.name, s.kind, s.authMode])).toEqual([
      ['github', 'Backend', 'existing'],
      ['kiwi', 'Service', 'kept'],
    ]);
    expect(f.oauth).toMatchObject({ enabled: true, issuer: 'https://auth.example.com' });
    expect(serverErrors(f)).toEqual([]);
  });

  it('round-trips an unchanged route exactly', () => {
    expect(toMCPSpec(formFromMCPRoute(existing), existing.spec)).toEqual(existing.spec);
  });

  it('applies edits while keeping extras', () => {
    const f = formFromMCPRoute(existing);
    f.servers[0].includeRegex = '';
    f.servers[0].forwardHeaders = 'x-user, x-org';
    f.oauth.scopes = 'read';
    const spec = toMCPSpec(f, existing.spec);
    expect(spec.backendRefs[0].toolSelector).toEqual({ excludeRegex: ['.*delete.*'] });
    expect(spec.backendRefs[0].forwardHeaders).toEqual([
      { name: 'x-user', backendHeader: 'x-github-user' },
      { name: 'x-org' },
    ]);
    expect(spec.backendRefs[1].securityPolicy).toEqual(existing.spec.backendRefs[1].securityPolicy);
    expect(spec.securityPolicy.oauth.claimToHeaders).toEqual([{ claim: 'sub', header: 'x-sub' }]);
    expect(spec.securityPolicy.oauth.protectedResourceMetadata.scopesSupported).toEqual(['read']);
    expect(spec.securityPolicy.authorization).toEqual({ defaultAction: 'Deny' });
    expect(spec.headers).toEqual(existing.spec.headers);
  });

  it('removes OAuth when disabled but keeps other security settings', () => {
    const f = formFromMCPRoute(existing);
    f.oauth.enabled = false;
    expect(toMCPSpec(f, existing.spec).securityPolicy).toEqual({
      authorization: { defaultAction: 'Deny' },
    });
  });
});
