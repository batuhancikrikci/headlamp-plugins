import { Alert } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  DurationInput,
  FieldGrid,
  FormSection,
  SelectInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import {
  extProcBackendRefs,
  ExtProcExtension,
  WasmExtension,
} from '../../resources/envoyExtensionPolicy';
import { KubeJson } from '../../resources/types';
import {
  BackendRefsEditor,
  MetadataFields,
  TARGET_KINDS,
  TargetRefsEditor,
} from '../common/form/RefFields';

function WasmEditor({
  wasm,
  onChange,
}: {
  wasm: WasmExtension;
  onChange: (w: WasmExtension) => void;
}) {
  const { t } = useText();
  const type = wasm.code?.type || 'HTTP';
  const source = type === 'Image' ? wasm.code?.image : wasm.code?.http;
  const setSource = (patch: { url?: string; sha256?: string }) => {
    const next = {
      url: source?.url || '',
      ...(source?.sha256 ? { sha256: source.sha256 } : {}),
      ...patch,
    };
    if (!next.sha256) delete next.sha256;
    onChange({ ...wasm, code: type === 'Image' ? { type, image: next } : { type, http: next } });
  };
  return (
    <FieldGrid>
      <TextInput
        label={t('Name')}
        value={wasm.name}
        onChange={v => onChange({ ...wasm, name: v })}
      />
      <SelectInput
        label={t('Code source')}
        allowEmpty={false}
        options={[
          { value: 'HTTP', label: t('HTTP URL') },
          { value: 'Image', label: t('OCI image') },
        ]}
        value={type}
        onChange={v =>
          onChange({
            ...wasm,
            code:
              v === 'Image'
                ? { type: 'Image', image: { url: '' } }
                : { type: 'HTTP', http: { url: '' } },
          })
        }
      />
      <TextInput
        label={type === 'Image' ? t('Image') : t('URL')}
        required
        placeholder={
          type === 'Image' ? 'oci://ghcr.io/org/filter:v1' : 'https://example.com/filter.wasm'
        }
        value={source?.url}
        onChange={v => setSource({ url: v || '' })}
      />
      <TextInput
        label={t('SHA256 checksum')}
        help={t('Required for HTTP sources unless the URL is trusted.')}
        value={source?.sha256}
        onChange={v => setSource({ sha256: v })}
      />
      <TextInput
        label={t('Root ID')}
        value={wasm.rootID}
        onChange={v => onChange({ ...wasm, rootID: v })}
      />
      <SwitchInput
        label={t('Fail open')}
        help={t('Keep serving traffic if the extension fails to load.')}
        value={wasm.failOpen}
        onChange={v => onChange({ ...wasm, failOpen: v })}
      />
    </FieldGrid>
  );
}

function ExtProcEditor({
  proc,
  onChange,
  namespace,
}: {
  proc: ExtProcExtension;
  onChange: (p: ExtProcExtension) => void;
  namespace?: string;
}) {
  const { t } = useText();
  return (
    <>
      <BackendRefsEditor
        namespace={namespace}
        value={extProcBackendRefs(proc)}
        onChange={refs => {
          const next = { ...proc, backendRefs: refs };
          delete next.backendRef;
          onChange(next);
        }}
      />
      <FieldGrid columns={3}>
        <DurationInput
          label={t('Message timeout')}
          placeholder="200ms"
          value={proc.messageTimeout}
          onChange={v => onChange({ ...proc, messageTimeout: v })}
        />
        <SelectInput
          label={t('Request body')}
          options={['Buffered', 'Streamed', 'BufferedPartial']}
          value={proc.processingMode?.request?.body}
          onChange={v =>
            onChange({
              ...proc,
              processingMode: { ...proc.processingMode, request: v ? { body: v } : {} },
            })
          }
        />
        <SelectInput
          label={t('Response body')}
          options={['Buffered', 'Streamed', 'BufferedPartial']}
          value={proc.processingMode?.response?.body}
          onChange={v =>
            onChange({
              ...proc,
              processingMode: { ...proc.processingMode, response: v ? { body: v } : {} },
            })
          }
        />
        <SwitchInput
          label={t('Fail open')}
          value={proc.failOpen}
          onChange={v => onChange({ ...proc, failOpen: v })}
        />
      </FieldGrid>
    </>
  );
}

export function EnvoyExtensionPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const namespace = value.metadata?.namespace;
  const wasm = bind<WasmExtension[]>(['spec', 'wasm']);
  const extProc = bind<ExtProcExtension[]>(['spec', 'extProc']);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection title={t('Targets')} icon="mdi:target">
        <TargetRefsEditor
          kinds={TARGET_KINDS.gatewayAndHttp}
          namespace={namespace}
          withSection
          {...bind(['spec', 'targetRefs'])}
        />
      </FormSection>
      <FormSection
        title={t('Wasm extensions')}
        description={t('WebAssembly filters executed inside Envoy.')}
        icon="mdi:puzzle-outline"
      >
        <ArrayEditor<WasmExtension>
          items={wasm.value}
          onChange={wasm.onChange}
          newItem={() => ({ name: '', code: { type: 'HTTP', http: { url: '' } } })}
          addLabel={t('Add Wasm extension')}
          itemTitle={(w, i) => w.name || t('Wasm #{{index}}', { index: i + 1 })}
          renderItem={(w, update) => <WasmEditor wasm={w} onChange={update} />}
        />
      </FormSection>
      <FormSection
        title={t('External processors')}
        description={t(
          'gRPC services that can inspect and mutate requests and responses (ext_proc).'
        )}
        icon="mdi:cog-transfer-outline"
      >
        <ArrayEditor<ExtProcExtension>
          items={extProc.value}
          onChange={extProc.onChange}
          newItem={() => ({ backendRefs: [{ name: '', port: 9002 }] })}
          addLabel={t('Add external processor')}
          itemTitle={(_, i) => t('Processor #{{index}}', { index: i + 1 })}
          renderItem={(p, update) => (
            <ExtProcEditor proc={p} onChange={update} namespace={namespace} />
          )}
        />
      </FormSection>
      {!!value.spec?.lua?.length && (
        <Alert severity="info">
          {t('Lua extensions are kept as they are; edit them in the YAML tab.')}
        </Alert>
      )}
    </>
  );
}
