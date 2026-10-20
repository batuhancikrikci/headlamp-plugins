import { Router } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import React, { useState } from 'react';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { AI_MODEL_HEADER } from '../../resources/common';
import { InferencePool } from '../../resources/external';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { costErrors } from '../../utils/costForm';
import { prune, splitList, validateName } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CostMetricsField } from '../common/CostMetricsField';
import { editableJson, EditObjectLoader } from '../common/EditWithFormAction';
import {
  FieldGrid,
  FullRow,
  NamespaceInput,
  RepeatedField,
  SuggestInput,
  TextInput,
} from '../common/FormFields';
import { gatewayRefErrors, GatewayRefsField, newGatewayRef } from '../common/GatewayRefsField';
import { ObjectBlock } from '../common/SharedComponents';
import { useAutoSelectSingle } from '../common/useAutoSelect';
import { ResourceWizard } from '../common/Wizard';
import {
  describeRuleTargets,
  formFromRoute,
  hasCrossNamespaceRefs,
  newBackend,
  newRule,
  RouteForm,
  RuleBackendType,
  ruleErrors as validateRules,
  RuleForm,
  toRouteSpec,
} from './routeForm';

export function AIGatewayRouteCreateWizard() {
  return (
    <WithVersionDiscovery title="Create AI Route">
      <WizardContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing AIGatewayRoute with the same steps (form layout by default). */
export function AIGatewayRouteEditWizard() {
  return (
    <WithVersionDiscovery title="Edit AI Route">
      <EditObjectLoader<AIGatewayRoute> resourceClass={AIGatewayRoute} title="Edit AI Route">
        {route => <WizardContent key={route.metadata.resourceVersion} edit={route} />}
      </EditObjectLoader>
    </WithVersionDiscovery>
  );
}

const newRouteForm = (): RouteForm => ({
  name: '',
  namespace: 'default',
  gateways: [newGatewayRef()],
  hostnames: '',
  rules: [newRule()],
  costs: [],
});

function WizardContent({ edit }: { edit?: AIGatewayRoute }) {
  const [form, setForm] = useState<RouteForm>(() =>
    edit ? formFromRoute(edit.jsonData) : newRouteForm()
  );
  const { name, namespace, gateways, hostnames, rules, costs } = form;
  const setField =
    <K extends keyof RouteForm>(key: K) =>
    (value: RouteForm[K]) =>
      setForm(f => ({ ...f, [key]: value }));
  const setName = setField('name');
  const setNamespace = setField('namespace');
  const setGateways = setField('gateways');
  const setHostnames = setField('hostnames');
  const setRules = setField('rules');
  const setCosts = setField('costs');

  // All namespaces: backendRefs may point to other namespaces (with a ReferenceGrant).
  const [backends] = AIServiceBackend.useList();
  const [pools, poolsError] = InferencePool.useList();

  const backendOptions = (ns: string) =>
    (backends || [])
      .filter(b => b.metadata.namespace === (ns || namespace))
      .map(b => ({ value: b.metadata.name, description: `${b.schemaName} → ${b.backendRefName}` }));
  const poolOptions = (ns: string) =>
    (pools || [])
      .filter(p => p.metadata.namespace === (ns || namespace))
      .map(p => ({ value: p.metadata.name, description: p.summary }));

  const namespaceBackends = backends
    ? backends.filter(b => b.metadata.namespace === namespace).map(b => b.metadata.name)
    : null;
  const namespacePools = pools
    ? pools.filter(p => p.metadata.namespace === namespace).map(p => p.metadata.name)
    : null;

  // Only one Service Backend in the namespace: use it for the first rule.
  useAutoSelectSingle(
    namespaceBackends,
    rules.length === 1 &&
      rules[0].backendType === 'AIServiceBackend' &&
      !rules[0].backends[0]?.name,
    backendName =>
      setForm(f => ({
        ...f,
        rules: [{ ...f.rules[0], backends: [{ ...f.rules[0].backends[0], name: backendName }] }],
      })),
    !edit,
    namespace
  );

  /** Switching a rule to InferencePool picks the only pool in the namespace, if any. */
  function backendTypePatch(r: RuleForm, backendType: RuleBackendType): Partial<RuleForm> {
    if (backendType === 'InferencePool' && !r.pool.name && namespacePools?.length === 1) {
      return { backendType, pool: { ...r.pool, name: namespacePools[0] } };
    }
    return { backendType };
  }

  /** Update with the loaded resourceVersion, so concurrent changes fail instead of being lost. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return;
    if (items.length !== 1 || items[0].kind !== AIGatewayRoute.kind) {
      throw new Error('Edit exactly one AIGatewayRoute document.');
    }
    await edit.update(items[0]);
  }

  // ─── Validation ───────────────────────────────────────────────────────────
  const basicsErrors: string[] = [];
  [validateName(name), validateName(namespace, 'Namespace')].forEach(
    e => e && basicsErrors.push(e)
  );
  basicsErrors.push(...gatewayRefErrors(gateways));

  const ruleErrors = validateRules(rules);

  const costValidation = costErrors(costs);

  // ─── Resource generation ──────────────────────────────────────────────────
  function buildResources(): KubeObjectInterface[] {
    if (edit) {
      const current = editableJson<KubeObjectInterface & { spec?: Record<string, unknown> }>(edit);
      return [{ ...current, spec: toRouteSpec(form, current.spec) } as KubeObjectInterface];
    }
    const route = {
      apiVersion: AIGatewayRoute.apiVersion,
      kind: AIGatewayRoute.kind,
      metadata: { name, namespace },
      spec: toRouteSpec(form),
    };
    return [prune(route) as KubeObjectInterface];
  }

  return (
    <ResourceWizard
      title={edit ? `Edit AI Route ${namespace}/${name}` : 'Create AI Route'}
      mode={edit ? 'edit' : 'create'}
      applyItems={edit ? saveEdit : undefined}
      cancelUrl={
        edit
          ? Router.createRouteURL(detailRoute(ROUTE_NAMES.routes), { namespace, name })
          : undefined
      }
      listRouteName={listRoute(ROUTE_NAMES.routes)}
      detailRouteName={detailRoute(ROUTE_NAMES.routes)}
      primaryKind={AIGatewayRoute.kind}
      buildResources={buildResources}
      summary={
        <NameValueTable
          rows={[
            { name: 'AI Route', value: `${namespace}/${name}` },
            {
              name: 'Gateways',
              value: gateways
                .filter(g => g.name)
                .map(g => g.name)
                .join(', '),
            },
            { name: 'Hostnames', value: splitList(hostnames).join(', ') || '*' },
            ...rules.map((r, i) => ({
              name: `Rule ${i + 1}${r.name ? ` (${r.name})` : ''}`,
              value: `${splitList(r.models).join(', ') || 'all models'} → ${describeRuleTargets(
                r
              )}`,
            })),
            { name: 'Cost Metrics', value: costs.map(c => c.metadataKey).join(', ') || '-' },
          ]}
        />
      }
      reviewNotice={
        hasCrossNamespaceRefs(rules, namespace) ? (
          <Alert severity="warning">
            Some backends live in another namespace. Each target namespace needs a ReferenceGrant
            allowing AIGatewayRoutes from “{namespace}”, otherwise the route is not accepted.
          </Alert>
        ) : undefined
      }
      steps={[
        {
          label: 'Basics',
          description: 'Name the route and attach it to one or more Gateways.',
          errors: basicsErrors,
          content: (
            <FieldGrid>
              <TextInput
                label="Name"
                required
                disabled={!!edit}
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {edit ? (
                <TextInput label="Namespace" disabled value={namespace} />
              ) : (
                <NamespaceInput value={namespace} onChange={setNamespace} />
              )}
              <FullRow>
                <TextInput
                  label="Hostnames"
                  value={hostnames}
                  onChange={e => setHostnames(e.target.value)}
                  helperText="Optional, comma separated. Leave empty to match all hostnames of the Gateway."
                />
              </FullRow>
              <FullRow>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Gateways
                </Typography>
                <GatewayRefsField
                  refs={gateways}
                  onChange={setGateways}
                  ownerNamespace={namespace}
                  autoSelect={!edit}
                />
              </FullRow>
            </FieldGrid>
          ),
        },
        {
          label: 'Routing Rules',
          description: `Each rule matches requests by model name (the ${AI_MODEL_HEADER} header) and sends them either to Service Backends or to a single InferencePool. A rule with no models matches every request.`,
          errors: ruleErrors,
          content: (
            <RepeatedField
              items={rules}
              onChange={setRules}
              minItems={1}
              addLabel="Add Rule"
              itemTitle={i => `Rule ${i + 1}`}
              createItem={newRule}
              render={(r, update) => (
                <FieldGrid>
                  <TextInput
                    label="Rule name"
                    value={r.name}
                    onChange={e => update({ name: e.target.value })}
                  />
                  <TextInput
                    label="Request timeout"
                    placeholder="60s"
                    value={r.requestTimeout}
                    onChange={e => update({ requestTimeout: e.target.value.trim() })}
                  />
                  <FullRow>
                    {r.advancedMatches ? (
                      <Alert severity="info">
                        This rule uses match conditions beyond model names (several headers, other
                        headers or regular expressions). They are kept unchanged; use Edit YAML to
                        modify them.
                        <ObjectBlock value={r.original?.matches} />
                      </Alert>
                    ) : (
                      <TextInput
                        label="Models"
                        value={r.models}
                        onChange={e => update({ models: e.target.value })}
                        placeholder="gpt-4o-mini, claude-sonnet-4"
                        helperText="Comma separated. Any of these model names matches this rule."
                      />
                    )}
                  </FullRow>
                  <FullRow>
                    <RadioGroup
                      row
                      value={r.backendType}
                      onChange={e => update(backendTypePatch(r, e.target.value as RuleBackendType))}
                    >
                      <FormControlLabel
                        value="AIServiceBackend"
                        control={<Radio />}
                        label="Service Backends"
                      />
                      <FormControlLabel
                        value="InferencePool"
                        control={<Radio />}
                        label="InferencePool (self-hosted models)"
                      />
                    </RadioGroup>
                  </FullRow>
                  <FullRow>
                    {r.backendType === 'InferencePool' ? (
                      <InferencePoolFields
                        rule={r}
                        update={update}
                        routeNamespace={namespace}
                        options={poolOptions(r.pool.namespace)}
                        loading={pools === null && !poolsError}
                        unavailable={!!poolsError}
                      />
                    ) : (
                      <RepeatedField
                        items={r.backends}
                        onChange={b => update({ backends: b })}
                        minItems={1}
                        addLabel="Add Backend"
                        itemTitle={j => `Backend ${j + 1}`}
                        createItem={newBackend}
                        render={(b, updateBackend) => (
                          <FieldGrid>
                            <SuggestInput
                              label="Service Backend"
                              required
                              value={b.name}
                              onChange={v => updateBackend({ name: v })}
                              loading={backends === null}
                              options={backendOptions(b.namespace)}
                            />
                            <TextInput
                              label="Namespace"
                              value={b.namespace}
                              placeholder={namespace}
                              onChange={e => updateBackend({ namespace: e.target.value.trim() })}
                              helperText="Defaults to the route's namespace."
                            />
                            <TextInput
                              label="Weight"
                              type="number"
                              placeholder="1"
                              value={b.weight}
                              onChange={e => updateBackend({ weight: e.target.value })}
                              helperText="Traffic split among backends with the same priority."
                            />
                            <TextInput
                              label="Priority"
                              type="number"
                              placeholder="0"
                              value={b.priority}
                              onChange={e => updateBackend({ priority: e.target.value })}
                              helperText="0 is primary; higher values are used as fallback."
                            />
                            <FullRow>
                              <TextInput
                                label="Model name override"
                                value={b.modelNameOverride}
                                onChange={e => updateBackend({ modelNameOverride: e.target.value })}
                                helperText="Rewrite the model name sent to this backend."
                              />
                            </FullRow>
                          </FieldGrid>
                        )}
                      />
                    )}
                  </FullRow>
                </FieldGrid>
              )}
            />
          ),
        },
        {
          label: 'Cost Metrics',
          description:
            'Optional. Token usage values the gateway records in dynamic metadata, e.g. for rate limiting or quota accounting.',
          errors: costValidation,
          content: <CostMetricsField costs={costs} onChange={setCosts} />,
        },
      ]}
    />
  );
}

/** Single InferencePool target of a rule (upstream allows exactly one per rule). */
function InferencePoolFields({
  rule,
  update,
  routeNamespace,
  options,
  loading,
  unavailable,
}: {
  rule: RuleForm;
  update: (patch: Partial<RuleForm>) => void;
  routeNamespace: string;
  options: Array<{ value: string; description?: string }>;
  loading: boolean;
  unavailable: boolean;
}) {
  const setPool = (patch: Partial<RuleForm['pool']>) =>
    update({ pool: { ...rule.pool, ...patch } });
  return (
    <FieldGrid>
      <SuggestInput
        label="InferencePool"
        required
        value={rule.pool.name}
        onChange={v => setPool({ name: v })}
        loading={loading}
        options={options}
        helperText={
          unavailable
            ? 'InferencePools (inference.networking.k8s.io/v1) could not be listed; the Gateway API Inference Extension may not be installed.'
            : undefined
        }
      />
      <TextInput
        label="Namespace"
        value={rule.pool.namespace}
        placeholder={routeNamespace}
        onChange={e => setPool({ namespace: e.target.value.trim() })}
        helperText="Defaults to the route's namespace."
      />
      <FullRow>
        <Typography variant="caption" color="text.secondary">
          A rule targeting an InferencePool contains only that pool. Load balancing and fallback are
          handled by the pool&apos;s endpoint picker, so weight, priority and model name override do
          not apply.
        </Typography>
      </FullRow>
    </FieldGrid>
  );
}
