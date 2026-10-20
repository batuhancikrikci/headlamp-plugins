import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Typography,
} from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import {
  CiliumClusterwideEnvoyConfig,
  CiliumEnvoyConfig,
  EnvoyBackendServiceRef,
  envoyResourceKind,
  EnvoyServiceRef,
} from '../../resources/network';
import { crd } from '../../resources/registry';
import { selectorToString } from '../../utils/selectors';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { SelectorView, StringArray } from '../common/Shared';
import { CiliumDetailView, CiliumListView, Column } from '../common/Views';

type EnvoyConfig = CiliumEnvoyConfig | CiliumClusterwideEnvoyConfig;

function serviceLabel(ref: { name: string; namespace?: string }): string {
  return ref.namespace ? `${ref.namespace}/${ref.name}` : ref.name;
}

function kindChips(config: EnvoyConfig): string[] {
  return Object.entries(config.resourceKinds).map(([kind, n]) => (n > 1 ? `${kind} × ${n}` : kind));
}

function useEnvoyColumns(): Array<Column<EnvoyConfig>> {
  const { t } = useText();
  return [
    {
      id: 'services',
      label: t('Services'),
      render: (config: EnvoyConfig) => (
        <StringArray items={(config.spec.services || []).map(serviceLabel)} max={3} />
      ),
      getValue: (config: EnvoyConfig) => (config.spec.services || []).map(serviceLabel).join(', '),
    },
    {
      id: 'backendServices',
      label: t('Backend services'),
      render: (config: EnvoyConfig) => (
        <StringArray items={(config.spec.backendServices || []).map(serviceLabel)} max={3} />
      ),
      getValue: (config: EnvoyConfig) =>
        (config.spec.backendServices || []).map(serviceLabel).join(', '),
    },
    {
      id: 'resources',
      label: t('Envoy resources'),
      render: (config: EnvoyConfig) => <StringArray items={kindChips(config)} max={4} />,
      getValue: (config: EnvoyConfig) => kindChips(config).join(', '),
    },
    {
      id: 'nodeSelector',
      label: t('Node selector'),
      render: (config: EnvoyConfig) => (
        <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />
      ),
      getValue: (config: EnvoyConfig) => selectorToString(config.spec.nodeSelector),
      show: false,
    },
  ];
}

export function EnvoyConfigList() {
  return <CiliumListView crd={crd('CiliumEnvoyConfig')} columns={useEnvoyColumns()} />;
}

export function ClusterwideEnvoyConfigList() {
  return <CiliumListView crd={crd('CiliumClusterwideEnvoyConfig')} columns={useEnvoyColumns()} />;
}

function ServiceRef({ name, namespace }: { name: string; namespace?: string }) {
  return <ResourceRefLink kind="Service" name={name} namespace={namespace} qualified />;
}

function EnvoyConfigDetailView({
  kind,
}: {
  kind: 'CiliumEnvoyConfig' | 'CiliumClusterwideEnvoyConfig';
}) {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd(kind)}
      extraInfo={(config: EnvoyConfig) => [
        { name: t('Envoy resources'), value: <StringArray items={kindChips(config)} /> },
        {
          name: t('Node selector'),
          value: <SelectorView selector={config.spec.nodeSelector} emptyLabel={t('All nodes')} />,
        },
      ]}
      sections={(config: EnvoyConfig) => {
        const namespace = config.metadata.namespace;
        return [
          {
            id: 'cilium-envoy-services',
            section: (
              <SectionBox title={t('Services')}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t(
                    'Traffic to these services is redirected to the Envoy listener; backend services only have their endpoints synced to Envoy.'
                  )}
                </Typography>
                <SimpleTable
                  emptyMessage={t('No services are redirected to Envoy.')}
                  data={config.spec.services || []}
                  columns={[
                    {
                      label: t('Redirected service'),
                      getter: (s: EnvoyServiceRef) => (
                        <ServiceRef name={s.name} namespace={s.namespace || namespace} />
                      ),
                    },
                    {
                      label: t('Listener'),
                      getter: (s: EnvoyServiceRef) => s.listener || t('First'),
                    },
                    {
                      label: t('Ports'),
                      getter: (s: EnvoyServiceRef) =>
                        s.ports?.length ? s.ports.join(', ') : t('All'),
                    },
                  ]}
                />
                {!!config.spec.backendServices?.length && (
                  <SimpleTable
                    data={config.spec.backendServices}
                    columns={[
                      {
                        label: t('Backend service'),
                        getter: (s: EnvoyBackendServiceRef) => (
                          <ServiceRef name={s.name} namespace={s.namespace || namespace} />
                        ),
                      },
                      {
                        label: t('Ports'),
                        getter: (s: EnvoyBackendServiceRef) =>
                          s.number?.length ? s.number.join(', ') : t('All'),
                      },
                    ]}
                  />
                )}
              </SectionBox>
            ),
          },
          {
            id: 'cilium-envoy-resources',
            section: (
              <SectionBox title={t('Envoy resources')}>
                {config.resources.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('No Envoy resources defined.')}
                  </Typography>
                )}
                {config.resources.map((resource, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Accordion key={index} variant="outlined" disableGutters>
                    <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={envoyResourceKind(resource)}
                        />
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {resource.name || t('(unnamed)')}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <CodeBlock value={resource} maxHeight={480} />
                    </AccordionDetails>
                  </Accordion>
                ))}
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}

export function EnvoyConfigDetail() {
  return <EnvoyConfigDetailView kind="CiliumEnvoyConfig" />;
}

export function ClusterwideEnvoyConfigDetail() {
  return <EnvoyConfigDetailView kind="CiliumClusterwideEnvoyConfig" />;
}
