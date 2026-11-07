/**
 * A brand match saves its changes to the draft only while the builder that
 * asked is still listening: when the connection has gone (the builder has
 * already said the match failed), nothing is saved, so the draft and what
 * the builder said agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  brandMatch: vi.fn(),
  capture: vi.fn(),
  readSite: vi.fn(),
  siteOnly: vi.fn(),
}))

vi.mock('../design-ai', () => ({
  designAiModel: () => ({ id: 'model' }),
  allowanceRefusal: async () => null,
}))
vi.mock('../../design.actions', () => ({
  readDraftForChange: async () => ({ design: { brand: { logo: { mark: {} } } }, revision: 'r1' }),
  saveDesignDraft: mocks.save,
}))
vi.mock('../../design-author', () => ({ designAuthor: async () => ({ id: 'p1' }) }))
vi.mock('../../design-allowances', () => ({
  designAllowances: async () => ({ name: 'Acme', hasMark: false }),
}))
vi.mock('../brand-match', () => ({ brandMatch: mocks.brandMatch }))
vi.mock('../brand-calls', () => ({ brandMatchDeps: () => ({}) }))
vi.mock('../brand-start', () => ({ matchBrand: vi.fn() }))
vi.mock('../../site/capture-service', () => ({ getSiteCapture: mocks.capture }))
vi.mock('../../site/site-read', () => ({ readSite: mocks.readSite, liveSiteFetcher: vi.fn() }))
vi.mock('../../site/capture-shots', () => ({
  shotFromCapture: () => ({
    shot: {
      analysis: 'data:image/jpeg;base64,AA==',
      strip: 'data:image/png;base64,AA==',
      width: 1440,
      height: 900,
    },
    jpeg: 'data:image/jpeg;base64,BB==',
    dimmed: false,
  }),
}))
vi.mock('../brand-site-match', () => ({ siteOnlyMatch: mocks.siteOnly }))

import { runBrandMatchRequest } from '../brand-match-request'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

const data = {
  message: 'match my brand',
  images: [{ palette: [], analysis: 'data:image/png;base64,AA==', width: 1440, height: 900 }],
}
const auth = { principal: { id: 'principal_1' } } as unknown as AuthContext
const matched = {
  ok: true,
  reply: 'I matched your brand from your screenshot: blue.',
  design: { changed: true },
  applied: [{ path: 'colors.accent' }],
}

const facts = {
  url: 'https://www.acme.test/',
  colours: [{ hex: '#123456', from: '--brand', weight: 3 }],
}
const read = { facts, favicon: null, logo: null, shareImage: null, failed: null }

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({ ok: true, report: {}, revision: 'r2' })
  mocks.brandMatch.mockReset().mockResolvedValue(matched)
  mocks.capture.mockReset()
  mocks.readSite.mockReset().mockResolvedValue(read)
  mocks.siteOnly.mockReset().mockResolvedValue({ ...matched, reply: 'From the site.' })
})

describe('runBrandMatchRequest', () => {
  it('saves the changes while the builder is listening', async () => {
    const result = await runBrandMatchRequest(data, auth, () => {}, new AbortController().signal)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, revision: 'r2' })
  })

  it('stamps the saved draft and the design it returns with when the match ran', async () => {
    const result = await runBrandMatchRequest(data, auth, () => {})
    const saved = mocks.save.mock.calls[0]![0] as {
      changed: boolean
      brand: { matchedAt?: string }
    }
    expect(saved.changed).toBe(true)
    expect(saved.brand.matchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result).toMatchObject({ design: { brand: { matchedAt: saved.brand.matchedAt } } })
  })

  it('saves nothing once the builder has gone', async () => {
    const gone = new AbortController()
    mocks.brandMatch.mockImplementation(async () => {
      gone.abort()
      return matched
    })
    const result = await runBrandMatchRequest(data, auth, () => {}, gone.signal)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' })
  })
})

describe('the first screen for a hero photo', () => {
  it('passes it to the match, and refuses one past its bound or not a JPEG', async () => {
    const { brandMatchRequest } = await import('../brand-match-request')
    const hero = 'data:image/jpeg;base64,AAAA'
    const shot = { ...data.images[0]!, hero }
    expect(brandMatchRequest.safeParse({ ...data, images: [shot] }).success).toBe(true)
    const big = { ...shot, hero: `data:image/jpeg;base64,${'A'.repeat(5_000_000)}` }
    expect(brandMatchRequest.safeParse({ ...data, images: [big] }).success).toBe(false)
    const png = { ...shot, hero: 'data:image/png;base64,AAAA' }
    expect(brandMatchRequest.safeParse({ ...data, images: [png] }).success).toBe(false)
    await runBrandMatchRequest({ ...data, images: [shot] }, auth, () => {})
    expect(mocks.brandMatch.mock.calls[0]![0].shots[0].hero).toBe(hero)
  })
})

describe('a website', () => {
  const steps = () => {
    const seen: string[] = []
    return { seen, on: (s: string) => seen.push(s) }
  }

  it('needs a screenshot or a website', async () => {
    const { brandMatchRequest } = await import('../brand-match-request')
    expect(brandMatchRequest.safeParse({ message: '', images: [] }).success).toBe(false)
    expect(brandMatchRequest.safeParse({ message: '', images: [], url: 'acme.test' }).success).toBe(
      true
    )
  })

  it('with screenshots, is read beside them and never captured', async () => {
    const s = steps()
    await runBrandMatchRequest({ ...data, url: 'acme.test' }, auth, s.on)
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.readSite).toHaveBeenCalledWith('https://acme.test/', expect.anything())
    expect(await mocks.brandMatch.mock.calls[0]![0].site).toBe(read)
    expect(s.seen).toEqual(['site'])
  })

  it('alone, is captured for the signed-in admin and matched as a screenshot', async () => {
    mocks.capture.mockResolvedValue({
      ok: true,
      host: 'acme.test',
      url: 'https://acme.test/',
      cached: true,
      capturedAt: new Date('2026-11-01T10:00:00Z'),
      image: {
        key: 'site-captures/acme.test/1.png',
        width: 1440,
        height: 900,
        png: new Uint8Array([1]),
      },
      facts,
      usage: {},
    })
    const s = steps()
    const result = await runBrandMatchRequest(
      { message: '', images: [], url: 'https://www.acme.test/pricing' },
      auth,
      s.on
    )
    expect(mocks.capture).toHaveBeenCalledWith({
      url: 'https://www.acme.test/',
      principalId: 'principal_1',
      recapture: false,
      loadImage: true,
    })
    const input = mocks.brandMatch.mock.calls[0]![0]
    expect(input.shots).toHaveLength(1)
    expect(input.shots[0].analysis).toBe('data:image/jpeg;base64,AA==')
    expect(s.seen).toEqual(['capture'])
    expect(result).toMatchObject({
      ok: true,
      capture: { host: 'acme.test', cached: true, againFrom: '2026-11-02T10:00:00.000Z' },
      reply: 'I matched your brand from a capture of acme.test: blue.',
    })
  })

  it('passes Capture again on', async () => {
    mocks.capture.mockResolvedValue({
      ok: false,
      host: 'acme.test',
      reason: 'recapture_too_soon',
      facts,
      message: 'You can capture it again tomorrow.',
    })
    await runBrandMatchRequest(
      { message: '', images: [], url: 'acme.test', recapture: true },
      auth,
      () => {}
    )
    expect(mocks.capture.mock.calls[0]![0].recapture).toBe(true)
  })

  it('without a capture, matches from the site’s code and says why', async () => {
    mocks.capture.mockResolvedValue({
      ok: false,
      host: 'acme.test',
      reason: 'limit',
      facts,
      message: 'Captures are used up for this month.',
    })
    const result = await runBrandMatchRequest(
      { message: '', images: [], url: 'acme.test' },
      auth,
      () => {}
    )
    expect(mocks.brandMatch).not.toHaveBeenCalled()
    expect(mocks.siteOnly).toHaveBeenCalledTimes(1)
    expect(mocks.siteOnly.mock.calls[0]![2]).toBe('Captures are used up for this month.')
    expect(result).toMatchObject({ ok: true, reply: 'From the site.' })
    // A match from the site's code is a match too: the saved draft and the result say so.
    const saved = mocks.save.mock.calls[0]![0] as { brand: { matchedAt?: string } }
    expect(saved.brand.matchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result).toMatchObject({ design: { brand: { matchedAt: saved.brand.matchedAt } } })
  })

  it('says so plainly when neither a capture nor the site’s code can be had', async () => {
    mocks.capture.mockResolvedValue({
      ok: false,
      host: 'acme.test',
      reason: 'challenge',
      facts: null,
      message: 'That site turned the capture away.',
    })
    mocks.readSite.mockResolvedValue({ ...read, failed: 'challenge' })
    const result = await runBrandMatchRequest(
      { message: '', images: [], url: 'acme.test' },
      auth,
      () => {}
    )
    expect(result).toMatchObject({ ok: false, code: 'SITE_UNREADABLE' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses an address that is not a public website, before any fetch', async () => {
    const result = await runBrandMatchRequest(
      { message: '', images: [], url: 'http://localhost:3000' },
      auth,
      () => {}
    )
    expect(result).toMatchObject({ ok: false, code: 'INVALID_URL' })
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.readSite).not.toHaveBeenCalled()
  })
})
