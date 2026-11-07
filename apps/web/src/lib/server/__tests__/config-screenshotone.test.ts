/**
 * Site capture settings: the ScreenshotOne keys are optional, and the usage
 * limits default to 90 a month for the instance, 5 a day and 30 a month for
 * the workspace, and 3 an hour for a teammate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }) },
}))

const { config, resetConfig } = await import('../config')

const VARS = [
  'SCREENSHOTONE_ACCESS_KEY',
  'SCREENSHOTONE_SECRET_KEY',
  'SCREENSHOTONE_MONTHLY_LIMIT',
  'SCREENSHOTONE_WORKSPACE_DAILY_LIMIT',
  'SCREENSHOTONE_WORKSPACE_MONTHLY_LIMIT',
  'SCREENSHOTONE_USER_HOURLY_LIMIT',
]

let saved: NodeJS.ProcessEnv
beforeEach(() => {
  saved = { ...process.env }
  for (const key of ['QUACKBACK_TENANCY', ...VARS]) delete process.env[key]
  Object.assign(process.env, {
    BASE_URL: 'https://app.example.com',
    SECRET_KEY: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://app@localhost:5432/quackback',
  })
  resetConfig()
})
afterEach(() => {
  process.env = saved
  resetConfig()
})

describe('site capture config', () => {
  it('defaults to no keys and the documented limits', () => {
    expect(config.screenshotoneAccessKey).toBeUndefined()
    expect(config.screenshotoneSecretKey).toBeUndefined()
    expect(config.screenshotoneMonthlyLimit).toBe(90)
    expect(config.screenshotoneWorkspaceDailyLimit).toBe(5)
    expect(config.screenshotoneWorkspaceMonthlyLimit).toBe(30)
    expect(config.screenshotoneUserHourlyLimit).toBe(3)
  })

  it('reads the keys and limits, treating blanks as unset', () => {
    Object.assign(process.env, {
      SCREENSHOTONE_ACCESS_KEY: 'access-for-test',
      SCREENSHOTONE_SECRET_KEY: '',
      SCREENSHOTONE_MONTHLY_LIMIT: '200',
      SCREENSHOTONE_WORKSPACE_DAILY_LIMIT: '10',
      SCREENSHOTONE_WORKSPACE_MONTHLY_LIMIT: '50',
      SCREENSHOTONE_USER_HOURLY_LIMIT: '',
    })
    resetConfig()
    expect(config.screenshotoneAccessKey).toBe('access-for-test')
    expect(config.screenshotoneSecretKey).toBeUndefined()
    expect(config.screenshotoneMonthlyLimit).toBe(200)
    expect(config.screenshotoneWorkspaceDailyLimit).toBe(10)
    expect(config.screenshotoneWorkspaceMonthlyLimit).toBe(50)
    expect(config.screenshotoneUserHourlyLimit).toBe(3)
  })

  it('refuses a limit that is not a whole number', () => {
    process.env.SCREENSHOTONE_MONTHLY_LIMIT = 'lots'
    resetConfig()
    expect(() => config.screenshotoneMonthlyLimit).toThrow('Configuration validation failed')
  })
})
