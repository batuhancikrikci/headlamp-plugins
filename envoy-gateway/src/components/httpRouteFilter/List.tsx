import React from 'react';
import { useText } from '../../common/i18n';
import { HTTPRouteFilter } from '../../resources/httpRouteFilter';
import { crdByKind } from '../../resources/registry';
import { StringArray } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';

export function HTTPRouteFilterList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('HTTPRouteFilter')!}
      editing={EDITING.HTTPRouteFilter}
      columns={[
        {
          id: 'filterType',
          label: t('Filter Type'),
          render: (item: HTTPRouteFilter) => <StringArray items={item.filterTypes} />,
          getValue: (item: HTTPRouteFilter) => item.filterTypes.join(', '),
        },
        {
          id: 'summary',
          label: t('Summary'),
          getValue: (item: HTTPRouteFilter) => {
            const s = item.spec;
            if (s.directResponse) {
              return `${s.directResponse.statusCode ?? 200} ${
                s.directResponse.contentType || ''
              }`.trim();
            }
            if (s.urlRewrite) {
              return [
                s.urlRewrite.hostname?.type
                  ? `host←${s.urlRewrite.hostname.header || s.urlRewrite.hostname.type}`
                  : '',
                s.urlRewrite.path?.replaceRegexMatch?.pattern || '',
              ]
                .filter(Boolean)
                .join(' · ');
            }
            return '-';
          },
        },
      ]}
    />
  );
}
