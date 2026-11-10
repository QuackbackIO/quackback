/**
 * The ScreenshotOne client: one light-mode, above-the-fold capture of a
 * site's homepage, with the noise a visitor would dismiss (cookie banners,
 * chat bubbles, newsletter pop-ups) kept out of the picture.
 *
 * Pure parts (the query, its signature, the redacted record) are separate
 * from the call so they can be tested without a network. The access key is
 * a query parameter, so the full request URL is a secret: it never leaves
 * this module except as the fetch argument. Results carry `redactedRequest`
 * instead, and errors carry only the provider's error code.
 *
 * `user_agent` is deliberately not set: the provider's docs warn it "might
 * break stealth mode capabilities", and its default browser is what passes
 * bot checks best. There is no option to wait for fonts (the `delay` covers
 * them) or to show a video's first frame (`reduce_motion` pauses video).
 */
import { createHmac } from 'node:crypto'
import { CONSENT_WORDS } from './consent'

export const SCREENSHOTONE_ENDPOINT = 'https://api.screenshotone.com/take'

/*
 * block_banners_by_heuristics is left off: on a page with an announcement
 * bar it followed the bar's link and captured another page (a blog post for
 * the homepage), and the service's docs warn it is imprecise.
 */
/** Kept generic and conservative: overlays only, never real page content. */
export const HIDE_SELECTORS = [
  '[class*="newsletter-popup"]',
  '[id*="newsletter-modal"]',
  '[class*="promo-bar"]',
  '[class*="announcement-bar"]',
  '[aria-modal="true"][role="dialog"]',
] as const

/**
 * Run on the page before the capture: closes a modal consent dialog the
 * banner blocking emptied but left open (its backdrop dims the whole page),
 * and removes a full-page translucent overlay with nothing in it. Never
 * touches anything with words or pictures in it.
 */
export const CLEAN_UP_SCRIPT = `(() => {
const consent = /${CONSENT_WORDS.source}/i;
for (const d of Array.from(document.querySelectorAll('dialog[open]'))) {
  const words = (d.innerText || '').trim();
  if (words.length < 3 || consent.test(words)) { try { d.close() } catch (e) {} d.remove() }
}
const vw = innerWidth, vh = innerHeight;
const alphaOf = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,\\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1 };
for (const el of Array.from(document.querySelectorAll('body *'))) {
  const s = getComputedStyle(el);
  if (s.position !== 'fixed' && s.position !== 'absolute') continue;
  const r = el.getBoundingClientRect();
  if (r.width < vw * 0.9 || r.height < vh * 0.9 || r.top > 1 || r.left > 1) continue;
  const a = alphaOf(s.backgroundColor) * parseFloat(s.opacity || '1');
  if (a > 0.05 && a < 0.95 && (el.innerText || '').trim().length < 40 && !el.querySelector('img,video,canvas,picture')) el.remove();
}
})()`

/** A modal dialog's backdrop drawn clear, so one left open never dims the capture. */
export const CLEAN_UP_STYLES =
  '::backdrop{background:transparent!important;backdrop-filter:none!important}'

/** Bot-wall phrases; a page containing one fails the capture, which is not billed. */
export const CHALLENGE_PHRASES = [
  'Just a moment...',
  'Verify you are human',
  'Checking your browser',
  'Attention Required',
  'you have been blocked',
] as const

/**
 * Countries the capture can browse from, each with a time zone the service
 * accepts (it takes a fixed list: the same offset where the country's own
 * zone is not on it).
 */
const COUNTRY_TIME_ZONES: Record<string, string> = {
  gb: 'Europe/London',
  ie: 'Europe/London',
  us: 'America/New_York',
  ca: 'America/Toronto',
  au: 'Pacific/Auckland',
  de: 'Europe/Berlin',
  fr: 'Europe/Berlin',
  it: 'Europe/Berlin',
  es: 'Europe/Madrid',
  jp: 'Asia/Shanghai',
}
/** A language with no region still says where its visitors mostly are. */
const LANGUAGE_COUNTRIES: Record<string, string> = {
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
  ja: 'jp',
}

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i

