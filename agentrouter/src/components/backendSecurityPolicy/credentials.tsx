import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  BACKEND_SECURITY_POLICY_TYPES,
  BackendSecurityPolicyType,
} from '../../resources/backendSecurityPolicy';
import { FieldGrid, FullRow, SuggestInput, TextInput } from '../common/FormFields';
import {
  CredentialState,
  expectedSecretKey,
  isAPIKeyType,
  POLICY_TYPE_LABELS,
} from './credentialResources';

export * from './credentialResources';

/** Form fields for choosing a credential type and entering or referencing its secret. */
export function CredentialFields({
  state,
  onChange,
  namespace,
  lockType = false,
}: {
  state: CredentialState;
  onChange: (patch: Partial<CredentialState>) => void;
  namespace: string;
  lockType?: boolean;
}) {
  const [secrets] = K8s.ResourceClasses.Secret.useList({ namespace: namespace || undefined });
  const expectedKey = expectedSecretKey(state.type);
  const opaque = (secrets || []).filter(s => s.jsonData.type === 'Opaque');
  const hasKey = (s: (typeof opaque)[number]) => Object.keys(s.data || {}).includes(expectedKey);
  // Secrets holding the expected key first; they are the ones the controller can use.
  const secretOptions = [...opaque.filter(hasKey), ...opaque.filter(s => !hasKey(s))].map(s => ({
    value: s.metadata.name,
    description: `${hasKey(s) ? `✓ has "${expectedKey}"` : `no "${expectedKey}" key`} · keys: ${
      Object.keys(s.data || {}).join(', ') || '-'
    }`,
  }));
  const matchingSecrets = opaque.filter(hasKey);

  /** Switching to an existing Secret picks the only one holding the expected key, if any. */
  function setSecretMode(mode: 'new' | 'existing') {
    if (mode === 'existing' && matchingSecrets.length === 1) {
      onChange({ secretMode: mode, secretName: matchingSecrets[0].metadata.name });
    } else {
      onChange({ secretMode: mode, secretName: '' });
    }
  }
  const creating = state.secretMode === 'new';

  return (
    <FieldGrid>
      <FullRow>
        <TextInput
          select
          label="Authentication type"
          value={state.type}
          disabled={lockType}
          onChange={e => onChange({ type: e.target.value as BackendSecurityPolicyType })}
        >
          {BACKEND_SECURITY_POLICY_TYPES.map(t => (
            <MenuItem key={t} value={t}>
              {POLICY_TYPE_LABELS[t]}
            </MenuItem>
          ))}
        </TextInput>
      </FullRow>

      <FullRow>
        <RadioGroup
          row
          value={state.secretMode}
          onChange={e => setSecretMode(e.target.value as 'new' | 'existing')}
        >
          <FormControlLabel value="new" control={<Radio />} label="Create a new Secret" />
          <FormControlLabel value="existing" control={<Radio />} label="Use an existing Secret" />
        </RadioGroup>
      </FullRow>

      {creating ? (
        <TextInput
          label="Secret name"
          required
          value={state.secretName}
          onChange={e => onChange({ secretName: e.target.value })}
        />
      ) : (
        <SuggestInput
          label="Secret name"
          required
          value={state.secretName}
          onChange={v => onChange({ secretName: v })}
          loading={secrets === null}
          options={secretOptions}
          helperText={
            state.secretName &&
            secrets !== null &&
            !matchingSecrets.some(m => m.metadata.name === state.secretName)
              ? `Warning: this Secret has no "${expectedKey}" key, which the controller reads.`
              : `Must contain the key "${expectedKey}".`
          }
        />
      )}

      {isAPIKeyType(state.type) && creating && (
        <TextInput
          label="API key"
          type="password"
          autoComplete="new-password"
          required
          value={state.apiKey}
          onChange={e => onChange({ apiKey: e.target.value })}
        />
      )}

      {state.type === 'AWSCredentials' && (
        <>
          <TextInput
            label="AWS region"
            required
            value={state.awsRegion}
            onChange={e => onChange({ awsRegion: e.target.value })}
          />
          <TextInput
            label="Credentials profile"
            placeholder="default"
            value={state.awsProfile}
            onChange={e => onChange({ awsProfile: e.target.value })}
          />
          {creating && (
            <>
              <TextInput
                label="Access key ID"
                required
                value={state.awsAccessKeyId}
                onChange={e => onChange({ awsAccessKeyId: e.target.value })}
              />
              <TextInput
                label="Secret access key"
                type="password"
                autoComplete="new-password"
                required
                value={state.awsSecretAccessKey}
                onChange={e => onChange({ awsSecretAccessKey: e.target.value })}
              />
            </>
          )}
        </>
      )}

      {state.type === 'AzureCredentials' && (
        <>
          <TextInput
            label="Client ID"
            required
            value={state.azureClientId}
            onChange={e => onChange({ azureClientId: e.target.value })}
          />
          <TextInput
            label="Tenant ID"
            required
            value={state.azureTenantId}
            onChange={e => onChange({ azureTenantId: e.target.value })}
          />
          {creating && (
            <TextInput
              label="Client secret"
              type="password"
              autoComplete="new-password"
              required
              value={state.secretValue}
              onChange={e => onChange({ secretValue: e.target.value })}
            />
          )}
        </>
      )}

      {state.type === 'GCPCredentials' && (
        <>
          <TextInput
            label="GCP project"
            required
            value={state.gcpProject}
            onChange={e => onChange({ gcpProject: e.target.value })}
          />
          <TextInput
            label="GCP region"
            required
            value={state.gcpRegion}
            onChange={e => onChange({ gcpRegion: e.target.value })}
          />
          {creating && (
            <FullRow>
              <TextField
                label="Service account key (JSON)"
                required
                multiline
                minRows={4}
                fullWidth
                size="small"
                value={state.secretValue}
                onChange={e => onChange({ secretValue: e.target.value })}
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
              />
            </FullRow>
          )}
        </>
      )}

      {(state.type === 'AWSCredentials' ||
        state.type === 'AzureCredentials' ||
        state.type === 'GCPCredentials') && (
        <FullRow>
          <Typography variant="caption" color="text.secondary">
            OIDC / workload identity federation is not configurable here; use “Edit YAML” on the
            review step to add it.
          </Typography>
        </FullRow>
      )}
    </FieldGrid>
  );
}
