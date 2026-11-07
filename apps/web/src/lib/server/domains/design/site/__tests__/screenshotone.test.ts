import { describe, expect, it, vi } from 'vitest'
import {
  CLEAN_UP_SCRIPT,
  CLEAN_UP_STYLES,
  CHALLENGE_PHRASES,
  HIDE_SELECTORS,
  SCREENSHOTONE_ENDPOINT,
  captureLocale,
  captureQuery,
  captureRequestUrl,
  pngSize,
  redactedRequest,
  signQuery,
  takeCapture,
} from '../screenshotone'
import { CONSENT_WORDS } from '../consent'
import { fakePng } from './capture-fixtures'

const ACCESS = 'test-access-key-abc'
const SECRET = 'test-secret-key-xyz'

function params(query: string): Array<[string, string]> {
  return query.split('&').map((pair) => {
    const [k, ...rest] = pair.split('=')
    return [k, decodeURIComponent(rest.join('='))]
  })
}
function all(query: string, name: string): string[] {
  return params(query)
    .filter(([k]) => k === name)
    .map(([, v]) => v)
}
function one(query: string, name: string): string {
  const values = all(query, name)
  expect(values).toHaveLength(1)
  return values[0]
}

describe('signQuery', () => {
  it('matches the documented test vector on the exact string', () => {
    expect(signQuery('access_key=0Ij4LFMtFnGUrA&url=https://apple.com', 'm9ajW9br9hTw2A')).toBe(
      '70bea3e52efc43834129ecbea236f38bf9bb4a7cd7c2e1951017435defd4dbaf'
    )
  })
})

describe('captureQuery', () => {
  const query = captureQuery('https://www.acme.test/', { accessKey: ACCESS })

  it('has no leading question mark and starts with the key and the target', () => {
    expect(query.startsWith('access_key=')).toBe(true)
    expect(params(query)[1]).toEqual(['url', 'https://www.acme.test/'])
  })

  it.each([
    ['access_key', ACCESS],
    ['url', 'https://www.acme.test/'],
    ['viewport_width', '1440'],
    ['viewport_height', '900'],
    ['device_scale_factor', '1'],
    ['format', 'png'],
    ['full_page', 'false'],
    ['block_ads', 'true'],
    ['block_cookie_banners', 'true'],
    ['block_chats', 'true'],
    ['block_trackers', 'true'],
    ['delay', '2'],
    ['reduced_motion', 'true'],
    ['reduce_motion', 'true'],
    ['dark_mode', 'false'],
    ['headers', 'Accept-Language:en-GB,en;q=0.9'],
    ['ip_country_code', 'gb'],
    ['time_zone', 'Europe/London'],
    ['timeout', '60'],
    ['navigation_timeout', '30'],
    ['ignore_host_errors', 'false'],
    ['cache', 'false'],
  ])('sets %s=%s', (name, value) => {
    expect(one(query, name)).toBe(value)
  })

  it('never lets the banner heuristics follow a link off the page', () => {
    expect(new URLSearchParams(query).has('block_banners_by_heuristics')).toBe(false)
  })

  it('runs the clean-up script and draws modal backdrops clear', () => {
    expect(one(query, 'scripts')).toBe(CLEAN_UP_SCRIPT)
    expect(one(query, 'styles')).toBe(CLEAN_UP_STYLES)
    // The script parses, and closes only consent dialogs or empty ones.
    expect(() => new Function(CLEAN_UP_SCRIPT)).not.toThrow()
    // The dialog test is the design domain's one consent wording.
    expect(CLEAN_UP_SCRIPT).toContain(`/${CONSENT_WORDS.source}/i`)
  })

  it('repeats wait_until, hide_selectors and fail_if_content_contains', () => {
    expect(all(query, 'wait_until')).toEqual(['load', 'networkidle2'])
    expect(all(query, 'hide_selectors')).toEqual([...HIDE_SELECTORS])
    expect(all(query, 'fail_if_content_contains')).toEqual([...CHALLENGE_PHRASES])
    expect(all(query, 'fail_if_content_contains')).toContain('Just a moment...')
    expect(all(query, 'hide_selectors')).toContain('[aria-modal="true"][role="dialog"]')
  })

  it('never sets a user agent', () => {
    expect(all(query, 'user_agent')).toEqual([])
  })

  it('names every option in a fixed order', () => {
    expect([...new Set(params(query).map(([k]) => k))]).toEqual([
      'access_key',
      'url',
      'viewport_width',
      'viewport_height',
      'device_scale_factor',
      'format',
      'full_page',
      'block_ads',
      'block_cookie_banners',
      'block_chats',
      'block_trackers',
      'hide_selectors',
      'wait_until',
      'delay',
      'scripts',
      'styles',
      'reduced_motion',
      'reduce_motion',
      'dark_mode',
      'headers',
      'ip_country_code',
      'time_zone',
      'timeout',
      'navigation_timeout',
      'ignore_host_errors',
      'fail_if_content_contains',
      'cache',
    ])
    expect(captureQuery('https://www.acme.test/', { accessKey: ACCESS })).toBe(query)
  })

  it('url-encodes values', () => {
    const q = captureQuery('https://acme.test/?a=1&b=2', { accessKey: ACCESS })
    expect(q).toContain('url=https%3A%2F%2Facme.test%2F%3Fa%3D1%26b%3D2')
  })

  it("browses in the site's language", () => {
    const q = captureQuery('https://nimbus.example/', { accessKey: ACCESS, language: 'de' })
    expect(one(q, 'headers')).toBe('Accept-Language:de,en;q=0.5')
    expect(one(q, 'ip_country_code')).toBe('de')
    expect(one(q, 'time_zone')).toBe('Europe/Berlin')
  })
})

