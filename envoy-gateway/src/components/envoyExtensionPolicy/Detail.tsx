import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { EnvoyExtensionPolicy, extProcBackendRefs } from '../../resources/envoyExtensionPolicy';
import { crdByKind } from '../../resources/registry';
import { API_GROUP } from '../../resources/types';
import { ResourceRefLink, ResourceRefList } from '../common/ResourceRefLink';
import { FeatureChips, KeyValueBlock, TargetRefsList, useYesNo } from '../common/SharedComponents';
import { EGDetailView } from '../common/Views';
import { EDITING } from '../editing';
import { eepFeatures } from '../features';

export function EnvoyExtensionPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('EnvoyExtensionPolicy')!}
      editing={EDITING.EnvoyExtensionPolicy}
      extraInfo={(item: EnvoyExtensionPolicy) => [
        {
          name: t('Targets'),
          value: (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
        },
        { name: t('Extensions'), value: <FeatureChips features={eepFeatures(item, t)} /> },
      ]}
      sections={(item: EnvoyExtensionPolicy) => {
        const s = item.spec;
        const ns = item.metadata.namespace;
        return [
          {
            id: 'eg-eep-wasm',
            section: !!s.wasm?.length && (
              <SectionBox title={t('Wasm extensions')}>
                {s.wasm.map((w, i) => (
                  <Box key={w.name || i} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2">
                      {w.name || t('Wasm #{{index}}', { index: i + 1 })}
                    </Typography>
                    <NameValueTable
                      rows={[
                        { name: t('Code source'), value: w.code?.type || '-' },
                        { name: t('URL'), value: w.code?.http?.url || w.code?.image?.url || '-' },
                        {
                          name: t('SHA256 checksum'),
                          value: w.code?.http?.sha256 || w.code?.image?.sha256 || '-',
                        },
                        {
                          name: t('Pull secret'),
                          value: w.code?.image?.pullSecretRef ? (
                            <ResourceRefLink
                              group=""
                              kind="Secret"
                              name={w.code.image.pullSecretRef.name}
                              namespace={w.code.image.pullSecretRef.namespace || ns}
                              hideKind
                            />
                          ) : (
                            '-'
                          ),
                          hide: w.code?.type !== 'Image',
                        },
                        { name: t('Root ID'), value: w.rootID || '-' },
                        { name: t('Fail open'), value: yesNo(w.failOpen, true) },
                        {
                          name: t('Configuration'),
                          value: w.config !== undefined ? <KeyValueBlock value={w.config} /> : '-',
                        },
                      ]}
                    />
                  </Box>
                ))}
              </SectionBox>
            ),
          },
          {
            id: 'eg-eep-extproc',
            section: !!s.extProc?.length && (
              <SectionBox title={t('External processors')}>
                {s.extProc.map((p, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Box key={i} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2">
                      {t('Processor #{{index}}', { index: i + 1 })}
                    </Typography>
                    <NameValueTable
                      rows={[
                        {
                          name: t('Backends'),
                          value: (
                            <ResourceRefList
                              refs={extProcBackendRefs(p).map(r => ({
                                group: r.kind === 'Backend' ? r.group || API_GROUP : r.group || '',
                                kind: r.kind || 'Service',
                                name: r.name,
                                namespace: r.namespace || ns,
                                port: r.port,
                              }))}
                            />
                          ),
                        },
                        { name: t('Message timeout'), value: p.messageTimeout || '-' },
                        { name: t('Request body'), value: p.processingMode?.request?.body || '-' },
                        {
                          name: t('Response body'),
                          value: p.processingMode?.response?.body || '-',
                        },
                        { name: t('Fail open'), value: yesNo(p.failOpen, true) },
                      ]}
                    />
                  </Box>
                ))}
              </SectionBox>
            ),
          },
          {
            id: 'eg-eep-lua',
            section: !!s.lua?.length && (
              <SectionBox title={t('Lua extensions')}>
                {s.lua.map((l, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Box key={i} sx={{ mb: 2 }}>
                    {l.inline ? (
                      <CodeBlock value={l.inline} />
                    ) : l.valueRef ? (
                      <ResourceRefLink
                        group=""
                        kind={l.valueRef.kind || 'ConfigMap'}
                        name={l.valueRef.name}
                        namespace={ns}
                      />
                    ) : (
                      '-'
                    )}
                  </Box>
                ))}
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}
