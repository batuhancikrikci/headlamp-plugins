/**
 * The standard list and detail pages every kind is built from: availability gate, live data for
 * relationships, status column / sections, create and edit actions.
 */
import { DetailsGrid, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import {
  CoreKind,
  GatewayApiData,
  GatewayApiDataValue,
  useGatewayApiData,
} from '../../data/GatewayApiData';
import { CRDGate } from '../../discovery/CRDGate';
import { servedApiVersion } from '../../discovery/discovery';
import { classOf, ensureInstance, GatewayApiObject } from '../../resources/classes';
import { kindInfo, KindName } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { computeHealth } from '../../utils/conditions';
import { CreateMenu, EditWithFormAction } from '../editor/EditActions';
import { HEALTH_ORDER, HealthChip, ProblemsAlert } from './Status';
import {
  AncestorsSection,
  DeniedReferencesAlert,
  ObjectConditionsSection,
  ParentsSection,
} from './StatusSections';

type ListColumns = React.ComponentProps<typeof ResourceListView>['columns'];

/** A table column for objects of type `T`. */
export interface ListColumn<T> {
  id: string;
  label: string;
  getValue: (item: T) => string | number | null | undefined;
  render?: (item: T) => React.ReactNode;
  sort?: boolean | ((a: T, b: T) => number);
  gridTemplate?: string | number;
  show?: boolean;
}

export interface NameValueRow {
  name: string;
  value: React.ReactNode;
  hide?: boolean;
}

export interface DetailSection {
  id: string;
  section: React.ReactNode;
}

/** JSON of an item, whichever class (this plugin's or Headlamp's built-in one) it is of. */
function jsonOf(item: { jsonData: unknown }): KubeJson {
  return item.jsonData as KubeJson;
}

function statusColumn<T extends GatewayApiObject>(): ListColumn<T> {
  return {
    id: 'status',
    label: 'Status',
    getValue: item => computeHealth(jsonOf(item)).label,
    render: item => <HealthChip health={computeHealth(jsonOf(item))} />,
    sort: (a, b) =>
      HEALTH_ORDER[computeHealth(jsonOf(a)).level] - HEALTH_ORDER[computeHealth(jsonOf(b)).level],
  };
}

export interface KindListViewProps<T extends GatewayApiObject> {
  kind: KindName;
  /** Columns between Name/Namespace and Status/Age. */
  columns: (data: GatewayApiDataValue) => ListColumn<T>[];
  /** Other Gateway API kinds the columns relate to. */
  related?: KindName[];
  core?: CoreKind[];
  /** Extra buttons next to the create menu. */
  actions?: React.ReactNode;
}

function ListInner<T extends GatewayApiObject>({ kind, columns, actions }: KindListViewProps<T>) {
  const info = kindInfo(kind);
  const data = useGatewayApiData();
  const cls = classOf(kind);

  const allColumns = [
    'name' as const,
    ...(info.namespaced ? ['namespace' as const] : []),
    // The table may hold instances of Headlamp's built-in class (shared query cache); the
    // columns always get an instance of this plugin's class.
    ...columns(data).map(column => ({
      ...column,
      getValue: (item: T) => column.getValue(ensureInstance<T>(kind, item)),
      render: column.render
        ? (item: T) => column.render!(ensureInstance<T>(kind, item))
        : undefined,
    })),
    ...(info.statusModel !== 'none' ? [statusColumn<T>()] : []),
    'age' as const,
  ];

  return (
    <ResourceListView
      title={info.labelPlural}
      resourceClass={cls as unknown as KubeObjectClass}
      id={`gateway-api-${info.plural}`}
      headerProps={{
        noNamespaceFilter: !info.namespaced,
        titleSideActions: [
          <Box key="actions" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DocsDrawer apiVersion={servedApiVersion(info)} kind={kind} iconOnly />
            {actions}
            <CreateMenu kind={kind} />
          </Box>,
        ],
      }}
      // ResourceListView types its columns for any KubeObject; the rows are instances of this
      // kind's class, which is what the columns above expect.
      columns={allColumns as unknown as ListColumns}
    />
  );
}

/** List page of one kind. */
export function KindListView<T extends GatewayApiObject>(props: KindListViewProps<T>) {
  const info = kindInfo(props.kind);
  return (
    <CRDGate title={info.labelPlural} kind={props.kind}>
      {availability => (
        <GatewayApiData
          availability={availability}
          kinds={props.related || []}
          core={props.core || []}
        >
          <ListInner {...props} />
        </GatewayApiData>
      )}
    </CRDGate>
  );
}

export interface KindDetailViewProps<T extends GatewayApiObject> {
  kind: KindName;
  related?: KindName[];
  core?: CoreKind[];
  extraInfo?: (item: T, data: GatewayApiDataValue) => NameValueRow[];
  sections?: (item: T, data: GatewayApiDataValue) => DetailSection[];
}

function statusSections(kind: KindName, obj: KubeJson, data: GatewayApiDataValue): DetailSection[] {
  const info = kindInfo(kind);
  switch (info.statusModel) {
    case 'conditions':
      return [{ id: 'gwapi-conditions', section: <ObjectConditionsSection obj={obj} /> }];
    case 'parents':
      return [{ id: 'gwapi-parents', section: <ParentsSection route={obj} data={data} /> }];
    case 'ancestors':
      return [{ id: 'gwapi-ancestors', section: <AncestorsSection policy={obj} /> }];
    default:
      return [];
  }
}

function DetailInner<T extends GatewayApiObject>({
  kind,
  extraInfo,
  sections,
}: KindDetailViewProps<T>) {
  const info = kindInfo(kind);
  const data = useGatewayApiData();
  const { name, namespace } = useParams<{ name: string; namespace?: string }>();
  const cls = classOf(kind) as unknown as KubeObjectClass;

  return (
    <DetailsGrid
      resourceType={cls}
      name={name}
      namespace={info.namespaced ? namespace : undefined}
      withEvents
      headerSection={item =>
        item ? (
          <>
            <ProblemsAlert health={computeHealth(jsonOf(item))} />
            <DeniedReferencesAlert obj={jsonOf(item)} data={data} />
          </>
        ) : null
      }
      actions={item =>
        item
          ? [
              // The documentation marks the fields that are set on this object.
              <DocsDrawer
                key="docs"
                apiVersion={jsonOf(item).apiVersion || servedApiVersion(info)}
                kind={kind}
                getValue={() => jsonOf(item)}
                iconOnly
              />,
              <EditWithFormAction key="edit" item={item} />,
            ]
          : []
      }
      extraInfo={item =>
        item
          ? [
              {
                name: 'Status',
                value: <HealthChip health={computeHealth(jsonOf(item))} />,
                hide: info.statusModel === 'none',
              },
              ...(extraInfo ? extraInfo(ensureInstance<T>(kind, item), data) : []),
            ]
          : null
      }
      extraSections={item =>
        item
          ? [
              ...(sections ? sections(ensureInstance<T>(kind, item), data) : []),
              ...statusSections(kind, jsonOf(item), data),
            ]
          : []
      }
    />
  );
}

/** Detail page of one kind. */
export function KindDetailView<T extends GatewayApiObject>(props: KindDetailViewProps<T>) {
  const info = kindInfo(props.kind);
  return (
    <CRDGate title={info.label} kind={props.kind}>
      {availability => (
        <GatewayApiData
          availability={availability}
          kinds={props.related || []}
          core={props.core || []}
        >
          <DetailInner {...props} />
        </GatewayApiData>
      )}
    </CRDGate>
  );
}
