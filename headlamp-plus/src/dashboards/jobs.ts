/**
 * Pure helpers of the jobs dashboard: the last runs of each CronJob, runs that were missed, runs
 * that fail again and again, and jobs that are still running when the next run is due.
 *
 * Schedules are read like the CronJob controller does (five fields, names, steps, ranges, lists
 * and the @hourly style macros). Times are compared in UTC: a CronJob without spec.timeZone runs
 * in the time zone of kube-controller-manager, which is UTC on most clusters. CronJobs with
 * another time zone are not checked for missed runs.
 */
import { Issue, jobIssues, JobState, jobState } from '../overview/clusterHealth';

export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function field(
  text: string,
  min: number,
  max: number,
  names?: string[],
  namesStart = 0
): Set<number> | undefined {
  const value = (part: string): number | undefined => {
    const index = names?.indexOf(part.toUpperCase()) ?? -1;
    if (index >= 0) return index + namesStart;
    return /^\d+$/.test(part) ? Number(part) : undefined;
  };
  const result = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return undefined;
    let lo: number | undefined;
    let hi: number | undefined;
    if (range === '*' || range === '?') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = value(a);
      hi = value(b);
    } else {
      lo = value(range);
      hi = stepText === undefined ? lo : max;
    }
    if (lo === undefined || hi === undefined || lo < min || hi > max || lo > hi) return undefined;
    for (let v = lo; v <= hi; v += step) result.add(v);
  }
  return result;
}

/** Parses a CronJob schedule; undefined when it is not understood (e.g. a CRON_TZ prefix). */
export function parseCron(schedule: string): Cron | undefined {
  const text = MACROS[schedule.trim().toLowerCase()] ?? schedule.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return undefined;
  const minutes = field(parts[0], 0, 59);
  const hours = field(parts[1], 0, 23);
  const days = field(parts[2], 1, 31);
  const months = field(parts[3], 1, 12, MONTHS, 1);
  const weekdays = field(parts[4], 0, 7, WEEKDAYS);
  if (!minutes || !hours || !days || !months || !weekdays) return undefined;
  if (weekdays.has(7)) weekdays.add(0);
  const restricted = (t: string) => !/^[*?](\/1)?$/.test(t);
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    dayRestricted: restricted(parts[2]),
    weekdayRestricted: restricted(parts[4]),
  };
}

function dayMatches(cron: Cron, d: Date): boolean {
  const dom = cron.days.has(d.getUTCDate());
  const dow = cron.weekdays.has(d.getUTCDay());
  // Like cron: when both are restricted, either one matching is enough.
  return cron.dayRestricted && cron.weekdayRestricted ? dom || dow : dom && dow;
}

const MINUTE = 60_000;

/** The latest scheduled time at or before `before` (ms, UTC). */
export function previousRun(cron: Cron, before: number): number | undefined {
  let t = Math.floor(before / MINUTE) * MINUTE;
  for (let i = 0; i < 100_000; i++) {
    const d = new Date(t);
    if (!cron.months.has(d.getUTCMonth() + 1) || !dayMatches(cron, d)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - MINUTE;
    } else if (!cron.hours.has(d.getUTCHours())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()) - MINUTE;
    } else if (!cron.minutes.has(d.getUTCMinutes())) {
      t -= MINUTE;
    } else {
      return t;
    }
  }
  return undefined;
}

interface Meta {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  uid?: string;
  ownerReferences?: Array<{ kind?: string; name?: string }>;
}

