import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  DurationInput,
  FieldGrid,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  ToggleSection,
  useBinder,
} from '../../common/form/Fields';
import { useText } from '../../common/i18n';
import { AuthMethod, JWTProvider } from '../../resources/securityPolicy';
import { KubeJson, ObjectRef } from '../../resources/types';
import { BackendRefsEditor, ObjectRefField } from '../common/form/RefFields';
import {
  ApiKeyClient,
  BasicUser,
  Credential,
  generateApiKey,
  HTPASSWD_KEY,
  OIDC_SECRET_KEY,
  SecretMode,
  secretRefs,
  withSecretRefs,
} from './managedSecrets';
import { useManagedSecrets } from './ManagedSecretsProvider';

export interface SectionProps {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}

const CIDR_RE = /^([0-9]{1,3}(\.[0-9]{1,3}){3}\/[0-9]{1,2}|[0-9a-fA-F:]+\/[0-9]{1,3})$/;

/** Default configuration written when an authentication method is switched on. */
export const AUTH_DEFAULTS: Record<AuthMethod, () => unknown> = {
  jwt: () => ({ providers: [{ name: 'default', remoteJWKS: { uri: '' } }] }),
  oidc: () => ({ provider: { issuer: '' }, clientID: '', clientSecret: { name: '' } }),
  // New Secrets are named after the policy by ManagedSecretsProvider.
  basicAuth: () => ({ users: { name: '' } }),
  apiKeyAuth: () => ({ credentialRefs: [], extractFrom: [{ headers: ['x-api-key'] }] }),
  extAuth: () => ({ http: { backendRefs: [{ name: '', port: 80 }] } }),
};

export const AUTH_ICONS: Record<AuthMethod, string> = {
  jwt: 'mdi:key-chain-variant',
  oidc: 'mdi:account-key-outline',
  basicAuth: 'mdi:account-lock-outline',
  apiKeyAuth: 'mdi:key-outline',
  extAuth: 'mdi:shield-account-outline',
};

export function useAuthText() {
  const { t } = useText();
  return (m: AuthMethod): [string, string] =>
    ({
      jwt: [
        t('JWT'),
        t('Validate bearer tokens against a JWKS, e.g. from your identity provider.'),
      ] as [string, string],
      oidc: [t('OIDC'), t('Redirect browsers to an OpenID Connect provider to log in.')] as [
        string,
        string
      ],
      basicAuth: [t('Basic auth'), t('Usernames and passwords from an htpasswd Secret.')] as [
        string,
        string
      ],
      apiKeyAuth: [
        t('API key'),
        t('Accept requests carrying one of the API keys you define here.'),
      ] as [string, string],
      extAuth: [
        t('External auth'),
        t('Delegate the decision to your own HTTP or gRPC service.'),
      ] as [string, string],
    }[m]);
}

function useSection({ value, onChange }: SectionProps) {
  const bind = useBinder<KubeJson>(value, onChange);
  const spec = value.spec || {};
  return {
    bind,
    spec,
    namespace: value.metadata?.namespace,
    toggle: (key: string, defaults: () => unknown) => (on: boolean) =>
      bind(['spec', key]).onChange(on ? defaults() : undefined),
  };
}