describe('captureLocale', () => {
  it.each([
    [null, 'en-GB,en;q=0.9', 'gb'],
    ['en', 'en', 'gb'],
    ['en-us', 'en-US,en;q=0.9', 'us'],
    ['fr-ca', 'fr-CA,fr;q=0.9,en;q=0.5', 'ca'],
    ['pt-br', 'pt-BR,pt;q=0.9,en;q=0.5', 'gb'],
    ['ja', 'ja,en;q=0.5', 'jp'],
    ['not a tag; x', 'en-GB,en;q=0.9', 'gb'],
  ])('%s', (language, acceptLanguage, country) => {
    const locale = captureLocale(language)
    expect(locale.acceptLanguage).toBe(acceptLanguage)
    expect(locale.country).toBe(country)
  })
})

describe('captureRequestUrl and redactedRequest', () => {
  it('signs the exact query when a secret is set', () => {
    const url = captureRequestUrl('https://acme.test/', { accessKey: ACCESS, secretKey: SECRET })
    const query = captureQuery('https://acme.test/', { accessKey: ACCESS })
    expect(url).toBe(`${SCREENSHOTONE_ENDPOINT}?${query}&signature=${signQuery(query, SECRET)}`)
  })

  it('is unsigned without a secret', () => {
    const url = captureRequestUrl('https://acme.test/', { accessKey: ACCESS, secretKey: null })
    expect(url).not.toContain('signature=')
  })

  it('drops the key and signature from the record', () => {
    const url = captureRequestUrl('https://acme.test/', { accessKey: ACCESS, secretKey: SECRET })
    const record = redactedRequest(url)
    expect(record).not.toContain(ACCESS)
    expect(record).not.toContain('signature')
    expect(record).not.toContain('access_key')
    expect(record).toContain('url=https%3A%2F%2Facme.test%2F')
  })
})

