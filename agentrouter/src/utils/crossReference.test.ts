import { describe, expect, it } from 'vitest';
import type { AIGatewayRoute } from '../resources/aiGatewayRoute';
import { extractModelRoutes } from '../resources/aiGatewayRoute.models';
import type { AIServiceBackend } from '../resources/aiServiceBackend';
import type { BackendSecurityPolicy } from '../resources/backendSecurityPolicy';
import type { MCPRoute } from '../resources/mcpRoute';
import type { QuotaPolicy } from '../resources/quotaPolicy';
import {
  backendsForMCPRoute,
  isAccepted,
  mcpRouteSharesEnvoyBackend,
  resolveBackendRelations,
  routeReferencesBackend,
  targetRefsIncludeBackend,
} from './crossReference';

// The helpers only read `metadata`, `spec` and `targetRefs`, so plain objects stand in for
// the KubeObject classes (which need the Headlamp runtime).
const meta = (name: string, namespace = 'default') => ({ name, namespace });

const backend = (name: string, namespace = 'default', envoyBackend = name) =>
  ({
    metadata: meta(name, namespace),
    spec: {
      schema: { name: 'OpenAI' },
      backendRef: { name: envoyBackend, kind: 'Backend', group: 'gateway.envoyproxy.io' },
    },
  } as unknown as AIServiceBackend);

const route = (
  name: string,
  refs: Array<{ name: string; namespace?: string; kind?: string; group?: string }>,
  namespace = 'default'
) =>
  ({
    metadata: meta(name, namespace),
    spec: { rules: [{ backendRefs: refs }] },
  } as unknown as AIGatewayRoute);

const target = [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' }];
const policy = <T>(name: string) => ({ metadata: meta(name), targetRefs: target } as unknown as T);

describe('routeReferencesBackend', () => {
  it('matches by name in the route namespace when namespace is omitted', () => {
    expect(routeReferencesBackend(route('r', [{ name: 'openai' }]), backend('openai'))).toBe(true);
  });

  it('does not match a backend with the same name in another namespace', () => {
    expect(
      routeReferencesBackend(route('r', [{ name: 'openai' }]), backend('openai', 'other'))
    ).toBe(false);
  });

  it('honours an explicit cross-namespace reference', () => {
    const r = route('r', [{ name: 'openai', namespace: 'other' }]);
    expect(routeReferencesBackend(r, backend('openai', 'other'))).toBe(true);
  });

  it('ignores InferencePool references', () => {
    const r = route('r', [
      { name: 'openai', kind: 'InferencePool', group: 'inference.networking.k8s.io' },
    ]);
    expect(routeReferencesBackend(r, backend('openai'))).toBe(false);
  });
});

describe('targetRefsIncludeBackend', () => {
  it('matches only in the policy namespace', () => {
    expect(targetRefsIncludeBackend(target, 'default', backend('openai'))).toBe(true);
    expect(targetRefsIncludeBackend(target, 'other', backend('openai'))).toBe(false);
  });
});

describe('MCP routes and Envoy backends', () => {
  const mcp = {
    metadata: meta('mcp'),
    spec: { backendRefs: [{ name: 'shared', kind: 'Backend', group: 'gateway.envoyproxy.io' }] },
  } as unknown as MCPRoute;

  it('relates an MCPRoute to Service Backends on the same Envoy Backend', () => {
    expect(mcpRouteSharesEnvoyBackend(mcp, backend('llm', 'default', 'shared'))).toBe(true);
    expect(mcpRouteSharesEnvoyBackend(mcp, backend('llm', 'default', 'other'))).toBe(false);
    expect(
      backendsForMCPRoute(mcp, [backend('a', 'default', 'shared'), backend('b')])
    ).toHaveLength(1);
  });

  it('treats a missing kind as Service, not Backend', () => {
    const svcMcp = {
      metadata: meta('mcp'),
      spec: { backendRefs: [{ name: 'shared', port: 80 }] },
    } as unknown as MCPRoute;
    expect(mcpRouteSharesEnvoyBackend(svcMcp, backend('llm', 'default', 'shared'))).toBe(false);
  });
});

describe('resolveBackendRelations', () => {
  it('collects routes and policies attached to a backend', () => {
    const rel = resolveBackendRelations(backend('openai'), {
      routes: [route('uses', [{ name: 'openai' }]), route('other', [{ name: 'x' }])],
      securityPolicies: [policy<BackendSecurityPolicy>('auth')],
      quotaPolicies: [policy<QuotaPolicy>('q')],
      mcpRoutes: null,
    });
    expect(rel.routes.map(r => r.metadata.name)).toEqual(['uses']);
    expect(rel.securityPolicies).toHaveLength(1);
    expect(rel.quotaPolicies).toHaveLength(1);
    expect(rel.mcpRoutes).toEqual([]);
  });
});

describe('isAccepted', () => {
  it('requires Accepted=True', () => {
    expect(isAccepted([{ type: 'Accepted', status: 'True' }])).toBe(true);
    expect(isAccepted([{ type: 'NotAccepted', status: 'True' }])).toBe(false);
    expect(isAccepted(undefined)).toBe(false);
  });
});

describe('extractModelRoutes', () => {
  it('extracts exact model header matches with their backends', () => {
    const models = extractModelRoutes([
      {
        matches: [
          { headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: 'gpt-4o' }] },
          { headers: [{ type: 'RegularExpression', name: 'x-ai-eg-model', value: 'gpt-.*' }] },
          { headers: [{ name: 'x-tenant', value: 'a' }] },
        ],
        backendRefs: [{ name: 'openai' }],
      },
    ]);
    expect(models).toEqual([{ model: 'gpt-4o', backendRefs: [{ name: 'openai' }] }]);
  });
});
