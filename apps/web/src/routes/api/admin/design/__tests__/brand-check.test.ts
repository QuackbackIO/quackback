/**
 * The check route needs the branding permission, refuses a body it cannot
 * read before any work starts, and answers a step as JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), run: vi.fn(), flag: vi.fn() }))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({ isFeatureEnabled: mocks.flag }))
vi.mock('@/lib/server/domains/design/ai/brand-check-request', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runBrandCheckRequest: mocks.run,
}))

import { handleBrandCheck } from '../brand-check'
import { SSE_KEEPALIVE_INTERVAL_MS } from '@/lib/server/domains/assistant/agui'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQ'
const post = (data: unknown) =>
  handleBrandCheck({
    request: new Request('http://x/api/admin/design/brand-check', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  })

beforeEach(() => {
  mocks.requireAuth.mockReset().mockResolvedValue({ principal: { id: 'p1' } })
  mocks.run.mockReset()
  mocks.flag.mockReset().mockResolvedValue(true)
})

describe('POST /api/admin/design/brand-check', () => {
  it('scores a reading', async () => {
    mocks.run.mockResolvedValue({ ok: true, measured: 80, critic: 6, combined: 7 })
    const res = await post({
      op: 'score',
      round: 0,
      target: { headline: { size: 48 } },
      actual: { headline: { size: 56, family: 'Inter' }, button: null },
      picture: null,
      shots: [JPEG],
    })
    expect(await res.json()).toMatchObject({ ok: true, combined: 7 })
    expect(mocks.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_BRANDING })
    expect(mocks.run.mock.calls[0]![0]).toMatchObject({ op: 'score', round: 0 })
  })

  it('refuses a body it cannot read', async () => {
    const res = await post({ op: 'score', round: 0, target: {}, actual: {}, shots: [] })
    expect(res.status).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('needs the branding permission', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Access denied: branding'))
    expect((await post({ op: 'revise' })).status).toBe(403)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('refuses while the brandCheckLoop Labs flag is off, before any work starts', async () => {
    mocks.flag.mockResolvedValue(false)
    const res = await post({ op: 'revise' })
    expect(await res.json()).toMatchObject({ ok: false, code: 'CHECK_OFF' })
    expect(mocks.flag).toHaveBeenCalledWith('brandCheckLoop')
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('keeps a step that thinks past the server idle timeout alive with whitespace before the JSON', async () => {
    // Bun closes a connection that has written nothing for 10 s, a slow handler included.
    let finish!: () => void
    mocks.run.mockImplementation(
      () =>
        new Promise((done) => {
          finish = () => done({ ok: true, measured: 80, critic: 6, combined: 7 })
        })
    )
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const res = await post({
        op: 'score',
        round: 0,
        target: { headline: { size: 48 } },
        actual: { headline: { size: 56, family: 'Inter' }, button: null },
        picture: null,
        shots: [JPEG],
      })
      expect(res.headers.get('Content-Type')).toContain('application/json')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      const first = reader.read()
      await vi.advanceTimersByTimeAsync(SSE_KEEPALIVE_INTERVAL_MS)
      expect(decoder.decode((await first).value).trim()).toBe('')
      finish()
      let rest = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        rest += decoder.decode(value)
      }
      expect(JSON.parse(rest)).toMatchObject({ ok: true, combined: 7 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a step that throws as a refusal', async () => {
    mocks.run.mockRejectedValue(new Error('boom'))
    const res = await post({
      op: 'score',
      round: 0,
      target: { headline: { size: 48 } },
      actual: { headline: { size: 56, family: 'Inter' }, button: null },
      picture: null,
      shots: [JPEG],
    })
    expect(await res.json()).toMatchObject({ ok: false, code: 'AI_FAILED' })
  })
})
