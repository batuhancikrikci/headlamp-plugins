import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { HTTPRouteFilter } from '../../resources/httpRouteFilter';
import { crdByKind } from '../../resources/registry';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { StringArray, useYesNo } from '../common/SharedComponents';
import { EGDetailView } from '../common/Views';
import { EDITING } from '../editing';
import { HTTPRouteFilterUsedBy } from '../relations/UsedBy';

export function HTTPRouteFilterDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('HTTPRouteFilter')!}
      editing={EDITING.HTTPRouteFilter}
      extraInfo={(item: HTTPRouteFilter) => [
        { name: t('Filter Type'), value: <StringArray items={item.filterTypes} /> },
      ]}
      sections={(item: HTTPRouteFilter) => {
        const s = item.spec;
        const ns = item.metadata.namespace;
        return [
          {
            id: 'eg-hrf-urlrewrite',
            section: s.urlRewrite && (
              <SectionBox title={t('URL rewrite')}>
                <NameValueTable
                  rows={[
                    { name: t('Hostname from'), value: s.urlRewrite.hostname?.type || '-' },
                    {
                      name: t('Header name'),
                      value: s.urlRewrite.hostname?.header || '-',
                      hide: s.urlRewrite.hostname?.type !== 'Header',
                    },
                    {
                      name: t('Path regex pattern'),
                      value: s.urlRewrite.path?.replaceRegexMatch?.pattern ? (
                        <code>{s.urlRewrite.path.replaceRegexMatch.pattern}</code>
                      ) : (
                        '-'
                      ),
                    },
                    {
                      name: t('Path substitution'),
                      value: s.urlRewrite.path?.replaceRegexMatch?.substitution ? (
                        <code>{s.urlRewrite.path.replaceRegexMatch.substitution}</code>
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
            id: 'eg-hrf-directresponse',
            section: s.directResponse && (
              <SectionBox title={t('Direct response')}>
                <NameValueTable
                  rows={[
                    { name: t('Status code'), value: s.directResponse.statusCode ?? 200 },
                    { name: t('Content type'), value: s.directResponse.contentType || '-' },
                    { name: t('Body source'), value: s.directResponse.body?.type || '-' },
                    {
                      name: t('Body'),
                      value: s.directResponse.body?.inline ? (
                        <CodeBlock value={s.directResponse.body.inline} />
                      ) : s.directResponse.body?.valueRef ? (
                        <ResourceRefLink
                          group={s.directResponse.body.valueRef.group || ''}
                          kind={s.directResponse.body.valueRef.kind || 'ConfigMap'}
                          name={s.directResponse.body.valueRef.name}
                          namespace={ns}
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
            id: 'eg-hrf-credential',
            section: s.credentialInjection && (
              <SectionBox title={t('Credential injection')}>
                <NameValueTable
                  rows={[
                    { name: t('Header'), value: s.credentialInjection.header || 'Authorization' },
                    { name: t('Overwrite'), value: yesNo(s.credentialInjection.overwrite, true) },
                    {
                      name: t('Credential'),
                      value: s.credentialInjection.credential?.valueRef ? (
                        <ResourceRefLink
                          group={s.credentialInjection.credential.valueRef.group || ''}
                          kind={s.credentialInjection.credential.valueRef.kind || 'Secret'}
                          name={s.credentialInjection.credential.valueRef.name}
                          namespace={ns}
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
            id: 'eg-hrf-usedby',
            section: <HTTPRouteFilterUsedBy name={item.metadata.name} namespace={ns} />,
          },
        ];
      }}
    />
  );
}
