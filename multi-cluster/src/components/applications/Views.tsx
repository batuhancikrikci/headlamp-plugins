/**
 * Applications section: Subscription, Channel, HelmRelease, SubscriptionReport and
 * SubscriptionStatus (multicloud-operators-subscription).
 */
import {
  DateLabel,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  ChannelJson,
  channelType,
  GIT_ANNOTATIONS,
  HelmReleaseJson,
  isSubscriptionPaused,
  parseChannelRef,
  pausePatch,
  reportHealth,
  reportSummary,
  SUBSCRIPTION_STATE_HEALTH,
  SUBSCRIPTION_STATE_LABEL,
  SubscriptionJson,
  subscriptionPlacementRef,
  SubscriptionReportJson,
  subscriptionState,
  SubscriptionStatusJson,
} from '../../resources/models/apps';
import {
  decidedClusters,
  decisionsOfPlacement,
  PlacementDecisionJson,
} from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { ActionButton } from '../common/ActionButton';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, SelectorView, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';

function SubscriptionStateLabel({ sub }: { sub: SubscriptionJson }) {
  const { t } = useText();
  const state = subscriptionState(sub);
  return (
    <HealthLabel
      health={SUBSCRIPTION_STATE_HEALTH[state]}
      label={t(SUBSCRIPTION_STATE_LABEL[state])}
      tooltip={sub.status?.message || sub.status?.reason}
    />
  );
}

function ChannelRef({ value }: { value?: string }) {
  const ref = parseChannelRef(value);
  if (!ref) return <>{value || '-'}</>;
  return <ResourceRefLink kind="Channel" name={ref.name} namespace={ref.namespace} qualified />;
}

function PlacementRefLink({ sub }: { sub: SubscriptionJson }) {
  const ref = subscriptionPlacementRef(sub);
  if (!ref) return <>-</>;
  return (
    <ResourceRefLink
      kind={ref.kind}
      name={ref.name}
      namespace={ref.namespace}
      showKind={ref.kind === 'PlacementRule'}
    />
  );
}

export function SubscriptionList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('Subscription')}
      columns={[
        col<SubscriptionJson>(
          'status',
          t('Status'),
          j => SUBSCRIPTION_STATE_LABEL[subscriptionState(j)],
          j => <SubscriptionStateLabel sub={j} />
        ),
        col<SubscriptionJson>(
          'channel',
          t('Channel'),
          j => j.spec?.channel,
          j => <ChannelRef value={j.spec?.channel} />
        ),
        col<SubscriptionJson>(
          'placement',
          t('Placement'),
          j => subscriptionPlacementRef(j)?.name,
          j => <PlacementRefLink sub={j} />
        ),
        col<SubscriptionJson>(
          'package',
          t('Package / path'),
          j => j.spec?.name || j.metadata.annotations?.[GIT_ANNOTATIONS.path]
        ),
        col<SubscriptionJson>(
          'updated',
          t('Updated'),
          j => j.status?.lastUpdateTime,
          j =>
            j.status?.lastUpdateTime ? (
              <DateLabel date={j.status.lastUpdateTime} format="mini" />
            ) : (
              '-'
            )
        ),
      ]}
    />
  );
}

/** Pause / resume through the `subscription-pause` label. */
export function PauseAction({ item }: { item: KubeObject }) {
  const { t } = useText();
  const json = item.jsonData as SubscriptionJson;
  const paused = isSubscriptionPaused(json);
  const name = json.metadata.name;
  return paused ? (
    <ActionButton
      label={t('Resume subscription')}
      icon="mdi:play-circle-outline"
      color="success"
      authItem={item}
      authVerb="patch"
      run={() => item.patch(pausePatch(false))}
      successMessage={t('Subscription {{name}} resumed', { name })}
    />
  ) : (
    <ActionButton
      label={t('Pause subscription')}
      icon="mdi:pause-circle-outline"
      color="warning"
      authItem={item}
      authVerb="patch"
      run={() => item.patch(pausePatch(true))}
      successMessage={t('Subscription {{name}} paused', { name })}
      confirm={{
        title: t('Pause subscription {{name}}?', { name }),
        description: t(
          'The subscription stops reconciling (label subscription-pause=true): new channel content is not deployed until it is resumed. Deployed resources stay in place.'
        ),
        confirmLabel: t('Pause'),
      }}
    />
  );
}

