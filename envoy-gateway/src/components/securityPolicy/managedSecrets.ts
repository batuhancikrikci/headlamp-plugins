/**
 * Credential Secrets of a SecurityPolicy (API key, basic auth, OIDC client secret). For each
 * method the user either picks an existing Secret, which is never written, or lets the editor
 * create a new one from the values entered in the form. A new Secret is owned by the policy (owner
 * reference), so it is deleted together with it; when editing, only a Secret that already belongs
 * to the policy may be updated. Pure, unit tested.
 *
 * Stored values are never shown again: a key or password left empty keeps the value that is
 * already in the Secret (for basic auth, its SHA hash). A Secret of the policy that is no longer
 * used (its method switched off, or another Secret chosen) is deleted when the policy is saved.
 */
import { Dependent } from '../../common/form/apply';
import { isOwnedBy } from '../../common/form/resourceModel';
import { KubeJson, ValidationError } from '../../common/form/types';
import { ObjectRef } from '../../resources/types';
import { bytesToBase64, sha1Base64 } from '../../utils/sha1';

/** Key of the htpasswd file in a basic auth Secret. */
export const HTPASSWD_KEY = '.htpasswd';
/** Key of the client secret in an OIDC Secret. */
export const OIDC_SECRET_KEY = 'client-secret';

/** Secret data keys: letters, digits, ".", "_" and "-". */
const SECRET_KEY_RE = /^[-._a-zA-Z0-9]+$/;
/** Kubernetes object names (DNS subdomain). */
const NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export type Credential = 'apiKeyAuth' | 'basicAuth' | 'oidc';
export const CREDENTIALS: Credential[] = ['apiKeyAuth', 'basicAuth', 'oidc'];

/**
 * `new`: a Secret is created from the form. `existing`: the policy uses a Secret of the user, never
 * written. `owned`: the Secret the policy points to belongs to it and may be updated.
 */
export type SecretMode = 'new' | 'existing' | 'owned';

export interface ApiKeyClient {
  clientId: string;
  /** New API key; empty keeps the stored one. */
  key: string;
  /** Client ID the stored key is saved under in the live Secret. */
  storedId?: string;
}

export interface BasicUser {
  username: string;
  /** New password; empty keeps the stored hash. */
  password: string;
  /** `{SHA}…` hash from the live htpasswd file. */
  storedHash?: string;
}

export interface OidcClientSecret {
  /** New client secret; empty keeps the stored one. */
  value: string;
  stored?: boolean;
}

export interface CredentialState<T> {
  mode: SecretMode;
  items: T[];
  /** Name of the Secret that belongs to the policy, when there is one. */
  ownedName?: string;
  /** Base64 data of that Secret, for values that are kept. */
  storedData?: Record<string, string>;
  touched: boolean;
}

export interface State {
  apiKeyAuth: CredentialState<ApiKeyClient>;
  basicAuth: CredentialState<BasicUser>;
  oidc: CredentialState<OidcClientSecret>;
  /** The Secrets of the namespace could not be read, so ownership is unknown. */
  unreadable: boolean;
}

export type SecretJson = KubeJson & { data?: Record<string, string> };

// ---------------------------------------------------------------------------
// Names and references
// ---------------------------------------------------------------------------

const NAME_SUFFIX: Record<Credential, string> = {
  apiKeyAuth: 'api-keys',
  basicAuth: 'basic-auth',
  oidc: 'oidc-client-secret',
};

/** Suggested name of a new Secret, e.g. `my-policy-basic-auth`. */
export function defaultSecretName(policyName: string | undefined, credential: Credential): string {
  return policyName ? `${policyName}-${NAME_SUFFIX[credential]}` : '';
}

/** References of a method to its Secrets (API key auth may use several). */
export function secretRefs(spec: KubeJson['spec'], credential: Credential): ObjectRef[] {
  if (credential === 'apiKeyAuth') return spec?.apiKeyAuth?.credentialRefs || [];
  const ref = credential === 'basicAuth' ? spec?.basicAuth?.users : spec?.oidc?.clientSecret;
  return ref ? [ref] : [];
}

/** The spec with the references of a method replaced. */
export function withSecretRefs(
  spec: KubeJson['spec'],
  credential: Credential,
  refs: ObjectRef[]
): KubeJson['spec'] {
  const block = spec?.[credential];
  if (!block) return spec;
  if (credential === 'apiKeyAuth')
    return { ...spec, apiKeyAuth: { ...block, credentialRefs: refs } };
  const key = credential === 'basicAuth' ? 'users' : 'clientSecret';
  return { ...spec, [credential]: { ...block, [key]: refs[0] || { name: '' } } };
}

// ---------------------------------------------------------------------------
// Secret content
// ---------------------------------------------------------------------------