function JWTProviderEditor({
  provider,
  onChange,
}: {
  provider: JWTProvider;
  onChange: (next: JWTProvider) => void;
}) {
  const { t } = useText();
  const set = (patch: Partial<JWTProvider>) => onChange({ ...provider, ...patch });
  return (
    <FieldGrid>
      <TextInput
        label={t('Provider name')}
        required
        value={provider.name}
        onChange={v => set({ name: v || '' })}
      />
      <TextInput
        label={t('Issuer')}
        placeholder="https://auth.example.com/"
        help={t('Expected "iss" claim; leave empty to accept any issuer.')}
        value={provider.issuer}
        onChange={v => set({ issuer: v })}
      />
      <TextInput
        label={t('JWKS URI')}
        required
        placeholder="https://auth.example.com/.well-known/jwks.json"
        value={provider.remoteJWKS?.uri}
        onChange={v => set({ remoteJWKS: { uri: v || '' } })}
      />
      <StringListInput
        label={t('Audiences')}
        value={provider.audiences}
        onChange={v => set({ audiences: v })}
      />
      <StringListInput
        label={t('Copy claims to headers')}
        help={t('Format: claim=header, e.g. sub=x-user-id')}
        value={(provider.claimToHeaders || []).map(c => `${c.claim}=${c.header}`)}
        validateItem={i => /^[^=]+=[^=]+$/.test(i)}
        onChange={v =>
          set({
            claimToHeaders: (v || [])
              .filter(i => i.includes('='))
              .map(i => {
                const [claim, header] = i.split('=');
                return { claim: claim.trim(), header: header.trim() };
              }),
          })
        }
      />
      <SwitchInput
        label={t('Recompute route after validation')}
        help={t('Needed when routes match on headers populated from claims.')}
        value={provider.recomputeRoute}
        onChange={v => set({ recomputeRoute: v })}
      />
    </FieldGrid>
  );
}

export function JWTSection(props: SectionProps) {
  const { t } = useText();
  const text = useAuthText()('jwt');
  const { bind, spec, toggle } = useSection(props);
  const providers = bind<JWTProvider[]>(['spec', 'jwt', 'providers']);
  return (
    <ToggleSection
      title={text[0]}
      description={text[1]}
      icon={AUTH_ICONS.jwt}
      enabled={!!spec.jwt}
      onToggle={toggle('jwt', AUTH_DEFAULTS.jwt)}
    >
      <SwitchInput
        label={t('Allow requests without a token')}
        help={t('Tokens are still validated when present.')}
        {...bind(['spec', 'jwt', 'optional'])}
      />
      <Box sx={{ mt: 1 }}>
        <ArrayEditor<JWTProvider>
          items={providers.value}
          onChange={providers.onChange}
          newItem={() => ({ name: '', remoteJWKS: { uri: '' } })}
          addLabel={t('Add provider')}
          itemTitle={(p, i) => p.name || t('Provider #{{index}}', { index: i + 1 })}
          minItems={1}
          renderItem={(p, update) => <JWTProviderEditor provider={p} onChange={update} />}
        />
      </Box>
    </ToggleSection>
  );
}

export function OIDCSection(props: SectionProps) {
  const { t } = useText();
  const text = useAuthText()('oidc');
  const { bind, spec, toggle } = useSection(props);
  return (
    <ToggleSection
      title={text[0]}
      description={text[1]}
      icon={AUTH_ICONS.oidc}
      enabled={!!spec.oidc}
      onToggle={toggle('oidc', AUTH_DEFAULTS.oidc)}
    >
      <FieldGrid>
        <TextInput
          label={t('Issuer')}
          required
          placeholder="https://accounts.google.com"
          {...bind(['spec', 'oidc', 'provider', 'issuer'])}
        />
        <TextInput label={t('Client ID')} required {...bind(['spec', 'oidc', 'clientID'])} />
        <TextInput
          label={t('Redirect URL')}
          placeholder="https://www.example.com/oauth2/callback"
          {...bind(['spec', 'oidc', 'redirectURL'])}
        />
        <TextInput
          label={t('Logout path')}
          placeholder="/logout"
          {...bind(['spec', 'oidc', 'logoutPath'])}
        />
        <StringListInput
          label={t('Scopes')}
          suggestions={['openid', 'email', 'profile', 'offline_access']}
          {...bind(['spec', 'oidc', 'scopes'])}
        />
        <SwitchInput
          label={t('Forward access token to the backend')}
          {...bind(['spec', 'oidc', 'forwardAccessToken'])}
        />
      </FieldGrid>
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
        {t('Client secret')}
      </Typography>
      <CredentialSecret credential="oidc" {...props}>
        <OidcClientSecretInput />
      </CredentialSecret>
    </ToggleSection>
  );
}

