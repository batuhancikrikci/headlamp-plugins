import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  ResourceListView,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type {
  ColumnType,
  ResourceTableColumn,
} from '@kinvolk/headlamp-plugin/lib/components/common/Resource/ResourceTable';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Tab, Tabs, Tooltip } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { isAvailable, servedApiVersion, versionDeprecation } from '../../api/discovery';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { useText } from '../../common/i18n';
import { NotInstalled } from '../../common/States';
import { useCRDMetaOf } from '../../hooks/useDiscovery';
import type { CiliumObject } from '../../resources/base';
import { CRDInfo, crdsOfGroup, groupById, GroupId, groupRouteName } from '../../resources/registry';
import { EDITING } from '../editing';
import { CRDGate } from './CRDGate';
import { CreateResourceMenu, EditWithFormAction } from './form/EditActions';
import { ConditionPolarity, ConditionsTable } from './Shared';

/** A list column: a built-in one by name, or one that reads the row object of the kind. */
export type Column<T = CiliumObject> = ColumnType | ResourceTableColumn<T>;
type ListColumns = React.ComponentProps<typeof ResourceListView>['columns'];

/** URL of a group page, optionally with one of its tabs selected. */
export function groupURL(group: GroupId, plural?: string): string {
  return Router.createRouteURL(groupRouteName(group), plural ? { plural } : {});
}

export function listURL(crd: CRDInfo): string {
  return groupURL(crd.group, crd.plural);
}

/** Warns when the kind, or the served version in use, is deprecated. */
export function DeprecationNotice({ crd }: { crd: CRDInfo }) {
  const { t } = useText();
  const meta = useCRDMetaOf(crd.plural);
  const version = servedApiVersion(crd.plural, getCluster());
  const runtime = versionDeprecation(meta, version);
  if (!crd.deprecated && !runtime) return null;
  return (
    <Alert severity="warning" icon={<Icon icon="mdi:alert-outline" />} sx={{ mb: 2 }}>
      {crd.deprecationNote ||
        runtime ||
        t('{{kind}} is deprecated and may be removed in a future Cilium release.', {
          kind: crd.kind,
        })}{' '}
      {t('Existing objects can still be viewed and edited as YAML.')}
    </Alert>
  );
}

/**
 * Standard list page: CRD availability gate, deprecation notice, create menu and the common
 * name / namespace / age columns around the kind-specific ones.
 */
export function CiliumListView<T extends CiliumObject>({
  crd,
  columns,
}: {
  crd: CRDInfo;
  columns: Array<Column<T>>;
}) {
  const { t } = useText();
  const title = t(crd.labelPlural);
  const editing = EDITING[crd.kind] || {};
  // Deprecated kinds are read-mostly: existing objects stay editable, new ones are YAML only.
  const creatable = !crd.readOnly;
  const createEditing = crd.deprecated ? {} : editing;
  return (
    <CRDGate title={title} plural={crd.plural}>
      <DeprecationNotice crd={crd} />
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
              {creatable && <CreateResourceMenu crd={crd} editing={createEditing} />}
            </Box>,
          ],
        }}
        // ResourceListView types its columns for any KubeObject; the rows are instances of
        // crd.cls, which is what the columns expect.
        columns={
          ['name', ...(crd.namespaced ? ['namespace'] : []), ...columns, 'age'] as ListColumns
        }
        // Row menu and bulk selection (edit as YAML, delete with confirmation) for kinds that
        // users manage; runtime state written by Cilium stays read-only.
        enableRowActions={creatable}
        enableRowSelection={creatable}
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

/**
 * Standard detail page: gate, deprecation notice, documentation and edit-with-form actions,
 * the kind-specific sections, conditions and events.
 */
export function CiliumDetailView<T extends CiliumObject>({
  crd,
  extraInfo,
  sections,
  conditions,
}: {
  crd: CRDInfo;
  extraInfo?: (item: T) => InfoRow[];
  sections?: (item: T) => DetailSection[];
  /** Adds a Conditions section; `problem` for kinds whose conditions describe failures. */
  conditions?: ConditionPolarity;
}) {
  const { t } = useText();
  const { name, namespace } = useParams<{ name: string; namespace?: string }>();
  const editing = crd.readOnly ? {} : EDITING[crd.kind] || {};
  // DetailsGrid hands over instances of crd.cls, which is the class of T.
  const own = (item: CiliumObject) => item as T;

  return (
    <CRDGate title={crd.kind} plural={crd.plural}>
      <DeprecationNotice crd={crd} />
      <DetailsGrid
        resourceType={crd.cls}
        name={name}
        namespace={crd.namespaced ? namespace : undefined}
        withEvents
        backLink={listURL(crd)}
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
        extraInfo={item => (item && extraInfo ? extraInfo(own(item)).filter(r => !r.hide) : [])}
        extraSections={item =>
          item
            ? [
                ...(sections ? sections(own(item)) : []),
                ...(conditions
                  ? [
                      {
                        id: 'cilium-conditions',
                        section: (
                          <SectionBox title={t('Conditions')}>
                            <ConditionsTable conditions={item.conditions} polarity={conditions} />
                          </SectionBox>
                        ),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
    </CRDGate>
  );
}

/**
 * Page of a sidebar group: one tab per CRD of the group, selected through the URL so that every
 * list is deep-linkable. Tabs of CRDs that are not installed are disabled.
 */
export function GroupPage({
  group,
  lists,
}: {
  group: GroupId;
  lists: Record<string, React.ComponentType>;
}) {
  const { t } = useText();
  const history = useHistory();
  const { plural } = useParams<{ plural?: string }>();
  const info = groupById(group);
  const crds = crdsOfGroup(group);

  return (
    <CRDGate title={t(info.label)}>
      {availability => {
        const installed = crds.filter(c => isAvailable(availability, c.plural));
        // Deprecated kinds only get a tab when the cluster still serves them.
        const visible = crds.filter(c => !c.deprecated || isAvailable(availability, c.plural));
        const current = crds.find(c => c.plural === plural) || installed[0] || visible[0];
        const List = current ? lists[current.kind] : undefined;
        return (
          <Box>
            <Tabs
              value={current?.plural ?? false}
              onChange={(_, next: string) => history.push(groupURL(group, next))}
              variant="scrollable"
              scrollButtons="auto"
              aria-label={t(info.label)}
              sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
              {visible.map(c => {
                const available = isAvailable(availability, c.plural);
                return (
                  <Tab
                    key={c.plural}
                    value={c.plural}
                    disabled={!available}
                    // Disabled tabs do not receive pointer events; re-enable them for the tooltip.
                    sx={{ '&.Mui-disabled': { pointerEvents: 'auto' } }}
                    icon={<Icon icon={c.icon} width={18} />}
                    iconPosition="start"
                    label={
                      available ? (
                        t(c.tabLabel)
                      ) : (
                        <Tooltip
                          title={t('The {{kind}} CRD is not installed in this cluster', {
                            kind: c.kind,
                          })}
                        >
                          <span>{t(c.tabLabel)}</span>
                        </Tooltip>
                      )
                    }
                  />
                );
              })}
            </Tabs>
            {!current || !List ? (
              <NotInstalled title={t(info.label)} />
            ) : (
              // Remount per kind so list state (filters, pagination) does not leak between tabs.
              <List key={current.plural} />
            )}
          </Box>
        );
      }}
    </CRDGate>
  );
}
