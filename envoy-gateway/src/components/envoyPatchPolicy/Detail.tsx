import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { EnvoyPatchPolicy } from '../../resources/envoyPatchPolicy';
import { crdByKind } from '../../resources/registry';
import { KeyValueBlock, TargetRefsList } from '../common/SharedComponents';
import { EGDetailView } from '../common/Views';
import { EDITING } from '../editing';

export function EnvoyPatchPolicyDetail() {
  const { t } = useText();

  return (
    <EGDetailView
      crd={crdByKind('EnvoyPatchPolicy')!}
      editing={EDITING.EnvoyPatchPolicy}
      extraInfo={(item: EnvoyPatchPolicy) => [
        {
          name: t('Target'),
          value: (
            <TargetRefsList
              targetRefs={item.targetRefs}
              defaultNamespace={item.metadata.namespace}
            />
          ),
        },
        { name: t('Patch type'), value: item.patchType },
        { name: t('Patches'), value: item.patchCount },
        { name: t('Priority'), value: item.spec.priority ?? 0 },
      ]}
      sections={(item: EnvoyPatchPolicy) => [
        {
          id: 'eg-epp-patches',
          section: !!item.spec.jsonPatches?.length && (
            <SectionBox title={t('JSON patches')}>
              {item.spec.jsonPatches.map((patch, i) => (
                <Box key={`${patch.name}-${i}`} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2">
                    #{i + 1} {patch.operation?.op} · {patch.name}
                  </Typography>
                  <NameValueTable
                    rows={[
                      {
                        name: t('xDS resource type'),
                        value: patch.type.split('.').pop() || patch.type,
                      },
                      { name: t('xDS resource name'), value: patch.name },
                      {
                        name: t('Path'),
                        value: patch.operation?.path || patch.operation?.jsonPath || '-',
                      },
                      {
                        name: t('From'),
                        value: patch.operation?.from || '-',
                        hide: !patch.operation?.from,
                      },
                      {
                        name: t('Value'),
                        value:
                          patch.operation?.value !== undefined ? (
                            <KeyValueBlock value={patch.operation.value} />
                          ) : (
                            '-'
                          ),
                      },
                    ]}
                  />
                </Box>
              ))}
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
