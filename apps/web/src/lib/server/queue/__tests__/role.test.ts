import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProcessRole, isMigratorRole, shouldRunWorkers } from '../role'

describe('getProcessRole', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to all when QUACKBACK_ROLE is unset', () => {
    vi.stubEnv('QUACKBACK_ROLE', undefined)
    expect(getProcessRole()).toBe('all')
    expect(shouldRunWorkers()).toBe(true)
  })

  it('returns all for QUACKBACK_ROLE=all', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'all')
    expect(getProcessRole()).toBe('all')
    expect(shouldRunWorkers()).toBe(true)
  })

  it('returns worker for QUACKBACK_ROLE=worker', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'worker')
    expect(getProcessRole()).toBe('worker')
    expect(shouldRunWorkers()).toBe(true)
  })

  it('returns web for QUACKBACK_ROLE=web', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'web')
    expect(getProcessRole()).toBe('web')
    expect(shouldRunWorkers()).toBe(false)
  })

  it('returns migrator for QUACKBACK_ROLE=migrator, and starts NO workers', () => {
    // The reason `shouldRunWorkers` is an allowlist and not `!== 'web'`: the
    // negative form answers "true" for every role added after it, so this role
    // would have quietly booted fifteen BullMQ workers and six sweepers
    // alongside a fleet migration.
    vi.stubEnv('QUACKBACK_ROLE', 'migrator')
    expect(getProcessRole()).toBe('migrator')
    expect(shouldRunWorkers()).toBe(false)
    expect(isMigratorRole()).toBe(true)
  })

  it('is not the migrator under any other role', () => {
    for (const role of ['web', 'worker', 'all', 'banana']) {
      vi.stubEnv('QUACKBACK_ROLE', role)
      expect(isMigratorRole()).toBe(false)
    }
  })

  it('falls back to all for an invalid QUACKBACK_ROLE', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'banana')
    expect(getProcessRole()).toBe('all')
    expect(shouldRunWorkers()).toBe(true)
  })
})