describe('pngSize', () => {
  it('reads the IHDR size', () => {
    expect(pngSize(fakePng(1440, 900))).toEqual({ width: 1440, height: 900 })
  })
  it('refuses other bytes', () => {
    expect(
      pngSize(new TextEncoder().encode('<html>not an image</html> padding padding'))
    ).toBeNull()
    expect(pngSize(fakePng(1440, 900).slice(0, 20))).toBeNull()
  })
})

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('takeCapture', () => {
  const keys = { accessKey: ACCESS, secretKey: SECRET }

  it('returns the PNG and its size', async () => {
    const fetch = vi.fn(async () => new Response(fakePng(1440, 900), { status: 200 }))
    const out = await takeCapture('https://acme.test/', { fetch, keys, language: 'en-gb' })
    expect(out).toMatchObject({ ok: true, width: 1440, height: 900 })
    expect(fetch).toHaveBeenCalledTimes(1)
    const sent = String((fetch.mock.calls[0] as unknown[])[0])
    expect(sent).toContain('signature=')
    expect(JSON.stringify(out)).not.toContain(ACCESS)
    expect(JSON.stringify(out)).not.toContain(SECRET)
  })

  it.each([
    [
      400,
      { is_successful: false, error_code: 'screenshots_limit_reached', error_message: 'x' },
      'quota',
    ],
    [400, { error: { code: 'content_contains_specified_string', message: 'x' } }, 'challenge'],
    [500, { error_code: 'host_returned_error' }, 'host_error'],
    [400, { error_code: 'name_not_resolved' }, 'host_error'],
    [500, { error: { code: 'timeout_error' } }, 'timeout'],
    [503, { error_code: 'concurrency_limit_reached' }, 'failed'],
    [400, { error_code: 'access_key_invalid' }, 'failed'],
    [400, { error_code: 'signature_is_not_valid' }, 'failed'],
    [500, 'not json', 'failed'],
  ])('maps a %s error to its reason', async (status, body, reason) => {
    const fetch = vi.fn(async () => jsonResponse(status, body))
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: false, reason, billed: false })
    expect(JSON.stringify(out)).not.toContain(ACCESS)
  })

  it('keeps only a plain error code', async () => {
    const fetch = vi.fn(async () => jsonResponse(400, { error_code: `bad ${ACCESS}` }))
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: false, reason: 'failed', code: null })
  })

  it('rejects bytes that are not a PNG', async () => {
    const fetch = vi.fn(async () => new Response('<html>hello</html> and some more text'))
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: false, reason: 'bad_image', billed: true })
  })

  it('refuses an image over the size cap', async () => {
    const fetch = vi.fn(async () => new Response(fakePng(10, 10, 5000)))
    const out = await takeCapture('https://acme.test/', { fetch, keys, maxBytes: 1000 })
    expect(out).toMatchObject({ ok: false, reason: 'too_large' })
  })

  it('times out', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const out = await takeCapture('https://acme.test/', {
      fetch,
      keys,
      timeoutMs: 10,
    })
    expect(out).toMatchObject({ ok: false, reason: 'timeout', billed: false })
  })

  it('reports a network failure without its message', async () => {
    const fetch = vi.fn(async () => {
      throw new Error(`connect failed for ${ACCESS}`)
    })
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: false, reason: 'failed', code: null })
    expect(JSON.stringify(out)).not.toContain(ACCESS)
  })
})

describe('time zones the service accepts', () => {
  // The service takes a fixed list of zones; any other refuses the request.
  const ACCEPTED = new Set([
    'America/New_York',
    'America/Toronto',
    'Asia/Shanghai',
    'Europe/Berlin',
    'Europe/London',
    'Europe/Madrid',
    'Pacific/Auckland',
  ])
  it('sends only a zone on its list, whatever the site’s language', () => {
    for (const lang of [
      'en-gb',
      'en-ie',
      'en-au',
      'fr-fr',
      'it',
      'ja',
      'de-de',
      'es',
      'en-us',
      'pt-br',
      null,
    ])
      expect(ACCEPTED.has(captureLocale(lang).timeZone), String(lang)).toBe(true)
  })
})

describe('a page that never goes quiet', () => {
  const keys = { accessKey: ACCESS, secretKey: SECRET }

  it('is asked for once more, taken at load, when the network never settled', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error_code: 'timeout_error' }))
      .mockResolvedValueOnce(new Response(fakePng(1440, 900), { status: 200 }))
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: true, attempts: 2 })
    const [first, second] = fetch.mock.calls.map((c) => new URL(String(c[0])).searchParams)
    expect(first!.getAll('wait_until')).toEqual(['load', 'networkidle2'])
    expect(second!.getAll('wait_until')).toEqual(['load'])
    expect(second!.get('delay')).toBe('3')
  })

  it('is not asked for again for any other failure', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(400, { error_code: 'content_contains_specified_string' })
    )
    const out = await takeCapture('https://acme.test/', { fetch, keys })
    expect(out).toMatchObject({ ok: false, reason: 'challenge', attempts: 1 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
