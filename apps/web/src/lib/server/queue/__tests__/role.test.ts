import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProcessRole, shouldRunWorkers } from '../role'

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

  it('falls back to all for an invalid QUACKBACK_ROLE', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'banana')
    expect(getProcessRole()).toBe('all')
    expect(shouldRunWorkers()).toBe(true)
  })
})
