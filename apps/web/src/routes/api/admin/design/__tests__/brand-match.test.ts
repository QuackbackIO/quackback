/**
 * The brand match route streams each stage's step as it starts, then the
 * result, as server-sent events; it needs the branding permission and
 * refuses screenshots it cannot read before any work starts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  run: vi.fn(),
  flag: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({ isFeatureEnabled: mocks.flag }))
vi.mock('@/lib/server/domains/design/ai/brand-match-request', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runBrandMatchRequest: mocks.run,
}))

import { handleBrandMatch } from '../brand-match'
import { SSE_KEEPALIVE_INTERVAL_MS } from '@/lib/server/domains/assistant/agui'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const body = {
  message: 'match my brand',
  images: [{ palette: ['#0058a3'], analysis: PNG, width: 1440, height: 900 }],
}
const post = (data: unknown) =>
  handleBrandMatch({
    request: new Request('http://x/api/admin/design/brand-match', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  })

/** The stream's events, parsed. */
async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)))
}

beforeEach(() => {
  mocks.requireAuth.mockReset().mockResolvedValue({ principal: { id: 'p1' } })
  mocks.run.mockReset()
  mocks.flag.mockReset().mockResolvedValue(true)
})

describe('POST /api/admin/design/brand-match', () => {
  it('streams the steps in order, then the result', async () => {
    mocks.run.mockImplementation(async (_data, _auth, onStep: (s: string) => void) => {
      onStep('read')
      onStep('measure')
      await new Promise((done) => setTimeout(done, 5))
      onStep('fonts')
      return { ok: true, reply: 'Matched.', applied: [] }
    })
    const res = await post(body)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(mocks.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const got = await events(res)
    expect(got.filter((e) => e.type === 'STEP_STARTED').map((e) => e.stepName)).toEqual([
      'Reading your screenshots',
      'Measuring colours and type',
      'Matching fonts',
    ])
    expect(got.at(-1)).toMatchObject({
      type: 'CUSTOM',
      name: 'brand-match-result',
      value: { ok: true, reply: 'Matched.' },
    })
  })

  it('says the match failed when it throws, still as a result', async () => {
    mocks.run.mockRejectedValue(new Error('boom'))
    const got = await events(await post(body))
    expect(got.at(-1)).toMatchObject({
      name: 'brand-match-result',
      value: { ok: false, code: 'AI_FAILED' },
    })
  })

  it('keeps a stage that is silent for longer than the server idle timeout alive with SSE comments', async () => {
    // Bun closes a connection that carries no bytes for 10 s; one stage (the read) can take 17 s.
    let finish!: () => void
    mocks.run.mockImplementation(async (_data, _auth, onStep: (s: string) => void) => {
      onStep('read')
      await new Promise<void>((done) => {
        finish = done
      })
      return { ok: true, reply: 'Matched.', applied: [] }
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const res = await post(body)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      expect(decoder.decode((await reader.read()).value)).toContain('STEP_STARTED')
      const next = reader.read()
      await vi.advanceTimersByTimeAsync(SSE_KEEPALIVE_INTERVAL_MS)
      expect(decoder.decode((await next).value)).toBe(': keepalive\n\n')
      expect(SSE_KEEPALIVE_INTERVAL_MS).toBeLessThan(10_000 / 2)
      finish()
      let rest = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        rest += decoder.decode(value)
      }
      expect(rest).toContain('brand-match-result')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands the match the request signal, so it saves nothing once the builder has gone', async () => {
    mocks.run.mockResolvedValue({ ok: true, reply: 'Matched.', applied: [] })
    await events(await post(body))
    expect(mocks.run.mock.calls[0]![3]).toBeInstanceOf(AbortSignal)
  })

  it('refuses screenshots that are not images, and people without branding access', async () => {
    expect(
      (await post({ ...body, images: [{ ...body.images[0], analysis: 'nope' }] })).status
    ).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
    mocks.requireAuth.mockRejectedValue(new Error('Access denied: branding'))
    expect((await post(body)).status).toBe(403)
  })

  it('leaves the check after the match off unless the brandCheckLoop Labs flag is on', async () => {
    const target = { fingerprint: {}, checkable: true, paths: [] }
    mocks.run.mockResolvedValue({ ok: true, reply: 'Matched.', applied: [], target })
    mocks.flag.mockResolvedValue(false)
    const off = (await events(await post(body))).at(-1) as { value: { target: unknown } }
    expect(off.value.target).toMatchObject({ checkable: false })
    expect(mocks.flag).toHaveBeenCalledWith('brandCheckLoop')
    mocks.flag.mockResolvedValue(true)
    const on = (await events(await post(body))).at(-1) as { value: { target: unknown } }
    expect(on.value.target).toMatchObject({ checkable: true })
  })
})