function SubscriptionChain({ sub }: { sub: SubscriptionJson }) {
  const { t } = useText();
  const ref = subscriptionPlacementRef(sub);
  const decisions = useOcmList<PlacementDecisionJson>('PlacementDecision', {
    namespace: ref?.namespace,
    enabled: ref?.kind === 'Placement',
  });
  const reports = useOcmList<SubscriptionReportJson>('SubscriptionReport', {
    namespace: sub.metadata.namespace,
  });
  const report = (reports.items || []).find(
    r => r.reportType === 'Application' && r.metadata.name === sub.metadata.name
  );
  const clusters =
    ref?.kind === 'Placement' && decisions.items
      ? decidedClusters(
          decisionsOfPlacement(
            { metadata: { name: ref.name, namespace: ref.namespace } },
            decisions.items
          )
        )
      : null;
  const summary = report ? reportSummary(report) : undefined;
  return (
    <SectionBox title={t('Delivery chain')}>
      <NameValueTable
        rows={[
          { name: t('Channel'), value: <ChannelRef value={sub.spec?.channel} /> },
          {
            name: t('Secondary channel'),
            value: <ChannelRef value={sub.spec?.secondaryChannel} />,
            hide: !sub.spec?.secondaryChannel,
          },
          { name: t('Placement'), value: <PlacementRefLink sub={sub} /> },
          {
            name: t('Inline cluster selector'),
            value: <SelectorView selector={sub.spec?.placement?.clusterSelector} />,
            hide: !sub.spec?.placement?.clusterSelector,
          },
          { name: t('Local (hub only)'), value: t('Yes'), hide: !sub.spec?.placement?.local },
          {
            name: t('Selected clusters'),
            value: clusters ? (
              clusters.length === 0 ? (
                t('none')
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                  {clusters.map(c => (
                    <ClusterLink key={c} name={c} />
                  ))}
                </Box>
              )
            ) : (
              '-'
            ),
            hide: ref?.kind !== 'Placement',
          },
          {
            name: t('Application report'),
            value: report ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <ResourceRefLink
                  kind="SubscriptionReport"
                  name={report.metadata.name}
                  namespace={report.metadata.namespace}
                />
                <HealthLabel
                  health={reportHealth(report)}
                  label={t(
                    '{{deployed}} deployed · {{inProgress}} in progress · {{failed}} failed',
                    {
                      deployed: summary?.deployed,
                      inProgress: summary?.inProgress,
                      failed: (summary?.failed || 0) + (summary?.propagationFailed || 0),
                    }
                  )}
                />
              </Box>
            ) : (
              t('No report yet')
            ),
            hide: reports.missing,
          },
        ]}
      />
    </SectionBox>
  );
}

export function SubscriptionDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('Subscription')}
      conditions={false}
      actions={item => [<PauseAction key="pause" item={item} />]}
      extraInfo={item => {
        const j = item.jsonData as SubscriptionJson;
        const a = j.metadata.annotations || {};
        return [
          { name: t('Status'), value: <SubscriptionStateLabel sub={j} /> },
          {
            name: t('Phase message'),
            value: j.status?.message || j.status?.reason || '-',
            hide: !j.status?.message && !j.status?.reason,
          },
          { name: t('Paused'), value: isSubscriptionPaused(j) ? t('Yes') : t('No') },
          { name: t('Package'), value: j.spec?.name || '-', hide: !j.spec?.name },
          {
            name: t('Package version'),
            value: j.spec?.packageFilter?.version,
            hide: !j.spec?.packageFilter?.version,
          },
          {
            name: t('Git branch'),
            value: a[GIT_ANNOTATIONS.branch],
            hide: !a[GIT_ANNOTATIONS.branch],
          },
          { name: t('Git path'), value: a[GIT_ANNOTATIONS.path], hide: !a[GIT_ANNOTATIONS.path] },
          { name: t('Git tag'), value: a[GIT_ANNOTATIONS.tag], hide: !a[GIT_ANNOTATIONS.tag] },
          {
            name: t('Desired commit'),
            value: a[GIT_ANNOTATIONS.desiredCommit],
            hide: !a[GIT_ANNOTATIONS.desiredCommit],
          },
          {
            name: t('Current commit'),
            value: a[GIT_ANNOTATIONS.currentCommit],
            hide: !a[GIT_ANNOTATIONS.currentCommit],
          },
          {
            name: t('Time window'),
            value: j.spec?.timewindow
              ? `${j.spec.timewindow.windowtype || 'active'} · ${
                  (j.spec.timewindow.daysofweek || []).join(', ') || t('every day')
                } · ${
                  (j.spec.timewindow.hours || []).map(h => `${h.start}-${h.end}`).join(', ') ||
                  t('all day')
                }${j.spec.timewindow.location ? ` (${j.spec.timewindow.location})` : ''}`
              : '-',
            hide: !j.spec?.timewindow,
          },
        ];
      }}
      sections={item => [
        { id: 'mch-chain', section: <SubscriptionChain sub={item.jsonData as SubscriptionJson} /> },
      ]}
    />
  );
}

