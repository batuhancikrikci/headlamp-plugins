import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useText } from '../../common/i18n';
import { Mono } from '../../components/common/CodeBlock';
import { ApiErrorAlert } from '../../components/common/Feedback';
import { ChipFilter, FilterBar, SearchField, textMatches } from '../../components/common/Filters';
import { EndpointGate, InstanceBar } from '../../components/common/InstanceBar';
import { AlertStateChip, RuleHealthChip, SeverityChip } from '../../components/common/StatusChip';
import { usePrometheusEndpoint } from '../../hooks/useMonitoringEndpoint';
import { usePolling } from '../../hooks/usePolling';
import { useQueryParam } from '../../hooks/useQueryParam';
import { PrometheusRule } from '../../resources/crds';
import { refreshIntervalMs, useMonitoringSettings } from '../../settings';
import { PromRule } from '../../types';
import { formatSeconds, timeAgo } from '../../utils/duration';
import { promRuleGroups } from '../../utils/monitoringApi';
import { ruleFileOwner } from '../../utils/relations';
import { RuleDetailsDialog, RuleSourceLink } from './DetailsDialogs';

const { SimpleTable } = CommonComponents;

interface Row {
  rule: PromRule;
  group: string;
  source: { namespace: string; name: string } | null;
}

export default function AlertRules() {
  const { t } = useText();
  const settings = useMonitoringSettings();
  const prom = usePrometheusEndpoint();
  const groups = usePolling(
    prom.baseUrl ? () => promRuleGroups(prom.baseUrl) : null,
    [prom.baseUrl],
    refreshIntervalMs(settings)
  );
  const [ruleObjects] = PrometheusRule.useList();

  const [search, setSearch] = useQueryParam('q');
  const [typeParam, setTypeParam] = useQueryParam('type', 'alerting');
  const [stateParam, setStateParam] = useQueryParam('state');
  const [healthParam, setHealthParam] = useQueryParam('health');
  const types = typeParam ? typeParam.split(',') : [];
  const states = stateParam ? stateParam.split(',') : [];
  const healths = healthParam ? healthParam.split(',') : [];
  const [selected, setSelected] = useState<Row | null>(null);

  const rows: Row[] = useMemo(() => {
    const owners = (ruleObjects || []).map(r => r.jsonData);
    return (groups.data || []).flatMap(g => {
      const source = ruleFileOwner(g.file, owners);
      return g.rules.map(rule => ({ rule, group: g.name, source }));
    });
  }, [groups.data, ruleObjects]);

  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const filtered = rows.filter(
    ({ rule, group, source }) =>
      (types.length === 0 || types.includes(rule.type)) &&
      (states.length === 0 || (rule.state && states.includes(rule.state))) &&
      (healths.length === 0 || healths.includes(rule.health)) &&
      textMatches(
        search,
        rule.name,
        rule.query,
        group,
        rule.labels?.severity,
        source?.name,
        source?.namespace
      )
  );

  const gate = <EndpointGate kind="Prometheus" ep={prom} />;
  if (prom.loading || prom.error || prom.notFound || !prom.baseUrl) return gate;

  return (
    <Box>
      <InstanceBar
        kind="Prometheus"
        ep={prom}
        onRefresh={groups.refresh}
        refreshing={groups.refreshing}
        lastUpdated={groups.lastUpdated}
      />
      <ApiErrorAlert error={groups.error} onRetry={groups.refresh} />
      <FilterBar>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t('Search rules, queries, groups')}
        />
        <ChipFilter
          ariaLabel={t('Type')}
          options={[
            {
              value: 'alerting',
              label: t('Alerting'),
              count: count(r => r.rule.type === 'alerting'),
            },
            {
              value: 'recording',
              label: t('Recording'),
              count: count(r => r.rule.type === 'recording'),
            },
          ]}
          selected={types}
          onChange={v => setTypeParam(v.join(','))}
        />
        <ChipFilter
          ariaLabel={t('State')}
          options={[
            { value: 'firing', label: t('Firing'), count: count(r => r.rule.state === 'firing') },
            {
              value: 'pending',
              label: t('Pending'),
              count: count(r => r.rule.state === 'pending'),
            },
            {
              value: 'inactive',
              label: t('Inactive'),
              count: count(r => r.rule.state === 'inactive'),
            },
          ]}
          selected={states}
          onChange={v => setStateParam(v.join(','))}
        />
        <ChipFilter
          ariaLabel={t('Health')}
          options={[
            { value: 'ok', label: t('OK'), count: count(r => r.rule.health === 'ok') },
            { value: 'err', label: t('Error'), count: count(r => r.rule.health === 'err') },
            {
              value: 'unknown',
              label: t('Unknown'),
              count: count(r => r.rule.health === 'unknown'),
            },
          ]}
          selected={healths}
          onChange={v => setHealthParam(v.join(','))}
        />
      </FilterBar>
      <SimpleTable
        data={filtered}
        emptyMessage={groups.loading ? t('Loading…') : t('No rules match the filters.')}
        reflectInURL="rules"
        columns={[
          {
            label: t('Rule'),
            getter: (r: Row) => (
              <MuiLink
                component="button"
                variant="body2"
                onClick={() => setSelected(r)}
                sx={{ textAlign: 'left' }}
              >
                {r.rule.name}
              </MuiLink>
            ),
            sort: (a: Row, b: Row) => a.rule.name.localeCompare(b.rule.name),
          },
          {
            label: t('State'),
            getter: (r: Row) =>
              r.rule.type === 'alerting' ? <AlertStateChip state={r.rule.state} /> : '-',
          },
          {
            label: t('Severity'),
            getter: (r: Row) =>
              r.rule.type === 'alerting' ? (
                <SeverityChip severity={r.rule.labels?.severity} />
              ) : (
                '-'
              ),
          },
          {
            label: t('Health'),
            getter: (r: Row) => <RuleHealthChip health={r.rule.health} error={r.rule.lastError} />,
          },
          {
            label: t('Query'),
            getter: (r: Row) => (
              <Tooltip title={r.rule.query}>
                <Typography variant="body2" noWrap sx={{ maxWidth: 360 }}>
                  <Mono>{r.rule.query}</Mono>
                </Typography>
              </Tooltip>
            ),
          },
          {
            label: t('For'),
            getter: (r: Row) => (r.rule.type === 'alerting' ? formatSeconds(r.rule.duration) : '-'),
          },
          {
            label: t('Group'),
            getter: (r: Row) => r.group,
            sort: (a: Row, b: Row) => a.group.localeCompare(b.group),
          },
          { label: t('Source'), getter: (r: Row) => <RuleSourceLink source={r.source} /> },
          { label: t('Last evaluation'), getter: (r: Row) => timeAgo(r.rule.lastEvaluation) },
        ]}
      />
      <RuleDetailsDialog
        rule={selected?.rule || null}
        group={selected?.group}
        source={selected?.source}
        onClose={() => setSelected(null)}
      />
    </Box>
  );
}