/** Password field; the stored value is kept while it stays empty. */
function SecretInput({
  label,
  value,
  onChange,
  stored,
  storedHelp,
  visible,
  action,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  stored: boolean;
  storedHelp: string;
  visible?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete="new-password"
      required={!stored}
      value={value}
      onChange={e => onChange(e.target.value)}
      helperText={stored ? storedHelp : undefined}
      InputProps={{
        sx: visible ? { fontFamily: 'monospace', fontSize: '0.85rem' } : undefined,
        endAdornment: action ? <InputAdornment position="end">{action}</InputAdornment> : undefined,
      }}
    />
  );
}

const EXPECTED_KEY: Record<Credential, string> = {
  apiKeyAuth: '',
  basicAuth: HTPASSWD_KEY,
  oidc: OIDC_SECRET_KEY,
};

/**
 * Where a method keeps its credentials: a Secret of this policy (updated in place), a new Secret
 * created from the values below, or an existing Secret that is only referenced.
 */
function CredentialSecret({
  credential,
  value,
  onChange,
  children,
}: SectionProps & { credential: Credential; children: React.ReactNode }) {
  const { t } = useText();
  const managed = useManagedSecrets();
  const spec = value.spec || {};
  const refs = secretRefs(spec, credential);
  const setRefs = (next: ObjectRef[]) =>
    onChange({ ...value, spec: withSecretRefs(spec, credential, next) });
  const namespace = value.metadata?.namespace;
  const expectedKey = EXPECTED_KEY[credential];
  const existingHelp =
    credential === 'apiKeyAuth'
      ? t('Each key of these Secrets is a client ID and its value the API key.')
      : t('The Secret must hold the "{{key}}" key.', { key: expectedKey });

  const existingPicker =
    credential === 'apiKeyAuth' ? (
      <StringListInput
        label={t('Credential Secrets')}
        help={existingHelp}
        suggestions={managed?.secretNames}
        value={refs.map(r => r.name).filter(Boolean)}
        onChange={names => setRefs((names || []).map(name => ({ name })))}
      />
    ) : (
      <ObjectRefField
        kind="Secret"
        label={t('Secret')}
        required
        namespace={namespace}
        help={existingHelp}
        value={refs[0]}
        onChange={ref => setRefs(ref ? [ref] : [])}
      />
    );

  if (!managed) return <FieldGrid>{existingPicker}</FieldGrid>;
  if (!managed.ready) {
    return <Typography color="text.secondary">{t('Loading Secrets…')}</Typography>;
  }
  const method = managed.state[credential];
  return (
    <Box sx={{ mb: 2 }}>
      {managed.unreadable && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {t(
            'The Secrets of this namespace cannot be read, so it is unknown whether one belongs to this policy. You can still use an existing Secret or create a new one.'
          )}
        </Alert>
      )}
      <RadioGroup
        row
        value={method.mode}
        onChange={e => managed.setMode(credential, e.target.value as SecretMode)}
      >
        {method.ownedName && (
          <FormControlLabel
            value="owned"
            control={<Radio size="small" />}
            label={t('Update the Secret of this policy ({{name}})', { name: method.ownedName })}
          />
        )}
        <FormControlLabel
          value="new"
          control={<Radio size="small" />}
          label={t('Create a new Secret')}
        />
        <FormControlLabel
          value="existing"
          control={<Radio size="small" />}
          label={t('Use an existing Secret')}
        />
      </RadioGroup>
      {method.mode === 'existing' && <FieldGrid>{existingPicker}</FieldGrid>}
      {method.mode === 'new' && (
        <>
          <FieldGrid>
            <TextInput
              label={t('Secret name')}
              required
              help={t(
                'Created when you apply; it belongs to this policy and is deleted together with it. Applying fails if a Secret with this name already exists.'
              )}
              value={refs[0]?.name}
              onChange={name => setRefs([{ name: name || '' }, ...refs.slice(1)])}
            />
          </FieldGrid>
          <Box sx={{ mt: 1.5 }}>{children}</Box>
        </>
      )}
      {method.mode === 'owned' && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t(
              'The Secret "{{name}}" belongs to this policy and is deleted together with it. Stored values are not shown; leave a field empty to keep its value.',
              { name: method.ownedName }
            )}
          </Typography>
          {children}
        </>
      )}
    </Box>
  );
}

