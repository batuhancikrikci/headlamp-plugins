/** Jobs dashboard: CronJobs with their last runs and schedule problems, and running jobs. */
import { Box, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { cardGrid, Panel, RouteLink, Stat, StatCard, twoColumns } from '../overview/blocks';
import { Issue, JobState, jobState } from '../overview/clusterHealth';
import { age, duration } from './format';
import {
  cronIssues,
  CronJobDetailJson,
  cronRows,
  JobDetailJson,
  runningJobs,
  standaloneJobIssues,
} from './jobs';
import { AttentionPanel, DashboardShell, DataTable } from './shell';
import { listStatus, useApiList } from './useApi';

const RUN_COLOR: Record<JobState, string> = {
  complete: 'success.main',
  failed: 'error.main',
  active: 'info.main',
};

/** The last runs as small squares, oldest first; color and tooltip name the state. */
function Runs({ runs }: { runs: JobState[] }) {
  if (runs.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }} aria-label={`Last runs: ${runs.join(', ')}`}>
      {runs.map((state, i) => (
        <Tooltip key={i} title={state}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: RUN_COLOR[state] }} />
        </Tooltip>
      ))}
    </Box>
  );
}

export function JobsDashboard() {
  const cronJobs = useApiList<CronJobDetailJson>('/apis/batch/v1/cronjobs');
  const jobs = useApiList<JobDetailJson>('/apis/batch/v1/jobs');
  const status = listStatus([
    ['Cron Jobs', cronJobs],
    ['Jobs', jobs],
  ]);
  const rows = React.useMemo(
    () => cronRows(cronJobs.data ?? [], jobs.data ?? []),
    [cronJobs.data, jobs.data]
  );
  const issues: Issue[] = React.useMemo(
    () => [...cronIssues(rows), ...standaloneJobIssues(jobs.data ?? [])],
    [rows, jobs.data]
  );
  const running = runningJobs(jobs.data ?? []);
  const jobList = jobs.data ?? [];
  const failed = jobList.filter(j => jobState(j) === 'failed').length;
  const complete = jobList.filter(j => jobState(j) === 'complete').length;
  const suspended = rows.filter(r => r.suspended).length;
  const missed = rows.filter(r => r.missedAt !== undefined).length;
  const failing = rows.filter(r => r.failingStreak >= 2).length;

  const stats: Stat[] = [
    {
      id: 'cronjobs',
      label: 'Cron jobs',
      value: cronJobs.data ? rows.length : '—',
      caption: suspended > 0 ? `${suspended} suspended` : 'none suspended',
      icon: 'mdi:calendar-clock',
      tone: 'primary',
    },
    {
      id: 'missed',
      label: 'Missed runs',
      value: cronJobs.data ? missed : '—',
      caption: 'cron jobs behind schedule',
      icon: 'mdi:calendar-alert',
      tone: missed > 0 ? 'warning' : 'success',
    },
    {
      id: 'failing',
      label: 'Failing',
      value: cronJobs.data && jobs.data ? failing : '—',
      caption: 'cron jobs failing 2+ runs in a row',
      icon: 'mdi:alert-circle-outline',
      tone: failing > 0 ? 'error' : 'success',
    },
    {
      id: 'running',
      label: 'Jobs running',
      value: jobs.data ? running.length : '—',
      caption: `${complete} complete · ${failed} failed`,
      icon: 'mdi:briefcase-clock-outline',
      tone: failed > 0 ? 'warning' : 'info',
    },
  ];

  return (
    <DashboardShell
      icon="mdi:calendar-clock"
      title="Jobs"
      subtitle="Cron jobs, their runs and the jobs of the cluster"
      issues={issues}
      {...status}
    >
      <Box sx={cardGrid(200)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>
      <Box sx={twoColumns}>
        <AttentionPanel
          issues={issues}
          pending={status.pending}
          emptyText="No cron job missed a run or keeps failing, no run outlasts its schedule and no job failed."
        />
        <Panel title="Running jobs" icon="mdi:briefcase-clock-outline">
          <DataTable
            rows={running}
            rowKey={r => `${r.namespace}/${r.name}`}
            empty={jobs.data ? 'No job is running.' : 'Loading…'}
            maxHeight={360}
            columns={[
              {
                label: 'Job',
                render: r => (
                  <RouteLink
                    to={{ route: 'Job', params: { namespace: r.namespace, name: r.name } }}
                  >
                    {r.name}
                  </RouteLink>
                ),
              },
              { label: 'Namespace', render: r => r.namespace },
              { label: 'Running for', align: 'right', render: r => duration(r.seconds) },
            ]}
          />
        </Panel>
      </Box>
      <Panel title="Cron jobs" icon="mdi:calendar-clock">
        <DataTable
          rows={rows}
          rowKey={r => `${r.namespace}/${r.name}`}
          empty={cronJobs.data ? 'No cron job.' : 'Loading…'}
          columns={[
            {
              label: 'Cron job',
              render: r => (
                <RouteLink
                  to={{ route: 'CronJob', params: { namespace: r.namespace, name: r.name } }}
                >
                  {r.name}
                </RouteLink>
              ),
            },
            { label: 'Namespace', render: r => r.namespace },
            {
              label: 'Schedule',
              render: r => (
                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                  {r.schedule}
                  {r.timeZone ? ` (${r.timeZone})` : ''}
                  {r.suspended ? ' · suspended' : ''}
                </Box>
              ),
            },
            { label: 'Last run', render: r => age(r.lastSchedule) },
            { label: 'Last success', render: r => age(r.lastSuccess) },
            { label: 'Recent runs', render: r => <Runs runs={r.runs} /> },
          ]}
        />
        {rows.some(r => !r.checked) && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            Missed runs are not checked for cron jobs with a time zone other than UTC or a schedule
            this page does not understand.
          </Typography>
        )}
      </Panel>
    </DashboardShell>
  );
}
