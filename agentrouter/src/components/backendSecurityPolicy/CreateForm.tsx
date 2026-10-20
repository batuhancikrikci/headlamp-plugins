import { ApiProxy, Router } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert, Autocomplete, Box, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { BackendSecurityPolicy } from '../../resources/backendSecurityPolicy';
import { detailRoute, listRoute, ROUTE_NAMES } from '../../routes';
import { applyWithOwners, deleteReleasedSecrets } from '../../utils/apply';
import { validateName } from '../../utils/forms';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { editableJson, EditObjectLoader } from '../common/EditWithFormAction';
import { FieldGrid, FullRow, NamespaceInput, TextInput } from '../common/FormFields';
import { ObjectBlock, SchemaChip } from '../common/SharedComponents';
import { useAutoSelectSingle } from '../common/useAutoSelect';
import { ResourceWizard } from '../common/Wizard';
import { BSPEditState, CREDENTIAL_BLOCK, formFromBSP, mergeBSPSpec } from './bspForm';
import {
  buildCredentialResources,
  credentialErrors,
  CredentialFields,
  CredentialState,
  initialCredentialState,
  POLICY_TYPE_LABELS,
} from './credentials';

export function BackendSecurityPolicyCreateForm() {
  return (
    <WithVersionDiscovery title="Create Security Policy">
      <FormContent />
    </WithVersionDiscovery>
  );
}

/** Edits an existing BackendSecurityPolicy with the same steps (form layout by default). */
export function BackendSecurityPolicyEditForm() {
  return (
    <WithVersionDiscovery title="Edit Security Policy">
      <EditObjectLoader<BackendSecurityPolicy>
        resourceClass={BackendSecurityPolicy}
        title="Edit Security Policy"
      >
        {policy => <FormContent key={policy.metadata.resourceVersion} edit={policy} />}
      </EditObjectLoader>
    </WithVersionDiscovery>
  );
}