export function decodeBase64(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

/** Users of an htpasswd file, with their stored hashes. */
export function parseHtpasswd(text: string): BasicUser[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes(':'))
    .map(line => {
      const separator = line.indexOf(':');
      return {
        username: line.slice(0, separator),
        password: '',
        storedHash: line.slice(separator + 1),
      };
    });
}

/** Random API key: 32 URL-safe characters (192 bits). */
export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_');
}

function secretBase(name: string, namespace: string | undefined): KubeJson {
  return { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace }, type: 'Opaque' };
}

/**
 * Secret with one key per client ID. Clients without a new key keep the stored one (`storedData`
 * holds the live Secret's base64 data).
 */
export function buildApiKeySecret(opts: {
  name: string;
  namespace?: string;
  clients: ApiKeyClient[];
  storedData?: Record<string, string>;
}): KubeJson {
  const data: Record<string, string> = {};
  const stringData: Record<string, string> = {};
  for (const client of opts.clients) {
    if (client.key) stringData[client.clientId] = client.key;
    else if (client.storedId && opts.storedData?.[client.storedId] !== undefined) {
      data[client.clientId] = opts.storedData[client.storedId];
    }
  }
  const secret = secretBase(opts.name, opts.namespace);
  if (Object.keys(data).length > 0) secret.data = data;
  if (Object.keys(stringData).length > 0) secret.stringData = stringData;
  return secret;
}

/** One htpasswd line; a new password is hashed, otherwise the stored hash is kept. */
export function htpasswdLine(user: BasicUser): string {
  const hash = user.password ? `{SHA}${sha1Base64(user.password)}` : user.storedHash || '';
  return `${user.username}:${hash}`;
}

export function buildBasicAuthSecret(opts: {
  name: string;
  namespace?: string;
  users: BasicUser[];
}): KubeJson {
  const secret = secretBase(opts.name, opts.namespace);
  secret.stringData = { [HTPASSWD_KEY]: opts.users.map(htpasswdLine).join('\n') + '\n' };
  return secret;
}

/** Secret holding the OIDC client secret; an empty value keeps the stored one. */
export function buildOidcSecret(opts: {
  name: string;
  namespace?: string;
  clientSecret: OidcClientSecret;
  storedData?: Record<string, string>;
}): KubeJson {
  const secret = secretBase(opts.name, opts.namespace);
  if (opts.clientSecret.value) {
    secret.stringData = { [OIDC_SECRET_KEY]: opts.clientSecret.value };
  } else if (opts.storedData?.[OIDC_SECRET_KEY] !== undefined) {
    secret.data = { [OIDC_SECRET_KEY]: opts.storedData[OIDC_SECRET_KEY] };
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((v, i) => v && values.indexOf(v) !== i))];
}

const LABEL: Record<Credential, string> = {
  apiKeyAuth: 'API key',
  basicAuth: 'Basic auth',
  oidc: 'OIDC',
};

/** Name of a Secret to create. */
export function secretNameErrors(name: string, credential: Credential): ValidationError[] {
  const method = LABEL[credential];
  if (!name) return [{ key: '{{method}} needs a name for the new Secret', params: { method } }];
  if (name.length > 253 || !NAME_RE.test(name)) {
    return [
      {
        key: '{{method}} Secret name "{{name}}" must be lowercase letters, digits, "-" and "."',
        params: { method, name },
      },
    ];
  }
  return [];
}

export function apiKeyErrors(clients: ApiKeyClient[]): ValidationError[] {
  const errors: ValidationError[] = [];
  if (clients.length === 0) errors.push({ key: 'API key auth needs at least one client' });
  clients.forEach((client, i) => {
    const index = i + 1;
    if (!client.clientId) {
      errors.push({ key: 'API key client #{{index}} needs a client ID', params: { index } });
    } else if (!SECRET_KEY_RE.test(client.clientId)) {
      errors.push({
        key: 'API key client ID "{{name}}" may only contain letters, digits, ".", "_" and "-"',
        params: { name: client.clientId },
      });
    }
    if (!client.key && !client.storedId) {
      errors.push({ key: 'API key client #{{index}} needs a key', params: { index } });
    }
  });
  duplicates(clients.map(c => c.clientId)).forEach(name =>
    errors.push({ key: 'API key client ID "{{name}}" is used more than once', params: { name } })
  );
  return errors;
}

export function basicAuthErrors(users: BasicUser[]): ValidationError[] {
  const errors: ValidationError[] = [];
  if (users.length === 0) errors.push({ key: 'Basic auth needs at least one user' });
  users.forEach((user, i) => {
    const index = i + 1;
    if (!user.username) {
      errors.push({ key: 'Basic auth user #{{index}} needs a username', params: { index } });
    } else if (/[:\s]/.test(user.username)) {
      errors.push({
        key: 'Basic auth username "{{name}}" cannot contain ":" or spaces',
        params: { name: user.username },
      });
    }
    if (!user.password && !user.storedHash) {
      errors.push({ key: 'Basic auth user #{{index}} needs a password', params: { index } });
    }
  });
  duplicates(users.map(u => u.username)).forEach(name =>
    errors.push({ key: 'Basic auth username "{{name}}" is used more than once', params: { name } })
  );
  return errors;
}

