/**
 * The cron services and the worker's timers must stay one list.
 *
 * Under pooled tenancy every scheduled sweep funnels through `withSweepLock`,
 * which fans the tick out across the fleet — so the interval is the rate at
 * which every suspended Neon compute is woken. That is why `startup.ts` starts
 * no sweep timers on a pooled worker and the cron services own them instead.
 *
 * The hazard that creates is drift: a sweep added to `startup.ts`'s schedule but
 * not to a cron job would simply stop running on the pooled fleet, silently. So
 * this suite reads both sources and asserts they name the same work.
 *
 * Reading source text is a weak instrument, and this run has caught nineteen
 * tests that could not have failed — so every assertion below is paired with a
 * non-emptiness check, and the expected sets are written out literally rather
 * than derived from the same file they are checking.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', '..')

function read(rel: string): string {
  return readFileSync(join(serverDir, rel), 'utf8')
}

/** Every `withSweepLock('<name>', …)` call in a file. */
function sweepLockNames(source: string): Set<string> {
  return new Set([...source.matchAll(/withSweepLock\(\s*'([a-z_]+)'/g)].map((m) => m[1]))
}

/** Every `jobs.<fn>()` the startup schedule arms. */
function scheduledJobFns(source: string): Set<string> {
  return new Set([...source.matchAll(/jobs\.(run[A-Za-z]+)\(/g)].map((m) => m[1]))
}

describe('the sweep inventory', () => {
  const jobsSource = read('cron/fleet-jobs.ts')
  const startupSource = read('startup.ts')

  it('is exactly the eleven locks the fleet has, all defined in one module', () => {
    const names = sweepLockNames(jobsSource)
    // Written out rather than derived, so a sweep deleted from the module makes
    // this fail instead of quietly shrinking both sides of a comparison.
    expect([...names].sort()).toEqual([
      'audit_prune',
      'changelog_notify',
      'daily_cycle',
      'events_prune',
      'invite_sweep',
      'kv_sweep',
      'logs_retention',
      'merge_sweep',
      'status_maintenance_sweep',
      'status_notify',
      'summary_sweep',
    ])
  })

  it('is not duplicated back into startup.ts', () => {
    // startup.ts used to hold these bodies inline. If a sweep reappears there it
    // will run on the worker's timer and never on the cron service, which is the
    // drift this whole arrangement exists to avoid.
    expect(sweepLockNames(startupSource).size).toBe(0)
  })

  it('arms every exported job function from the single-workspace schedule', async () => {
    const armed = scheduledJobFns(startupSource)
    expect(armed.size).toBeGreaterThan(0)

    const jobs = await import('@/lib/server/cron/fleet-jobs')
    const exported = new Set(
      Object.keys(jobs).filter((k) => k.startsWith('run') && k !== 'runFleetCronJob')
    )
    expect(exported.size).toBeGreaterThan(0)
    expect([...armed].sort()).toEqual([...exported].sort())
  })
})

describe('the pooled worker starts no fleet-fanning timers', () => {
  const startupSource = read('startup.ts')

  it('returns before the sweep schedule when tenancy is pooled', () => {
    // The structural claim: the job tier is started BEFORE the pooled branch
    // (it runs under either tenancy mode), the branch ends in a `return`, and
    // the whole sweep schedule sits after it — so nothing that fans out
    // across the fleet on a timer can arm on a pooled worker.
    const fn = startupSource.slice(startupSource.indexOf('function startBackgroundProcessing'))
    expect(fn).not.toBe('')

    const jobTier = fn.indexOf('startJobTier')
    const branch = fn.indexOf('if (config.isPooledTenancy)')
    // The import expression, not the bare path — the branch's own comment and
    // its log line both name `cron/fleet-jobs.ts`, and matching those would
    // measure the prose rather than the schedule.
    const scheduleStart = fn.indexOf("import('@/lib/server/cron/fleet-jobs')")
    expect(jobTier).toBeGreaterThan(-1)
    expect(fn).not.toContain('startRelayTier')
    expect(branch).toBeGreaterThan(jobTier)
    expect(scheduleStart).toBeGreaterThan(branch)

    // The `return` belongs to the pooled branch, not to something after the
    // schedule: it must fall between the branch opening and the schedule.
    const earlyReturn = fn.indexOf('return', branch)
    expect(earlyReturn).toBeGreaterThan(branch)
    expect(earlyReturn).toBeLessThan(scheduleStart)
  })
})

describe('the cron entry point', () => {
  it('knows exactly three jobs and rejects anything else', async () => {
    const { FLEET_CRON_JOBS, isFleetCronJobName } = await import('@/lib/server/cron/fleet-jobs')
    expect(Object.keys(FLEET_CRON_JOBS).sort()).toEqual(['daily', 'hourly', 'housekeeping'])
    expect(isFleetCronJobName('daily')).toBe(true)
    expect(isFleetCronJobName('hourly')).toBe(true)
    expect(isFleetCronJobName('housekeeping')).toBe(true)
    expect(isFleetCronJobName('weekly')).toBe(false)
    // Not a prototype walk: `toString` must not read as a job name.
    expect(isFleetCronJobName('toString')).toBe(false)
    expect(isFleetCronJobName('constructor')).toBe(false)
  })
})