interface Locale {
  acceptLanguage: string
  country: string
  timeZone: string
}

/**
 * Where the capture browses from, from the site's own html lang: its
 * language first, then English. Unknown or missing: British English from
 * the UK, which avoids most geo-redirect pop-ups on English sites.
 */
export function captureLocale(language?: string | null): Locale {
  const fallback = { acceptLanguage: 'en-GB,en;q=0.9', country: 'gb', timeZone: 'Europe/London' }
  const tag = language?.trim() ?? ''
  if (!LANGUAGE_TAG.test(tag)) return fallback
  const [primaryRaw, regionRaw] = tag.split('-')
  const primary = primaryRaw.toLowerCase()
  const region = regionRaw && regionRaw.length === 2 ? regionRaw.toLowerCase() : null
  const country =
    region && COUNTRY_TIME_ZONES[region] ? region : (LANGUAGE_COUNTRIES[primary] ?? 'gb')
  const first = region ? `${primary}-${region.toUpperCase()}` : primary
  const parts = [first]
  if (first !== primary) parts.push(`${primary};q=0.9`)
  if (primary !== 'en') parts.push('en;q=0.5')
  return {
    acceptLanguage: parts.join(','),
    country,
    timeZone: COUNTRY_TIME_ZONES[country],
  }
}

/**
 * The capture's query string, in a fixed order, without a leading `?` and
 * without a signature. Repeated options appear once per value.
 */
export function captureQuery(
  target: string,
  opts: {
    accessKey: string
    language?: string | null
    /**
     * When the capture is taken: once the network is quiet (the default), or
     * at load, for a page that never goes quiet (streams, polling).
     */
    settle?: 'network' | 'load'
  }
): string {
  const locale = captureLocale(opts.language)
  const pairs: Array<[string, string]> = [
    ['access_key', opts.accessKey],
    ['url', target],
    ['viewport_width', '1440'],
    ['viewport_height', '900'],
    ['device_scale_factor', '1'],
    ['format', 'png'],
    ['full_page', 'false'],
    ['block_ads', 'true'],
    ['block_cookie_banners', 'true'],
    ['block_chats', 'true'],
    ['block_trackers', 'true'],
    ...HIDE_SELECTORS.map((s): [string, string] => ['hide_selectors', s]),
    ['wait_until', 'load'],
    ...(opts.settle === 'load' ? [] : [['wait_until', 'networkidle2'] as [string, string]]),
    ['delay', opts.settle === 'load' ? '3' : '2'],
    ['scripts', CLEAN_UP_SCRIPT],
    ['styles', CLEAN_UP_STYLES],
    ['reduced_motion', 'true'],
    ['reduce_motion', 'true'],
    ['dark_mode', 'false'],
    ['headers', `Accept-Language:${locale.acceptLanguage}`],
    ['ip_country_code', locale.country],
    ['time_zone', locale.timeZone],
    ['timeout', '60'],
    ['navigation_timeout', '30'],
    ['ignore_host_errors', 'false'],
    ...CHALLENGE_PHRASES.map((p): [string, string] => ['fail_if_content_contains', p]),
    ['cache', 'false'],
  ]
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

/** HMAC-SHA256 of the exact query string as sent, lowercase hex. */
export function signQuery(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query, 'utf8').digest('hex')
}

export interface ScreenshotOneKeys {
  accessKey: string
  secretKey?: string | null
}

/** The full request URL, signed when a secret key is set. Secret: never log it. */
export function captureRequestUrl(
  target: string,
  keys: ScreenshotOneKeys,
  opts: { language?: string | null; settle?: 'network' | 'load' } = {}
): string {
  const query = captureQuery(target, {
    accessKey: keys.accessKey,
    language: opts.language,
    ...(opts.settle && { settle: opts.settle }),
  })
  const signed = keys.secretKey ? `${query}&signature=${signQuery(query, keys.secretKey)}` : query
  return `${SCREENSHOTONE_ENDPOINT}?${signed}`
}