export function oidcSecretErrors(secret: OidcClientSecret | undefined): ValidationError[] {
  return secret?.value || secret?.stored ? [] : [{ key: 'OIDC needs a client secret value' }];
}

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

function fresh<T>(item: T): CredentialState<T> {
  return { mode: 'new', items: [item], touched: false };
}

export function newState(): State {
  return {
    apiKeyAuth: fresh<ApiKeyClient>({ clientId: '', key: '' }),
    basicAuth: fresh<BasicUser>({ username: '', password: '' }),
    oidc: fresh<OidcClientSecret>({ value: '' }),
    unreadable: false,
  };
}

/**
 * State of an existing policy: a referenced Secret that belongs to the policy (owner reference to
 * its uid) can be updated; any other is the user's and is only referenced.
 */
export function stateFromLive(value: KubeJson, secrets: SecretJson[], unreadable: boolean): State {
  const state = newState();
  state.unreadable = unreadable;
  const spec = value.spec || {};
  const namespace = value.metadata?.namespace;
  const owned = (ref: ObjectRef) => {
    if (!ref.name || (ref.namespace && ref.namespace !== namespace)) return undefined;
    const secret = secrets.find(s => s.metadata.name === ref.name);
    return secret && isOwnedBy(secret, value.metadata?.uid) ? secret : undefined;
  };

  for (const credential of CREDENTIALS) {
    if (!spec[credential]) continue;
    const refs = secretRefs(spec, credential);
    const ownSecret = refs.map(owned).find(Boolean);
    if (!ownSecret) {
      if (refs.some(r => r.name))
        state[credential] = { mode: 'existing', items: [], touched: false };
      continue;
    }
    const data = ownSecret.data || {};
    const base = {
      mode: 'owned' as const,
      ownedName: ownSecret.metadata.name,
      storedData: data,
      touched: false,
    };
    if (credential === 'apiKeyAuth') {
      state.apiKeyAuth = {
        ...base,
        items: Object.keys(data).map(id => ({ clientId: id, key: '', storedId: id })),
      };
    } else if (credential === 'basicAuth') {
      state.basicAuth = {
        ...base,
        items: parseHtpasswd(decodeBase64(data[HTPASSWD_KEY] || '')),
      };
    } else {
      state.oidc = { ...base, items: [{ value: '', stored: OIDC_SECRET_KEY in data }] };
    }
  }
  return state;
}

/**
 * Secrets to write and the problems that block applying, for the methods the policy uses. The
 * Secret of a `new` method is the one the policy refers to (the first one for API key auth).
 */
export function dependentsFor(
  state: State,
  value: KubeJson
): { dependents: Dependent[]; errors: ValidationError[] } {
  const dependents: Dependent[] = [];
  const errors: ValidationError[] = [];
  const spec = value.spec || {};
  const namespace = value.metadata?.namespace;

  for (const credential of CREDENTIALS) {
    const method = state[credential];
    if (!spec[credential] || method.mode === 'existing') continue;
    const name =
      method.mode === 'owned'
        ? method.ownedName || ''
        : secretRefs(spec, credential)[0]?.name || '';
    if (method.mode === 'new') errors.push(...secretNameErrors(name, credential));

    let object: KubeJson;
    if (credential === 'apiKeyAuth') {
      const clients = state.apiKeyAuth.items;
      errors.push(...apiKeyErrors(clients));
      object = buildApiKeySecret({ name, namespace, clients, storedData: method.storedData });
    } else if (credential === 'basicAuth') {
      const users = state.basicAuth.items;
      errors.push(...basicAuthErrors(users));
      object = buildBasicAuthSecret({ name, namespace, users });
    } else {
      const clientSecret = state.oidc.items[0];
      errors.push(...oidcSecretErrors(clientSecret));
      object = buildOidcSecret({
        name,
        namespace,
        clientSecret: clientSecret || { value: '' },
        storedData: method.storedData,
      });
    }

    if (method.mode === 'new') dependents.push({ object, action: 'create' });
    // An owned Secret is only rewritten when its values were changed.
    else if (method.touched) dependents.push({ object, action: 'update' });
  }

  // A Secret of the policy that no method refers to any more (method switched off, or another
  // Secret chosen) is deleted once the policy is saved.
  const referenced = new Set(
    CREDENTIALS.filter(c => spec[c]).flatMap(c => secretRefs(spec, c).map(r => r.name))
  );
  const released = new Set(
    CREDENTIALS.map(c => state[c].ownedName).filter(
      (name): name is string => !!name && !referenced.has(name)
    )
  );
  for (const name of released) {
    dependents.push({
      object: { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace } },
      action: 'delete',
    });
  }
  return { dependents, errors };
}
