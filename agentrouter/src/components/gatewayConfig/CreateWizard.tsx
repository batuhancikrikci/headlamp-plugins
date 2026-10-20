import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { Loader, NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert, Autocomplete, Box, MenuItem, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { GatewayConfig } from '../../resources/gatewayConfig';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { prune } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CostMetricsField } from '../common/CostMetricsField';
import {
  FieldGrid,
  FullRow,
  NamespaceInput,
  RepeatedField,
  SuggestInput,
  TextInput,
} from '../common/FormFields';
import { ResourceWizard } from '../common/Wizard';
import {
  basicsErrors,
  EnvSource,
  extProcErrors,
  formFromGatewayConfig,
  GATEWAY_CONFIG_ANNOTATION,
  gatewayChanges,
  GatewayConfigForm,
  mergeGatewayConfigSpec,
  newEnv,
  newGatewayConfigForm,
  PreservedEnv,
  toGatewayConfigSpec,
  trafficErrors,
} from './gatewayConfigForm';

export function GatewayConfigCreateWizard() {
  return (
    <WithVersionDiscovery title="Create Gateway Config">
      <WizardContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing GatewayConfig with the same steps, pre-filled from the cluster. */
export function GatewayConfigEditWizard() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  return (
    <WithVersionDiscovery title="Edit Gateway Config">
      <EditLoader namespace={namespace} name={name} />
    </WithVersionDiscovery>
  );
}

function EditLoader({ namespace, name }: { namespace: string; name: string }) {
  const [config, error] = GatewayConfig.useGet(name, namespace);
  const [gateways, gatewaysError] = K8s.ResourceClasses.Gateway.useList({ namespace });
  if (error) {
    return (
      <Alert severity="error">
        Could not load Gateway Config {name}: {error.message}
      </Alert>
    );
  }
  if (!config || (gateways === null && !gatewaysError)) {
    return <Loader title="Loading Gateway Config" />;
  }
  const attached = (gateways || [])
    .filter(g => g.metadata.annotations?.[GATEWAY_CONFIG_ANNOTATION] === name)
    .map(g => g.metadata.name);
  return <WizardContent key={config.metadata.resourceVersion} edit={{ config, attached }} />;
}

interface EditTarget {
  config: GatewayConfig;
  /** Gateways that selected this config when the editor was opened. */
  attached: string[];
}

function WizardContent({ edit }: { edit?: EditTarget }) {
  const [initial] = useState(() =>
    edit
      ? formFromGatewayConfig(edit.config.jsonData, edit.attached)
      : { form: newGatewayConfigForm(), preservedEnv: [] as PreservedEnv }
  );
  const [form, setForm] = useState<GatewayConfigForm>(initial.form);
  const preservedEnv = initial.preservedEnv;
  const update = (patch: Partial<GatewayConfigForm>) => setForm(f => ({ ...f, ...patch }));
  const ns = form.namespace || undefined;

  const [gateways] = K8s.ResourceClasses.Gateway.useList({ namespace: ns });
  const [secrets] = K8s.ResourceClasses.Secret.useList({ namespace: ns });
  const [configMaps] = K8s.ResourceClasses.ConfigMap.useList({ namespace: ns });

  const currentConfigOf = (name: string) =>
    gateways?.find(g => g.metadata.name === name)?.metadata.annotations?.[
      GATEWAY_CONFIG_ANNOTATION
    ];
  const { attach, detach } = gatewayChanges(edit ? edit.attached : [], form.gateways);
  const reassigned = attach.filter(g => {
    const current = currentConfigOf(g);
    return current && current !== form.name;
  });

  function buildResources(): KubeObjectInterface[] {
    if (edit) {
      const current = JSON.parse(JSON.stringify(edit.config.jsonData));
      delete current.status;
      delete current.metadata.managedFields;
      return [{ ...current, spec: mergeGatewayConfigSpec(current.spec, form, preservedEnv) }];
    }
    return [
      prune({
        apiVersion: GatewayConfig.apiVersion,
        kind: GatewayConfig.kind,
        metadata: { name: form.name, namespace: form.namespace },
        spec: toGatewayConfigSpec(form),
      }) as KubeObjectInterface,
    ];
  }

  /**
   * Points newly selected Gateways at this config and releases deselected ones
   * (JSON merge patch on the annotation only; other Gateway fields are untouched).
   */
  async function syncGatewayAnnotations() {
    const find = (name: string) => {
      const gw = gateways?.find(g => g.metadata.name === name);
      if (!gw) throw new Error(`Gateway ${form.namespace}/${name} was not found.`);
      return gw;
    };
    for (const name of attach) {
      await find(name).patch({
        metadata: { annotations: { [GATEWAY_CONFIG_ANNOTATION]: form.name } },
      });
    }
    for (const name of detach) {
      const gw = find(name);
      // Only release Gateways that still point at this config.
      if (gw.metadata.annotations?.[GATEWAY_CONFIG_ANNOTATION] === form.name) {
        // In a merge patch, null removes the annotation; the patch type does not model that.
        const remove = { [GATEWAY_CONFIG_ANNOTATION]: null } as unknown as Record<string, string>;
        await gw.patch({ metadata: { annotations: remove } });
      }
    }
  }

  /** Update with the loaded resourceVersion, so concurrent changes fail instead of being lost. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return;
    if (items.length !== 1 || items[0].kind !== GatewayConfig.kind) {
      throw new Error('Edit exactly one GatewayConfig document.');
    }
    await edit.config.update(items[0]);
  }

  const detailUrl = edit
    ? Router.createRouteURL(detailRoute(ROUTE_NAMES.config), {
        namespace: form.namespace,
        name: form.name,
      })
    : undefined;

  const containerSummary =
    [
      form.image && `image ${form.image}`,
      (form.cpuRequest || form.memoryRequest) &&
        `requests ${[form.cpuRequest, form.memoryRequest].filter(Boolean).join('/')}`,
      (form.cpuLimit || form.memoryLimit) &&
        `limits ${[form.cpuLimit, form.memoryLimit].filter(Boolean).join('/')}`,
      form.env.length > 0 && `${form.env.length} env var(s)`,
    ]
      .filter(Boolean)
      .join(', ') || 'Controller defaults';

  return (
    <ResourceWizard
      title={edit ? `Edit Gateway Config ${form.namespace}/${form.name}` : 'Create Gateway Config'}
      mode={edit ? 'edit' : 'create'}
      applyItems={edit ? saveEdit : undefined}
      cancelUrl={detailUrl}
      listRouteName={listRoute(ROUTE_NAMES.config)}
      detailRouteName={detailRoute(ROUTE_NAMES.config)}
      primaryKind={GatewayConfig.kind}
      buildResources={buildResources}
      extraActions={[
        ...attach.map(g => `Annotate Gateway ${form.namespace}/${g}`),
        ...detach.map(g => `Remove annotation from Gateway ${form.namespace}/${g}`),
      ]}
      afterApply={attach.length + detach.length > 0 ? syncGatewayAnnotations : undefined}
      summary={
        <NameValueTable
          rows={[
            { name: 'Gateway Config', value: `${form.namespace}/${form.name}` },
            { name: 'Gateways', value: form.gateways.join(', ') || 'None (attach later)' },
            { name: 'External Processor', value: containerSummary },
            { name: 'Forward Proxy', value: form.forwardProxy || 'None' },
            {
              name: 'Global Cost Metrics',
              value: form.costs.map(c => c.metadataKey).join(', ') || 'None',
            },
          ]}
        />
      }
      reviewNotice={
        reassigned.length > 0 ? (
          <Alert severity="warning">
            These Gateways currently use another Gateway Config and will be switched to “{form.name}
            ”: {reassigned.map(g => `${g} (${currentConfigOf(g)})`).join(', ')}.
          </Alert>
        ) : undefined
      }
      steps={[
        {
          label: 'Basics',
          description:
            'Gateway-level settings for the AI Gateway external processor. Gateways in the same namespace select a config with the aigateway.envoyproxy.io/gateway-config annotation.',
          errors: basicsErrors(form),
          content: (
            <FieldGrid>
              <TextInput
                label="Name"
                required
                disabled={!!edit}
                value={form.name}
                onChange={e => update({ name: e.target.value })}
              />
              {edit ? (
                <TextInput label="Namespace" disabled value={form.namespace} />
              ) : (
                <NamespaceInput
                  value={form.namespace}
                  onChange={namespace => update({ namespace, gateways: [] })}
                />
              )}
              <FullRow>
                <Autocomplete
                  multiple
                  size="small"
                  options={(gateways || []).map(g => g.metadata.name)}
                  loading={gateways === null}
                  value={form.gateways}
                  onChange={(_, value) => update({ gateways: value as string[] })}
                  renderOption={(props, name) => {
                    const current = currentConfigOf(name);
                    return (
                      <li {...props} key={name}>
                        <Box>
                          <Typography variant="body2">{name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {current ? `uses ${current}` : 'no Gateway Config'}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Attach to Gateways (optional)"
                      helperText={
                        edit
                          ? 'Added Gateways get the annotation; removed ones are released after saving.'
                          : 'The wizard adds the annotation to these Gateways after creating the config.'
                      }
                    />
                  )}
                />
              </FullRow>
            </FieldGrid>
          ),
        },
        {
          label: 'External Processor',
          description:
            'Container settings for the external processor deployed next to each Gateway. Leave empty to keep the controller defaults. Security context and volume mounts can be added with “Edit YAML” on the review step.',
          errors: extProcErrors(form),
          content: (
            <FieldGrid>
              <FullRow>
                <TextInput
                  label="Image"
                  value={form.image}
                  onChange={e => update({ image: e.target.value.trim() })}
                  placeholder="registry.example.com/envoyproxy/ai-gateway-extproc:v1.1.0"
                  helperText="Optional. Overrides the default image, e.g. for an internal registry."
                />
              </FullRow>
              <TextInput
                label="CPU request"
                value={form.cpuRequest}
                onChange={e => update({ cpuRequest: e.target.value.trim() })}
                placeholder="100m"
              />
              <TextInput
                label="Memory request"
                value={form.memoryRequest}
                onChange={e => update({ memoryRequest: e.target.value.trim() })}
                placeholder="128Mi"
              />
              <TextInput
                label="CPU limit"
                value={form.cpuLimit}
                onChange={e => update({ cpuLimit: e.target.value.trim() })}
                placeholder="500m"
              />
              <TextInput
                label="Memory limit"
                value={form.memoryLimit}
                onChange={e => update({ memoryLimit: e.target.value.trim() })}
                placeholder="512Mi"
              />
              <FullRow>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Environment variables
                </Typography>
                {preservedEnv.length > 0 && (
                  <Alert severity="info" sx={{ mb: 1.5 }}>
                    Kept unchanged (source not editable here):{' '}
                    {preservedEnv.map(e => e.name).join(', ')}. Use Edit YAML to change them.
                  </Alert>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Take precedence over the controller&apos;s global extProc environment variables
                  (e.g. OpenTelemetry settings).
                </Typography>
                <RepeatedField
                  items={form.env}
                  onChange={env => update({ env })}
                  addLabel="Add variable"
                  itemTitle={i => `Variable ${i + 1}`}
                  createItem={newEnv}
                  render={(e, updateEnv) => (
                    <FieldGrid>
                      <TextInput
                        label="Name"
                        required
                        value={e.name}
                        onChange={ev => updateEnv({ name: ev.target.value.trim() })}
                        placeholder="OTEL_EXPORTER_OTLP_ENDPOINT"
                      />
                      <TextInput
                        select
                        label="Source"
                        value={e.source}
                        onChange={ev => updateEnv({ source: ev.target.value as EnvSource })}
                      >
                        <MenuItem value="value">Value</MenuItem>
                        <MenuItem value="secret">Secret key</MenuItem>
                        <MenuItem value="configMap">ConfigMap key</MenuItem>
                      </TextInput>
                      {e.source === 'value' ? (
                        <FullRow>
                          <TextInput
                            label="Value"
                            value={e.value}
                            onChange={ev => updateEnv({ value: ev.target.value })}
                          />
                        </FullRow>
                      ) : (
                        <>
                          <SuggestInput
                            label={e.source === 'secret' ? 'Secret' : 'ConfigMap'}
                            required
                            value={e.refName}
                            onChange={refName => updateEnv({ refName, refKey: '' })}
                            options={(e.source === 'secret' ? secrets || [] : configMaps || []).map(
                              o => ({ value: o.metadata.name })
                            )}
                          />
                          <SuggestInput
                            label="Key"
                            required
                            value={e.refKey}
                            onChange={refKey => updateEnv({ refKey })}
                            options={Object.keys(
                              (e.source === 'secret' ? secrets : configMaps)?.find(
                                o => o.metadata.name === e.refName
                              )?.data || {}
                            ).map(k => ({ value: k }))}
                          />
                        </>
                      )}
                    </FieldGrid>
                  )}
                />
              </FullRow>
            </FieldGrid>
          ),
        },
        {
          label: 'Traffic',
          description:
            'Egress proxy and default cost metrics for every AI Route attached to these Gateways.',
          errors: trafficErrors(form),
          content: (
            <FieldGrid>
              <FullRow>
                <TextInput
                  label="Forward proxy (host:port)"
                  value={form.forwardProxy}
                  onChange={e => update({ forwardProxy: e.target.value.trim() })}
                  placeholder="proxy.corp.local:3128"
                  helperText="Optional. Tunnels all upstream AI traffic through an HTTP CONNECT proxy (for networks without direct egress); upstream TLS is preserved."
                />
              </FullRow>
              <FullRow>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Global cost metrics
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Defaults for all routes on these Gateways. An AI Route cost metric with the same
                  metadata key overrides the global one.
                </Typography>
                <CostMetricsField costs={form.costs} onChange={costs => update({ costs })} />
              </FullRow>
            </FieldGrid>
          ),
        },
      ]}
    />
  );
}
