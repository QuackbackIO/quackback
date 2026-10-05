/**
 * Before onboarding there is no settings row, so settings reads throw
 * SETTINGS_NOT_FOUND during sign-up. That is an expected state and logs at
 * debug; any other failure stays an error.
 */
import { describe, expect, it, vi } from 'vitest'
import { InternalError, NotFoundError } from '@/lib/shared/errors'
import { isSettingsNotYetCreated, logSettingsError } from '../settings-log'

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

describe('logSettingsError', () => {
  it('logs the not-yet-onboarded case at debug', () => {
    const log = logDouble()
    const err = new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    logSettingsError(log, err, 'get auth config failed')
    expect(log.error).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith({ err }, 'get auth config failed')
  })

  it('keeps real failures at error', () => {
    const log = logDouble()
    const err = new InternalError('DATABASE_ERROR', 'connection refused')
    logSettingsError(log, err, 'get auth config failed')
    expect(log.debug).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith({ err }, 'get auth config failed')
  })
})
