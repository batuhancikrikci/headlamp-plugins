import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  ResourceListView,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, Link as MuiLink, Typography } from '@mui/material';
import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ComponentStatus, InstallStatus } from '../../api/ciliumInstall';
import {
  Availability,
  CRDMeta,
  isAvailable,
  ServedResource,
  unknownResources,
  versionDeprecation,
} from '../../api/discovery';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { dumpYaml } from '../../common/yaml';
import { useCiliumInstall } from '../../hooks/useCiliumInstall';
import { useCiliumDiscovery, useCRDMeta } from '../../hooks/useDiscovery';
import { CLUSTER_SCOPE_SEGMENT, genericClass } from '../../resources/generic';
import { CRDInfo, CRDS, groupById } from '../../resources/registry';
import { ADVANCED_ROUTE } from '../../routes';
import { CRDGate } from '../common/CRDGate';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { ConditionsTable, DeprecatedChip, HealthLabel } from '../common/Shared';
import { listURL } from '../common/Views';

interface InventoryRow {
  kind: string;
  plural: string;
  info?: CRDInfo;
  served?: ServedResource;
  meta?: CRDMeta;
}

function advancedURL(plural?: string): string {
  return Router.createRouteURL(ADVANCED_ROUTE, plural ? { plural } : {});
}

function shortVersion(groupVersion: string): string {
  return groupVersion.split('/').pop() || groupVersion;
}

function InventoryTable({ availability }: { availability: Availability }) {
  const { t } = useText();
  const metaState = useCRDMeta(availability);
  const meta = metaState.status === 'ready' ? metaState.meta : {};
  const rows: InventoryRow[] = [
    ...CRDS.map(info => ({
      kind: info.kind,
      plural: info.plural,
      info,
      served: availability.resources[info.plural],
      meta: meta[info.plural],
    })),
    ...unknownResources(availability).map(served => ({
      kind: served.kind,
      plural: served.plural,
      served,
      meta: meta[served.plural],
    })),
  ];

  return (
    <>
      {metaState.status === 'unavailable' && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {t(
            'Storage versions and deprecation flags are not shown because your user cannot read CustomResourceDefinition objects.'
          )}
        </Alert>
      )}
      <SimpleTable
        rowsPerPage={[50, 100]}
        data={rows}
        columns={[
          {
            label: t('Kind'),
            getter: (row: InventoryRow) =>
              row.info && row.served ? (
                <MuiLink component={RouterLink} to={listURL(row.info)}>
                  {row.kind}
                </MuiLink>
              ) : row.served ? (
                <MuiLink component={RouterLink} to={advancedURL(row.plural)}>
                  {row.kind}
                </MuiLink>
              ) : (
                row.kind
              ),
            sort: (a: InventoryRow, b: InventoryRow) => a.kind.localeCompare(b.kind),
          },
          {
            label: t('Area'),
            getter: (row: InventoryRow) =>
              row.info ? t(groupById(row.info.group).label) : t('Other'),
          },
          {
            label: t('Scope'),
            getter: (row: InventoryRow) =>
              (row.served ? row.served.namespaced : row.info?.namespaced)
                ? t('Namespaced')
                : t('Cluster'),
          },
          {
            label: t('Served versions'),
            getter: (row: InventoryRow) =>
              row.served ? (
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {row.served.versions.map((version, i) => (
                    <Chip
                      key={version}
                      size="small"
                      variant={i === 0 ? 'filled' : 'outlined'}
                      color={i === 0 ? 'primary' : 'default'}
                      label={shortVersion(version)}
                    />
                  ))}
                </Box>
              ) : (
                '-'
              ),
          },
          {
            label: t('Storage version'),
            getter: (row: InventoryRow) => row.meta?.versions.find(v => v.storage)?.name || '-',
          },
          {
            label: t('Status'),
            getter: (row: InventoryRow) => {
              if (!row.served) return <HealthLabel health="unknown" label={t('Not installed')} />;
              const deprecation = versionDeprecation(row.meta, row.served.versions[0]);
              if (row.info?.deprecated || deprecation) {
                return (
                  <DeprecatedChip note={row.info?.deprecationNote || deprecation || undefined} />
                );
              }
              return <HealthLabel health="success" label={t('Installed')} />;
            },
          },
        ]}
      />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {t('The highlighted version is the one this plugin reads and writes.')}
      </Typography>
    </>
  );
}

interface ServiceObject {
  jsonData: { metadata: { name: string; namespace?: string; labels?: Record<string, string> } };
}

interface HubbleRow {
  component: ComponentStatus;
  /** Value of the k8s-app label of the component's service. */
  app: string;
}

/**
 * Hubble Relay and UI status. Flow data itself is not shown: it is only available over the
 * Hubble Relay gRPC API.
 */
