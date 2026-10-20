import { ApiProxy, Router } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { BackendSecurityPolicy } from '../../resources/backendSecurityPolicy';
import { API_SCHEMA_NAMES, APISchemaName } from '../../resources/common';
import { ENVOY_GATEWAY_GROUP, EnvoyBackend } from '../../resources/external';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { applyWithOwners, discoverBackendTLSPolicyVersion } from '../../utils/apply';
import { prune, validateName } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  buildCredentialResources,
  credentialErrors,
  CredentialFields,
  CredentialState,
  initialCredentialState,
  POLICY_TYPE_LABELS,
} from '../backendSecurityPolicy/credentials';
import { editableJson, EditObjectLoader } from '../common/EditWithFormAction';
import { FieldGrid, FullRow, NamespaceInput, SuggestInput, TextInput } from '../common/FormFields';
import { ProviderLogos } from '../common/ProviderLogos';
import { useAutoSelectSingle } from '../common/useAutoSelect';
import { ResourceWizard } from '../common/Wizard';
import { BackendForm, formFromAISB, formFromPreset, mergeAISBSpec } from './backendForm';
import { PROVIDER_PRESETS, ProviderPreset } from './providerPresets';
import { ServiceDiscoveryField } from './ServiceDiscoveryField';

export function AIServiceBackendCreateWizard() {
  return (
    <WithVersionDiscovery title="Connect a Provider">
      <WizardContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing AIServiceBackend (provider/schema and endpoint) with the same steps. */
export function AIServiceBackendEditWizard() {
  return (
    <WithVersionDiscovery title="Edit Service Backend">
      <EditObjectLoader<AIServiceBackend>
        resourceClass={AIServiceBackend}
        title="Edit Service Backend"
      >
        {backend => <WizardContent key={backend.metadata.resourceVersion} edit={backend} />}
      </EditObjectLoader>
    </WithVersionDiscovery>
  );
}

function WizardContent({ edit }: { edit?: AIServiceBackend }) {
  const [form, setForm] = useState<BackendForm>(() =>
    edit ? formFromAISB(edit.jsonData) : formFromPreset(PROVIDER_PRESETS[0])
  );
  const [cred, setCred] = useState<CredentialState>(() =>
    initialCredentialState(PROVIDER_PRESETS[0].policyType || 'APIKey', '')
  );
  const [tlsPolicyVersion, setTlsPolicyVersion] = useState<string | null | undefined>(undefined);
  const [envoyBackends, envoyBackendsError] = EnvoyBackend.useList({
    namespace: form.namespace || undefined,
  });

  useEffect(() => {
    discoverBackendTLSPolicyVersion().then(setTlsPolicyVersion);
  }, []);

  const preset = PROVIDER_PRESETS.find(p => p.id === form.presetId) || PROVIDER_PRESETS[0];

  // Reusing a Backend and only one exists in the namespace: select it.
  useAutoSelectSingle(
    form.endpointMode === 'existing' && envoyBackends
      ? envoyBackends.map(b => b.metadata.name)
      : null,
    !form.envoyBackendName,
    name => setForm(f => ({ ...f, envoyBackendName: name })),
    !edit,
    `${form.namespace}|${form.endpointMode}`
  );
  const update = (patch: Partial<BackendForm>) => setForm(f => ({ ...f, ...patch }));
  const envoyName = form.endpointMode === 'new' ? form.name : form.envoyBackendName;
  // An empty secret name means "derive it from the backend name".
  const defaultSecretName = form.name
    ? `${form.name}-${cred.type === 'AWSCredentials' ? 'credentials' : 'apikey'}`
    : '';
  const effectiveCred: CredentialState = {
    ...cred,
    secretName: cred.secretName || defaultSecretName,
  };

  function selectPreset(p: ProviderPreset) {
    // When editing, a preset only changes the schema (the endpoint stays as it is).
    setForm(f =>
      edit
        ? { ...f, presetId: p.id, schema: p.schema, schemaVersion: p.schemaVersion || '' }
        : formFromPreset(p, f)
    );
    if (p.policyType) {
      setCred(c => ({ ...initialCredentialState(p.policyType!, ''), secretName: c.secretName }));
    }
  }

  // ─── Validation ───────────────────────────────────────────────────────────
  const basicsErrors = [
    validateName(form.name),
    validateName(form.namespace, 'Namespace'),
    form.schema === 'AzureOpenAI' && !form.schemaVersion
      ? 'Azure OpenAI requires an API version (e.g. 2025-01-01-preview).'
      : null,
  ].filter((e): e is string => !!e);

  const port = Number(form.port);
  const endpointErrors =
    form.endpointMode === 'new'
      ? [
          !form.hostname ? 'Hostname is required.' : null,
          !Number.isInteger(port) || port < 1 || port > 65535
            ? 'Port must be between 1 and 65535.'
            : null,
        ].filter((e): e is string => !!e)
      : [validateName(form.envoyBackendName, 'Envoy Backend')].filter((e): e is string => !!e);

  const authErrors = form.configureAuth ? credentialErrors(effectiveCred) : [];

  /** New Backend/TLS/Secret/policy first, then update the Service Backend itself. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return [];
    const own = items.filter(i => i.kind === AIServiceBackend.kind);
    if (own.length !== 1) throw new Error('Edit exactly one AIServiceBackend document.');
    return applyWithOwners(
      items,
      item => (item.kind === AIServiceBackend.kind ? edit.update(item) : ApiProxy.apply(item)),
      // A policy added while editing is new: one with the same name is never replaced.
      { createOnly: item => item.kind === 'BackendSecurityPolicy' }
    );
  }

  // ─── Resource generation ──────────────────────────────────────────────────
  function buildResources(): KubeObjectInterface[] {
    const ns = form.namespace;
    const items: KubeObjectInterface[] = [];
    let secretAndPolicy: KubeObjectInterface[] = [];
    if (form.configureAuth) {
      secretAndPolicy = buildCredentialResources(effectiveCred, {
        policyName: `${form.name}-auth`,
        namespace: ns,
        targetBackends: [form.name],
        apiVersion: BackendSecurityPolicy.apiVersion,
      });
    }
    // Secret first so the policy never references a missing secret.
    const secret = secretAndPolicy.find(r => r.kind === 'Secret');
    const policy = secretAndPolicy.find(r => r.kind !== 'Secret');
    if (secret) items.push(secret);

    if (form.endpointMode === 'new') {
      items.push({
        apiVersion: EnvoyBackend.apiVersion,
        kind: EnvoyBackend.kind,
        metadata: { name: form.name, namespace: ns },
        spec: { endpoints: [{ fqdn: { hostname: form.hostname, port } }] },
      } as KubeObjectInterface);
      if (form.tls && tlsPolicyVersion) {
        items.push({
          apiVersion: tlsPolicyVersion,
          kind: 'BackendTLSPolicy',
          metadata: { name: `${form.name}-tls`, namespace: ns },
          spec: {
            targetRefs: [{ group: ENVOY_GATEWAY_GROUP, kind: 'Backend', name: form.name }],
            validation: { wellKnownCACertificates: 'System', hostname: form.hostname },
          },
        } as unknown as KubeObjectInterface);
      }
    }

    if (edit) {
      const current = editableJson<KubeObjectInterface & { spec?: Record<string, unknown> }>(edit);
      items.push({
        ...current,
        spec: mergeAISBSpec(current.spec, form, envoyName),
      } as KubeObjectInterface);
      if (policy) items.push(policy);
      return items;
    }
    items.push(
      prune({
        apiVersion: AIServiceBackend.apiVersion,
        kind: AIServiceBackend.kind,
        metadata: { name: form.name, namespace: ns },
        spec: {
          schema: {
            name: form.schema,
            version: form.schemaVersion || undefined,
            prefix: form.schemaPrefix || undefined,
          },
          backendRef: { name: envoyName, kind: 'Backend', group: ENVOY_GATEWAY_GROUP },
        },
      }) as KubeObjectInterface
    );
    if (policy) items.push(policy);
    return items;
  }

  return (
    <ResourceWizard
      title={edit ? `Edit Service Backend ${form.namespace}/${form.name}` : 'Connect a Provider'}
      mode={edit ? 'edit' : 'create'}
      applyItems={
        edit
          ? saveEdit
          : // A wizard creates: an object with the same name is never replaced.
            items => applyWithOwners(items, undefined, { createOnly: () => true })
      }
      cancelUrl={
        edit
          ? Router.createRouteURL(detailRoute(ROUTE_NAMES.backends), {
              namespace: form.namespace,
              name: form.name,
            })
          : undefined
      }
      listRouteName={listRoute(ROUTE_NAMES.backends)}
      detailRouteName={detailRoute(ROUTE_NAMES.backends)}
      primaryKind={AIServiceBackend.kind}
      buildResources={buildResources}
      summary={
        <NameValueTable
          rows={[
            {
              name: 'Provider',
              value: (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ProviderLogos presetId={preset.id} size={18} />
                  {preset.label}
                </Box>
              ),
            },
            { name: 'Service Backend', value: `${form.namespace}/${form.name}` },
            {
              name: 'API Schema',
              value: [form.schema, form.schemaVersion].filter(Boolean).join(' @ '),
            },
            {
              name: 'Endpoint',
              value:
                form.endpointMode === 'new'
                  ? `${form.tls ? 'https' : 'http'}://${form.hostname}:${form.port}`
                  : `Existing Backend ${form.envoyBackendName}`,
            },
            {
              name: 'Authentication',
              value: form.configureAuth ? POLICY_TYPE_LABELS[cred.type] : 'None',
            },
          ]}
        />
      }
      steps={[
        {
          label: 'Provider',
          description: 'Choose the AI provider and name the Service Backend.',
          errors: basicsErrors,
          content: (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                  gap: 1.5,
                  mb: 3,
                }}
              >
                {PROVIDER_PRESETS.map(p => (
                  <Card
                    key={p.id}
                    variant="outlined"
                    sx={{
                      borderColor: p.id === form.presetId ? 'primary.main' : undefined,
                      borderWidth: p.id === form.presetId ? 2 : 1,
                    }}
                  >
                    <CardActionArea
                      onClick={() => selectPreset(p)}
                      aria-pressed={p.id === form.presetId}
                      sx={{ height: '100%' }}
                    >
                      <CardContent
                        sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
                      >
                        <ProviderLogos presetId={p.id} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2">{p.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {p.description}
                          </Typography>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Box>
              <FieldGrid>
                <TextInput
                  label="Name"
                  required
                  disabled={!!edit}
                  value={form.name}
                  onChange={e => update({ name: e.target.value })}
                  helperText="Used for the Service Backend and the resources created with it."
                />
                {edit ? (
                  <TextInput label="Namespace" disabled value={form.namespace} />
                ) : (
                  <NamespaceInput
                    value={form.namespace}
                    onChange={v => update({ namespace: v, envoyBackendName: '' })}
                  />
                )}
                <TextInput
                  select
                  label="API schema"
                  value={form.schema}
                  onChange={e => update({ schema: e.target.value as APISchemaName })}
                >
                  {API_SCHEMA_NAMES.map(s => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextInput>
                <TextInput
                  label="Schema version"
                  value={form.schemaVersion}
                  onChange={e => update({ schemaVersion: e.target.value })}
                  helperText="Provider API version, e.g. the Azure OpenAI api-version."
                />
                <TextInput
                  label="Path prefix"
                  value={form.schemaPrefix}
                  onChange={e => update({ schemaPrefix: e.target.value })}
                  helperText="Optional. Overrides the default path prefix (e.g. /v1)."
                />
              </FieldGrid>
            </>
          ),
        },
        {
          label: 'Endpoint',
          description:
            'Where the gateway sends traffic. A new Envoy Gateway Backend is created unless you reuse an existing one.',
          errors: endpointErrors,
          content: (
            <FieldGrid>
              <FullRow>
                <RadioGroup
                  row
                  value={form.endpointMode}
                  onChange={e => update({ endpointMode: e.target.value as 'new' | 'existing' })}
                >
                  <FormControlLabel value="new" control={<Radio />} label="Create a new Backend" />
                  <FormControlLabel
                    value="existing"
                    control={<Radio />}
                    label="Use an existing Backend"
                  />
                </RadioGroup>
              </FullRow>
              {form.endpointMode === 'new' ? (
                <>
                  {preset.id === 'openai-compatible' && (
                    <FullRow>
                      <ServiceDiscoveryField
                        onPick={({ hostname, port, tls }) =>
                          update({ hostname, port: String(port), tls })
                        }
                      />
                    </FullRow>
                  )}
                  <TextInput
                    label="Hostname"
                    required
                    value={form.hostname}
                    placeholder={preset.hostnameHelp}
                    helperText={preset.hostnameHelp}
                    onChange={e => update({ hostname: e.target.value.trim() })}
                  />
                  <TextInput
                    label="Port"
                    required
                    type="number"
                    value={form.port}
                    onChange={e => update({ port: e.target.value })}
                  />
                  <FullRow>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.tls}
                          onChange={e => update({ tls: e.target.checked })}
                        />
                      }
                      label="Use TLS (creates a BackendTLSPolicy validated against system CAs)"
                    />
                    {form.tls && tlsPolicyVersion === null && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        BackendTLSPolicy is not served by this cluster's Gateway API. The Backend
                        will be created without TLS origination; configure TLS manually.
                      </Alert>
                    )}
                  </FullRow>
                </>
              ) : (
                <FullRow>
                  <SuggestInput
                    label="Envoy Gateway Backend"
                    required
                    value={form.envoyBackendName}
                    onChange={v => update({ envoyBackendName: v })}
                    loading={envoyBackends === null && !envoyBackendsError}
                    options={(envoyBackends || []).map(b => ({
                      value: b.metadata.name,
                      description: b.endpointSummary,
                    }))}
                    helperText={
                      envoyBackendsError
                        ? 'Could not list gateway.envoyproxy.io Backends in this namespace.'
                        : undefined
                    }
                  />
                </FullRow>
              )}
            </FieldGrid>
          ),
        },
        {
          label: 'Authentication',
          description:
            'Credentials the gateway injects when calling the provider. Creates a Security Policy targeting this backend.',
          errors: authErrors,
          content: (
            <>
              <FormControlLabel
                sx={{ mb: 2 }}
                control={
                  <Switch
                    checked={form.configureAuth}
                    onChange={e => update({ configureAuth: e.target.checked })}
                  />
                }
                label="Configure upstream authentication"
              />
              {form.configureAuth ? (
                <CredentialFields
                  state={effectiveCred}
                  namespace={form.namespace}
                  onChange={patch => setCred(c => ({ ...c, ...patch }))}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No Security Policy will be created. You can attach one later from Security
                  Policies.
                </Typography>
              )}
            </>
          ),
        },
        // Credentials live in a separate Security Policy, edited on its own page.
      ].filter(step => !edit || step.label !== 'Authentication')}
    />
  );
}