function BasicAuthUsers() {
  const { t } = useText();
  const managed = useManagedSecrets();
  if (!managed) return null;
  return (
    <ArrayEditor<BasicUser>
      items={managed.state.basicAuth.items}
      onChange={users => managed.setBasicUsers(users || [])}
      newItem={() => ({ username: '', password: '' })}
      addLabel={t('Add user')}
      itemTitle={(u, i) => u.username || t('User #{{index}}', { index: i + 1 })}
      renderItem={(user, update) => (
        <FieldGrid>
          <TextInput
            label={t('Username')}
            required
            value={user.username}
            onChange={v => update({ ...user, username: v || '' })}
          />
          <SecretInput
            label={t('Password')}
            value={user.password}
            onChange={v => update({ ...user, password: v })}
            stored={!!user.storedHash}
            storedHelp={t('Leave empty to keep the current password.')}
          />
        </FieldGrid>
      )}
    />
  );
}

function ApiKeyClients() {
  const { t } = useText();
  const managed = useManagedSecrets();
  if (!managed) return null;
  return (
    <ArrayEditor<ApiKeyClient>
      items={managed.state.apiKeyAuth.items}
      onChange={clients => managed.setApiKeyClients(clients || [])}
      newItem={() => ({ clientId: '', key: '' })}
      addLabel={t('Add client')}
      itemTitle={(c, i) => c.clientId || t('Client #{{index}}', { index: i + 1 })}
      renderItem={(client, update) => (
        <FieldGrid>
          <TextInput
            label={t('Client ID')}
            required
            help={t('Sent to the backend in the client ID header below, if set.')}
            value={client.clientId}
            onChange={v => update({ ...client, clientId: v || '' })}
          />
          <SecretInput
            label={t('API key')}
            visible
            value={client.key}
            onChange={v => update({ ...client, key: v })}
            stored={!!client.storedId}
            storedHelp={t('Leave empty to keep the current key.')}
            action={
              <Tooltip title={t('Generate a random key')}>
                <IconButton
                  size="small"
                  aria-label={t('Generate a random key')}
                  onClick={() => update({ ...client, key: generateApiKey() })}
                >
                  <Icon icon="mdi:dice-multiple-outline" />
                </IconButton>
              </Tooltip>
            }
          />
        </FieldGrid>
      )}
    />
  );
}

function OidcClientSecretInput() {
  const { t } = useText();
  const managed = useManagedSecrets();
  if (!managed) return null;
  const secret = managed.state.oidc.items[0] || { value: '' };
  return (
    <FieldGrid>
      <SecretInput
        label={t('Client secret')}
        value={secret.value}
        onChange={v => managed.setOidcSecret({ ...secret, value: v })}
        stored={!!secret.stored}
        storedHelp={t('Leave empty to keep the current client secret.')}
      />
    </FieldGrid>
  );
}

