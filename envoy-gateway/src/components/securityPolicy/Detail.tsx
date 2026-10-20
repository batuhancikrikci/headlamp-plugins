import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { crdByKind } from '../../resources/registry';
import { extAuthBackendRefs, SecurityPolicy } from '../../resources/securityPolicy';
import { API_GROUP, BackendRef, ObjectRef } from '../../resources/types';
import { ResourceRefLink, ResourceRefList } from '../common/ResourceRefLink';
import { FeatureChips, StringArray, TargetRefsList, useYesNo } from '../common/SharedComponents';
import { EGDetailView, SpecTabs } from '../common/Views';
import { EDITING } from '../editing';
import { spFeatures } from '../features';

function secretLink(ref: ObjectRef | undefined, ns?: string) {
  if (!ref?.name) return '-';
  return (
    <ResourceRefLink
      group={ref.group || ''}
      kind={ref.kind || 'Secret'}
      name={ref.name}
      namespace={ref.namespace || ns}
      hideKind
    />
  );
}

function backendRefList(refs: BackendRef[], ns?: string) {
  return (
    <ResourceRefList
      refs={refs.map(r => ({
        group: r.kind === 'Backend' ? r.group || API_GROUP : r.group || '',
        kind: r.kind || 'Service',
        name: r.name,
        namespace: r.namespace || ns,
        port: r.port,
      }))}
    />
  );
}

function Sub({ children }: React.PropsWithChildren<unknown>) {
  return (
    <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5, '&:first-of-type': { mt: 0 } }}>
      {children}
    </Typography>
  );
}