function HubbleStatus({ install }: { install: InstallStatus }) {
  const { t } = useText();
  const [services] = K8s.ResourceClasses.Service.useList({
    namespace: install.namespace,
    labelSelector: 'k8s-app in (hubble-ui,hubble-relay)',
  });
  const serviceOf = (app: string) =>
    ((services || []) as ServiceObject[]).find(
      s => s.jsonData.metadata.labels?.['k8s-app'] === app
    );
  const rows: HubbleRow[] = [
    { component: install.components.hubbleRelay, app: 'hubble-relay' },
    { component: install.components.hubbleUI, app: 'hubble-ui' },
  ];

  return (
    <SectionBox title="Hubble">
      <SimpleTable
        data={rows}
        columns={[
          { label: t('Component'), getter: (row: HubbleRow) => t(row.component.info.label) },
          {
            label: t('Status'),
            getter: (row: HubbleRow) => {
              const { ready, total } = row.component;
              if (total === 0) return <HealthLabel health="unknown" label={t('Not deployed')} />;
              return (
                <HealthLabel
                  health={ready === total ? 'success' : ready === 0 ? 'error' : 'warning'}
                  label={ready === total ? t('Ready') : t('Degraded')}
                />
              );
            },
          },
          {
            label: t('Pods ready'),
            getter: (row: HubbleRow) =>
              row.component.total ? `${row.component.ready}/${row.component.total}` : '-',
          },
          { label: t('Version'), getter: (row: HubbleRow) => row.component.versions[0] || '-' },
          {
            label: t('Service'),
            getter: (row: HubbleRow) => {
              const service = serviceOf(row.app);
              return service ? (
                <ResourceRefLink
                  kind="Service"
                  name={service.jsonData.metadata.name}
                  namespace={service.jsonData.metadata.namespace}
                  qualified
                />
              ) : (
                '-'
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}

function GenericList({ resource }: { resource: ServedResource }) {
  return (
    <ResourceListView
      title={resource.kind}
      resourceClass={genericClass(resource)}
      backLink={advancedURL()}
      columns={['name', ...(resource.namespaced ? (['namespace'] as const) : []), 'age']}
    />
  );
}

/** Advanced page: API inventory, plus generic lists for kinds without dedicated views. */
export function AdvancedPage() {
  const { t } = useText();
  const { plural } = useParams<{ plural?: string }>();
  const discovery = useCiliumDiscovery();
  const { install } = useCiliumInstall();

  return (
    <CRDGate title={t('Advanced')}>
      {availability => {
        if (plural) {
          const resource = availability.resources[plural];
          return resource ? (
            <GenericList resource={resource} />
          ) : (
            <SectionBox title={plural} backLink={advancedURL()}>
              <EmptyState
                icon="mdi:package-variant-remove"
                title={t('The resource {{plural}} is not served by this cluster', { plural })}
              />
            </SectionBox>
          );
        }
        const others = unknownResources(availability);
        const installed = CRDS.filter(info => isAvailable(availability, info.plural)).length;
        return (
          // Bottom padding keeps the last section clear of the window edge.
          <Box sx={{ pb: 8 }}>
            <SectionBox
              title={t('Cilium API inventory')}
              headerProps={{
                actions: [
                  <Button
                    key="refresh"
                    size="small"
                    startIcon={<Icon icon="mdi:refresh" />}
                    onClick={() => discovery.status === 'ready' && discovery.refresh()}
                  >
                    {t('Rediscover')}
                  </Button>,
                ],
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t(
                  '{{installed}} of {{total}} supported CRDs are installed. Cilium registers some CRDs only when the related feature is enabled.',
                  { installed, total: CRDS.length }
                )}
              </Typography>
              <InventoryTable availability={availability} />
            </SectionBox>
            {others.length > 0 && (
              <SectionBox title={t('Other Cilium resources')}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t(
                    'Kinds in the cilium.io group without dedicated views in this plugin. They can be listed, viewed and edited as YAML.'
                  )}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {others.map(resource => (
                    <Chip
                      key={resource.plural}
                      clickable
                      component={RouterLink}
                      to={advancedURL(resource.plural)}
                      icon={<Icon icon="mdi:file-document-outline" width={16} />}
                      label={`${resource.kind} (${shortVersion(resource.versions[0])})`}
                    />
                  ))}
                </Box>
              </SectionBox>
            )}
            {install?.found && <HubbleStatus install={install} />}
          </Box>
        );
      }}
    </CRDGate>
  );
}

/** Detail page for a cilium.io kind without a dedicated view: metadata, conditions, YAML. */
export function GenericResourceDetail() {
  const { t } = useText();
  const { plural, namespace, name } = useParams<{
    plural: string;
    namespace: string;
    name: string;
  }>();
  return (
    <CRDGate title={plural}>
      {availability => {
        const resource = availability.resources[plural];
        if (!resource) {
          return (
            <SectionBox title={plural} backLink={advancedURL()}>
              <EmptyState
                icon="mdi:package-variant-remove"
                title={t('The resource {{plural}} is not served by this cluster', { plural })}
              />
            </SectionBox>
          );
        }
        return (
          <DetailsGrid
            resourceType={genericClass(resource)}
            name={name}
            namespace={
              resource.namespaced && namespace !== CLUSTER_SCOPE_SEGMENT ? namespace : undefined
            }
            withEvents
            backLink={advancedURL(plural)}
            extraSections={item =>
              item
                ? [
                    {
                      id: 'cilium-generic-conditions',
                      section: !!item.conditions?.length && (
                        <SectionBox title={t('Conditions')}>
                          <ConditionsTable conditions={item.conditions} />
                        </SectionBox>
                      ),
                    },
                    {
                      id: 'cilium-generic-spec',
                      section: (
                        <SectionBox title={t('Specification')}>
                          <CodeBlock value={dumpYaml(item.jsonData.spec ?? {})} maxHeight={600} />
                        </SectionBox>
                      ),
                    },
                    {
                      id: 'cilium-generic-status',
                      section: !!item.jsonData.status && (
                        <SectionBox title={t('Status')}>
                          <CodeBlock value={dumpYaml(item.jsonData.status)} maxHeight={600} />
                        </SectionBox>
                      ),
                    },
                  ]
                : []
            }
          />
        );
      }}
    </CRDGate>
  );
}