// ----- Channel -----

export function ChannelList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('Channel')}
      columns={[
        col<ChannelJson>('type', t('Type'), j => channelType(j)),
        col<ChannelJson>('path', t('Path / URL'), j => j.spec?.pathname),
        col<ChannelJson>('secret', t('Credentials'), j => j.spec?.secretRef?.name || '-'),
      ]}
    />
  );
}

function ChannelSubscriptions({ channel }: { channel: ChannelJson }) {
  const { t } = useText();
  const subs = useOcmList<SubscriptionJson>('Subscription');
  const ref = `${channel.metadata.namespace}/${channel.metadata.name}`;
  return (
    <RelatedTable
      title={t('Subscriptions using this channel')}
      items={
        subs.items
          ? subs.items.filter(s => s.spec?.channel === ref || s.spec?.secondaryChannel === ref)
          : null
      }
      error={subs.error}
      what={t('subscriptions')}
      emptyMessage={t('No subscription uses this channel.')}
      columns={[
        {
          label: t('Subscription'),
          getter: (s: SubscriptionJson) => (
            <ResourceRefLink
              kind="Subscription"
              name={s.metadata.name}
              namespace={s.metadata.namespace}
              qualified
            />
          ),
        },
        { label: t('Status'), getter: (s: SubscriptionJson) => <SubscriptionStateLabel sub={s} /> },
        { label: t('Placement'), getter: (s: SubscriptionJson) => <PlacementRefLink sub={s} /> },
      ]}
    />
  );
}

export function ChannelDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('Channel')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as ChannelJson;
        return [
          { name: t('Type'), value: channelType(j) },
          { name: t('Path / URL'), value: j.spec?.pathname || '-' },
          {
            name: t('Credentials secret'),
            value: j.spec?.secretRef?.name ? (
              <ResourceRefLink
                kind="Secret"
                name={j.spec.secretRef.name}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            ),
          },
          {
            name: t('Config map'),
            value: j.spec?.configMapRef?.name ? (
              <ResourceRefLink
                kind="ConfigMap"
                name={j.spec.configMapRef.name}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            ),
            hide: !j.spec?.configMapRef,
          },
          {
            name: t('Skip TLS verification'),
            value: j.spec?.insecureSkipVerify ? t('Yes') : t('No'),
          },
        ];
      }}
      sections={item => [
        {
          id: 'mch-subs',
          section: <ChannelSubscriptions channel={item.jsonData as ChannelJson} />,
        },
      ]}
    />
  );
}

// ----- HelmRelease -----

export function HelmReleaseList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('HelmRelease')}
      columns={[
        col<HelmReleaseJson>('chart', t('Chart'), j => j.repo?.chartName),
        col<HelmReleaseJson>('version', t('Version'), j => j.repo?.version),
        col<HelmReleaseJson>('source', t('Source'), j => j.repo?.source?.type),
        col<HelmReleaseJson>('release', t('Release'), j => j.status?.deployedRelease?.name),
      ]}
    />
  );
}

export function HelmReleaseDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('HelmRelease')}
      extraInfo={item => {
        const j = item.jsonData as HelmReleaseJson;
        return [
          { name: t('Chart'), value: j.repo?.chartName || '-' },
          { name: t('Version'), value: j.repo?.version || '-' },
          { name: t('Source type'), value: j.repo?.source?.type || '-' },
          {
            name: t('Repository URLs'),
            value: (
              <StringArray items={j.repo?.source?.helmRepo?.urls || j.repo?.source?.git?.urls} />
            ),
          },
          { name: t('Deployed release'), value: j.status?.deployedRelease?.name || '-' },
        ];
      }}
    />
  );
}

// ----- SubscriptionReport / SubscriptionStatus -----

export function SubscriptionReportList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('SubscriptionReport')}
      columns={[
        col<SubscriptionReportJson>('type', t('Type'), j => j.reportType),
        col<SubscriptionReportJson>('deployed', t('Deployed'), j => reportSummary(j).deployed),
        col<SubscriptionReportJson>('progress', t('In progress'), j => reportSummary(j).inProgress),
        col<SubscriptionReportJson>(
          'failed',
          t('Failed'),
          j => reportSummary(j).failed + reportSummary(j).propagationFailed,
          j => {
            const n = reportSummary(j).failed + reportSummary(j).propagationFailed;
            return n > 0 ? <HealthLabel health="error" label={String(n)} /> : '0';
          }
        ),
        col<SubscriptionReportJson>('clusters', t('Clusters'), j => reportSummary(j).clusters),
      ]}
    />
  );
}

