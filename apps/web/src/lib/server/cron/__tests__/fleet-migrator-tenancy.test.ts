/**
 * The fleet migrator walks the workspace registry, which only exists under
 * pooled tenancy. A single-workspace install has no control database, so the
 * pass must be a no-op there instead of throwing from the registry.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { enrolActiveWorkspaces, runReconcilePass, withSweepLock } = vi.hoisted(() => ({
  enrolActiveWorkspaces: vi.fn(async () => 0),
  runReconcilePass: vi.fn(async () => ({
    claimed: 0,
    reconciled: 0,
    healed: 0,
    alreadyCurrent: 0,
    failed: 0,
  })),
  withSweepLock: vi.fn(async (_n: string, _t: number, fn: () => Promise<void>) => fn()),
}))

vi.mock('@/lib/server/sweep-lock', () => ({ withSweepLock }))
vi.mock('@/lib/server/fleet/migrator', () => ({ enrolActiveWorkspaces, runReconcilePass }))

import { runFleetMigratorPass } from '@/lib/server/cron/fleet-jobs'

beforeEach(() => {
  enrolActiveWorkspaces.mockClear()
  runReconcilePass.mockClear()
  withSweepLock.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('runFleetMigratorPass', () => {
  it('returns without touching the registry or the sweep lock on a single-workspace install', async () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    await runFleetMigratorPass()
    expect(withSweepLock).not.toHaveBeenCalled()
    expect(enrolActiveWorkspaces).not.toHaveBeenCalled()
    expect(runReconcilePass).not.toHaveBeenCalled()
  })

  it('runs the enrol and reconcile pass under pooled tenancy', async () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    await runFleetMigratorPass()
    expect(enrolActiveWorkspaces).toHaveBeenCalledOnce()
    expect(runReconcilePass).toHaveBeenCalledOnce()
  })
})

describe('the startup schedule', () => {
  it('arms the migrator timers only under pooled tenancy', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', '..', 'startup.ts'), 'utf8')
    const block = src.match(
      /if \(config\.isPooledTenancy\) \{\s*setTimeout\(\(\) => void jobs\.runFleetMigratorPass\(\)[^}]*\}/
    )
    expect(block).not.toBeNull()
    expect(block![0]).toContain('setInterval(() => void jobs.runFleetMigratorPass()')
  })
})
