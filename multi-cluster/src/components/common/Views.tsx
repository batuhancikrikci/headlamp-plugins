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
import { Alert, Box, Tab, Tabs, Tooltip } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { versionDeprecation } from '../../api/capabilities';
import { chosenApiVersion, kindState } from '../../api/discovery';
import { SectionId } from '../../api/kinds';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { useText } from '../../common/i18n';
import { NotInstalled } from '../../common/States';
import { useAvailability, useCRDOf } from '../../hooks/useDiscovery';
import type { OcmObject } from '../../resources/base';
import {
  crdByKind as crdByKindSafe,
  CRDInfo,
  crdsOfSection,
  sectionById,
  sectionRouteName,
} from '../../resources/registry';
import { EDITING } from '../editing';
import { CRDGate } from './CRDGate';
import { CreateResourceMenu, EditWithFormAction } from './form/EditActions';
import { ConditionsTable } from './Shared';
import { YamlSection } from './YamlSection';

/** Objects of every kind: the resource classes are built from the registry (see makeClass). */
export type Item = OcmObject;
/** A list column: a built-in one by name, or one that reads the row object. */
export type Column = ColumnType | ResourceTableColumn<Item>;

/** URL of a section page, optionally with one of its tabs selected. */
export function sectionURL(section: SectionId, plural?: string): string {
  return Router.createRouteURL(sectionRouteName(section), plural ? { plural } : {});
}

export function listURL(info: CRDInfo): string {
  return sectionURL(info.section, info.plural);
}

/** Warns about legacy kinds and about API versions the CRD marks as deprecated. */
export function DeprecationNotice({ info }: { info: CRDInfo }) {
  const availability = useAvailability();
  const crdState = useCRDOf(info.kind);
  const apiVersion = chosenApiVersion(availability, info);
  const runtime = crdState.status === 'ready' ? versionDeprecation(crdState.crd, apiVersion) : null;
  if (!info.legacy && !runtime) return null;
  return (
    <Alert severity="warning" icon={<Icon icon="mdi:alert-outline" />} sx={{ mb: 2 }}>
      {info.legacy || runtime}
    </Alert>
  );
}

/**
 * Standard list page: availability gate, legacy notice, documentation and create actions, and
 * the common name / namespace / age columns around the kind-specific ones.
 */
