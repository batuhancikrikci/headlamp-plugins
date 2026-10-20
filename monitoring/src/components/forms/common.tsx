import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Autocomplete, Box, Button, Chip, TextField, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useText } from '../../common/i18n';
import { useSelectingWorkloads } from '../../hooks/useWorkloads';
import { Labels, SecretKeySelector } from '../../types';
import { requiredLabelsFor, SelectableKind } from '../../utils/relations';
import { StatusChip } from '../common/StatusChip';
import { FieldRow, FormSection, isValidName, KeyValueEditor, NamespaceField } from './fields';
import { FormIssue, issue, Obj } from './ResourceEditorDialog';

/** name / namespace / labels, shared by every form. */
export function MetadataSection<T extends Obj>({
  value,
  onChange,
  showErrors,
  editMode,
  children,
}: {
  value: T;
  onChange: (next: T) => void;
  showErrors: boolean;
  editMode: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useText();
  const md = value.metadata || {};
  const setMd = (patch: Obj) => onChange({ ...value, metadata: { ...md, ...patch } });
  const nameInvalid = !!md.name && !isValidName(md.name);
  return (
    <FormSection title={t('General')} icon="mdi:tag-outline">
      <FieldRow>
        <TextField
          size="small"
          label={t('Name')}
          required
          value={md.name || ''}
          disabled={editMode}
          onChange={e => setMd({ name: e.target.value })}
          error={nameInvalid || (showErrors && !md.name)}
          helperText={
            nameInvalid
              ? t('Lowercase letters, digits, "-" and "."; must start and end alphanumeric')
              : ' '
          }
        />
        <NamespaceField
          value={md.namespace}
          onChange={ns => setMd({ namespace: ns })}
          disabled={editMode}
          showErrors={showErrors}
        />
      </FieldRow>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('Labels')}
        </Typography>
        <KeyValueEditor
          value={md.labels}
          onChange={labels => setMd({ labels })}
          addLabel={t('Add label')}
        />
      </Box>
      {children}
    </FormSection>
  );
}

export function validateMetadata(value: Obj, t: (s: string) => string): FormIssue[] {
  const errors: FormIssue[] = [];
  if (!value.metadata?.name) errors.push(issue('general', t('Name is required.')));
  else if (!isValidName(value.metadata.name)) {
    errors.push(issue('general', t('Name is not a valid DNS-1123 name.')));
  }
  if (!value.metadata?.namespace) errors.push(issue('general', t('Namespace is required.')));
  return errors;
}

/**
 * Shows which workloads will pick up the object being edited and offers to add
 * the labels a workload requires (the classic "missing release label" issue).
 */
