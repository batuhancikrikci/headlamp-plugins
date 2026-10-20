import { describe, expect, it } from 'vitest';
import { formFromBSP, mergeBSPSpec } from './bspForm';

const apiKeyPolicy = {
  metadata: { name: 'openai-auth', namespace: 'ai' },
  spec: {
    targetRefs: [
      { group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' },
      { group: 'inference.networking.k8s.io', kind: 'InferencePool', name: 'pool' },
    ],
    type: 'APIKey',
    apiKey: { secretRef: { name: 'openai-apikey' } },
    credentialOverride: { fromRequestHeaders: { header: 'x-api-key' } },
  },
};

describe('formFromBSP / mergeBSPSpec', () => {
  it('pre-fills targets and the existing secret', () => {
    const state = formFromBSP(apiKeyPolicy);
    expect(state.targets).toEqual(['openai']);
    expect(state.otherTargets).toHaveLength(1);
    expect(state.cred).toMatchObject({
      type: 'APIKey',
      secretMode: 'existing',
      secretName: 'openai-apikey',
    });
    expect(state.credentialLocked).toBe(false);
  });

  it('round-trips an unchanged policy exactly', () => {
    expect(mergeBSPSpec(apiKeyPolicy.spec, formFromBSP(apiKeyPolicy), 'ai')).toEqual(
      apiKeyPolicy.spec
    );
  });

  it('switches the secret and credential type', () => {
    const state = formFromBSP(apiKeyPolicy);
    state.cred = { ...state.cred, secretName: 'rotated' };
    expect(mergeBSPSpec(apiKeyPolicy.spec, state, 'ai').apiKey).toEqual({
      secretRef: { name: 'rotated' },
    });

    state.cred = { ...state.cred, type: 'AnthropicAPIKey', secretName: 'claude' };
    const spec = mergeBSPSpec(apiKeyPolicy.spec, state, 'ai');
    expect(spec.apiKey).toBeUndefined();
    expect(spec.anthropicAPIKey).toEqual({ secretRef: { name: 'claude', namespace: 'ai' } });
    expect(spec.credentialOverride).toEqual(apiKeyPolicy.spec.credentialOverride);
  });

  it('keeps federated credentials read-only', () => {
    const aws = {
      metadata: { name: 'aws', namespace: 'ai' },
      spec: {
        type: 'AWSCredentials',
        awsCredentials: {
          region: 'eu-west-1',
          oidcExchangeToken: { oidc: { provider: { issuer: 'https://idp' } }, awsRoleArn: 'arn' },
        },
      },
    };
    const state = formFromBSP(aws);
    expect(state.credentialLocked).toBe(true);
    state.targets = ['bedrock'];
    const spec = mergeBSPSpec(aws.spec, state, 'ai');
    expect(spec.awsCredentials).toEqual(aws.spec.awsCredentials);
    expect(spec.targetRefs).toEqual([
      { group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'bedrock' },
    ]);
  });

  it('round-trips AWS credential files with profile', () => {
    const aws = {
      spec: {
        type: 'AWSCredentials',
        awsCredentials: {
          region: 'us-east-1',
          credentialsFile: { secretRef: { name: 'aws-creds', namespace: 'ai' }, profile: 'prod' },
        },
      },
    };
    expect(mergeBSPSpec(aws.spec, formFromBSP(aws), 'ai')).toEqual(aws.spec);
  });
});
