/**
 * Work registered against a settings write's transaction runs only after that
 * transaction commits, once; a rollback drops it; a write that owns its own
 * transaction runs it at once.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/lib/server/db'
import {
  afterSettingsCommit,
  dropAfterSettingsCommit,
  runAfterSettingsCommit,
} from '../settings.after-commit'

const tx = () => ({}) as unknown as Transaction

describe('settings after-commit work', () => {
  it('runs at once without a transaction', () => {
    const work = vi.fn()
    afterSettingsCommit(undefined, work)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('waits for the commit, then runs once', () => {
    const t = tx()
    const work = vi.fn()
    afterSettingsCommit(t, work)
    expect(work).not.toHaveBeenCalled()
    runAfterSettingsCommit(t)
    runAfterSettingsCommit(t)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('drops the work of a transaction that rolled back', () => {
    const t = tx()
    const work = vi.fn()
    afterSettingsCommit(t, work)
    dropAfterSettingsCommit(t)
    runAfterSettingsCommit(t)
    expect(work).not.toHaveBeenCalled()
  })
})