function FormContent({ edit }: { edit?: BackendSecurityPolicy }) {
  const [initial] = useState<BSPEditState | null>(() => (edit ? formFromBSP(edit.jsonData) : null));
  const [name, setName] = useState(edit?.metadata.name || '');
  const [namespace, setNamespace] = useState(edit?.metadata.namespace || 'default');
  const [targets, setTargets] = useState<string[]>(initial?.targets || []);
  const [cred, setCred] = useState<CredentialState>(
    () => initial?.cred || initialCredentialState('APIKey', '')
  );
  const locked = !!initial?.credentialLocked;
  const [backends] = AIServiceBackend.useList({ namespace: namespace || undefined });
  const [policies] = BackendSecurityPolicy.useList({ namespace: namespace || undefined });

  // Backends already protected by another policy (upstream allows only one per backend).
  const protectedBy = new Map<string, string>();
  (policies || [])
    .filter(p => p.metadata.name !== name)
    .forEach(p => p.targetRefs.forEach(t => protectedBy.set(t.name, p.metadata.name)));
  const conflicts = targets.filter(t => protectedBy.has(t));
  const unprotected = backends
    ? backends.map(b => b.metadata.name).filter(n => !protectedBy.has(n))
    : null;

  // Only one Service Backend without a policy: target it.
  useAutoSelectSingle(
    policies === null ? null : unprotected,
    targets.length === 0,
    n => setTargets([n]),
    !edit,
    namespace
  );

  const effectiveCred: CredentialState = {
    ...cred,
    secretName: cred.secretName || (name ? `${name}-credentials` : ''),
  };

  const basicsErrors = [
    validateName(name),
    validateName(namespace, 'Namespace'),
    targets.length + (initial?.otherTargets.length || 0) > 16
      ? 'At most 16 targets are allowed.'
      : null,
  ].filter((e): e is string => !!e);

  function buildResources(): KubeObjectInterface[] {
    const created = buildCredentialResources(effectiveCred, {
      policyName: name,
      namespace,
      targetBackends: targets,
      apiVersion: BackendSecurityPolicy.apiVersion,
    });
    if (!edit || !initial) return created;
    const current = editableJson<KubeObjectInterface & { spec?: Record<string, unknown> }>(edit);
    const policy = {
      ...current,
      spec: mergeBSPSpec(current.spec, { ...initial, targets, cred: effectiveCred }, namespace),
    } as KubeObjectInterface;
    return [...created.filter(r => r.kind === 'Secret'), policy];
  }

  /** New Secret first (key rotation), then update the policy with its resourceVersion. */
  async function saveEdit(items: KubeObjectInterface[]) {
    if (!edit) return [];
    const policies = items.filter(i => i.kind === BackendSecurityPolicy.kind);
    if (policies.length !== 1) throw new Error('Edit exactly one BackendSecurityPolicy document.');
    const warnings = await applyWithOwners(items, item =>
      item.kind === BackendSecurityPolicy.kind ? edit.update(item) : ApiProxy.apply(item)
    );
    // After a key rotation the old Secret of the policy is no longer used.
    return [...warnings, ...(await deleteReleasedSecrets(edit.jsonData, policies[0]))];
  }

  const lockedBlock = edit?.jsonData.spec?.[CREDENTIAL_BLOCK[cred.type]];

  return (
    <ResourceWizard
      title={edit ? `Edit Security Policy ${namespace}/${name}` : 'Create Security Policy'}
      mode={edit ? 'edit' : 'create'}
      applyItems={
        edit
          ? saveEdit
          : // A wizard creates: an object with the same name is never replaced.
            items => applyWithOwners(items, undefined, { createOnly: () => true })
      }
      cancelUrl={
        edit
          ? Router.createRouteURL(detailRoute(ROUTE_NAMES.security), { namespace, name })
          : undefined
      }
      listRouteName={listRoute(ROUTE_NAMES.security)}
      detailRouteName={detailRoute(ROUTE_NAMES.security)}
      primaryKind={BackendSecurityPolicy.kind}
      buildResources={buildResources}
      summary={
        <NameValueTable
          rows={[
            { name: 'Security Policy', value: `${namespace}/${name}` },
            { name: 'Type', value: POLICY_TYPE_LABELS[cred.type] },
            { name: 'Targets', value: targets.join(', ') || 'None (attach later)' },
            {
              name: 'Secret',
              value: locked
                ? 'Unchanged (federated credentials)'
                : `${effectiveCred.secretName} (${cred.secretMode === 'new' ? 'new' : 'existing'})`,
            },
          ]}
        />
      }
      reviewNotice={
        conflicts.length > 0 ? (
          <Alert severity="warning">
            Already protected by another Security Policy:{' '}
            {conflicts.map(t => `${t} (${protectedBy.get(t)})`).join(', ')}. Only one Security
            Policy may target a Service Backend; the controller rejects the second one.
          </Alert>
        ) : undefined
      }
      steps={[
        {
          label: 'Policy',
          description:
            'A Service Backend can have only one Security Policy; attaching a second one is rejected by the controller.',
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
                <NamespaceInput
                  value={namespace}
                  onChange={ns => {
                    setNamespace(ns);
                    setTargets([]);
                  }}
                />
              )}
              <FullRow>
                <Autocomplete
                  multiple
                  freeSolo
                  size="small"
                  options={(backends || []).map(b => b.metadata.name)}
                  loading={backends === null}
                  value={targets}
                  onChange={(_, v) => setTargets(v as string[])}
                  renderOption={(props, option) => {
                    const b = backends?.find(x => x.metadata.name === option);
                    return (
                      <li {...props} key={option}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {option}
                          {b && <SchemaChip schemaName={b.schemaName} />}
                          {protectedBy.has(option) && (
                            <Typography variant="caption" color="warning.main">
                              protected by {protectedBy.get(option)}
                            </Typography>
                          )}
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Target Service Backends"
                      helperText="Service Backends in the same namespace that use these credentials."
                    />
                  )}
                />
              </FullRow>
              {initial && initial.otherTargets.length > 0 && (
                <FullRow>
                  <Alert severity="info">
                    Also targets (kept unchanged):{' '}
                    {initial.otherTargets.map(t => `${t.kind}/${t.name}`).join(', ')}.
                  </Alert>
                </FullRow>
              )}
            </FieldGrid>
          ),
        },
        {
          label: 'Credentials',
          description: edit
            ? 'Choose "Create a new Secret" to rotate the key: a new Secret is created and the policy points to it.'
            : undefined,
          errors: locked ? [] : credentialErrors(effectiveCred),
          content: locked ? (
            <Alert severity="info">
              This policy uses OIDC token exchange / workload identity federation, which the form
              does not edit. The credentials are kept unchanged; use Edit YAML to modify them.
              <Box sx={{ mt: 1 }}>
                <ObjectBlock value={lockedBlock} />
              </Box>
            </Alert>
          ) : (
            <CredentialFields
              state={effectiveCred}
              namespace={namespace}
              onChange={patch => setCred(c => ({ ...c, ...patch }))}
            />
          ),
        },
      ]}
    />
  );
}
