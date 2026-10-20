import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  Link,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { GatewayConfig } from '../../resources/gatewayConfig';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  ConditionsTable,
  KeyValueBlock,
  LLMRequestCostsSection,
  StructuredValue,
} from '../common/SharedComponents';
import { GATEWAY_CONFIG_ANNOTATION } from './gatewayConfigForm';

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: { name: string; key: string };
    configMapKeyRef?: { name: string; key: string };
    fieldRef?: { fieldPath: string };
    resourceFieldRef?: { resource: string };
  };
}

export function GatewayConfigDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="Gateway Config">
      <DetailsGrid
        resourceType={GatewayConfig}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            {
              name: 'Forward Proxy',
              value: item.forwardProxyAddress,
            },
            { name: 'Global Cost Metrics', value: String(item.costCount) },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'extProc',
              section: item.hasExtProc && <ExtProcSection config={item} />,
            },
            {
              id: 'globalCosts',
              section: item.costCount > 0 && (
                <LLMRequestCostsSection
                  title="Global LLM Request Costs"
                  costs={item.spec?.globalLLMRequestCosts || []}
                />
              ),
            },
            {
              id: 'gateways',
              section: <AttachedGatewaysSection config={item} />,
            },
            {
              id: 'conditions',
              section: (
                <SectionBox title="Conditions">
                  <ConditionsTable conditions={item.conditions} />
                </SectionBox>
              ),
            },
          ]
        }
      />
    </WithVersionDiscovery>
  );
}

/** Human-readable source of an env var's valueFrom (secret/configmap/field/resource ref). */
function describeValueFrom(from: EnvVar['valueFrom']): string {
  if (!from) return '-';
  if (from.secretKeyRef) return `secret ${from.secretKeyRef.name}/${from.secretKeyRef.key}`;
  if (from.configMapKeyRef) {
    return `configmap ${from.configMapKeyRef.name}/${from.configMapKeyRef.key}`;
  }
  if (from.fieldRef) return `field ${from.fieldRef.fieldPath}`;
  if (from.resourceFieldRef) return `resource ${from.resourceFieldRef.resource}`;
  return JSON.stringify(from);
}

function ExtProcSection({ config }: { config: GatewayConfig }) {
  const container = (config.spec?.extProc?.kubernetes || {}) as Record<string, unknown> & {
    env?: EnvVar[];
  };
  const { env, ...rest } = container;

  const rows = [
    ...(env && env.length > 0
      ? [
          {
            name: 'env',
            value: (
              <Box>
                <Box sx={{ mb: 1.5 }}>
                  <Chip size="small" variant="outlined" label={`${env.length} variable(s)`} />
                </Box>
                <KeyValueBlock
                  entries={env.map(e => [
                    e.name,
                    e.value !== undefined ? e.value : describeValueFrom(e.valueFrom),
                  ])}
                />
              </Box>
            ),
          },
        ]
      : []),
    ...Object.entries(rest).map(([key, value]) => ({
      name: key,
      value: <StructuredValue value={value} />,
    })),
  ];

  return (
    <SectionBox title="External Processor Container">
      {rows.length > 0 ? (
        <NameValueTable rows={rows} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Uses the controller defaults.
        </Typography>
      )}
    </SectionBox>
  );
}

function AttachedGatewaysSection({ config }: { config: GatewayConfig }) {
  const [gateways, error] = K8s.ResourceClasses.Gateway.useList({
    namespace: config.metadata.namespace,
  });
  const attached = (gateways || []).filter(
    gw => gw.metadata.annotations?.[GATEWAY_CONFIG_ANNOTATION] === config.metadata.name
  );

  return (
    <SectionBox title="Attached Gateways">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Gateways in this namespace that select this config via the{' '}
        <code>{GATEWAY_CONFIG_ANNOTATION}</code> annotation.
      </Typography>
      {error ? (
        <Typography variant="body2" color="text.secondary">
          Gateway API resources are not available on this cluster.
        </Typography>
      ) : gateways === null ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : attached.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No Gateway references this config.
        </Typography>
      ) : (
        <SimpleTable
          data={attached}
          columns={[
            {
              label: 'Gateway',
              getter: gw => <Link kubeObject={gw}>{gw.metadata.name}</Link>,
            },
            {
              label: 'Class',
              getter: gw => gw.jsonData.spec?.gatewayClassName || '-',
            },
          ]}
        />
      )}
    </SectionBox>
  );
}