export function OcmListView({
  info,
  columns,
  title,
  filterFunction,
  notice,
}: {
  info: CRDInfo;
  columns: Column[];
  title?: string;
  /** Only rows for which this returns true are listed. */
  filterFunction?: (item: Item) => boolean;
  /** Content shown above the table (e.g. an explanation of the filter). */
  notice?: React.ReactNode;
}) {
  const { t } = useText();
  const heading = title || t(info.labelPlural);
  const editing = EDITING[info.kind] || {};
  const creatable = !info.readOnly;
  return (
    <CRDGate title={heading} kind={info.kind}>
      {availability => (
        <>
          <DeprecationNotice info={info} />
          {notice}
          <ResourceListView
            title={heading}
            resourceClass={info.cls}
            headerProps={{
              titleSideActions: [
                <Box key="actions" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DocsDrawer kind={info.kind} apiVersion={chosenApiVersion(availability, info)} />
                  {creatable && <CreateResourceMenu crd={info} editing={editing} />}
                </Box>,
              ],
            }}
            columns={[
              'name' as const,
              ...(info.namespaced ? ['namespace' as const] : []),
              ...columns,
              'age' as const,
            ]}
            enableRowActions={creatable}
            enableRowSelection={creatable}
            filterFunction={filterFunction}
          />
        </>
      )}
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
 * Standard detail page: gate, legacy notice, documentation / form-edit / custom actions,
 * kind-specific info rows and sections, conditions, a YAML section and events.
 */
export function OcmDetailView({
  info,
  extraInfo,
  sections,
  actions,
  conditions = true,
}: {
  info: CRDInfo;
  extraInfo?: (item: Item) => InfoRow[];
  sections?: (item: Item) => DetailSection[];
  /** Extra header actions (accept, approve, pause, ...). */
  actions?: (item: Item) => React.ReactNode[];
  /** Render `status.conditions` as a section. */
  conditions?: boolean;
}) {
  const { t } = useText();
  const { name, namespace } = useParams<{ name: string; namespace?: string }>();
  const Form = info.readOnly ? undefined : EDITING[info.kind]?.Form;
  return (
    <CRDGate title={t(info.label)} kind={info.kind}>
      <DeprecationNotice info={info} />
      <DetailsGrid
        resourceType={info.cls}
        name={name}
        namespace={info.namespaced ? namespace : undefined}
        withEvents
        backLink={listURL(info)}
        actions={item =>
          item
            ? [
                ...(actions ? actions(item) : []),
                <DocsDrawer
                  key="docs"
                  kind={info.kind}
                  apiVersion={item.jsonData.apiVersion}
                  getValue={() => item.jsonData}
                />,
                <EditWithFormAction key="edit-form" item={item} Form={Form} />,
              ]
            : []
        }
        extraInfo={item => (item && extraInfo ? extraInfo(item).filter(r => !r.hide) : [])}
        extraSections={item =>
          item
            ? [
                ...(sections ? sections(item) : []),
                ...(conditions
                  ? [
                      {
                        id: 'mch-conditions',
                        section: (
                          <SectionBox title={t('Conditions')}>
                            <ConditionsTable conditions={item.conditions} />
                          </SectionBox>
                        ),
                      },
                    ]
                  : []),
                {
                  id: 'mch-yaml',
                  section: <YamlSection item={item} Form={Form} readOnly={info.readOnly} />,
                },
              ]
            : []
        }
      />
    </CRDGate>
  );
}

/**
 * Page of a sidebar section: one tab per kind, selected through the URL so every list is
 * deep-linkable. Tabs of kinds that are not installed (or served in an unsupported version) are
 * disabled with an explanation.
 */
export function SectionPage({
  section,
  lists,
  header,
  extraTabs = [],
}: {
  section: SectionId;
  lists: Record<string, React.ComponentType>;
  /** Content above the tabs (e.g. section actions). */
  header?: React.ReactNode;
  /** Non-CRD tabs shown after the kind tabs. */
  extraTabs?: Array<{
    id: string;
    label: string;
    icon: string;
    requires: string;
    Component: React.ComponentType;
  }>;
}) {
  const { t } = useText();
  const history = useHistory();
  const { plural } = useParams<{ plural?: string }>();
  const info = sectionById(section);
  const crds = crdsOfSection(section);
  return (
    <CRDGate title={t(info.label)}>
      {availability => {
        const state = (c: CRDInfo) => kindState(availability, c).status;
        const installed = crds.filter(c => state(c) === 'available');
        // Legacy kinds only get a tab when the cluster still serves them.
        const visible = crds.filter(c => !c.legacy || state(c) !== 'missing');
        const extras = extraTabs.filter(x => {
          const required = crds.find(c => c.kind === x.requires) || crdByKindSafe(x.requires);
          return !required || state(required) === 'available';
        });
        const extra = extras.find(x => x.id === plural);
        const current = extra
          ? undefined
          : crds.find(c => c.plural === plural) || installed[0] || visible[0];
        const List = extra ? extra.Component : current ? lists[current.kind] : undefined;
        return (
          <Box>
            {header}
            <Tabs
              value={extra?.id ?? current?.plural ?? false}
              onChange={(_, next: string) => history.push(sectionURL(section, next))}
              variant="scrollable"
              scrollButtons="auto"
              aria-label={t(info.label)}
              sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
              {visible.map(c => {
                const s = state(c);
                const available = s === 'available';
                return (
                  <Tab
                    key={c.plural}
                    value={c.plural}
                    disabled={!available}
                    sx={{ '&.Mui-disabled': { pointerEvents: 'auto' } }}
                    icon={<Icon icon={c.icon} width={18} />}
                    iconPosition="start"
                    label={
                      available ? (
                        t(c.tabLabel)
                      ) : (
                        <Tooltip
                          title={
                            s === 'unsupported'
                              ? t(
                                  '{{kind}} is served in an API version this plugin does not support',
                                  { kind: c.kind }
                                )
                              : t('{{kind}} is not installed in this cluster', { kind: c.kind })
                          }
                        >
                          <span>{t(c.tabLabel)}</span>
                        </Tooltip>
                      )
                    }
                  />
                );
              })}
              {extras.map(x => (
                <Tab
                  key={x.id}
                  value={x.id}
                  icon={<Icon icon={x.icon} width={18} />}
                  iconPosition="start"
                  label={t(x.label)}
                />
              ))}
            </Tabs>
            {!List ? (
              <NotInstalled title={t(info.label)} />
            ) : (
              // Remount per kind so list state (filters, pagination) does not leak between tabs.
              <List key={extra?.id || current?.plural} />
            )}
          </Box>
        );
      }}
    </CRDGate>
  );
}