export function SubscriptionReportDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('SubscriptionReport')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as SubscriptionReportJson;
        const s = reportSummary(j);
        return [
          { name: t('Report type'), value: j.reportType || '-' },
          {
            name: t('Summary'),
            value: (
              <HealthLabel
                health={reportHealth(j)}
                label={t(
                  '{{deployed}} deployed · {{inProgress}} in progress · {{failed}} failed · {{propagationFailed}} propagation failed · {{clusters}} clusters',
                  s as unknown as Record<string, unknown>
                )}
              />
            ),
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as SubscriptionReportJson;
        return [
          {
            id: 'mch-results',
            section: (
              <RelatedTable
                title={t('Results')}
                items={j.results || []}
                what={t('results')}
                emptyMessage={t('No results reported.')}
                columns={[
                  {
                    label: j.reportType === 'Cluster' ? t('Subscription') : t('Cluster'),
                    getter: (r: { source?: string }) =>
                      j.reportType === 'Cluster' ? (
                        r.source || '-'
                      ) : r.source ? (
                        <ClusterLink name={r.source} />
                      ) : (
                        '-'
                      ),
                  },
                  {
                    label: t('Result'),
                    getter: (r: { result?: string }) => (
                      <HealthLabel
                        health={
                          r.result === 'deployed' ? 'success' : r.result ? 'error' : 'unknown'
                        }
                        label={r.result || '-'}
                      />
                    ),
                  },
                  {
                    label: t('Time'),
                    getter: (r: { timestamp?: { seconds?: number } }) =>
                      r.timestamp?.seconds ? (
                        <DateLabel
                          date={new Date(r.timestamp.seconds * 1000).toISOString()}
                          format="mini"
                        />
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            ),
          },
          {
            id: 'mch-resources',
            section: (
              <SectionBox title={t('Resources')}>
                <StringArray
                  items={(j.resources || []).map(
                    r => `${r.kind || '?'} ${r.namespace ? `${r.namespace}/` : ''}${r.name || '?'}`
                  )}
                  max={50}
                />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}

export function SubscriptionStatusList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('SubscriptionStatus')}
      columns={[
        col<SubscriptionStatusJson>('phase', t('Phase'), j => j.statuses?.subscription?.phase),
        col<SubscriptionStatusJson>(
          'packages',
          t('Packages'),
          j => (j.statuses?.packages || []).length
        ),
        col<SubscriptionStatusJson>(
          'failed',
          t('Failed packages'),
          j =>
            (j.statuses?.packages || []).filter(p => (p.phase || '').toLowerCase().includes('fail'))
              .length
        ),
      ]}
    />
  );
}

export function SubscriptionStatusDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('SubscriptionStatus')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as SubscriptionStatusJson;
        return [
          { name: t('Phase'), value: j.statuses?.subscription?.phase || '-' },
          { name: t('Message'), value: j.statuses?.subscription?.message || '-' },
        ];
      }}
      sections={item => {
        const j = item.jsonData as SubscriptionStatusJson;
        type Pkg = NonNullable<NonNullable<SubscriptionStatusJson['statuses']>['packages']>[number];
        return [
          {
            id: 'mch-packages',
            section: (
              <RelatedTable
                title={t('Packages')}
                items={j.statuses?.packages || []}
                what={t('packages')}
                emptyMessage={t('No packages reported.')}
                columns={[
                  { label: t('Kind'), getter: (p: Pkg) => p.kind || '-' },
                  {
                    label: t('Name'),
                    getter: (p: Pkg) => `${p.namespace ? `${p.namespace}/` : ''}${p.name || '?'}`,
                  },
                  {
                    label: t('Phase'),
                    getter: (p: Pkg) => (
                      <HealthLabel
                        health={
                          (p.phase || '').toLowerCase().includes('fail')
                            ? 'error'
                            : p.phase === 'Deployed' || p.phase === 'deployed'
                            ? 'success'
                            : 'unknown'
                        }
                        label={p.phase || '-'}
                        tooltip={p.message}
                      />
                    ),
                  },
                  {
                    label: t('Message'),
                    getter: (p: Pkg) => <Typography variant="body2">{p.message || '-'}</Typography>,
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
