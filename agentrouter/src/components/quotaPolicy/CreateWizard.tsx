import { Router } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { QuotaPolicy } from '../../resources/quotaPolicy';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { prune } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { editableJson, EditObjectLoader } from '../common/EditWithFormAction';
import {
  FieldGrid,
  FullRow,
  NamespaceInput,
  RepeatedField,
  SuggestInput,
  TextInput,
} from '../common/FormFields';
import { ObjectBlock, SchemaChip } from '../common/SharedComponents';
import { useAutoSelectSingle } from '../common/useAutoSelect';
import { ResourceWizard } from '../common/Wizard';
import {
  BUCKET_RULE_TEMPLATES,
  BucketRuleForm,
  conflictingPolicies,
  COST_PRESETS,
  costExpressionOf,
  costExpressionWarnings,
  CostPresetId,
  formFromQuotaPolicy,
  HeaderConditionForm,
  HeaderMatchType,
  mergeQuotaSpec,
  modelErrors,
  modelSuggestions,
  newBucketRule,
  newHeader,
  newModelQuota,
  newQuotaForm,
  QUOTA_DURATIONS,
  QuotaCostForm,
  QuotaDuration,
  QuotaForm,
  routesWithoutOverride,
  serviceQuotaErrors,
  targetErrors,
  toQuotaSpec,
} from './quotaForm';

const CEL_VARIABLES =
  'input_tokens, output_tokens, total_tokens, cached_input_tokens, cache_creation_input_tokens, reasoning_tokens, model, backend, route_name';

