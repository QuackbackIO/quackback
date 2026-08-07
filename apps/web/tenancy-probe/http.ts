/**
 * Per-tenant HTTP client.
 *
 * Three properties matter for this suite:
 *
 *  1. It owns an explicit, inspectable cookie jar. Probe P01 works by lifting
 *     alpha's jar wholesale and planting it on bravo's client, so the jar has to
 *     be a first-class value rather than hidden inside `fetch`.
 *  2. Every exchange is fed to the tripwire, so a leak in a response body counts
 *     even when the probe that made the request was looking at something else.
 *  3. Redirects are NOT followed by default. A 302 is frequently the whole
 *     signal (storage read tokens, magic-link verify), and following it would
 *     both discard the evidence and send a credential somewhere unintended.
 */

import type {
  Exchange,
  ProbeRequestInit,
  ProbeResponse,
  TenantHttp,
  TenantSlot,
  TripwireRecorder,
} from './types'

/** Thrown when the target could not be reached at all. Never swallowed. */
export class TransportError extends Error {
  constructor(
    readonly tenant: TenantSlot,
    readonly url: string,
    readonly cause: unknown
  ) {
    super(`[${tenant}] request to ${url} failed: ${describe(cause)}`)
    this.name = 'TransportError'
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/** A minimal cookie jar: name → value, no path/domain modelling. */
export class CookieJar {
  private readonly cookies = new Map<string, string>()

  static fromHeader(header: string): CookieJar {
    const jar = new CookieJar()
    for (const part of header.split(';')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      jar.cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
    }
    return jar
  }

  absorb(setCookieValues: string[]): void {
    for (const raw of setCookieValues) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      // An empty value with Max-Age=0/Expires in the past is a deletion.
      if (value === '' || /(?:max-age=0|expires=thu, 01 jan 1970)/i.test(raw)) {
        this.cookies.delete(name)
        continue
      }
      this.cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  names(): string[] {
    return [...this.cookies.keys()]
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  clear(): void {
    this.cookies.clear()
  }

  isEmpty(): boolean {
    return this.cookies.size === 0
  }
}

function readSetCookie(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetter.getSetCookie === 'function') return withGetter.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

/**
 * The narrow slice of `fetch` this harness uses. Deliberately not `typeof fetch`:
 * the platform type carries extras (`preconnect`) that a test double has no
 * business implementing, and requiring them would push tests toward casting.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface TenantHttpOptions {
  slot: TenantSlot
  baseUrl: string
  tripwire: TripwireRecorder
  defaultTimeoutMs: number
  /** Swappable for tests. */
  fetchImpl?: FetchLike
  /** Called for every completed exchange, after tripwire scanning. */
  onExchange?: (exchange: Exchange) => void
}

/**
 * `RESPONSE_BODY_LIMIT` caps how much of a response body is buffered for
 * tripwire scanning. Portal SSR documents are large; 2 MB is far beyond any
 * JSON API response here and still bounds memory across a full run.
 */
const RESPONSE_BODY_LIMIT = 2 * 1024 * 1024

export function createTenantHttp(options: TenantHttpOptions): TenantHttp {
  const doFetch = options.fetchImpl ?? fetch
  let jar = new CookieJar()

  async function request(path: string, init: ProbeRequestInit = {}): Promise<ProbeResponse> {
    const url = path.startsWith('http') ? path : `${options.baseUrl}${path}`
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = { ...init.headers }

    if (!init.omitCookies && !jar.isEmpty()) {
      headers.cookie = jar.header()
    }
    if (typeof init.body === 'string' && !headers['content-type']) {
      headers['content-type'] = 'application/json'
    }

    const controller = new AbortController()
    const timeoutMs = init.timeoutMs ?? options.defaultTimeoutMs
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()

    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: init.body,
        redirect: init.followRedirects === true ? 'follow' : 'manual',
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      throw new TransportError(options.slot, url, err)
    }
    clearTimeout(timer)

    let text: string
    try {
      const raw = await response.text()
      text = raw.length > RESPONSE_BODY_LIMIT ? raw.slice(0, RESPONSE_BODY_LIMIT) : raw
    } catch (err) {
      throw new TransportError(options.slot, url, err)
    }

    if (!init.omitCookies) {
      jar.absorb(readSetCookie(response.headers))
    }

    const exchange: Exchange = {
      tenant: options.slot,
      method,
      url,
      status: response.status,
      requestBody: typeof init.body === 'string' ? init.body : '',
      responseText: text,
      responseHeaders: headersToObject(response.headers),
      durationMs: Date.now() - startedAt,
      expectsForeignMarkers: init.expectsForeignMarkers === true,
    }
    options.tripwire.record(exchange)
    options.onExchange?.(exchange)

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers: exchange.responseHeaders,
      text,
      url,
      json<T = unknown>(): T | null {
        try {
          return JSON.parse(text) as T
        } catch {
          return null
        }
      },
    }
  }

  return {
    slot: options.slot,
    baseUrl: options.baseUrl,
    request,
    cookieHeader: () => jar.header(),
    setCookieHeader: (header: string) => {
      jar = CookieJar.fromHeader(header)
    },
    clearCookies: () => {
      jar = new CookieJar()
    },
  }
}
