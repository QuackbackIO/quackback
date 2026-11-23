/**
 * The shared `db` must not be used inside `db.transaction`: the transaction
 * holds a pool connection, so a query on the pool waits for a second one, and
 * with a pool of one that wait never ends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/server/db'
import { runInAfterCommitFrame } from '@/lib/server/workspaces/after-commit'

describe('shared db inside a transaction', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws outside production, naming what was used', async () => {
    await expect(runInAfterCommitFrame(async () => db.select)).rejects.toThrow(
      'db.select was used inside db.transaction'
    )
  })

  it('treats a nested db.transaction the same way', async () => {
    await expect(runInAfterCommitFrame(async () => db.transaction)).rejects.toThrow(
      'db.transaction was used inside db.transaction'
    )
  })

  it('still throws in a production build run by the e2e suites', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('E2E_HARNESS', '1')
    await expect(runInAfterCommitFrame(async () => db.select)).rejects.toThrow(
      'db.select was used inside db.transaction'
    )
  })

  it('lets the call through in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    // Past the guard, the proxy goes on to resolve a database; any failure from
    // here on is that resolution, not the guard.
    const error = await runInAfterCommitFrame(async () => db.select).catch((err: Error) => err)
    expect(String(error)).not.toContain('used inside db.transaction')
  })
})
