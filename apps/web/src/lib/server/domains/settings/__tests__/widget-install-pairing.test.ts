import { beforeEach, describe, expect, it, vi } from 'vitest'

const kvSet = vi.fn()
const dbExecute = vi.fn()
const ensureWidgetSecret = vi.fn()
const updateWidgetConfig = vi.fn()
const getBaseUrl = vi.fn(() => 'https://feedback.example.com/')

vi.mock('@/lib/server/kv/pg-kv', () => ({ kvSet: (...a: unknown[]) => kvSet(...a) }))
vi.mock('@/lib/server/db', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => getBaseUrl() }))
vi.mock('../settings.widget', () => ({
  ensureWidgetSecret: (...a: unknown[]) => ensureWidgetSecret(...a),
  updateWidgetConfig: (...a: unknown[]) => updateWidgetConfig(...a),
}))

import {
  WIDGET_INSTALL_CODE_MAX_USES,
  WIDGET_INSTALL_CODE_PREFIX,
  WIDGET_INSTALL_CODE_TTL_SECONDS,
  consumeWidgetInstallCode,
  generateWidgetInstallCode,
  hashWidgetInstallCode,
  mintWidgetInstallCode,
  redeemWidgetInstallCode,
  widgetInstallPairingKey,
} from '../widget-install-pairing'

beforeEach(() => {
  vi.clearAllMocks()
  ensureWidgetSecret.mockResolvedValue('wgt_mintedsecret')
  updateWidgetConfig.mockResolvedValue({ enabled: true })
  dbExecute.mockResolvedValue([{ remaining: 1 }])
})

describe('generateWidgetInstallCode', () => {
  it('is a short opaque qbi_ code', () => {
    const code = generateWidgetInstallCode()
    expect(code.startsWith(WIDGET_INSTALL_CODE_PREFIX)).toBe(true)
    expect(code.length).toBeGreaterThan(12)
    expect(code).not.toContain('wgt_')
    expect(generateWidgetInstallCode()).not.toBe(code)
  })
})

describe('hashWidgetInstallCode', () => {
  it('is a stable sha256 hex of the trimmed code', () => {
    const hash = hashWidgetInstallCode(' qbi_abc ')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashWidgetInstallCode('qbi_abc')).toBe(hash)
    expect(hashWidgetInstallCode('qbi_other')).not.toBe(hash)
  })
})

describe('mintWidgetInstallCode', () => {
  it('ensures a secret exists and stores a hashed TTL record with two uses', async () => {
    const minted = await mintWidgetInstallCode()
    expect(ensureWidgetSecret).toHaveBeenCalledTimes(1)
    expect(minted).toEqual({ code: expect.stringMatching(/^qbi_/) })
    expect(kvSet).toHaveBeenCalledWith(
      widgetInstallPairingKey(hashWidgetInstallCode(minted.code)),
      { remaining: WIDGET_INSTALL_CODE_MAX_USES },
      WIDGET_INSTALL_CODE_TTL_SECONDS
    )
  })
})

describe('consumeWidgetInstallCode', () => {
  it('returns true when the statement consumes a live use', async () => {
    dbExecute.mockResolvedValue([{ remaining: 1 }])
    await expect(consumeWidgetInstallCode('qbi_live')).resolves.toBe(true)
  })

  it('returns false for expiry or reuse (no row)', async () => {
    dbExecute.mockResolvedValue([])
    await expect(consumeWidgetInstallCode('qbi_dead')).resolves.toBe(false)
  })
})

describe('redeemWidgetInstallCode', () => {
  it('returns instance URL, sdk URL, and signing secret and enables the widget', async () => {
    const result = await redeemWidgetInstallCode('qbi_ok')
    expect(result).toEqual({
      instanceUrl: 'https://feedback.example.com',
      sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
      signingSecret: 'wgt_mintedsecret',
    })
    expect(updateWidgetConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it('returns null without enabling when the code is spent or expired', async () => {
    dbExecute.mockResolvedValue([])
    await expect(redeemWidgetInstallCode('qbi_spent')).resolves.toBeNull()
    expect(ensureWidgetSecret).not.toHaveBeenCalled()
    expect(updateWidgetConfig).not.toHaveBeenCalled()
  })
})
