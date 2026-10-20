import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { useText } from '../../common/i18n';
import { HelmManagedAlert } from '../../components/common/Feedback';
import { EditWithFormAction } from '../../components/forms/registry';
import { MonitoringResourceClass } from '../../resources/crds';
import { helmRelease, isHelmManaged } from '../../utils/relations';

const { DetailsGrid, SectionBox, ConditionsTable } = CommonComponents;

export interface NameValueRow {
  name: React.ReactNode;
  value?: React.ReactNode;
  hide?: boolean;
}

/**
 * Standard details page for monitoring CRDs: back link, header with the
 * form-based "Edit" action (plus Headlamp's YAML edit/delete), main info,
 * kind specific sections and events. Loading/404/403 are handled by DetailsGrid.
 */
export function DetailsPage<C extends MonitoringResourceClass>({
  resourceClass,
  extraInfo,
  sections,
}: {
  resourceClass: C;
  extraInfo?: (item: InstanceType<C>) => NameValueRow[];
  sections?: (item: InstanceType<C>) => Array<{ id: string; section: React.ReactNode }>;
}) {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  return (
    <DetailsGrid
      resourceType={resourceClass}
      name={name}
      namespace={namespace}
      withEvents
      actions={item => (item ? [<EditWithFormAction key="edit-form" item={item} />] : [])}
      extraInfo={item => (item && extraInfo ? extraInfo(item) : [])}
      extraSections={item => {
        if (!item) return [];
        const list: Array<{ id: string; section: React.ReactNode }> = [];
        if (isHelmManaged(item.jsonData)) {
          list.push({
            id: 'monitoring-helm',
            section: (
              <Box sx={{ px: 2 }}>
                <HelmManagedAlert release={helmRelease(item.jsonData)} />
              </Box>
            ),
          });
        }
        return [...list, ...(sections ? sections(item) : [])];
      }}
    />
  );
}

export function ConditionsSection({ item }: { item: KubeObject }) {
  const { t } = useText();
  if (!item.jsonData.status?.conditions?.length) return null;
  return (
    <SectionBox title={t('Conditions')}>
      <ConditionsTable resource={item.jsonData} showLastUpdate={false} />
    </SectionBox>
  );
}