export function BasicAuthSection(props: SectionProps) {
  const { t } = useText();
  const text = useAuthText()('basicAuth');
  const { bind, spec, toggle } = useSection(props);
  return (
    <ToggleSection
      title={text[0]}
      description={text[1]}
      icon={AUTH_ICONS.basicAuth}
      enabled={!!spec.basicAuth}
      onToggle={toggle('basicAuth', AUTH_DEFAULTS.basicAuth)}
    >
      <CredentialSecret credential="basicAuth" {...props}>
        <BasicAuthUsers />
      </CredentialSecret>
      <FieldGrid>
        <TextInput
          label={t('Forward username header')}
          placeholder="x-username"
          {...bind(['spec', 'basicAuth', 'forwardUsernameHeader'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function APIKeySection(props: SectionProps) {
  const { t } = useText();
  const text = useAuthText()('apiKeyAuth');
  const { bind, spec, toggle } = useSection(props);
  const headers: string[] = spec.apiKeyAuth?.extractFrom?.[0]?.headers || [];
  return (
    <ToggleSection
      title={text[0]}
      description={text[1]}
      icon={AUTH_ICONS.apiKeyAuth}
      enabled={!!spec.apiKeyAuth}
      onToggle={toggle('apiKeyAuth', AUTH_DEFAULTS.apiKeyAuth)}
    >
      <CredentialSecret credential="apiKeyAuth" {...props}>
        <ApiKeyClients />
      </CredentialSecret>
      <FieldGrid>
        <StringListInput
          label={t('Read the key from headers')}
          suggestions={['x-api-key', 'authorization']}
          value={headers}
          onChange={v =>
            bind(['spec', 'apiKeyAuth', 'extractFrom']).onChange(
              v?.length ? [{ headers: v }] : undefined
            )
          }
        />
        <TextInput
          label={t('Forward client ID header')}
          placeholder="x-client-id"
          {...bind(['spec', 'apiKeyAuth', 'forwardClientIDHeader'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function ExtAuthSection(props: SectionProps) {
  const { t } = useText();
  const text = useAuthText()('extAuth');
  const { bind, spec, namespace, toggle } = useSection(props);
  const protocol: 'http' | 'grpc' = spec.extAuth?.grpc ? 'grpc' : 'http';
  const service = spec.extAuth?.[protocol] || {};
  const refs = [
    ...(service.backendRef ? [service.backendRef] : []),
    ...(service.backendRefs || []),
  ];
  return (
    <ToggleSection
      title={text[0]}
      description={text[1]}
      icon={AUTH_ICONS.extAuth}
      enabled={!!spec.extAuth}
      onToggle={toggle('extAuth', AUTH_DEFAULTS.extAuth)}
    >
      <FieldGrid>
        <SelectInput
          label={t('Protocol')}
          allowEmpty={false}
          options={[
            { value: 'http', label: 'HTTP' },
            { value: 'grpc', label: 'gRPC (ext_authz)' },
          ]}
          value={protocol}
          onChange={v => {
            const ext = { ...spec.extAuth };
            delete ext.http;
            delete ext.grpc;
            ext[v === 'grpc' ? 'grpc' : 'http'] = { backendRefs: refs };
            bind(['spec', 'extAuth']).onChange(ext);
          }}
        />
        {protocol === 'http' && (
          <TextInput
            label={t('Path prefix')}
            placeholder="/auth"
            {...bind(['spec', 'extAuth', 'http', 'path'])}
          />
        )}
      </FieldGrid>
      <Box sx={{ my: 2 }}>
        <BackendRefsEditor
          namespace={namespace}
          value={refs}
          onChange={next => {
            const svc = { ...service, backendRefs: next };
            delete svc.backendRef;
            bind(['spec', 'extAuth', protocol]).onChange(svc);
          }}
        />
      </Box>
      <FieldGrid>
        <StringListInput
          label={t('Headers sent to the auth service')}
          suggestions={['authorization', 'cookie']}
          {...bind(['spec', 'extAuth', 'headersToExtAuth'])}
        />
        {protocol === 'http' && (
          <StringListInput
            label={t('Headers copied back to the request')}
            help={t('Headers of the auth response that are added to the upstream request.')}
            {...bind(['spec', 'extAuth', 'http', 'headersToBackend'])}
          />
        )}
        <SwitchInput
          label={t('Fail open')}
          help={t('Allow requests when the auth service is unreachable.')}
          {...bind(['spec', 'extAuth', 'failOpen'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function CORSSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, toggle } = useSection(props);
  return (
    <ToggleSection
      title={t('CORS')}
      description={t('Cross-origin resource sharing for browser clients.')}
      icon="mdi:web"
      enabled={!!spec.cors}
      onToggle={toggle('cors', () => ({
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
      }))}
    >
      <FieldGrid>
        <StringListInput
          label={t('Allowed origins')}
          placeholder="https://*.example.com"
          {...bind(['spec', 'cors', 'allowOrigins'])}
        />
        <StringListInput
          label={t('Allowed methods')}
          suggestions={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']}
          {...bind(['spec', 'cors', 'allowMethods'])}
        />
        <StringListInput label={t('Allowed headers')} {...bind(['spec', 'cors', 'allowHeaders'])} />
        <StringListInput
          label={t('Exposed headers')}
          {...bind(['spec', 'cors', 'exposeHeaders'])}
        />
        <DurationInput
          label={t('Max age')}
          placeholder="1h"
          {...bind(['spec', 'cors', 'maxAge'])}
        />
        <SwitchInput
          label={t('Allow credentials')}
          {...bind(['spec', 'cors', 'allowCredentials'])}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

interface AuthzRule {
  name?: string;
  action: string;
  principal?: { clientCIDRs?: string[] };
}

export function AuthorizationSection(props: SectionProps) {
  const { t } = useText();
  const { bind, spec, toggle } = useSection(props);
  const rules = bind<AuthzRule[]>(['spec', 'authorization', 'rules']);
  return (
    <ToggleSection
      title={t('Authorization')}
      description={t(
        'Allow or deny requests by client IP (more principals such as JWT claims can be set in YAML).'
      )}
      icon="mdi:shield-check-outline"
      enabled={!!spec.authorization}
      onToggle={toggle('authorization', () => ({
        defaultAction: 'Deny',
        rules: [
          { name: 'allow-internal', action: 'Allow', principal: { clientCIDRs: ['10.0.0.0/8'] } },
        ],
      }))}
    >
      <FieldGrid>
        <SelectInput
          label={t('Default action')}
          help={t('Applied when no rule matches.')}
          options={['Deny', 'Allow']}
          {...bind(['spec', 'authorization', 'defaultAction'])}
        />
      </FieldGrid>
      <Box sx={{ mt: 2 }}>
        <ArrayEditor<AuthzRule>
          items={rules.value}
          onChange={rules.onChange}
          newItem={() => ({ action: 'Allow', principal: { clientCIDRs: [] } })}
          addLabel={t('Add rule')}
          itemTitle={(r, i) => r.name || t('Rule #{{index}}', { index: i + 1 })}
          renderItem={(rule, update) => (
            <FieldGrid columns={3}>
              <TextInput
                label={t('Name')}
                value={rule.name}
                onChange={v => update({ ...rule, name: v })}
              />
              <SelectInput
                label={t('Action')}
                allowEmpty={false}
                options={['Allow', 'Deny']}
                value={rule.action}
                onChange={v => update({ ...rule, action: v || 'Allow' })}
              />
              <StringListInput
                label={t('Client CIDRs')}
                placeholder="10.0.0.0/8"
                validateItem={i => CIDR_RE.test(i)}
                value={rule.principal?.clientCIDRs}
                onChange={v =>
                  update({ ...rule, principal: { ...rule.principal, clientCIDRs: v } })
                }
              />
            </FieldGrid>
          )}
        />
      </Box>
    </ToggleSection>
  );
}

export const AUTH_SECTIONS: Record<AuthMethod, React.ComponentType<SectionProps>> = {
  jwt: JWTSection,
  oidc: OIDCSection,
  basicAuth: BasicAuthSection,
  apiKeyAuth: APIKeySection,
  extAuth: ExtAuthSection,
};