export function SecurityPolicyDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('SecurityPolicy')!}
      editing={EDITING.SecurityPolicy}
      extraInfo={(item: SecurityPolicy) => [
        {
          name: t('Targets'),
          value: (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
        },
        { name: t('Features'), value: <FeatureChips features={spFeatures(item, t)} /> },
      ]}
      sections={(item: SecurityPolicy) => {
        const s = item.spec;
        const ns = item.metadata.namespace;
        const ext = s.extAuth;
        const extSvc = ext?.grpc || ext?.http;
        return [
          {
            id: 'eg-sp-config',
            section: (
              <SpecTabs
                title={t('Configuration')}
                tabs={[
                  {
                    label: t('Authentication'),
                    content: item.authMethods.length > 0 && (
                      <Box>
                        {s.jwt && (
                          <>
                            <Sub>JWT</Sub>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Allow requests without a token'),
                                  value: yesNo(s.jwt.optional, true),
                                },
                                ...(s.jwt.providers || []).map(p => ({
                                  name: t('Provider: {{name}}', { name: p.name }),
                                  value: (
                                    <Box>
                                      <div>
                                        {t('Issuer')}: {p.issuer || '*'}
                                      </div>
                                      <div>
                                        JWKS:{' '}
                                        {p.remoteJWKS?.uri || (p.localJWKS ? t('local') : '-')}
                                      </div>
                                      {!!p.audiences?.length && (
                                        <div>
                                          {t('Audiences')}: {p.audiences.join(', ')}
                                        </div>
                                      )}
                                      {!!p.claimToHeaders?.length && (
                                        <div>
                                          {t('Claims → headers')}:{' '}
                                          {p.claimToHeaders
                                            .map(c => `${c.claim} → ${c.header}`)
                                            .join(', ')}
                                        </div>
                                      )}
                                    </Box>
                                  ),
                                })),
                              ]}
                            />
                          </>
                        )}
                        {s.oidc && (
                          <>
                            <Sub>OIDC</Sub>
                            <NameValueTable
                              rows={[
                                { name: t('Issuer'), value: s.oidc.provider?.issuer || '-' },
                                { name: t('Client ID'), value: s.oidc.clientID || '-' },
                                {
                                  name: t('Client secret'),
                                  value: secretLink(s.oidc.clientSecret, ns),
                                },
                                { name: t('Redirect URL'), value: s.oidc.redirectURL || '-' },
                                { name: t('Logout path'), value: s.oidc.logoutPath || '-' },
                                { name: t('Scopes'), value: <StringArray items={s.oidc.scopes} /> },
                                {
                                  name: t('Forward access token to the backend'),
                                  value: yesNo(s.oidc.forwardAccessToken, true),
                                },
                              ]}
                            />
                          </>
                        )}
                        {s.basicAuth && (
                          <>
                            <Sub>{t('Basic auth')}</Sub>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Users Secret'),
                                  value: secretLink(s.basicAuth.users, ns),
                                },
                                {
                                  name: t('Forward username header'),
                                  value: s.basicAuth.forwardUsernameHeader || '-',
                                },
                              ]}
                            />
                          </>
                        )}
                        {s.apiKeyAuth && (
                          <>
                            <Sub>{t('API key')}</Sub>
                            <NameValueTable
                              rows={[
                                {
                                  name: t('Credential Secrets'),
                                  value: (
                                    <ResourceRefList
                                      refs={(s.apiKeyAuth.credentialRefs || []).map(r => ({
                                        group: r.group || '',
                                        kind: r.kind || 'Secret',
                                        name: r.name,
                                        namespace: r.namespace || ns,
                                      }))}
                                    />
                                  ),
                                },
                                {
                                  name: t('Read the key from headers'),
                                  value: (
                                    <StringArray
                                      items={(s.apiKeyAuth.extractFrom || []).flatMap(
                                        e => e.headers || []
                                      )}
                                    />
                                  ),
                                },
                                {
                                  name: t('Forward client ID header'),
                                  value: s.apiKeyAuth.forwardClientIDHeader || '-',
                                },
                              ]}
                            />
                          </>
                        )}
                        {ext && (
                          <>
                            <Sub>{t('External auth')}</Sub>
                            <NameValueTable
                              rows={[
                                { name: t('Protocol'), value: ext.grpc ? 'gRPC' : 'HTTP' },
                                {
                                  name: t('Backends'),
                                  value: backendRefList(extAuthBackendRefs(extSvc), ns),
                                },
                                {
                                  name: t('Path prefix'),
                                  value: ext.http?.path || '-',
                                  hide: !!ext.grpc,
                                },
                                {
                                  name: t('Headers sent to the auth service'),
                                  value: <StringArray items={ext.headersToExtAuth} />,
                                },
                                {
                                  name: t('Headers copied back to the request'),
                                  value: <StringArray items={ext.http?.headersToBackend} />,
                                  hide: !!ext.grpc,
                                },
                                { name: t('Fail open'), value: yesNo(ext.failOpen, true) },
                              ]}
                            />
                          </>
                        )}
                      </Box>
                    ),
                  },
                  {
                    label: 'CORS',
                    content: s.cors && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Allowed origins'),
                            value: <StringArray items={s.cors.allowOrigins} />,
                          },
                          {
                            name: t('Allowed methods'),
                            value: <StringArray items={s.cors.allowMethods} />,
                          },
                          {
                            name: t('Allowed headers'),
                            value: <StringArray items={s.cors.allowHeaders} />,
                          },
                          {
                            name: t('Exposed headers'),
                            value: <StringArray items={s.cors.exposeHeaders} />,
                          },
                          { name: t('Max age'), value: s.cors.maxAge || '-' },
                          {
                            name: t('Allow credentials'),
                            value: yesNo(s.cors.allowCredentials, true),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    label: t('Authorization'),
                    content: s.authorization && (
                      <NameValueTable
                        rows={[
                          {
                            name: t('Default action'),
                            value: s.authorization.defaultAction || 'Deny',
                          },
                          ...(s.authorization.rules || []).map((rule, i) => ({
                            name: `${rule.action}: ${
                              rule.name || t('Rule #{{index}}', { index: i + 1 })
                            }`,
                            value: (
                              <Box>
                                {!!rule.principal?.clientCIDRs?.length && (
                                  <div>
                                    {t('Client CIDRs')}: {rule.principal.clientCIDRs.join(', ')}
                                  </div>
                                )}
                                {rule.principal?.jwt && (
                                  <div>
                                    JWT: {rule.principal.jwt.provider || '*'}
                                    {rule.principal.jwt.scopes?.length
                                      ? ` · ${t('Scopes')}: ${rule.principal.jwt.scopes.join(', ')}`
                                      : ''}
                                    {rule.principal.jwt.claims?.length
                                      ? ` · ${rule.principal.jwt.claims
                                          .map(c => `${c.name}=${(c.values || []).join('|')}`)
                                          .join(', ')}`
                                      : ''}
                                  </div>
                                )}
                                {!!rule.principal?.headers?.length && (
                                  <div>
                                    {t('Headers')}:{' '}
                                    {rule.principal.headers
                                      .map(h => `${h.name}=${(h.values || []).join('|')}`)
                                      .join(', ')}
                                  </div>
                                )}
                                {!rule.principal && t('any client')}
                              </Box>
                            ),
                          })),
                        ]}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
        ];
      }}
    />
  );
}
