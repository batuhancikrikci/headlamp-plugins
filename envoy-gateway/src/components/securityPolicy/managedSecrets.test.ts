import {
  apiKeyErrors,
  basicAuthErrors,
  buildApiKeySecret,
  buildBasicAuthSecret,
  buildOidcSecret,
  decodeBase64,
  defaultSecretName,
  dependentsFor,
  generateApiKey,
  newState,
  parseHtpasswd,
  secretNameErrors,
  secretRefs,
  State,
  stateFromLive,
  withSecretRefs,
} from './managedSecrets';

const POLICY_UID = 'policy-uid';
const owner = [
  {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    name: 'shop',
    uid: POLICY_UID,
  },
];

const policy = (spec: Record<string, unknown>, uid?: string) => ({
  apiVersion: 'gateway.envoyproxy.io/v1alpha1',
  kind: 'SecurityPolicy',
  metadata: { name: 'shop', namespace: 'apps', uid },
  spec,
});

describe('names and references', () => {
  it('suggests Secret names after the policy', () => {
    expect(defaultSecretName('shop', 'apiKeyAuth')).toBe('shop-api-keys');
    expect(defaultSecretName('shop', 'basicAuth')).toBe('shop-basic-auth');
    expect(defaultSecretName('shop', 'oidc')).toBe('shop-oidc-client-secret');
    expect(defaultSecretName(undefined, 'basicAuth')).toBe('');
  });

  it('reads and writes the references of each method', () => {
    const spec = {
      basicAuth: { users: { name: 'u' }, forwardUsernameHeader: 'x-user' },
      oidc: { clientID: 'c', clientSecret: { name: 'o' } },
      apiKeyAuth: { credentialRefs: [{ name: 'a' }, { name: 'b' }] },
    };
    expect(secretRefs(spec, 'basicAuth')).toEqual([{ name: 'u' }]);
    expect(secretRefs(spec, 'oidc')).toEqual([{ name: 'o' }]);
    expect(secretRefs(spec, 'apiKeyAuth')).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(withSecretRefs(spec, 'basicAuth', [{ name: 'v' }]).basicAuth).toEqual({
      users: { name: 'v' },
      forwardUsernameHeader: 'x-user',
    });
    expect(withSecretRefs(spec, 'apiKeyAuth', []).apiKeyAuth.credentialRefs).toEqual([]);
    expect(withSecretRefs({}, 'oidc', [{ name: 'x' }])).toEqual({});
  });

  it('checks the name of a Secret to create', () => {
    expect(secretNameErrors('shop-basic-auth', 'basicAuth')).toEqual([]);
    expect(secretNameErrors('', 'oidc')[0].key).toContain('needs a name');
    expect(secretNameErrors('Bad_Name', 'apiKeyAuth')[0].key).toContain('must be lowercase');
  });
});

describe('Secret content', () => {
  it('writes new API keys and keeps stored ones, also under a renamed client ID', () => {
    const secret = buildApiKeySecret({
      name: 'shop-api-keys',
      namespace: 'apps',
      clients: [
        { clientId: 'mobile', key: 'new-key' },
        { clientId: 'web', key: '', storedId: 'web' },
        { clientId: 'partner', key: '', storedId: 'partner-old' },
        { clientId: 'gone', key: '', storedId: 'missing' },
      ],
      storedData: { web: 'd2Vi', 'partner-old': 'cGFydG5lcg==', unused: 'eA==' },
    });
    expect(secret).toEqual({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'shop-api-keys', namespace: 'apps' },
      type: 'Opaque',
      data: { web: 'd2Vi', partner: 'cGFydG5lcg==' },
      stringData: { mobile: 'new-key' },
    });
  });

  it('hashes new passwords and keeps stored hashes', () => {
    const secret = buildBasicAuthSecret({
      name: 'shop-basic-auth',
      namespace: 'apps',
      users: [
        { username: 'alice', password: 'password' },
        { username: 'bob', password: '', storedHash: '{SHA}stored' },
      ],
    });
    expect(secret.stringData).toEqual({
      '.htpasswd': 'alice:{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=\nbob:{SHA}stored\n',
    });
    expect(secret.metadata).toEqual({ name: 'shop-basic-auth', namespace: 'apps' });
  });

  it('writes a new OIDC client secret or keeps the stored one', () => {
    expect(buildOidcSecret({ name: 'o', clientSecret: { value: 'shh' } }).stringData).toEqual({
      'client-secret': 'shh',
    });
    const kept = buildOidcSecret({
      name: 'o',
      clientSecret: { value: '', stored: true },
      storedData: { 'client-secret': 'c2ho' },
    });
    expect(kept.data).toEqual({ 'client-secret': 'c2ho' });
    expect(kept.stringData).toBeUndefined();
  });

  it('reads users back from a stored htpasswd file', () => {
    const stored = btoa('alice:{SHA}abc=\n# comment\n\nbob:{SHA}def=\n');
    expect(parseHtpasswd(decodeBase64(stored))).toEqual([
      { username: 'alice', password: '', storedHash: '{SHA}abc=' },
      { username: 'bob', password: '', storedHash: '{SHA}def=' },
    ]);
  });
});