export function QuotaPolicyCreateWizard() {
  return (
    <WithVersionDiscovery title="Create Quota Policy">
      <WizardContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing QuotaPolicy with the same steps (form layout by default). */
export function QuotaPolicyEditWizard() {
  return (
    <WithVersionDiscovery title="Edit Quota Policy">
      <EditObjectLoader<QuotaPolicy> resourceClass={QuotaPolicy} title="Edit Quota Policy">
        {policy => <WizardContent key={policy.metadata.resourceVersion} edit={policy} />}
      </EditObjectLoader>
    </WithVersionDiscovery>
  );
}

/** Limit + time window pair (the only windows upstream accepts are 1s/1m/1h/1d). */
function QuotaValueFields({
  limit,
  duration,
  onChange,
  label,
}: {
  limit: string;
  duration: QuotaDuration;
  onChange: (patch: { limit?: string; duration?: QuotaDuration }) => void;
  label: string;
}) {
  return (
    <>
      <TextInput
        label={label}
        required
        type="number"
        value={limit}
        onChange={e => onChange({ limit: e.target.value })}
        helperText="Cost units (tokens by default) allowed per window."
      />
      <TextInput
        select
        label="Window"
        value={duration}
        onChange={e => onChange({ duration: e.target.value as QuotaDuration })}
        helperText="Sliding window; only these sizes are supported."
      >
        {QUOTA_DURATIONS.map(d => (
          <MenuItem key={d.value} value={d.value}>
            {d.label} ({d.value})
          </MenuItem>
        ))}
      </TextInput>
    </>
  );
}

/** Cost preset selector with a custom CEL expression and unsigned-literal hints. */
function CostFields({
  cost,
  onChange,
}: {
  cost: QuotaCostForm;
  onChange: (cost: QuotaCostForm) => void;
}) {
  const warnings = costExpressionWarnings(costExpressionOf(cost));
  return (
    <>
      <FullRow>
        <TextInput
          select
          label="Cost per request"
          value={cost.preset}
          onChange={e => onChange({ ...cost, preset: e.target.value as CostPresetId })}
          helperText={
            cost.preset !== 'custom' && costExpressionOf(cost)
              ? `CEL: ${costExpressionOf(cost)}`
              : 'How much one request burns down the quota.'
          }
        >
          {COST_PRESETS.map(p => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
        </TextInput>
      </FullRow>
      {cost.preset === 'custom' && (
        <FullRow>
          <TextInput
            label="CEL cost expression"
            required
            value={cost.custom}
            onChange={e => onChange({ ...cost, custom: e.target.value })}
            placeholder="input_tokens + output_tokens * 4u"
            helperText={`Unsigned integers: write literals as 4u. Variables: ${CEL_VARIABLES}.`}
            InputProps={{ sx: { fontFamily: 'monospace' } }}
          />
        </FullRow>
      )}
      {warnings.length > 0 && (
        <FullRow>
          <Alert severity="warning">{warnings.join(' ')}</Alert>
        </FullRow>
      )}
    </>
  );
}

/** Header conditions of one bucket rule (all must match). */
function HeaderConditions({
  headers,
  onChange,
}: {
  headers: HeaderConditionForm[];
  onChange: (headers: HeaderConditionForm[]) => void;
}) {
  return (
    <RepeatedField
      items={headers}
      onChange={onChange}
      minItems={1}
      addLabel="Add header condition"
      itemTitle={i => `Header condition ${i + 1}`}
      createItem={newHeader}
      render={(h, update) => (
        <FieldGrid>
          <TextInput
            label="Header name"
            required
            value={h.name}
            onChange={e => update({ name: e.target.value.trim() })}
            placeholder="x-user-id"
          />
          <TextInput
            select
            label="Match"
            value={h.type}
            onChange={e => update({ type: e.target.value as HeaderMatchType })}
          >
            <MenuItem value="Exact">Exact value</MenuItem>
            <MenuItem value="RegularExpression">Regular expression</MenuItem>
            <MenuItem value="Distinct">Distinct (one bucket per value)</MenuItem>
          </TextInput>
          {h.type !== 'Distinct' && (
            <TextInput
              label="Value"
              required
              value={h.value}
              onChange={e => update({ value: e.target.value })}
            />
          )}
          <FormControlLabel
            control={
              <Checkbox checked={h.invert} onChange={e => update({ invert: e.target.checked })} />
            }
            label="Invert (match when the header does NOT match)"
          />
        </FieldGrid>
      )}
    />
  );
}

/** Bucket rules of a model quota, with one-click templates. */
function BucketRules({
  rules,
  onChange,
}: {
  rules: BucketRuleForm[];
  onChange: (rules: BucketRuleForm[]) => void;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Bucket rules (optional)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Extra budgets for clients selected by request headers. A matching request is charged to the
        rule&apos;s bucket and the default bucket, and is allowed while any of them has quota left.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {BUCKET_RULE_TEMPLATES.map(t => (
          <Tooltip key={t.id} title={t.description}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onChange([...rules, t.create()])}
            >
              + {t.label}
            </Button>
          </Tooltip>
        ))}
      </Box>
      {rules.length > 0 && (
        <RepeatedField
          items={rules}
          onChange={onChange}
          addLabel="Add custom rule"
          itemTitle={i => `Rule ${i + 1}`}
          createItem={newBucketRule}
          render={(r, update) =>
            r.preserved ? (
              <Alert severity="info">
                This rule uses selectors the form cannot edit (several selectors, or client IP,
                method or path). It is kept unchanged; use Edit YAML to modify it.
                <Box sx={{ mt: 1 }}>
                  <ObjectBlock value={r.preserved} />
                </Box>
              </Alert>
            ) : (
              <FieldGrid>
                <QuotaValueFields
                  label="Limit"
                  limit={r.limit}
                  duration={r.duration}
                  onChange={patch => update(patch)}
                />
                <FullRow>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={r.shadowMode}
                        onChange={e => update({ shadowMode: e.target.checked })}
                      />
                    }
                    label="Shadow mode (measure only, never reject)"
                  />
                </FullRow>
                <FullRow>
                  <HeaderConditions headers={r.headers} onChange={headers => update({ headers })} />
                </FullRow>
              </FieldGrid>
            )
          }
        />
      )}
    </Box>
  );
}

function WizardContent({ edit }: { edit?: QuotaPolicy }) {
  const [form, setForm] = useState<QuotaForm>(() =>
    edit ? formFromQuotaPolicy(edit.jsonData) : newQuotaForm()
  );
  const update = (patch: Partial<QuotaForm>) => setForm(f => ({ ...f, ...patch }));

  const [backends] = AIServiceBackend.useList({ namespace: form.namespace || undefined });
  const [routes] = AIGatewayRoute.useList();
  const [policies] = QuotaPolicy.useList({ namespace: form.namespace || undefined });

  const suggestions = modelSuggestions(routes, form.targets, form.namespace);
  const knownModels = new Set(suggestions.map(s => s.model));
  const noOverride = routesWithoutOverride(routes, form.targets, form.namespace);
  const conflicts = conflictingPolicies(policies, form);
  const missingSuggestions = suggestions.filter(
    s => !form.models.some(m => m.modelName.trim() === s.model)
  );

  // Only one Service Backend in the namespace: select it.
  useAutoSelectSingle(
    backends ? backends.map(b => b.metadata.name) : null,
    form.targets.length === 0,
    name => update({ targets: [name] }),
    !edit,
    form.namespace
  );

  /** Adds a model quota for every routed model that has none yet. */
  function addSuggestedModels() {
    setForm(f => {
      const blank = f.models.filter(m => !m.modelName.trim() && !m.limit);
      const kept = f.models.filter(m => !blank.includes(m));
      return {
        ...f,
        models: [
          ...kept,
          ...missingSuggestions.map(s => ({ ...newModelQuota(), modelName: s.model })),
        ],
      };
    });
  }

  /** Update with the loaded resourceVersion, so concurrent changes fail instead of being lost. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return;
    if (items.length !== 1 || items[0].kind !== QuotaPolicy.kind) {
      throw new Error('Edit exactly one QuotaPolicy document.');
    }
    await edit.update(items[0]);
  }

  function buildResources(): KubeObjectInterface[] {
    if (edit) {
      const current = editableJson<KubeObjectInterface & { spec?: Record<string, unknown> }>(edit);
      return [
        { ...current, spec: prune(mergeQuotaSpec(current.spec, form)) } as KubeObjectInterface,
      ];
    }
    return [
      prune({
        apiVersion: QuotaPolicy.apiVersion,
        kind: QuotaPolicy.kind,
        metadata: { name: form.name, namespace: form.namespace },
        spec: toQuotaSpec(form),
      }) as KubeObjectInterface,
    ];
  }

  const durationLabel = (d: QuotaDuration) => QUOTA_DURATIONS.find(x => x.value === d)?.label;

  return (
    <ResourceWizard
      title={edit ? `Edit Quota Policy ${form.namespace}/${form.name}` : 'Create Quota Policy'}
      mode={edit ? 'edit' : 'create'}
      applyItems={edit ? saveEdit : undefined}
      cancelUrl={
        edit
          ? Router.createRouteURL(detailRoute(ROUTE_NAMES.quotas), {
              namespace: form.namespace,
              name: form.name,
            })
          : undefined
      }
      listRouteName={listRoute(ROUTE_NAMES.quotas)}
      detailRouteName={detailRoute(ROUTE_NAMES.quotas)}
      primaryKind={QuotaPolicy.kind}
      buildResources={buildResources}
      summary={
        <NameValueTable
          rows={[
            { name: 'Quota Policy', value: `${form.namespace}/${form.name}` },
            { name: 'Service Backends', value: form.targets.join(', ') },
            ...form.models.map(m => ({
              name: `Model ${m.modelName}`,
              value: `${Number(m.limit).toLocaleString()} ${durationLabel(m.duration)}${
                m.rules.length ? `, ${m.rules.length} bucket rule(s)` : ''
              }`,
            })),
            {
              name: 'Service quota',
              value: form.serviceQuota.enabled
                ? `${Number(form.serviceQuota.limit).toLocaleString()} ${durationLabel(
                    form.serviceQuota.duration
                  )} (not enforced yet)`
                : 'Not set',
            },
          ]}
        />
      }
      reviewNotice={
        conflicts.length > 0 ? (
          <Alert severity="warning">
            Other policies also set quotas for these models on the same backends:{' '}
            {conflicts.map(c => `${c.policy} (${c.models.join(', ')})`).join('; ')}. For each model
            the policy whose namespace/name sorts first alphabetically wins.
          </Alert>
        ) : undefined
      }
      steps={[
        {
          label: 'Targets',
          description:
            'Token budgets for the selected Service Backends. Requests are rejected with 429 once all related quotas are used up.',
          errors: targetErrors(form),
          content: (
            <FieldGrid>
              <FullRow>
                <Alert severity="info">
                  Prerequisite: quota enforcement uses Envoy Gateway&apos;s global rate limiting, so
                  Envoy Gateway must be installed with rate limiting enabled and a Redis instance.
                </Alert>
              </FullRow>
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
                  onChange={namespace => update({ namespace, targets: [] })}
                />
              )}
              <FullRow>
                <Autocomplete
                  multiple
                  size="small"
                  options={(backends || []).map(b => b.metadata.name)}
                  loading={backends === null}
                  value={form.targets}
                  onChange={(_, targets) => update({ targets: targets as string[] })}
                  renderOption={(props, name) => {
                    const b = backends?.find(x => x.metadata.name === name);
                    return (
                      <li {...props} key={name}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {name}
                          {b && <SchemaChip schemaName={b.schemaName} />}
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Service Backends"
                      required
                      helperText="Service Backends in this namespace the quota applies to."
                    />
                  )}
                />
              </FullRow>
            </FieldGrid>
          ),
        },
        {
          label: 'Model Quotas',
          description:
            'One budget per model. The model name must equal the "Model name override" of the AI Route backend that sends traffic to these Service Backends, otherwise the quota is silently not applied.',
          errors: modelErrors(form.models),
          content: (
            <>
              {missingSuggestions.length > 0 && (
                <Alert
                  severity="info"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" onClick={addSuggestedModels}>
                      Add {missingSuggestions.length}
                    </Button>
                  }
                >
                  Models routed to these backends without a quota yet:{' '}
                  {missingSuggestions.map(s => s.model).join(', ')}.
                </Alert>
              )}
              {noOverride.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  These AI Routes send traffic to the selected backends without a model name
                  override, so per-model quotas cannot match those requests:{' '}
                  {noOverride.map(n => `${n.route} → ${n.backend}`).join(', ')}.
                </Alert>
              )}
              <RepeatedField
                items={form.models}
                onChange={models => update({ models })}
                minItems={1}
                addLabel="Add model quota"
                itemTitle={i => `Model quota ${i + 1}`}
                createItem={newModelQuota}
                render={(m, updateModel) => (
                  <FieldGrid>
                    <FullRow>
                      <SuggestInput
                        label="Model name"
                        required
                        value={m.modelName}
                        onChange={modelName => updateModel({ modelName })}
                        loading={routes === null}
                        options={suggestions.map(s => ({
                          value: s.model,
                          description: `via ${s.routes.join(', ')}`,
                        }))}
                        helperText={
                          m.modelName && routes !== null && !knownModels.has(m.modelName.trim())
                            ? 'No AI Route overrides a backend of this policy to this model name; the quota will not apply until one does.'
                            : 'Suggestions come from AI Route backend model name overrides.'
                        }
                      />
                    </FullRow>
                    <QuotaValueFields
                      label="Default bucket limit"
                      limit={m.limit}
                      duration={m.duration}
                      onChange={patch => updateModel(patch)}
                    />
                    <CostFields cost={m.cost} onChange={cost => updateModel({ cost })} />
                    <FullRow>
                      <BucketRules rules={m.rules} onChange={rules => updateModel({ rules })} />
                    </FullRow>
                  </FieldGrid>
                )}
              />
            </>
          ),
        },
        {
          label: 'Service Quota',
          description: 'Optional budget across all models of the targeted Service Backends.',
          errors: serviceQuotaErrors(form),
          content: (
            <FieldGrid>
              <FullRow>
                <Alert severity="warning">
                  Not enforced yet: the API accepts a service-wide quota, but Agent Router (v1.1)
                  does not apply it to traffic. Use model quotas to enforce budgets today.
                </Alert>
              </FullRow>
              <FullRow>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.serviceQuota.enabled}
                      onChange={e =>
                        update({
                          serviceQuota: { ...form.serviceQuota, enabled: e.target.checked },
                        })
                      }
                    />
                  }
                  label="Set a service-wide quota anyway"
                />
              </FullRow>
              {form.serviceQuota.enabled && (
                <>
                  <QuotaValueFields
                    label="Service quota limit"
                    limit={form.serviceQuota.limit}
                    duration={form.serviceQuota.duration}
                    onChange={patch => update({ serviceQuota: { ...form.serviceQuota, ...patch } })}
                  />
                  <CostFields
                    cost={form.serviceQuota.cost}
                    onChange={cost => update({ serviceQuota: { ...form.serviceQuota, cost } })}
                  />
                </>
              )}
            </FieldGrid>
          ),
        },
      ]}
    />
  );
}
