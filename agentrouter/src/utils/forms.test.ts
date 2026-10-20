import { describe, expect, it } from 'vitest';
import {
  buildCredentialResources,
  credentialErrors,
  initialCredentialState,
} from '../components/backendSecurityPolicy/credentialResources';
import { prune, splitList, validateName } from './forms';

const API_VERSION = 'aigateway.envoyproxy.io/v1beta1';

describe('validateName', () => {
  it('accepts DNS-1123 subdomains', () => {
    expect(validateName('openai-backend')).toBeNull();
    expect(validateName('a.b-c')).toBeNull();
  });

  it('rejects empty, uppercase and badly delimited names', () => {
    expect(validateName('')).toMatch(/required/);
    expect(validateName('OpenAI')).not.toBeNull();
    expect(validateName('-bad')).not.toBeNull();
    expect(validateName('bad-')).not.toBeNull();
  });
});

describe('prune', () => {
  it('drops empty values recursively but keeps zero and false', () => {
    expect(
      prune({
        a: '',
        b: undefined,
        c: [],
        d: {},
        e: { f: '' },
        g: 0,
        h: false,
        i: ['x', undefined],
      })
    ).toEqual({ g: 0, h: false, i: ['x'] });
  });
});

describe('splitList', () => {
  it('splits on commas and newlines, trims and de-duplicates', () => {
    expect(splitList(' a, b\nc,,a ')).toEqual(['a', 'b', 'c']);
  });
});

describe('credential resources', () => {
  it('creates an apiKey Secret before an APIKey policy targeting the backends', () => {
    const state = { ...initialCredentialState('APIKey', 'openai-apikey'), apiKey: 'sk-test' };
    const [secret, policy] = buildCredentialResources(state, {
      policyName: 'openai-auth',
      namespace: 'ai',
      targetBackends: ['openai'],
      apiVersion: API_VERSION,
    });

    expect(secret.kind).toBe('Secret');
    expect(secret.stringData).toEqual({ apiKey: 'sk-test' });
    expect(policy.kind).toBe('BackendSecurityPolicy');
    expect(policy.apiVersion).toBe(API_VERSION);
    expect(policy.spec).toEqual({
      type: 'APIKey',
      targetRefs: [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' }],
      apiKey: { secretRef: { name: 'openai-apikey', namespace: 'ai' } },
    });
  });

  it('writes an AWS credentials file under the "credentials" key', () => {
    const state = {
      ...initialCredentialState('AWSCredentials', 'aws'),
      awsAccessKeyId: 'AKIA',
      awsSecretAccessKey: 'secret',
    };
    const [secret, policy] = buildCredentialResources(state, {
      policyName: 'p',
      namespace: 'ai',
      targetBackends: [],
      apiVersion: API_VERSION,
    });
    expect(secret.stringData.credentials).toContain('aws_access_key_id = AKIA');
    expect(policy.spec.awsCredentials.region).toBe('us-east-1');
    expect(policy.spec.targetRefs).toBeUndefined();
  });

  it('does not create a Secret when referencing an existing one', () => {
    const state = {
      ...initialCredentialState('AnthropicAPIKey', 'existing'),
      secretMode: 'existing' as const,
    };
    const items = buildCredentialResources(state, {
      policyName: 'p',
      namespace: 'ai',
      targetBackends: ['claude'],
      apiVersion: API_VERSION,
    });
    expect(items.map(i => i.kind)).toEqual(['BackendSecurityPolicy']);
    expect(credentialErrors(state)).toEqual([]);
  });

  it('validates the GCP service account JSON', () => {
    const state = {
      ...initialCredentialState('GCPCredentials', 'gcp'),
      gcpProject: 'p',
      secretValue: 'not json',
    };
    expect(credentialErrors(state)).toContain('Service account key must be valid JSON.');
  });
});