describe('validation', () => {
  it('checks API key clients', () => {
    expect(apiKeyErrors([])).toEqual([{ key: 'API key auth needs at least one client' }]);
    expect(apiKeyErrors([{ clientId: 'web', key: '', storedId: 'web' }])).toEqual([]);
    expect(
      apiKeyErrors([
        { clientId: '', key: 'k' },
        { clientId: 'bad id', key: 'k' },
        { clientId: 'web', key: '' },
        { clientId: 'web', key: 'k' },
      ]).map(e => e.key)
    ).toEqual([
      'API key client #{{index}} needs a client ID',
      'API key client ID "{{name}}" may only contain letters, digits, ".", "_" and "-"',
      'API key client #{{index}} needs a key',
      'API key client ID "{{name}}" is used more than once',
    ]);
  });

  it('checks basic auth users', () => {
    expect(basicAuthErrors([{ username: 'bob', password: '', storedHash: '{SHA}x' }])).toEqual([]);
    expect(
      basicAuthErrors([
        { username: '', password: 'p' },
        { username: 'a:b', password: 'p' },
        { username: 'carol', password: '' },
        { username: 'carol', password: 'p' },
      ]).map(e => e.key)
    ).toEqual([
      'Basic auth user #{{index}} needs a username',
      'Basic auth username "{{name}}" cannot contain ":" or spaces',
      'Basic auth user #{{index}} needs a password',
      'Basic auth username "{{name}}" is used more than once',
    ]);
  });
});

describe('stateFromLive', () => {
  const secret = (name: string, data: Record<string, string>, ownerReferences?: typeof owner) => ({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace: 'apps', ownerReferences },
    data,
  });
  const secrets = [
    secret('shop-basic-auth', { '.htpasswd': btoa('alice:{SHA}abc=\n') }, owner),
    secret('shop-api-keys', { web: 'a2V5' }, owner),
    secret('shop-oidc-client-secret', { 'client-secret': 'c2ho' }, owner),
    secret('legacy-users', { '.htpasswd': btoa('bob:{SHA}x\n') }),
    secret('partner-keys', { partner: 'cA==' }),
  ];

  it('loads the values of the Secrets that belong to the policy', () => {
    const state = stateFromLive(
      policy(
        {
          basicAuth: { users: { name: 'shop-basic-auth' } },
          apiKeyAuth: { credentialRefs: [{ name: 'partner-keys' }, { name: 'shop-api-keys' }] },
          oidc: { clientSecret: { name: 'shop-oidc-client-secret' } },
        },
        POLICY_UID
      ),
      secrets,
      false
    );
    expect(state.basicAuth).toMatchObject({
      mode: 'owned',
      ownedName: 'shop-basic-auth',
      items: [{ username: 'alice', password: '', storedHash: '{SHA}abc=' }],
    });
    expect(state.apiKeyAuth).toMatchObject({
      mode: 'owned',
      ownedName: 'shop-api-keys',
      items: [{ clientId: 'web', key: '', storedId: 'web' }],
      storedData: { web: 'a2V5' },
    });
    expect(state.oidc).toMatchObject({ mode: 'owned', items: [{ value: '', stored: true }] });
  });

  it('treats Secrets of someone else, or of another policy, as existing', () => {
    const state = stateFromLive(
      policy(
        {
          basicAuth: { users: { name: 'legacy-users' } },
          apiKeyAuth: { credentialRefs: [{ name: 'partner-keys' }] },
          oidc: { clientSecret: { name: 'shop-oidc-client-secret' } },
        },
        'another-uid'
      ),
      secrets,
      false
    );
    expect(state.basicAuth.mode).toBe('existing');
    expect(state.apiKeyAuth.mode).toBe('existing');
    expect(state.oidc.mode).toBe('existing');
  });

  it('starts new Secrets for methods the policy does not use yet', () => {
    const state = stateFromLive(policy({}, POLICY_UID), [], true);
    expect(state.unreadable).toBe(true);
    expect(state.basicAuth).toMatchObject({ mode: 'new', items: [{ username: '', password: '' }] });
  });
});

