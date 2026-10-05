/**
 * Before onboarding there is no settings row, so settings reads throw
 * SETTINGS_NOT_FOUND during sign-up. That is an expected state and logs at
 * debug; any other failure stays an error.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InternalError, NotFoundError } from '@/lib/shared/errors'
import { isSettingsNotYetCreated, logSettingsReadError } from '../settings-log'

function logDouble() {
  return { error: vi.fn(), debug: vi.fn() }
}

describe('isSettingsNotYetCreated', () => {
  it('is true only for the settings-not-found refusal', () => {
    expect(
      isSettingsNotYetCreated(new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found'))
    ).toBe(true)
    expect(isSettingsNotYetCreated(new NotFoundError('POST_NOT_FOUND', 'Post not found'))).toBe(
      false
    )
    expect(isSettingsNotYetCreated(new Error('Settings not found'))).toBe(false)
    expect(isSettingsNotYetCreated(new InternalError('DATABASE_ERROR', 'boom'))).toBe(false)
    expect(isSettingsNotYetCreated(null)).toBe(false)
  })
})

describe('logSettingsReadError', () => {
  it('logs the not-yet-onboarded case at debug', () => {
    const log = logDouble()
    const err = new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    logSettingsReadError(log, err, 'get auth config failed')
    expect(log.error).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith({ err }, 'get auth config failed')
  })

  it('keeps real failures at error', () => {
    const log = logDouble()
    const err = new InternalError('DATABASE_ERROR', 'connection refused')
    logSettingsReadError(log, err, 'get auth config failed')
    expect(log.debug).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith({ err }, 'get auth config failed')
  })
})

describe('which call sites downgrade', () => {
  const dir = join(__dirname, '..')
  const sources = ['settings.service.ts', 'settings.widget.ts'].map((f) =>
    readFileSync(join(dir, f), 'utf8')
  )
  const downgraded = sources.flatMap((s) =>
    [...s.matchAll(/logSettingsReadError\(log, error, '([^']+)'\)/g)].map((m) => m[1])
  )

  it('downgrades exactly the pre-onboarding reads', () => {
    expect([...downgraded].sort()).toEqual([
      'get auth config failed',
      'get portal config failed',
      'get public auth config failed',
      'get public portal config failed',
      'get public widget config failed',
      'get widget config failed',
      'get workspace settings failed',
    ])
  })

  it('keeps write paths at error', () => {
    const all = sources.join('\n')
    for (const msg of [
      'update auth config failed',
      'update widget config failed',
      'update portal config failed',
      'update developer config failed',
      'update help center config failed',
      'save widget hero image key failed',
      'regenerate widget secret failed',
    ]) {
      expect(all).toContain(`log.error({ err: error }, '${msg}')`)
      expect(downgraded).not.toContain(msg)
    }
  })
})
