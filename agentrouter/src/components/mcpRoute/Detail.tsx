import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { MCPRoute, MCPRouteBackendRef } from '../../resources/mcpRoute';
import { backendsForMCPRoute } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  BackendRefChip,
  ConditionsTable,
  ObjectBlock,
  ParentRefChip,
  RelatedResourcesSection,
  SchemaChip,
  SecretRefLabel,
  StringArray,
} from '../common/SharedComponents';

const mono = { fontFamily: 'monospace' };

function toolSelectorSummary(ref: MCPRouteBackendRef): React.ReactNode {
  const ts = ref.toolSelector;
  if (!ts) return 'All tools';
  const parts: Array<[string, string[] | undefined]> = [
    ['include', ts.include],
    ['includeRegex', ts.includeRegex],
    ['exclude', ts.exclude],
    ['excludeRegex', ts.excludeRegex],
  ];
  return (
    <Box>
      {parts
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => (
          <Typography key={k} variant="body2" sx={mono}>
            {k}: {v!.join(', ')}
          </Typography>
        ))}
    </Box>
  );
}

function backendAuthSummary(ref: MCPRouteBackendRef): React.ReactNode {
  const key = ref.securityPolicy?.apiKey;
  if (!key) return '-';
  const where = key.header
    ? `header ${key.header}`
    : key.queryParam
    ? `query ?${key.queryParam}`
    : 'Authorization: Bearer';
  return (
    <Box>
      {key.secretRef ? (
        <SecretRefLabel secretRef={key.secretRef} />
      ) : (
        <Chip size="small" label="Inline key" />
      )}
      <Typography variant="caption" color="text.secondary" display="block">
        via {where}
      </Typography>
    </Box>
  );
}

