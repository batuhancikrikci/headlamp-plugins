/**
 * Credential Secrets for the SecurityPolicy editors (see managedSecrets.ts). The Secret names live
 * in the policy itself (its references), so form and YAML stay in sync; this provider keeps what is
 * not part of the policy: the mode of each method and the values of a new or owned Secret. It hands
 * the Secrets to write to the editor, which applies them with the policy (FormExtras).
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { FormExtras, ResourceFormProps } from '../../common/form/ResourceEditor';
import { sameJson } from '../../common/yaml';
import {
  ApiKeyClient,
  BasicUser,
  Credential,
  CREDENTIALS,
  defaultSecretName,
  dependentsFor,
  newState,
  OidcClientSecret,
  SecretJson,
  SecretMode,
  secretRefs,
  State,
  stateFromLive,
  withSecretRefs,
} from './managedSecrets';

interface ContextValue {
  /** False while the Secrets of an edited policy are loading. */
  ready: boolean;
  unreadable: boolean;
  state: State;
  /** Names of the Secrets in the policy namespace, for the "existing" pickers. */
  secretNames: string[];
  setMode: (credential: Credential, mode: SecretMode) => void;
  setApiKeyClients: (clients: ApiKeyClient[]) => void;
  setBasicUsers: (users: BasicUser[]) => void;
  setOidcSecret: (secret: OidcClientSecret) => void;
  /** Secrets that applying creates or updates. */
  pending: Array<{ name: string; action: 'create' | 'update' | 'delete' }>;
}

const Context = React.createContext<ContextValue | null>(null);

export function useManagedSecrets(): ContextValue | null {
  return React.useContext(Context);
}

export function ManagedSecretsProvider({
  value,
  onChange,
  mode,
  onExtrasChange,
  children,
}: React.PropsWithChildren<
  Pick<ResourceFormProps, 'value' | 'onChange' | 'mode' | 'onExtrasChange'>
>) {
  const namespace = value.metadata?.namespace;
  const policyName = value.metadata?.name;
  const [secrets, secretsError] = K8s.ResourceClasses.Secret.useList(
    namespace ? { namespace } : {}
  );
  const [state, setState] = React.useState<State | null>(() =>
    mode === 'create' ? newState() : null
  );
  /** State the edit started from, to restore an owned Secret's values after switching away. */
  const initial = React.useRef<State | null>(null);
  /** Names this provider suggested, per method, so a renamed policy renames them too. */
  const suggested = React.useRef<Partial<Record<Credential, string>>>({});

  // An edited policy starts from its live Secrets.
  React.useEffect(() => {
    if (state || (!secrets && !secretsError)) return;
    const live = stateFromLive(
      value,
      (secrets || []).map(s => s.jsonData as SecretJson),
      !!secretsError && !secrets
    );
    initial.current = live;
    setState(live);
  }, [state, secrets, secretsError, value]);

  // A new Secret is named after the policy until the user names it.
  React.useEffect(() => {
    if (!state) return;
    let spec = value.spec || {};
    for (const credential of CREDENTIALS) {
      if (!spec[credential] || state[credential].mode !== 'new') continue;
      const refs = secretRefs(spec, credential);
      const current = refs[0]?.name || '';
      const name = defaultSecretName(policyName, credential);
      if (current === name || (current && current !== suggested.current[credential])) continue;
      suggested.current[credential] = name;
      spec = withSecretRefs(spec, credential, [{ name }, ...refs.slice(1)]);
    }
    if (!sameJson(spec, value.spec || {})) onChange({ ...value, spec });
  }, [state, value, policyName, onChange]);

  const extras: FormExtras = React.useMemo(() => {
    if (!state) return { dependents: [], errors: [], dirty: false };
    const { dependents, errors } = dependentsFor(state, value);
    return {
      dependents,
      errors,
      dirty: CREDENTIALS.some(c => state[c].touched),
    };
  }, [state, value]);

  React.useEffect(() => {
    onExtrasChange?.(extras);
  }, [extras, onExtrasChange]);

  const update = <C extends Credential>(credential: C, patch: Partial<State[C]>) =>
    setState(s => s && { ...s, [credential]: { ...s[credential], ...patch, touched: true } });

  const setMode = (credential: Credential, next: SecretMode) => {
    if (!state) return;
    const spec = value.spec || {};
    const current = state[credential];
    // Switching changes which Secret the policy points to.
    let refs = secretRefs(spec, credential);
    if (next === 'owned') refs = [{ name: current.ownedName || '' }, ...refs.slice(1)];
    if (next === 'new') {
      const name = defaultSecretName(policyName, credential);
      suggested.current[credential] = name;
      refs = [{ name }];
    }
    if (next === 'existing') refs = current.mode === 'existing' ? refs : [];
    const base =
      next === 'new'
        ? newState()[credential]
        : next === 'owned'
        ? initial.current?.[credential] || current
        : current;
    setState(
      s =>
        s && {
          ...s,
          [credential]: {
            ...base,
            ownedName: current.ownedName,
            storedData: current.storedData,
            mode: next,
            // Back on the owned Secret without changes: nothing to rewrite.
            touched: next !== 'owned',
          },
        }
    );
    onChange({ ...value, spec: withSecretRefs(spec, credential, refs) });
  };

  const context: ContextValue = {
    ready: !!state,
    unreadable: !!state?.unreadable,
    state: state || newState(),
    secretNames: (secrets || []).map(s => s.metadata.name),
    setMode,
    setApiKeyClients: items => update('apiKeyAuth', { items }),
    setBasicUsers: items => update('basicAuth', { items }),
    setOidcSecret: secret => update('oidc', { items: [secret] }),
    pending: extras.dependents.map(d => ({ name: d.object.metadata.name, action: d.action })),
  };

  return <Context.Provider value={context}>{children}</Context.Provider>;
}
