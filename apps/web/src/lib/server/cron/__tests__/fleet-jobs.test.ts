/**
 * The worker's timers and the one-shot `QUACKBACK_CRON_JOB` bodies must stay
 * one list.
 *
 * Under pooled tenancy every scheduled sweep funnels through `withSweepLock`,
 * which fans the tick out across the fleet. The always-on worker arms those
 * timers itself — the same schedule as a single-workspace install. A sweep
 * added to `fleet-jobs.ts` but not to `startup.ts`'s schedule would silently
 * stop running on the live fleet. So this suite reads both sources and
 * asserts they name the same work.
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

  it('is exactly the twelve locks the fleet has, all defined in one module', () => {
    const names = sweepLockNames(jobsSource)
    // Written out rather than derived, so a sweep deleted from the module makes
    // this fail instead of quietly shrinking both sides of a comparison.
    expect([...names].sort()).toEqual([
      'audit_prune',
      'changelog_notify',
      'daily_cycle',
      'events_prune',
      'fleet_migrator',
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
    // startup.ts used to hold these bodies inline. The schedule must keep
    // calling `jobs.run…()` rather than taking the lock itself, or a one-shot
    // `QUACKBACK_CRON_JOB` run would drift from the live timers.
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

describe('the worker arms the sweep schedule under either tenancy mode', () => {
  const startupSource = read('startup.ts')

  it('does not skip the sweep schedule when tenancy is pooled', () => {
    // Compute and Postgres stay up, so a pooled worker runs the same timers
    // as a single-workspace install. An early return gated on pooled tenancy
    // would silently park the fleet's sweeps on cron containers we no longer
    // run.
    const fn = startupSource.slice(startupSource.indexOf('function startBackgroundProcessing'))
    expect(fn).not.toBe('')

    const jobWorker = fn.indexOf('startJobWorker')
    const scheduleStart = fn.indexOf("import('@/lib/server/cron/fleet-jobs')")
    expect(jobWorker).toBeGreaterThan(-1)
    expect(fn).not.toContain('startRelayTier')
    expect(scheduleStart).toBeGreaterThan(jobWorker)
    expect(fn).not.toMatch(/if\s*\(\s*config\.isPooledTenancy\s*\)/)
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
