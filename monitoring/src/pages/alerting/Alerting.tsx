import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, Tab, Tabs } from '@mui/material';
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useText } from '../../common/i18n';
import ActiveAlerts from './ActiveAlerts';
import AlertRules from './AlertRules';
import Silences from './Silences';

const { SectionBox } = CommonComponents;

const TABS = ['alerts', 'rules', 'silences'] as const;

export default function Alerting() {
  const { t } = useText();
  const location = useLocation();
  const history = useHistory();
  const tab = new URLSearchParams(location.search).get('tab') || 'alerts';
  const index = Math.max(0, TABS.indexOf(tab as (typeof TABS)[number]));
  // Filters are tab specific, so switching tabs drops every other query param.
  const setTab = (next: string) =>
    history.replace({ ...location, search: next === 'alerts' ? '' : `?tab=${next}` });

  return (
    <SectionBox title={t('Alerting')}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={index}
          onChange={(_, v: number) => setTab(TABS[v])}
          aria-label={t('Alerting sections')}
        >
          <Tab label={t('Alerts')} id="alerting-tab-alerts" aria-controls="alerting-panel" />
          <Tab label={t('Rules')} id="alerting-tab-rules" aria-controls="alerting-panel" />
          <Tab label={t('Silences')} id="alerting-tab-silences" aria-controls="alerting-panel" />
        </Tabs>
      </Box>
      <Box role="tabpanel" id="alerting-panel" aria-labelledby={`alerting-tab-${TABS[index]}`}>
        {index === 0 && <ActiveAlerts key="alerts" />}
        {index === 1 && <AlertRules key="rules" />}
        {index === 2 && <Silences key="silences" />}
      </Box>
    </SectionBox>
  );
}
