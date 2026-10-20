import { Alert } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { JSONPatch } from '../../resources/envoyPatchPolicy';
import { KubeJson, TargetRef } from '../../resources/types';
import { MetadataFields, TARGET_KINDS, TargetRefsEditor } from '../common/form/RefFields';

const XDS_TYPES = [
  'type.googleapis.com/envoy.config.listener.v3.Listener',
  'type.googleapis.com/envoy.config.route.v3.RouteConfiguration',
  'type.googleapis.com/envoy.config.cluster.v3.Cluster',
  'type.googleapis.com/envoy.config.endpoint.v3.ClusterLoadAssignment',
  'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
];

/** JSON value editor that keeps the raw text while it is being typed. */
function JsonValueInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useText();
  const [text, setText] = React.useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2)
  );
  const [error, setError] = React.useState<string>();
  return (
    <TextInput
      label={t('Value (JSON)')}
      multiline
      minRows={4}
      monospace
      value={text}
      error={error}
      onChange={v => {
        setText(v || '');
        if (!v) {
          setError(undefined);
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(v));
          setError(undefined);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    />
  );
}

function PatchEditor({ patch, onChange }: { patch: JSONPatch; onChange: (p: JSONPatch) => void }) {
  const { t } = useText();
  const op = patch.operation || { op: 'add' };
  const setOp = (next: Partial<JSONPatch['operation']>) => {
    const merged = { ...op, ...next };
    for (const k of Object.keys(merged) as Array<keyof typeof merged>) {
      if (merged[k] === undefined) delete merged[k];
    }
    onChange({ ...patch, operation: merged as JSONPatch['operation'] });
  };
  return (
    <>
      <FieldGrid>
        <SelectInput
          label={t('xDS resource type')}
          allowEmpty={false}
          options={XDS_TYPES.map(v => ({ value: v, label: v.split('.').pop() || v }))}
          value={patch.type}
          onChange={v => onChange({ ...patch, type: v || XDS_TYPES[0] })}
        />
        <TextInput
          label={t('xDS resource name')}
          required
          placeholder="default/eg/http"
          help={t('Name of the generated xDS resource, visible in the Envoy config dump.')}
          value={patch.name}
          onChange={v => onChange({ ...patch, name: v || '' })}
        />
        <SelectInput
          label={t('Operation')}
          allowEmpty={false}
          options={['add', 'remove', 'replace', 'move', 'copy', 'test']}
          value={op.op}
          onChange={v => setOp({ op: v || 'add' })}
        />
        <TextInput
          label={t('JSON pointer path')}
          placeholder="/default_filter_chain/filters/0"
          monospace
          value={op.path}
          onChange={v => setOp({ path: v })}
        />
        <TextInput
          label={t('JSONPath (alternative)')}
          monospace
          value={op.jsonPath}
          onChange={v => setOp({ jsonPath: v })}
        />
        {(op.op === 'move' || op.op === 'copy') && (
          <TextInput
            label={t('From')}
            monospace
            value={op.from}
            onChange={v => setOp({ from: v })}
          />
        )}
      </FieldGrid>
      {op.op !== 'remove' && op.op !== 'move' && (
        <FieldGrid columns={1}>
          <JsonValueInput value={op.value} onChange={v => setOp({ value: v })} />
        </FieldGrid>
      )}
    </>
  );
}

export function EnvoyPatchPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const target = bind<TargetRef>(['spec', 'targetRef']);
  const patches = bind<JSONPatch[]>(['spec', 'jsonPatches']);
  return (
    <>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t(
          'EnvoyPatchPolicy modifies the generated Envoy configuration directly. It must be enabled in the Envoy Gateway configuration (extensionApis.enableEnvoyPatchPolicy) and patches can break when Envoy Gateway is upgraded.'
        )}
      </Alert>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Target')}
        description={t(
          'A Gateway in the same namespace, or a GatewayClass when Gateways are merged (the policy must then live in the Envoy Gateway namespace).'
        )}
        icon="mdi:target"
      >
        <TargetRefsEditor
          single
          kinds={TARGET_KINDS.gatewayOrClass}
          namespace={value.metadata?.namespace}
          value={target.value ? [target.value] : undefined}
          onChange={refs => target.onChange(refs?.[0])}
        />
        <FieldGrid>
          <NumberInput
            label={t('Priority')}
            help={t(
              'Lower values are applied first when several policies target the same Gateway.'
            )}
            {...bind(['spec', 'priority'])}
          />
        </FieldGrid>
      </FormSection>
      <FormSection title={t('JSON patches')} icon="mdi:code-json">
        <ArrayEditor<JSONPatch>
          items={patches.value}
          onChange={patches.onChange}
          newItem={() => ({ type: XDS_TYPES[0], name: '', operation: { op: 'add', path: '' } })}
          addLabel={t('Add patch')}
          itemTitle={(p, i) => `#${i + 1} ${p.operation?.op || ''} ${p.name || ''}`.trim()}
          renderItem={(p, update) => <PatchEditor patch={p} onChange={update} />}
        />
      </FormSection>
    </>
  );
}
