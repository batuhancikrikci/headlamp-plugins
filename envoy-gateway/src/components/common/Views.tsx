import {
  DetailsGrid,
  ResourceListView,
  SectionBox,
  Tabs as HeadlampTabs,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type {
  ColumnType,
  ResourceTableColumn,
} from '@kinvolk/headlamp-plugin/lib/components/common/Resource/ResourceTable';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { useText } from '../../common/i18n';
import type { EnvoyGatewayObject } from '../../resources/base';
import { CRDInfo } from '../../resources/registry';
import { servedApiVersion } from '../../utils/versionDiscovery';
import { CRDGate } from './CRDGate';
import { CreateResourceMenu, EditingConfig, EditWithFormAction } from './form/EditActions';
import { statusColumn, statusSections, StatusSummary } from './SharedComponents';

/** A list column: a built-in one by name, or one that reads the row object of the kind. */
export type Column<T = EnvoyGatewayObject> = ColumnType | ResourceTableColumn<T>;
type ListColumns = React.ComponentProps<typeof ResourceListView>['columns'];

/**
 * Standard list page: CRD availability gate, create menu, common columns.
 *
 * `statusColumn` replaces the default condition based status column (used by kinds whose health
 * is derived from other resources); kinds without any status get no status column.
 */
export function EGListView<T extends EnvoyGatewayObject>({
  crd,
  editing,
  columns,
  statusColumn: customStatusColumn,
}: {
  crd: CRDInfo;
  editing: EditingConfig;
  columns: Array<Column<T>>;
  statusColumn?: Column<T>;
}) {
  const { t } = useText();
  const title = t(crd.labelPlural);
  const status =
    customStatusColumn ?? (crd.statusSource === 'conditions' ? statusColumn(t('Status')) : null);
  return (
    <CRDGate title={title} plural={crd.plural}>
      <ResourceListView
        title={title}
        resourceClass={crd.cls}
        headerProps={{
          titleSideActions: [
            <Box key="actions" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <DocsDrawer
                apiVersion={servedApiVersion(crd.plural, getCluster())}
                kind={crd.kind}
                iconOnly
              />
              <CreateResourceMenu crd={crd} editing={editing} />
            </Box>,
          ],
        }}
        // ResourceListView types its columns for any KubeObject; the rows are instances of
        // crd.cls, which is what the columns expect.
        columns={
          ['name', 'namespace', ...columns, ...(status ? [status] : []), 'age'] as ListColumns
        }
      />
    </CRDGate>
  );
}

export interface InfoRow {
  name: string;
  value: React.ReactNode;
  hide?: boolean;
}

export interface DetailSection {
  id: string;
  section: React.ReactNode;
}

/** Standard detail page: gate, status row, edit-with-form action, status sections and events. */
export function EGDetailView<T extends EnvoyGatewayObject>({
  crd,
  editing,
  extraInfo,
  sections,
  statusValue,
}: {
  crd: CRDInfo;
  editing: EditingConfig;
  extraInfo?: (item: T) => InfoRow[];
  sections?: (item: T) => DetailSection[];
  /** Replaces the condition based status row (see CRDInfo.statusSource). */
  statusValue?: (item: T) => React.ReactNode;
}) {
  // DetailsGrid hands over instances of crd.cls, which is the class of T.
  const own = (item: EnvoyGatewayObject) => item as T;
  const { t } = useText();
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <CRDGate title={crd.kind} plural={crd.plural}>
      <DetailsGrid
        resourceType={crd.cls}
        name={name}
        namespace={namespace}
        withEvents
        actions={item =>
          item
            ? [
                <DocsDrawer
                  key="docs"
                  apiVersion={item.jsonData.apiVersion}
                  kind={crd.kind}
                  getValue={() => item.jsonData}
                  iconOnly
                />,
                <EditWithFormAction key="edit-form" item={item} editing={editing} />,
              ]
            : []
        }
        extraInfo={item =>
          item && [
            {
              name: t('Status'),
              value: statusValue ? (
                statusValue(own(item))
              ) : (
                <StatusSummary summary={item.statusSummary} />
              ),
              hide: crd.statusSource === 'none' && !statusValue,
            },
            ...(extraInfo ? extraInfo(own(item)) : []),
          ]
        }
        extraSections={item =>
          item && [
            ...(sections ? sections(own(item)) : []),
            // Only kinds with controller conditions get the Conditions / Ancestors sections.
            ...(crd.statusSource === 'conditions' ? statusSections(item.status, namespace, t) : []),
          ]
        }
      />
    </CRDGate>
  );
}

export interface SpecTab {
  label: string;
  content: React.ReactNode;
}

/**
 * Groups many optional spec sections into tabs. Tabs without content are dropped so the reader
 * only sees what is configured.
 */
export function SpecTabs({ title, tabs }: { title: string; tabs: SpecTab[] }) {
  const visible = tabs.filter(tab => !!tab.content);
  if (visible.length === 0) return null;
  return (
    <SectionBox title={title}>
      <HeadlampTabs
        ariaLabel={title}
        tabs={visible.map(tab => ({ label: tab.label, component: tab.content }))}
      />
    </SectionBox>
  );
}