export function SelectionCheck<T extends Obj>({
  kind,
  value,
  onChange,
}: {
  kind: SelectableKind;
  value: T;
  onChange: (next: T) => void;
}) {
  const { t } = useText();
  const { workloads, evaluate } = useSelectingWorkloads(kind);
  const md = value.metadata || {};
  if (!md.namespace) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('Choose a namespace to check which workloads will select this resource.')}
      </Typography>
    );
  }
  const selections = evaluate({
    metadata: { name: md.name || '', namespace: md.namespace, labels: md.labels },
  });
  if (workloads.length === 0) {
    return (
      <Alert severity="info">
        {kind === 'AlertmanagerConfig'
          ? t('No Alertmanager resources found in the cluster.')
          : t('No Prometheus resources found in the cluster.')}
      </Alert>
    );
  }
  const addLabels = (labels: Labels) =>
    onChange({ ...value, metadata: { ...md, labels: { ...(md.labels || {}), ...labels } } });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {selections.map(s => {
        const required = requiredLabelsFor(s.workload.jsonData, kind);
        const missing = required
          ? Object.fromEntries(Object.entries(required).filter(([k, v]) => md.labels?.[k] !== v))
          : null;
        return (
          <Box
            key={s.workload.metadata.uid}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            {s.result === 'selected' ? (
              <StatusChip tone="success" icon="mdi:check-circle" label={t('Selected')} />
            ) : s.result === 'unknown' ? (
              <StatusChip tone="default" icon="mdi:help-circle" label={t('Unknown')} />
            ) : (
              <StatusChip tone="warning" icon="mdi:alert" label={t('Not selected')} />
            )}
            <Typography variant="body2">
              {s.workload.kind}{' '}
              <strong>
                {s.workload.metadata.namespace}/{s.workload.metadata.name}
              </strong>
            </Typography>
            {s.result === 'not-selected' && missing && Object.keys(missing).length > 0 && (
              <Button
                size="small"
                startIcon={<Icon icon="mdi:auto-fix" />}
                onClick={() => addLabels(missing)}
              >
                {t('Add labels')}{' '}
                {Object.entries(missing)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </Button>
            )}
            {s.result === 'not-selected' && required === null && (
              <Typography variant="caption" color="text.secondary">
                {t('This workload does not select any resource of this kind.')}
              </Typography>
            )}
            {s.result === 'not-selected' && missing && Object.keys(missing).length === 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('The namespace is not selected by this workload.')}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** Secret + key picker for SecretKeySelector fields (secrets of one namespace). */
export function SecretKeyField({
  namespace,
  value,
  onChange,
  label,
  required,
  showErrors,
}: {
  namespace?: string;
  value?: SecretKeySelector;
  onChange: (next: SecretKeySelector | undefined) => void;
  label: string;
  required?: boolean;
  showErrors?: boolean;
}) {
  const { t } = useText();
  const [secrets, setSecrets] = useState<Array<{ name: string; keys: string[] }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSecrets(null);
    if (!namespace) return;
    ApiProxy.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`)
      .then(
        (res: { items?: Array<{ metadata: { name: string }; data?: Record<string, string> }> }) => {
          if (cancelled) return;
          setSecrets(
            (res?.items || []).map(s => ({
              name: s.metadata.name,
              keys: Object.keys(s.data || {}),
            }))
          );
        }
      )
      .catch(() => {
        // No permission to list secrets: fall back to free text.
        if (!cancelled) setSecrets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const secret = secrets?.find(s => s.name === value?.name);
  const set = (patch: Partial<SecretKeySelector>) => {
    const next = { name: value?.name || '', key: value?.key || '', ...patch };
    onChange(next.name || next.key ? next : undefined);
  };
  const missing = required && (!value?.name || !value?.key);

  return (
    <FieldRow>
      <Autocomplete
        freeSolo
        options={(secrets || []).map(s => s.name)}
        value={value?.name || ''}
        onInputChange={(_, v) => v !== (value?.name || '') && set({ name: v })}
        renderInput={params => (
          <TextField
            {...params}
            size="small"
            label={`${label} – ${t('Secret')}`}
            required={required}
            error={!!showErrors && !!missing && !value?.name}
            helperText={
              value?.name && secrets && secrets.length > 0 && !secret
                ? t('Secret not found in namespace {{nsName}}', { nsName: namespace })
                : ' '
            }
          />
        )}
      />
      <Autocomplete
        freeSolo
        options={secret?.keys || []}
        value={value?.key || ''}
        onInputChange={(_, v) => v !== (value?.key || '') && set({ key: v })}
        renderInput={params => (
          <TextField
            {...params}
            size="small"
            label={`${label} – ${t('Key')}`}
            required={required}
            error={!!showErrors && !!missing && !value?.key}
            helperText=" "
          />
        )}
      />
    </FieldRow>
  );
}

/** Lists the pods/services matched by a selector, as a live preview inside forms. */
export function MatchPreview({ names, emptyText }: { names: string[] | null; emptyText: string }) {
  const { t } = useText();
  if (names === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('Loading…')}
      </Typography>
    );
  }
  if (names.length === 0) {
    return <Alert severity="warning">{emptyText}</Alert>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {names.slice(0, 30).map(n => (
        <Chip key={n} size="small" label={n} />
      ))}
      {names.length > 30 && <Chip size="small" label={`+${names.length - 30}`} />}
    </Box>
  );
}