/** The request without its access key and signature, for the record. */
export function redactedRequest(url: string): string {
  const q = url.indexOf('?')
  if (q === -1) return url
  const kept = url
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      const name = pair.split('=', 1)[0]
      return name !== 'access_key' && name !== 'signature'
    })
  return `${url.slice(0, q)}?${kept.join('&')}`
}

export type CaptureFailure =
  'quota' | 'challenge' | 'host_error' | 'timeout' | 'failed' | 'bad_image' | 'too_large'

export type CaptureOutcome = (
  | { ok: true; png: Uint8Array; width: number; height: number; request: string }
  | {
      ok: false
      reason: CaptureFailure
      /** The provider's error code, when it gave one. */
      code: string | null
      /** Whether the provider counts it; failed requests are not counted. */
      billed: boolean
      request: string
    }
) & {
  /** Requests made: two when a page that never went quiet was asked for again. */
  attempts?: number
}

/** The slice of fetch the client uses; global fetch fits it. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface TakeCaptureDeps {
  fetch: FetchLike
  keys: ScreenshotOneKeys
  language?: string | null
  timeoutMs?: number
  maxBytes?: number
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's size from its IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return null
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width === 0 || height === 0) return null
  return { width, height }
}

const ERROR_CODE = /^[a-z][a-z\d_]{0,63}$/

/** The provider's error code from either documented body shape, or null. */
export function errorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const flat = (body as { error_code?: unknown }).error_code
  const nested = (body as { error?: { code?: unknown } }).error?.code
  const code = typeof flat === 'string' ? flat : typeof nested === 'string' ? nested : null
  // Only a plain code is kept: nothing the provider echoes back is recorded.
  return code && ERROR_CODE.test(code) ? code : null
}

export function failureFor(code: string | null): CaptureFailure {
  switch (code) {
    case 'screenshots_limit_reached':
      return 'quota'
    case 'content_contains_specified_string':
      return 'challenge'
    case 'host_returned_error':
    case 'name_not_resolved':
      return 'host_error'
    case 'timeout_error':
      return 'timeout'
    default:
      return 'failed'
  }
}

class TooLarge extends Error {}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new TooLarge()
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new TooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * Take one capture of `target`. Never throws for the provider's or the
 * network's failures; every outcome is a value the caller records.
 */
/**
 * A capture of the page; a page whose network never went quiet within the
 * timeout is asked for once more, taken at load. A timed-out request is not
 * billed, so the second costs only when it succeeds.
 */
export async function takeCapture(target: string, deps: TakeCaptureDeps): Promise<CaptureOutcome> {
  const first = await takeOnce(target, deps, 'network')
  if (first.ok || first.reason !== 'timeout') return { ...first, attempts: 1 }
  return { ...(await takeOnce(target, deps, 'load')), attempts: 2 }
}

async function takeOnce(
  target: string,
  deps: TakeCaptureDeps,
  settle: 'network' | 'load'
): Promise<CaptureOutcome> {
  const url = captureRequestUrl(target, deps.keys, { language: deps.language, settle })
  const request = redactedRequest(url)
  const maxBytes = deps.maxBytes ?? 10 * 1024 * 1024
  const fail = (reason: CaptureFailure, code: string | null, billed: boolean): CaptureOutcome => ({
    ok: false,
    reason,
    code,
    billed,
    request,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 75_000)
  try {
    let res: Response
    try {
      res = await deps.fetch(url, { method: 'GET', signal: controller.signal, redirect: 'error' })
    } catch {
      return fail(controller.signal.aborted ? 'timeout' : 'failed', null, false)
    }

    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      const code = errorCode(body)
      return fail(failureFor(code), code, false)
    }

    // The provider answered with an image, so it counts it whatever the bytes are.
    let png: Uint8Array
    try {
      png = await readCapped(res, maxBytes)
    } catch (err) {
      if (err instanceof TooLarge) return fail('too_large', null, true)
      return fail(controller.signal.aborted ? 'timeout' : 'failed', null, true)
    }
    const size = pngSize(png)
    if (!size) return fail('bad_image', null, true)
    return { ok: true, png, width: size.width, height: size.height, request }
  } finally {
    clearTimeout(timer)
  }
}
