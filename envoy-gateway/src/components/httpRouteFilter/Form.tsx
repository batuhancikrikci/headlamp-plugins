import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import React from 'react';
import {
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { KubeJson } from '../../resources/types';
import { MetadataFields, ObjectRefField } from '../common/form/RefFields';

type Mode = 'urlRewrite' | 'directResponse';

export function HTTPRouteFilterForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const namespace = value.metadata?.namespace;
  const spec = value.spec || {};
  const filterMode: Mode = spec.urlRewrite ? 'urlRewrite' : 'directResponse';

  const switchMode = (next: Mode | null) => {
    if (!next || next === filterMode) return;
    const newSpec = { ...spec };
    delete newSpec.urlRewrite;
    delete newSpec.directResponse;
    if (next === 'urlRewrite') {
      newSpec.urlRewrite = { hostname: { type: 'Header', header: 'x-original-host' } };
    } else {
      newSpec.directResponse = {
        statusCode: 200,
        contentType: 'text/plain',
        body: { type: 'Inline', inline: 'OK' },
      };
    }
    onChange({ ...value, spec: newSpec });
  };

  const bodyType = spec.directResponse?.body?.type || 'Inline';
  const hostnameType = spec.urlRewrite?.hostname?.type;

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>

      <FormSection
        title={t('Filter type')}
        description={t('Reference this filter from an HTTPRoute rule with an ExtensionRef filter.')}
        icon="mdi:filter-outline"
      >
        <ToggleButtonGroup
          exclusive
          color="primary"
          size="small"
          value={filterMode}
          onChange={(_, v) => switchMode(v)}
        >
          <ToggleButton value="urlRewrite">{t('URL rewrite')}</ToggleButton>
          <ToggleButton value="directResponse">{t('Direct response')}</ToggleButton>
        </ToggleButtonGroup>
      </FormSection>

      {filterMode === 'urlRewrite' && (
        <FormSection title={t('URL rewrite')} icon="mdi:swap-horizontal">
          <FieldGrid>
            <SelectInput
              label={t('Rewrite hostname from')}
              options={[
                { value: 'Header', label: t('Request header') },
                { value: 'Backend', label: t('Backend hostname') },
              ]}
              value={hostnameType}
              onChange={v =>
                onChange({
                  ...value,
                  spec: {
                    ...spec,
                    urlRewrite: {
                      ...spec.urlRewrite,
                      hostname: v
                        ? { type: v, ...(v === 'Header' ? { header: '' } : {}) }
                        : undefined,
                    },
                  },
                })
              }
            />
            {hostnameType === 'Header' && (
              <TextInput
                label={t('Header name')}
                required
                placeholder="x-original-host"
                {...bind(['spec', 'urlRewrite', 'hostname', 'header'])}
              />
            )}
            <TextInput
              label={t('Path regex pattern')}
              placeholder="^/service/([^/]+)(/.*)$"
              monospace
              help={t('RE2 regular expression matched against the request path.')}
              {...bind(['spec', 'urlRewrite', 'path', 'replaceRegexMatch', 'pattern'])}
              onChange={v => {
                const path = v
                  ? {
                      type: 'ReplaceRegexMatch',
                      replaceRegexMatch: {
                        ...(spec.urlRewrite?.path?.replaceRegexMatch || {}),
                        pattern: v,
                      },
                    }
                  : undefined;
                const urlRewrite = { ...spec.urlRewrite, path };
                if (!path) delete urlRewrite.path;
                onChange({ ...value, spec: { ...spec, urlRewrite } });
              }}
            />
            <TextInput
              label={t('Path substitution')}
              placeholder="\\2/instance/\\1"
              monospace
              disabled={!spec.urlRewrite?.path}
              {...bind(['spec', 'urlRewrite', 'path', 'replaceRegexMatch', 'substitution'])}
            />
          </FieldGrid>
        </FormSection>
      )}

      {filterMode === 'directResponse' && (
        <FormSection
          title={t('Direct response')}
          description={t('Envoy answers the request itself without contacting a backend.')}
          icon="mdi:reply-outline"
        >
          <FieldGrid>
            <NumberInput
              label={t('Status code')}
              min={200}
              max={599}
              {...bind(['spec', 'directResponse', 'statusCode'])}
            />
            <TextInput
              label={t('Content type')}
              placeholder="application/json"
              {...bind(['spec', 'directResponse', 'contentType'])}
            />
            <SelectInput
              label={t('Body source')}
              allowEmpty={false}
              options={[
                { value: 'Inline', label: t('Inline text') },
                { value: 'ValueRef', label: t('ConfigMap') },
              ]}
              value={bodyType}
              onChange={v =>
                onChange({
                  ...value,
                  spec: {
                    ...spec,
                    directResponse: {
                      ...spec.directResponse,
                      body:
                        v === 'ValueRef' ? { type: 'ValueRef' } : { type: 'Inline', inline: '' },
                    },
                  },
                })
              }
            />
            {bodyType === 'ValueRef' && (
              <ObjectRefField
                kind="ConfigMap"
                label={t('ConfigMap')}
                required
                includeKind
                namespace={namespace}
                help={t('The body is read from the "response.body" key of the ConfigMap.')}
                {...bind(['spec', 'directResponse', 'body', 'valueRef'])}
              />
            )}
          </FieldGrid>
          {bodyType === 'Inline' && (
            <TextInput
              label={t('Body')}
              multiline
              minRows={4}
              monospace
              {...bind(['spec', 'directResponse', 'body', 'inline'])}
            />
          )}
        </FormSection>
      )}
    </>
  );
}
