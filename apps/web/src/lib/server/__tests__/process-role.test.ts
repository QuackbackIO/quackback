import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRoleWarningForTests,
  assertProcessRoleConfigured,
  getProcessRole,
  InvalidProcessRole,
  isMigratorRole,
  shouldRunWorkers,
} from '../process-role'

describe('getProcessRole', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    __resetRoleWarningForTests()
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
    // would have quietly booted the job worker's fifteen queues and six sweepers
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

  // The measured failure: `banana`, `MIGRATOR`, `Migrator` and `'migrator '`
  // all returned 'all' and booted the job worker AND the sweepers. The
  // allowlist was over the ProcessRole union rather than over the
  // environment string, so a case typo missed every comparison and fell through
  // to a default that starts everything.
  // 'all ' and ' ' are deliberately NOT here: they trim to 'all' and to unset
  // respectively, which are both legitimate. Including them was my own bad
  // fixture and the suite caught it.
  it.each(['banana', 'MIGRATOR', 'Migrator', 'WEB', 'Worker', 'al l', 'web,worker'])(
    'fails CLOSED for QUACKBACK_ROLE=%j — never to the everything-role',
    (raw) => {
      vi.stubEnv('QUACKBACK_ROLE', raw)
      expect(getProcessRole()).not.toBe('all')
      expect(getProcessRole()).not.toBe('worker')
      expect(shouldRunWorkers()).toBe(false)
      expect(isMigratorRole()).toBe(false)
    }
  )

  it('trims whitespace, because a trailing space is a YAML artefact not an intent', () => {
    vi.stubEnv('QUACKBACK_ROLE', 'migrator ')
    expect(getProcessRole()).toBe('migrator')
    vi.stubEnv('QUACKBACK_ROLE', '  worker')
    expect(getProcessRole()).toBe('worker')
  })

  it('treats an empty value as unset, not as invalid', () => {
    vi.stubEnv('QUACKBACK_ROLE', '')
    expect(getProcessRole()).toBe('all')
    expect(() =>
      assertProcessRoleConfigured({ QUACKBACK_ROLE: '' } as NodeJS.ProcessEnv)
    ).not.toThrow()
  })
})

describe('assertProcessRoleConfigured', () => {
  it('refuses to boot on an unrecognised role', () => {
    for (const raw of ['banana', 'MIGRATOR', 'Migrator']) {
      expect(() =>
        assertProcessRoleConfigured({ QUACKBACK_ROLE: raw } as NodeJS.ProcessEnv)
      ).toThrow(InvalidProcessRole)
    }
  })

  it('accepts every documented role, and an unset one', () => {
    for (const raw of ['web', 'worker', 'all', 'migrator', undefined]) {
      expect(() =>
        assertProcessRoleConfigured({ QUACKBACK_ROLE: raw } as NodeJS.ProcessEnv)
      ).not.toThrow()
    }
  })
})
