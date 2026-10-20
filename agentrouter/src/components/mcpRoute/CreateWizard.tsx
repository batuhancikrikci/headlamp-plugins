import { ApiProxy, K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert, FormControlLabel, MenuItem, Switch, Typography } from '@mui/material';
import React, { useState } from 'react';
import { EnvoyBackend } from '../../resources/external';
import { MCPRoute } from '../../resources/mcpRoute';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { applyWithOwners, deleteReleasedSecrets } from '../../utils/apply';
import { prune } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { bestServicePort, ServicePortLike } from '../aiServiceBackend/backendForm';
import { editableJson, EditObjectLoader } from '../common/EditWithFormAction';
import {
  FieldGrid,
  FullRow,
  NamespaceInput,
  RepeatedField,
  SuggestInput,
  TextInput,
} from '../common/FormFields';
import { GatewayRefsField } from '../common/GatewayRefsField';
import { ObjectBlock } from '../common/SharedComponents';
import { ResourceWizard } from '../common/Wizard';
import {
  AuthMode,
  basicsErrors,
  formFromMCPRoute,
  MCP_API_KEY_SECRET_KEY,
  MCPForm,
  newMCPForm,
  newSecrets,
  newServer,
  secretNameFor,
  securityErrors,
  serverErrors,
  ServerForm,
  toMCPSpec,
} from './mcpForm';

