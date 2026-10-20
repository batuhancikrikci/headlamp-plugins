import { describe, expect, it } from 'vitest';
import { newCost } from '../../utils/costForm';
import { prune } from '../../utils/forms';
import {
  basicsErrors,
  extProcErrors,
  formFromGatewayConfig,
  gatewayChanges,
  GatewayConfigForm,
  mergeGatewayConfigSpec,
  newEnv,
  newGatewayConfigForm,
  toGatewayConfigSpec,
  trafficErrors,
} from './gatewayConfigForm';

const form = (overrides: Partial<GatewayConfigForm> = {}): GatewayConfigForm => ({
  ...newGatewayConfigForm(),
  name: 'ai-gw',
  namespace: 'ai',
  ...overrides,
});

describe('toGatewayConfigSpec', () => {
  it('produces an empty spec when nothing is configured', () => {
    expect(prune(toGatewayConfigSpec(form()))).toEqual({});
  });

  it('builds extProc resources, env sources, costs and the forward proxy', () => {
    const spec = prune(
      toGatewayConfigSpec(
        form({
          image: 'registry.local/extproc:v1.1.0',
          cpuRequest: '100m',
          memoryLimit: '512Mi',
          env: [
            { ...newEnv(), name: 'LOG_LEVEL', value: 'debug' },
            { ...newEnv(), name: 'OTEL_TOKEN', source: 'secret', refName: 'otel', refKey: 'token' },
          ],
          costs: [{ ...newCost(), metadataKey: 'total', type: 'TotalToken' }],
          forwardProxy: 'proxy.corp.local:3128',
        })
      )
    );
    expect(spec).toEqual({
      extProc: {
        kubernetes: {
          image: 'registry.local/extproc:v1.1.0',
          resources: { requests: { cpu: '100m' }, limits: { memory: '512Mi' } },
          env: [
            { name: 'LOG_LEVEL', value: 'debug' },
            { name: 'OTEL_TOKEN', valueFrom: { secretKeyRef: { name: 'otel', key: 'token' } } },
          ],
        },
      },
      globalLLMRequestCosts: [{ metadataKey: 'total', type: 'TotalToken' }],
      forwardProxy: { address: 'proxy.corp.local:3128' },
    });
  });
});

describe('validation', () => {
  it('checks names', () => {
    expect(basicsErrors(form())).toEqual([]);
    expect(basicsErrors(form({ name: 'Bad_Name' }))).toHaveLength(1);
  });

  it('checks image, quantities and env vars', () => {
    const errors = extProcErrors(
      form({
        image: 'bad image',
        cpuLimit: 'lots',
        env: [
          { ...newEnv(), name: 'A' },
          { ...newEnv(), name: 'A' },
          { ...newEnv(), name: 'B', source: 'configMap', refName: '', refKey: '' },
        ],
      })
    );
    expect(errors).toContain(
      'Image must look like "registry/repo:tag" (optionally "@sha256:<digest>").'
    );
    expect(errors).toContain('CPU limit must be a Kubernetes quantity (e.g. 500m, 1, 256Mi, 1Gi).');
    expect(errors).toContain('Environment variable 2: "A" is defined twice.');
    expect(errors).toContain('Environment variable 3: enter the key to read.');
    expect(extProcErrors(form({ cpuRequest: '500m', memoryRequest: '1Gi' }))).toEqual([]);
  });

  it('checks the forward proxy address and cost keys', () => {
    expect(trafficErrors(form({ forwardProxy: 'proxy:3128' }))).toEqual([]);
    expect(trafficErrors(form({ forwardProxy: '[::1]:8080' }))).toEqual([]);
    expect(trafficErrors(form({ forwardProxy: 'proxy' }))).toHaveLength(1);
    expect(trafficErrors(form({ forwardProxy: 'proxy:99999' }))).toHaveLength(1);
    expect(trafficErrors(form({ costs: [{ ...newCost(), metadataKey: '' }] }))).toEqual([
      'Cost metric #1: metadata key is required.',
    ]);
  });
});

describe('edit support', () => {
  const existing = {
    metadata: { name: 'ai-gw', namespace: 'ai', resourceVersion: '42' },
    spec: {
      extProc: {
        kubernetes: {
          image: 'registry.local/extproc:v1',
          resources: {
            requests: { cpu: '100m', 'ephemeral-storage': '1Gi' },
            limits: { memory: '512Mi' },
          },
          env: [
            { name: 'LOG_LEVEL', value: 'info' },
            { name: 'TOKEN', valueFrom: { secretKeyRef: { name: 'otel', key: 'token' } } },
            { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
          ],
          securityContext: { runAsNonRoot: true },
        },
      },
      globalLLMRequestCosts: [{ metadataKey: 'total', type: 'TotalToken' }],
      forwardProxy: { address: 'proxy:3128' },
    },
  };

  it('pre-fills the form and keeps env entries it cannot represent', () => {
    const { form: f, preservedEnv } = formFromGatewayConfig(existing, ['gw-a']);
    expect(f).toMatchObject({
      name: 'ai-gw',
      namespace: 'ai',
      gateways: ['gw-a'],
      image: 'registry.local/extproc:v1',
      cpuRequest: '100m',
      memoryLimit: '512Mi',
      forwardProxy: 'proxy:3128',
    });
    expect(f.env.map(e => [e.name, e.source])).toEqual([
      ['LOG_LEVEL', 'value'],
      ['TOKEN', 'secret'],
    ]);
    expect(preservedEnv).toEqual([
      { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
    ]);
  });

  it('round-trips unchanged and preserves fields the form does not manage', () => {
    const { form: f, preservedEnv } = formFromGatewayConfig(existing, []);
    expect(mergeGatewayConfigSpec(existing.spec, f, preservedEnv)).toEqual(existing.spec);
  });

  it('applies edits and removes cleared fields', () => {
    const { form: f, preservedEnv } = formFromGatewayConfig(existing, []);
    const spec = mergeGatewayConfigSpec(
      existing.spec,
      { ...f, image: '', cpuRequest: '', memoryLimit: '1Gi', forwardProxy: '', costs: [] },
      preservedEnv
    );
    expect(spec.extProc.kubernetes.image).toBeUndefined();
    expect(spec.extProc.kubernetes.resources).toEqual({
      requests: { 'ephemeral-storage': '1Gi' },
      limits: { memory: '1Gi' },
    });
    expect(spec.extProc.kubernetes.securityContext).toEqual({ runAsNonRoot: true });
    expect(spec.forwardProxy).toBeUndefined();
    expect(spec.globalLLMRequestCosts).toBeUndefined();
  });

  it('computes Gateway attach/detach sets', () => {
    expect(gatewayChanges(['a', 'b'], ['b', 'c'])).toEqual({ attach: ['c'], detach: ['a'] });
  });
});
