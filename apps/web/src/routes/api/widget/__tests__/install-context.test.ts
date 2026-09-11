import { beforeEach, describe, expect, it, vi } from 'vitest'

const redeemWidgetInstallCode = vi.fn()
const checkRateLimit = vi.fn()
const pooled = { current: false }

vi.mock('@/lib/server/domains/settings/widget-install-pairing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/widget-install-pairing')>()
  return {
    ...actual,
    redeemWidgetInstallCode: (...a: unknown[]) => redeemWidgetInstallCode(...a),
  }
})
vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkWidgetInstallContextRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}))
vi.mock('@/lib/server/workspaces/mode', () => ({
  isPooledTenancy: () => pooled.current,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

import { handleWidgetInstallContext } from '../install-context'

function post(body: unknown, url = 'http://127.0.0.1:3020/api/widget/install-context') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pooled.current = false
  checkRateLimit.mockResolvedValue({ allowed: true })
  redeemWidgetInstallCode.mockResolvedValue({
    instanceUrl: 'https://feedback.example.com',
    sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
    signingSecret: 'wgt_fromredeem',
  })
})

describe('POST /api/widget/install-context', () => {
  it('returns instance URL, sdk URL, and signing secret on a valid code', async () => {
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      instanceUrl: 'https://feedback.example.com',
      sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
      signingSecret: 'wgt_fromredeem',
    })
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
  })

  it('rejects an unknown or spent code', async () => {
    redeemWidgetInstallCode.mockResolvedValue(null)
    const res = await handleWidgetInstallContext(post({ code: 'qbi_unknowncode' }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'CODE_INVALID' } })
  })

  it('rate-limits by IP', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 })
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(429)
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('requires HTTPS on Cloud (pooled tenancy)', async () => {
    pooled.current = true
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'HTTPS_REQUIRED' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('allows HTTPS Cloud redeem', async () => {
    pooled.current = true
    const res = await handleWidgetInstallContext(
      new Request('https://acme.quackback.app/api/widget/install-context', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '203.0.113.9',
        },
        body: JSON.stringify({ code: 'qbi_validcode12' }),
      })
    )
    expect(res.status).toBe(200)
  })
})