export function MCPRouteCreateWizard() {
  return (
    <WithVersionDiscovery title="Create MCP Route">
      <WizardContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing MCPRoute with the same steps (form layout by default). */
export function MCPRouteEditWizard() {
  return (
    <WithVersionDiscovery title="Edit MCP Route">
      <EditObjectLoader<MCPRoute> resourceClass={MCPRoute} title="Edit MCP Route">
        {route => <WizardContent key={route.metadata.resourceVersion} edit={route} />}
      </EditObjectLoader>
    </WithVersionDiscovery>
  );
}

const portLabel = (p: ServicePortLike) => `${p.port}${p.name ? ` (${p.name})` : ''}`;

function WizardContent({ edit }: { edit?: MCPRoute }) {
  const [form, setForm] = useState<MCPForm>(() =>
    edit ? formFromMCPRoute(edit.jsonData) : newMCPForm()
  );
  const update = (patch: Partial<MCPForm>) => setForm(f => ({ ...f, ...patch }));
  const ns = form.namespace || undefined;

  const [envoyBackends] = EnvoyBackend.useList({ namespace: ns });
  const [services] = K8s.ResourceClasses.Service.useList({ namespace: ns });
  const [secrets] = K8s.ResourceClasses.Secret.useList({ namespace: ns });

  const servicePorts = (name: string): ServicePortLike[] =>
    ((services || []).find(s => s.metadata.name === name)?.jsonData.spec?.ports ||
      []) as ServicePortLike[];

  /** Picking a Service fills its port automatically (best guess when it has several). */
  function serverPatch(s: ServerForm, patch: Partial<ServerForm>): Partial<ServerForm> {
    const next = { ...s, ...patch };
    if (next.kind === 'Service' && (patch.name !== undefined || patch.kind !== undefined)) {
      const port = bestServicePort(servicePorts(next.name));
      if (port) return { ...patch, port: String(port.port) };
    }
    return patch;
  }

  function buildResources(): KubeObjectInterface[] {
    const secretsToCreate = newSecrets(form) as unknown as KubeObjectInterface[];
    if (edit) {
      const current = editableJson<KubeObjectInterface & { spec?: Record<string, unknown> }>(edit);
      return [
        ...secretsToCreate,
        { ...current, spec: toMCPSpec(form, current.spec) } as KubeObjectInterface,
      ];
    }
    const route = prune({
      apiVersion: MCPRoute.apiVersion,
      kind: MCPRoute.kind,
      metadata: { name: form.name, namespace: form.namespace },
      spec: toMCPSpec(form),
    }) as KubeObjectInterface;
    return [...secretsToCreate, route];
  }

  /** New Secrets first, then update the route with its resourceVersion. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return [];
    const own = items.filter(i => i.kind === MCPRoute.kind);
    if (own.length !== 1) throw new Error('Edit exactly one MCPRoute document.');
    const warnings = await applyWithOwners(items, item =>
      item.kind === MCPRoute.kind ? edit.update(item) : ApiProxy.apply(item)
    );
    // A server removed, or given a new key, leaves its old Secret unused.
    return [...warnings, ...(await deleteReleasedSecrets(edit.jsonData, own[0]))];
  }

  const backendOptions = (envoyBackends || []).map(b => ({
    value: b.metadata.name,
    description: b.endpointSummary,
  }));
  const serviceOptions = (services || []).map(svc => ({
    value: svc.metadata.name,
    description: `ports ${(svc.jsonData.spec?.ports || []).map(p => portLabel(p)).join(', ')}`,
  }));
  const secretOptions = (secrets || [])
    .filter(s => s.jsonData.type === 'Opaque')
    .sort(
      (a, b) =>
        Number(!!b.data?.[MCP_API_KEY_SECRET_KEY]) - Number(!!a.data?.[MCP_API_KEY_SECRET_KEY])
    )
    .map(s => ({ value: s.metadata.name, description: Object.keys(s.data || {}).join(', ') }));

  const { name, namespace, oauth } = form;
  const setOAuth = (patch: Partial<MCPForm['oauth']>) =>
    setForm(f => ({ ...f, oauth: { ...f.oauth, ...patch } }));

  return (
    <ResourceWizard
      title={edit ? `Edit MCP Route ${namespace}/${name}` : 'Create MCP Route'}
      mode={edit ? 'edit' : 'create'}
      applyItems={
        edit
          ? saveEdit
          : // A wizard creates: an object with the same name is never replaced.
            items => applyWithOwners(items, undefined, { createOnly: () => true })
      }
      cancelUrl={
        edit ? Router.createRouteURL(detailRoute(ROUTE_NAMES.mcp), { namespace, name }) : undefined
      }
      listRouteName={listRoute(ROUTE_NAMES.mcp)}
      detailRouteName={detailRoute(ROUTE_NAMES.mcp)}
      primaryKind={MCPRoute.kind}
      buildResources={buildResources}
      summary={
        <NameValueTable
          rows={[
            { name: 'MCP Route', value: `${namespace}/${name}` },
            { name: 'Endpoint path', value: form.path || '/mcp' },
            {
              name: 'Gateways',
              value: form.gateways
                .filter(g => g.name)
                .map(g => g.name)
                .join(', '),
            },
            ...form.servers.map((s, i) => ({
              name: `MCP server ${i + 1}`,
              value: `${s.kind}/${s.name}${s.kind === 'Service' ? `:${s.port}` : ''}${
                s.path ? ` ${s.path}` : ''
              }${s.authMode !== 'none' ? ' (API key)' : ''}`,
            })),
            { name: 'Client auth', value: oauth.enabled ? `OAuth (${oauth.issuer})` : 'None' },
          ]}
        />
      }
      steps={[
        {
          label: 'Basics',
          description:
            'Clients connect to a single MCP endpoint; the gateway aggregates the tools of all configured MCP servers.',
          errors: basicsErrors(form),
          content: (
            <FieldGrid>
              <TextInput
                label="Name"
                required
                disabled={!!edit}
                value={name}
                onChange={e => update({ name: e.target.value })}
              />
              {edit ? (
                <TextInput label="Namespace" disabled value={namespace} />
              ) : (
                <NamespaceInput value={namespace} onChange={v => update({ namespace: v })} />
              )}
              <TextInput
                label="Endpoint path"
                value={form.path}
                onChange={e => update({ path: e.target.value.trim() })}
                helperText='Defaults to "/mcp".'
              />
              <TextInput
                label="Hostnames"
                value={form.hostnames}
                onChange={e => update({ hostnames: e.target.value })}
                helperText="Optional, comma separated."
              />
              <FullRow>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Gateways
                </Typography>
                <GatewayRefsField
                  refs={form.gateways}
                  onChange={gateways => update({ gateways })}
                  ownerNamespace={namespace}
                  autoSelect={!edit}
                />
              </FullRow>
            </FieldGrid>
          ),
        },
        {
          label: 'MCP Servers',
          description:
            'Upstream MCP servers in the same namespace. Backend names must be unique; they prefix the aggregated tool names.',
          errors: serverErrors(form),
          content: (
            <RepeatedField
              items={form.servers}
              onChange={servers => update({ servers })}
              minItems={1}
              addLabel="Add MCP Server"
              itemTitle={i => `MCP server ${i + 1}`}
              createItem={newServer}
              render={(s, rawUpdate) => {
                const updateServer = (patch: Partial<ServerForm>) =>
                  rawUpdate(serverPatch(s, patch));
                const ports = s.kind === 'Service' ? servicePorts(s.name) : [];
                const backend =
                  s.kind === 'Backend'
                    ? envoyBackends?.find(b => b.metadata.name === s.name)
                    : undefined;
                return (
                  <FieldGrid>
                    <TextInput
                      select
                      label="Backend kind"
                      value={s.kind}
                      onChange={e => updateServer({ kind: e.target.value as ServerForm['kind'] })}
                    >
                      <MenuItem value="Backend">Envoy Gateway Backend</MenuItem>
                      <MenuItem value="Service">Kubernetes Service</MenuItem>
                    </TextInput>
                    <SuggestInput
                      label={s.kind === 'Backend' ? 'Backend name' : 'Service name'}
                      required
                      value={s.name}
                      onChange={v => updateServer({ name: v })}
                      options={s.kind === 'Backend' ? backendOptions : serviceOptions}
                      helperText={backend ? `Endpoints: ${backend.endpointSummary}` : undefined}
                    />
                    {s.kind === 'Service' &&
                      (ports.length > 1 ? (
                        <TextInput
                          select
                          label="Port"
                          required
                          value={s.port}
                          onChange={e => updateServer({ port: e.target.value })}
                          helperText="Filled from the Service; pick another port if needed."
                        >
                          {ports.map(p => (
                            <MenuItem key={`${p.port}-${p.name}`} value={String(p.port)}>
                              {portLabel(p)}
                            </MenuItem>
                          ))}
                        </TextInput>
                      ) : (
                        <TextInput
                          label="Port"
                          type="number"
                          required
                          value={s.port}
                          onChange={e => updateServer({ port: e.target.value })}
                          helperText={ports.length === 1 ? 'Filled from the Service.' : undefined}
                        />
                      ))}
                    <TextInput
                      label="Upstream path"
                      placeholder="/mcp"
                      value={s.path}
                      onChange={e => updateServer({ path: e.target.value.trim() })}
                    />
                    <TextInput
                      label="Include tools"
                      value={s.includeTools}
                      onChange={e => updateServer({ includeTools: e.target.value })}
                      helperText="Comma separated exact tool names. Empty = all tools."
                    />
                    <TextInput
                      label="Include tools (regex)"
                      value={s.includeRegex}
                      onChange={e => updateServer({ includeRegex: e.target.value })}
                      helperText="Comma separated regular expressions."
                    />
                    <TextInput
                      label="Exclude tools"
                      value={s.excludeTools}
                      onChange={e => updateServer({ excludeTools: e.target.value })}
                    />
                    <TextInput
                      label="Forward client headers"
                      value={s.forwardHeaders}
                      onChange={e => updateServer({ forwardHeaders: e.target.value })}
                      helperText="Comma separated header names forwarded to this server."
                    />
                    <TextInput
                      select
                      label="Upstream authentication"
                      value={s.authMode}
                      onChange={e => updateServer({ authMode: e.target.value as AuthMode })}
                    >
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="existing">API key from existing Secret</MenuItem>
                      <MenuItem value="new">API key in a new Secret</MenuItem>
                      {s.authMode === 'kept' && (
                        <MenuItem value="kept">Keep current key configuration</MenuItem>
                      )}
                    </TextInput>
                    {s.authMode === 'kept' && (
                      <FullRow>
                        <Alert severity="info">
                          This server uses an inline or query-parameter API key, which the form does
                          not edit. It is kept unchanged.
                          <ObjectBlock value={s.original?.securityPolicy?.apiKey} />
                        </Alert>
                      </FullRow>
                    )}
                    {(s.authMode === 'existing' || s.authMode === 'new') && (
                      <>
                        {s.authMode === 'existing' ? (
                          <SuggestInput
                            label="Secret name"
                            required
                            value={s.secretName}
                            onChange={v => updateServer({ secretName: v })}
                            options={secretOptions}
                            helperText={`Must contain the key "${MCP_API_KEY_SECRET_KEY}".`}
                          />
                        ) : (
                          <>
                            <TextInput
                              label="Secret name"
                              value={secretNameFor(form, s)}
                              onChange={e => updateServer({ secretName: e.target.value })}
                            />
                            <TextInput
                              label="API key"
                              type="password"
                              autoComplete="new-password"
                              required
                              value={s.apiKey}
                              onChange={e => updateServer({ apiKey: e.target.value })}
                            />
                          </>
                        )}
                        <TextInput
                          label="Header"
                          placeholder="Authorization"
                          value={s.header}
                          onChange={e => updateServer({ header: e.target.value })}
                          helperText='Defaults to "Authorization: Bearer <key>".'
                        />
                      </>
                    )}
                  </FieldGrid>
                );
              }}
            />
          ),
        },
        {
          label: 'Client Security',
          description:
            'Optionally require MCP clients to present an OAuth access token (MCP authorization spec).',
          errors: securityErrors(form),
          content: (
            <FieldGrid>
              <FullRow>
                <FormControlLabel
                  control={
                    <Switch
                      checked={oauth.enabled}
                      onChange={e => setOAuth({ enabled: e.target.checked })}
                    />
                  }
                  label="Require OAuth"
                />
              </FullRow>
              {oauth.enabled && (
                <>
                  <TextInput
                    label="Issuer"
                    required
                    value={oauth.issuer}
                    onChange={e => setOAuth({ issuer: e.target.value.trim() })}
                  />
                  <TextInput
                    label="Audiences"
                    value={oauth.audiences}
                    onChange={e => setOAuth({ audiences: e.target.value })}
                    helperText="Comma separated."
                  />
                  <TextInput
                    label="JWKS URI"
                    value={oauth.jwksUri}
                    onChange={e => setOAuth({ jwksUri: e.target.value.trim() })}
                    helperText="Optional remote JWKS endpoint."
                  />
                  <TextInput
                    label="Protected resource URL"
                    required
                    value={oauth.resource}
                    onChange={e => setOAuth({ resource: e.target.value.trim() })}
                    helperText="Public URL of this MCP endpoint, e.g. https://api.example.com/mcp"
                  />
                  <FullRow>
                    <TextInput
                      label="Supported scopes"
                      value={oauth.scopes}
                      onChange={e => setOAuth({ scopes: e.target.value })}
                      helperText="Comma separated."
                    />
                  </FullRow>
                </>
              )}
              {edit && (
                <FullRow>
                  <Typography variant="caption" color="text.secondary">
                    Authorization rules, API key / external auth, OAuth claim-to-header mappings and
                    the backend selector are kept unchanged; use Edit YAML to change them.
                  </Typography>
                </FullRow>
              )}
            </FieldGrid>
          ),
        },
      ]}
    />
  );
}