export interface JobDetailJson {
  metadata?: Meta;
  status?: {
    startTime?: string;
    completionTime?: string;
    active?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export interface CronJobDetailJson {
  metadata?: Meta;
  spec?: { schedule?: string; timeZone?: string; suspend?: boolean; concurrencyPolicy?: string };
  status?: { lastScheduleTime?: string; lastSuccessfulTime?: string; active?: unknown[] };
}

const UTC_ZONES = new Set(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT']);

/** A run is reported missed when it is this late. */
export const MISSED_GRACE_MS = 5 * MINUTE;

export interface CronRow {
  name: string;
  namespace: string;
  schedule: string;
  timeZone?: string;
  suspended: boolean;
  concurrencyPolicy: string;
  lastSchedule?: string;
  lastSuccess?: string;
  active: number;
  /** States of the last runs, oldest first. */
  runs: JobState[];
  /** Failed runs in a row, ignoring a run still in progress. */
  failingStreak: number;
  /** When a run was due but did not start. */
  missedAt?: number;
  /** Time between the last two scheduled runs. */
  intervalMs?: number;
  /** Runs still active although the next one was due. */
  overdue: string[];
  /** The schedule could be checked (understood, UTC). */
  checked: boolean;
}

function ownerCronJob(job: JobDetailJson): string | undefined {
  return job.metadata?.ownerReferences?.find(o => o.kind === 'CronJob')?.name;
}

export function cronRows(
  cronJobs: CronJobDetailJson[],
  jobs: JobDetailJson[],
  now: number = Date.now()
): CronRow[] {
  const owned = new Map<string, JobDetailJson[]>();
  for (const job of jobs) {
    const owner = ownerCronJob(job);
    if (!owner) continue;
    const k = `${job.metadata?.namespace}/${owner}`;
    owned.set(k, [...(owned.get(k) ?? []), job]);
  }
  return cronJobs
    .map(cj => {
      const name = cj.metadata?.name ?? '';
      const namespace = cj.metadata?.namespace ?? '';
      const schedule = cj.spec?.schedule ?? '';
      const runs = (owned.get(`${namespace}/${name}`) ?? []).sort(
        (a, b) =>
          Date.parse(a.metadata?.creationTimestamp ?? '') -
          Date.parse(b.metadata?.creationTimestamp ?? '')
      );
      const states = runs.map(job => jobState(job));
      let failingStreak = 0;
      const finished = states[states.length - 1] === 'active' ? states.slice(0, -1) : states;
      for (let i = finished.length - 1; i >= 0 && finished[i] === 'failed'; i--) failingStreak++;

      const zone = cj.spec?.timeZone;
      const cron = parseCron(schedule);
      const checked = !!cron && (!zone || UTC_ZONES.has(zone));
      const suspended = !!cj.spec?.suspend;
      let missedAt: number | undefined;
      let intervalMs: number | undefined;
      const overdue: string[] = [];
      if (cron && checked) {
        const last = previousRun(cron, now);
        const before = last !== undefined ? previousRun(cron, last - MINUTE) : undefined;
        if (last !== undefined && before !== undefined) intervalMs = last - before;
        const due = previousRun(cron, now - MISSED_GRACE_MS);
        const created = Date.parse(cj.metadata?.creationTimestamp ?? '');
        const lastSchedule = Date.parse(cj.status?.lastScheduleTime ?? '');
        if (
          !suspended &&
          due !== undefined &&
          !Number.isNaN(created) &&
          due > created &&
          (Number.isNaN(lastSchedule) || lastSchedule < due)
        ) {
          missedAt = due;
        }
        if (intervalMs !== undefined) {
          for (const job of runs) {
            const started = Date.parse(job.status?.startTime ?? '');
            if (
              jobState(job) === 'active' &&
              !Number.isNaN(started) &&
              now - started > intervalMs
            ) {
              overdue.push(job.metadata?.name ?? '');
            }
          }
        }
      }
      return {
        name,
        namespace,
        schedule,
        timeZone: zone,
        suspended,
        concurrencyPolicy: cj.spec?.concurrencyPolicy || 'Allow',
        lastSchedule: cj.status?.lastScheduleTime,
        lastSuccess: cj.status?.lastSuccessfulTime,
        active: cj.status?.active?.length ?? 0,
        runs: states.slice(-5),
        failingStreak,
        missedAt,
        intervalMs,
        overdue,
        checked,
      };
    })
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}

export function cronIssues(rows: CronRow[]): Issue[] {
  const issues: Issue[] = [];
  for (const row of rows) {
    const base = {
      kind: 'CronJob',
      name: row.name,
      namespace: row.namespace,
      link: { route: 'CronJob', params: { namespace: row.namespace, name: row.name } },
    };
    if (row.failingStreak >= 2) {
      issues.push({
        ...base,
        level: 'error',
        title: `Failed ${row.failingStreak} runs in a row`,
        detail: row.lastSuccess ? `Last success ${row.lastSuccess}.` : 'No recorded success.',
      });
    }
    if (row.missedAt !== undefined) {
      issues.push({
        ...base,
        level: 'warning',
        title: 'Missed a scheduled run',
        detail: `A run was due at ${new Date(row.missedAt).toISOString()} (UTC) but did not start${
          row.concurrencyPolicy === 'Forbid' && row.active > 0
            ? ': concurrencyPolicy Forbid skips runs while one is active'
            : ''
        }.`,
      });
    }
    if (row.overdue.length > 0) {
      issues.push({
        ...base,
        level: 'warning',
        title: 'Still running when the next run was due',
        detail: `${row.overdue.join(', ')} (concurrency policy ${row.concurrencyPolicy}).`,
      });
    }
  }
  return issues;
}

/** Failed jobs that no CronJob owns (CronJob runs are reported per CronJob). */
export function standaloneJobIssues(jobs: JobDetailJson[]): Issue[] {
  return jobs
    .filter(job => !ownerCronJob(job))
    .flatMap(job =>
      jobIssues('Job', job).map(issue => ({
        ...issue,
        link: { route: 'Job', params: { namespace: issue.namespace ?? '', name: issue.name } },
      }))
    );
}

export interface RunningJob {
  name: string;
  namespace: string;
  cronJob?: string;
  startTime?: string;
  seconds: number;
}

/** Jobs in progress, longest running first. */
export function runningJobs(jobs: JobDetailJson[], now: number = Date.now()): RunningJob[] {
  return jobs
    .filter(job => jobState(job) === 'active' && (job.status?.active ?? 0) > 0)
    .map(job => {
      const started = Date.parse(job.status?.startTime ?? '');
      return {
        name: job.metadata?.name ?? '',
        namespace: job.metadata?.namespace ?? '',
        cronJob: ownerCronJob(job),
        startTime: job.status?.startTime,
        seconds: Number.isNaN(started) ? 0 : (now - started) / 1000,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}