export function MCPRouteDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="MCP Route">
      <DetailsGrid
        resourceType={MCPRoute}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            { name: 'Path', value: <Typography sx={mono}>{item.path}</Typography> },
            {
              name: 'Gateways',
              value:
                (item.spec?.parentRefs || []).length > 0 ? (
                  <Box>
                    {item.spec!.parentRefs!.map((ref, i) => (
                      <ParentRefChip key={i} parentRef={ref} />
                    ))}
                  </Box>
                ) : (
                  '-'
                ),
            },
            {
              name: 'Hostnames',
              value: item.hostnames.length > 0 ? <StringArray items={item.hostnames} /> : '*',
            },
            {
              name: 'Header Matches',
              value: (
                <Box>
                  {(item.spec?.headers || []).map((h, i) => (
                    <Typography key={i} variant="body2" sx={mono}>
                      {h.name} {h.type === 'RegularExpression' ? '~=' : '=='} {h.value}
                    </Typography>
                  ))}
                </Box>
              ),
              hide: !item.spec?.headers?.length,
            },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'backends',
              section: (
                <SectionBox title="MCP Servers">
                  <SimpleTable
                    data={item.spec?.backendRefs || []}
                    emptyMessage="No MCP servers configured."
                    columns={[
                      {
                        label: 'Backend',
                        getter: (ref: MCPRouteBackendRef) => <BackendRefChip backendRef={ref} />,
                      },
                      {
                        label: 'Path',
                        getter: (ref: MCPRouteBackendRef) => ref.path || '/mcp',
                      },
                      { label: 'Tools', getter: toolSelectorSummary },
                      { label: 'Upstream Auth', getter: backendAuthSummary },
                      {
                        label: 'Forwarded Headers',
                        getter: (ref: MCPRouteBackendRef) =>
                          ref.forwardHeaders?.length ? (
                            <StringArray
                              items={ref.forwardHeaders.map(h =>
                                h.backendHeader ? `${h.name} → ${h.backendHeader}` : h.name
                              )}
                            />
                          ) : (
                            '-'
                          ),
                      },
                    ]}
                  />
                </SectionBox>
              ),
            },
            {
              id: 'security',
              section: item.hasSecurityPolicy && <SecuritySection route={item} />,
            },
            {
              id: 'backendSelector',
              section: item.spec?.backendSelector && (
                <SectionBox title="Backend Selector">
                  <NameValueTable
                    rows={[
                      {
                        name: 'Default Action',
                        value: item.spec.backendSelector.defaultAction || 'Deny',
                      },
                      ...(item.spec.backendSelector.rules || []).map((r, i) => ({
                        name: `Rule #${i + 1} (${r.action || 'Allow'})`,
                        value: <Typography sx={mono}>{r.cel || '-'}</Typography>,
                      })),
                    ]}
                  />
                </SectionBox>
              ),
            },
            {
              id: 'relatedBackends',
              section: <SharedServiceBackends route={item} />,
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

function SecuritySection({ route }: { route: MCPRoute }) {
  const sp = route.spec?.securityPolicy;
  if (!sp) return null;
  const oauth = sp.oauth;
  const authz = sp.authorization;

  return (
    <SectionBox title="Client Security">
      <NameValueTable
        rows={[
          { name: 'OAuth Issuer', value: oauth?.issuer || '-', hide: !oauth },
          {
            name: 'OAuth Audiences',
            value: <StringArray items={oauth?.audiences} />,
            hide: !oauth?.audiences?.length,
          },
          {
            name: 'JWKS',
            value: oauth?.jwks?.remoteJWKS?.uri || (oauth?.jwks?.localJWKS ? 'Local JWKS' : '-'),
            hide: !oauth?.jwks,
          },
          {
            name: 'Protected Resource',
            value: oauth?.protectedResourceMetadata?.resource || '-',
            hide: !oauth,
          },
          {
            name: 'Supported Scopes',
            value: <StringArray items={oauth?.protectedResourceMetadata?.scopesSupported} />,
            hide: !oauth?.protectedResourceMetadata?.scopesSupported?.length,
          },
          {
            name: 'Claim → Header',
            value: (
              <StringArray
                items={(oauth?.claimToHeaders || []).map(c => `${c.claim} → ${c.header}`)}
              />
            ),
            hide: !oauth?.claimToHeaders?.length,
          },
          {
            name: 'API Key Auth',
            value: <ObjectBlock value={sp.apiKeyAuth} />,
            hide: !sp.apiKeyAuth,
          },
          { name: 'External Auth', value: <ObjectBlock value={sp.extAuth} />, hide: !sp.extAuth },
          {
            name: 'Authorization Default',
            value: authz?.defaultAction || 'Deny',
            hide: !authz,
          },
          ...(authz?.rules || []).map((r, i) => ({
            name: `Authorization Rule #${i + 1} (${r.action || 'Allow'})`,
            value: (
              <Box>
                {r.source?.jwt?.scopes?.length ? (
                  <Typography variant="body2">Scopes: {r.source.jwt.scopes.join(', ')}</Typography>
                ) : null}
                {r.target?.tools?.length ? (
                  <Typography variant="body2">
                    Tools: {r.target.tools.map(t => `${t.backend}/${t.tool}`).join(', ')}
                  </Typography>
                ) : null}
                {r.cel ? (
                  <Typography variant="body2" sx={mono}>
                    {r.cel}
                  </Typography>
                ) : null}
              </Box>
            ),
          })),
        ]}
      />
    </SectionBox>
  );
}

function SharedServiceBackends({ route }: { route: MCPRoute }) {
  const [backends] = AIServiceBackend.useList({ namespace: route.metadata.namespace });
  return (
    <RelatedResourcesSection
      title="Service Backends (Shared Envoy Backend)"
      description="AI Service Backends that sit on the same Envoy Gateway backends as this MCP Route."
      items={backends === null ? null : backendsForMCPRoute(route, backends)}
      emptyMessage="No Service Backend shares these Envoy Gateway backends."
      extraColumns={[
        {
          label: 'API Schema',
          getter: item => <SchemaChip schemaName={(item as AIServiceBackend).schemaName} />,
        },
      ]}
    />
  );
}
