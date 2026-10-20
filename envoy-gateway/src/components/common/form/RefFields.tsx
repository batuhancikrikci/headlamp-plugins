import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Autocomplete, Box, Button, IconButton, TextField, Tooltip } from '@mui/material';
import React from 'react';
import {
  FieldGrid,
  HelpTip,
  NumberInput,
  SelectInput,
  TextInput,
} from '../../../common/form/Fields';
import { useText } from '../../../common/i18n';
import { isValidResourceName, setIn } from '../../../common/objects';
import { API_GROUP, BackendRef, KubeJson, ObjectRef } from '../../../resources/types';
import { classForKind } from '../ResourceRefLink';

export { emptyTargetRef, TargetRefsEditor } from './TargetPicker';

interface NameAutocompleteProps {
  cls: KubeObjectClass;
  namespace?: string;
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  error?: string;
}

/** Name picker backed by a live list of objects; free text is still allowed. */
function LiveNameAutocomplete({
  cls,
  namespace,
  label,
  value,
  onChange,
  required,
  disabled,
  helperText,
  error,
}: NameAutocompleteProps) {
  const { t } = useText();
  const [items, listError] = cls.useList(cls.isNamespaced && namespace ? { namespace } : {});
  const names: string[] = React.useMemo(
    () =>
      Array.from(
        new Set(
          ((items as Array<{ metadata: { name: string } }> | null) || []).map(i => i.metadata.name)
        )
      ).sort(),
    [items]
  );
  const loading = items === null && !listError;

  return (
    <Autocomplete
      freeSolo
      size="small"
      options={names}
      loading={loading}
      value={value ?? null}
      inputValue={value ?? ''}
      disabled={disabled}
      onInputChange={(_, next) => onChange(next === '' ? undefined : next)}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={!!error}
          helperText={
            error ||
            helperText ||
            (value && !loading && names.length > 0 && !names.includes(value)
              ? t('No {{kind}} with this name was found', { kind: cls.kind })
              : undefined)
          }
        />
      )}
    />
  );
}

/** Name field for a reference: a live picker if Headlamp knows the kind, otherwise a text field. */
export function RefNameField(
  props: Omit<NameAutocompleteProps, 'cls'> & { group?: string; kind: string }
) {
  const cls = classForKind(props.group, props.kind);
  if (!cls) {
    return (
      <TextInput
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        required={props.required}
        disabled={props.disabled}
        helperText={props.helperText}
        error={props.error}
      />
    );
  }
  return <LiveNameAutocomplete key={props.kind} cls={cls} {...props} />;
}

/** Name + namespace fields shared by every form. */
export function MetadataFields({
  value,
  onChange,
  mode,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  mode: 'create' | 'edit';
}) {
  const { t } = useText();
  const name = value.metadata?.name;
  const namespace = value.metadata?.namespace;
  const NamespaceClass = (K8s.ResourceClasses as Record<string, KubeObjectClass>).Namespace;
  const nameError =
    name && !isValidResourceName(name)
      ? t('Use lowercase letters, digits, "-" and "." only')
      : undefined;

  return (
    <FieldGrid>
      <TextInput
        label={t('Name')}
        value={name}
        required
        disabled={mode === 'edit'}
        error={nameError}
        onChange={v => onChange(setIn(value, ['metadata', 'name'], v))}
      />
      {mode === 'edit' ? (
        <TextInput label={t('Namespace')} value={namespace} disabled onChange={() => {}} />
      ) : (
        <LiveNameAutocomplete
          cls={NamespaceClass}
          label={t('Namespace')}
          value={namespace}
          required
          onChange={v => onChange(setIn(value, ['metadata', 'namespace'], v))}
        />
      )}
    </FieldGrid>
  );
}

/** Kinds a policy can target, per CRD. */
export const TARGET_KINDS = {
  gatewayOnly: ['Gateway'],
  gatewayAndRoutes: ['Gateway', 'HTTPRoute', 'GRPCRoute', 'TCPRoute', 'UDPRoute', 'TLSRoute'],
  gatewayAndHttp: ['Gateway', 'HTTPRoute', 'GRPCRoute'],
  gatewayOrClass: ['Gateway', 'GatewayClass'],
};

/** Editor for a list of backendRefs (Service or Envoy Gateway Backend). */
export function BackendRefsEditor({
  value,
  onChange,
  namespace,
}: {
  value: BackendRef[] | undefined;
  onChange: (refs: BackendRef[] | undefined) => void;
  namespace?: string;
}) {
  const { t } = useText();
  const refs = value || [];
  const update = (index: number, next: BackendRef) => {
    const copy = [...refs];
    copy[index] = next;
    onChange(copy);
  };
  const remove = (index: number) => {
    const copy = refs.filter((_, i) => i !== index);
    onChange(copy.length > 0 ? copy : undefined);
  };
  const kindOf = (ref: BackendRef) => (ref.kind === 'Backend' ? 'Backend' : 'Service');

  return (
    <Box>
      {refs.map((ref, index) => (
        <Box
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: { xs: '1fr', md: '140px 1fr 120px 40px' },
            alignItems: 'start',
            mb: 1.5,
          }}
        >
          <SelectInput
            label={t('Kind')}
            value={kindOf(ref)}
            allowEmpty={false}
            options={['Service', 'Backend']}
            onChange={kind =>
              update(
                index,
                kind === 'Backend'
                  ? { group: API_GROUP, kind: 'Backend', name: '', port: ref.port }
                  : { name: '', port: ref.port }
              )
            }
          />
          <RefNameField
            group={kindOf(ref) === 'Backend' ? API_GROUP : ''}
            kind={kindOf(ref)}
            namespace={ref.namespace || namespace}
            label={t('Name')}
            required
            value={ref.name}
            onChange={name => update(index, { ...ref, name: name || '' })}
          />
          <NumberInput
            label={t('Port')}
            value={ref.port}
            min={1}
            max={65535}
            onChange={port => {
              const next = { ...ref, port };
              if (port === undefined) delete next.port;
              update(index, next);
            }}
          />
          <Tooltip title={t('Remove')}>
            <IconButton aria-label={t('Remove')} onClick={() => remove(index)} sx={{ mt: 0.25 }}>
              <Icon icon="mdi:close" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:server-network" />}
        onClick={() => onChange([...refs, { name: '', port: 80 }])}
      >
        {t('Add backend')}
      </Button>
    </Box>
  );
}

/** Picker for a single Secret/ConfigMap reference. */
export function ObjectRefField({
  kind,
  label,
  value,
  onChange,
  namespace,
  required,
  help,
  includeKind,
}: {
  kind: 'Secret' | 'ConfigMap';
  label: string;
  value: ObjectRef | undefined;
  onChange: (ref: ObjectRef | undefined) => void;
  namespace?: string;
  required?: boolean;
  help?: string;
  /** Write group/kind explicitly (required by some fields such as valueRef). */
  includeKind?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Box sx={{ flexGrow: 1 }}>
        <RefNameField
          group=""
          kind={kind}
          namespace={namespace}
          label={label}
          required={required}
          value={value?.name}
          onChange={name =>
            onChange(
              name
                ? includeKind
                  ? { group: '', kind, name }
                  : { ...(value || {}), name }
                : undefined
            )
          }
        />
      </Box>
      <HelpTip text={help} />
    </Box>
  );
}