describe('dependentsFor', () => {
  const withUsers = (s: State): State => ({
    ...s,
    basicAuth: { ...s.basicAuth, items: [{ username: 'alice', password: 'pw' }] },
  });

  it('creates the Secret a new method refers to', () => {
    const { dependents, errors } = dependentsFor(
      withUsers(newState()),
      policy({ basicAuth: { users: { name: 'shop-basic-auth' } } })
    );
    expect(errors).toEqual([]);
    expect(dependents).toHaveLength(1);
    expect(dependents[0].action).toBe('create');
    expect(dependents[0].object.metadata).toEqual({ name: 'shop-basic-auth', namespace: 'apps' });
  });

  it('reports a missing name and missing values instead', () => {
    const { errors } = dependentsFor(newState(), policy({ basicAuth: { users: { name: '' } } }));
    expect(errors.map(e => e.key)).toEqual([
      '{{method}} needs a name for the new Secret',
      'Basic auth user #{{index}} needs a username',
      'Basic auth user #{{index}} needs a password',
    ]);
  });

  it('never writes an existing Secret and only rewrites an owned one that was changed', () => {
    const state = newState();
    const spec = { basicAuth: { users: { name: 'users' } } };
    const existing = { ...state, basicAuth: { ...state.basicAuth, mode: 'existing' as const } };
    expect(dependentsFor(existing, policy(spec)).dependents).toEqual([]);

    const owned = {
      ...state,
      basicAuth: {
        mode: 'owned' as const,
        ownedName: 'users',
        items: [{ username: 'bob', password: '', storedHash: '{SHA}x' }],
        touched: false,
      },
    };
    expect(dependentsFor(owned, policy(spec)).dependents).toEqual([]);
    const changed = dependentsFor(
      { ...owned, basicAuth: { ...owned.basicAuth, touched: true } },
      policy(spec)
    );
    expect(changed.dependents.map(d => [d.action, d.object.metadata.name])).toEqual([
      ['update', 'users'],
    ]);
  });

  it('deletes a Secret of the policy that is no longer used', () => {
    const owned = {
      ...newState(),
      basicAuth: {
        mode: 'owned' as const,
        ownedName: 'shop-basic-auth',
        items: [{ username: 'bob', password: '', storedHash: '{SHA}x' }],
        touched: false,
      },
    };
    const deletions = (spec: Record<string, unknown>, state: State = owned) =>
      dependentsFor(state, policy(spec, POLICY_UID))
        .dependents.filter(d => d.action === 'delete')
        .map(d => d.object.metadata.name);

    // Still used: kept.
    expect(deletions({ basicAuth: { users: { name: 'shop-basic-auth' } } })).toEqual([]);
    // Method switched off: deleted.
    expect(deletions({})).toEqual(['shop-basic-auth']);
    // Another Secret chosen: deleted.
    const existing = { ...owned, basicAuth: { ...owned.basicAuth, mode: 'existing' as const } };
    expect(deletions({ basicAuth: { users: { name: 'team-users' } } }, existing)).toEqual([
      'shop-basic-auth',
    ]);
    // Used by another method of the same policy: kept.
    expect(deletions({ oidc: { clientSecret: { name: 'shop-basic-auth' } } }, existing)).toEqual(
      []
    );
  });

  it('ignores methods the policy does not use', () => {
    expect(dependentsFor(withUsers(newState()), policy({}))).toEqual({
      dependents: [],
      errors: [],
    });
  });
});

describe('generateApiKey', () => {
  it('returns distinct URL-safe keys', () => {
    const a = generateApiKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generateApiKey()).not.toBe(a);
  });
});
