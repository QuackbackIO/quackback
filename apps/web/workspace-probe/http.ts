/**
 * Per-workspace HTTP client.
 *
 * Three properties matter for this suite:
 *
 *  1. It owns an explicit, inspectable cookie jar. Probe P01 works by lifting
 *     alpha's jar wholesale and planting it on bravo's client, so the jar has to
 *     be a first-class value rather than hidden inside `fetch`.
 *  2. Every exchange is fed to the tripwire, and the hits it returns are carried
 *     back on the response, so a leak in a response body counts even when the
 *     probe that made the request was looking at something else.
 *  3. Redirects are NOT followed by default. A 302 is frequently the whole
 *     signal (storage read tokens, magic-link verify), and following it would
 *     both discard the evidence and send a credential somewhere unintended.
 *     Document reads opt in with `followRedirects`, because on this app the
 *     document is always one hop away: `GET /` answers `307 → /?sort=trending`
 *     with a zero-byte body. Following is done by hand rather than with
 *     `redirect: 'follow'` for one reason — a redirect that leaves the workspace's
 *     own origin must never be followed. Chasing alpha's redirect onto bravo's
 *     host and then reporting "no foreign markers" would read bravo's page and
 *     call it alpha's, which is worse than reading nothing.
 */

import type {
  Exchange,
  ProbeRequestInit,
  ProbeResponse,
  WorkspaceHttp,
  WorkspaceSlot,
  TripwireHit,
  TripwireRecorder,
} from './types'

/** Thrown when the target could not be reached at all. Never swallowed. */
export class TransportError extends Error {
  constructor(
    readonly workspace: WorkspaceSlot,
    readonly url: string,
    readonly cause: unknown
  ) {
    super(`[${workspace}] request to ${url} failed: ${describe(cause)}`)
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

export interface WorkspaceHttpOptions {
  slot: WorkspaceSlot
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

/** Statuses that carry a `location` worth following. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Hop ceiling. The app's canonicalising redirects are one hop; anything past a
 * handful is a loop, and a loop must surface as a fact rather than as a hang.
 */
const MAX_REDIRECT_HOPS = 5

export function createWorkspaceHttp(options: WorkspaceHttpOptions): WorkspaceHttp {
  const doFetch = options.fetchImpl ?? fetch
  const ownOrigin = new URL(options.baseUrl).origin
  let jar = new CookieJar()

  async function request(path: string, init: ProbeRequestInit = {}): Promise<ProbeResponse> {
    let url = path.startsWith('http') ? path : `${options.baseUrl}${path}`
    let method = init.method ?? 'GET'
    let body = init.body

    const redirectChain: string[] = []
    const tripwireHits: TripwireHit[] = []
    let crossOriginRedirect: string | undefined
    let redirectLimitExceeded: boolean | undefined

    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = { ...init.headers }

      if (!init.omitCookies && !jar.isEmpty()) {
        headers.cookie = jar.header()
      }
      if (typeof body === 'string' && !headers['content-type']) {
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
          body,
          // Always manual. Following is done in this loop so the origin guard
          // below cannot be bypassed, and so every hop is tripwire-scanned.
          redirect: 'manual',
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

      // Absorption is unconditional, and `omitCookies` governs SENDING only.
      //
      // These were one flag once, and it made the whole magic-link/OTP family
      // structurally incapable of executing: a redemption request must present no
      // cookies (it is testing a bare credential) but must capture the session
      // cookie a successful redemption issues. Sharing the flag meant the
      // resulting session was never observed, `sessionEstablished` was always
      // false, and the probe reported ERROR against a server that had in fact
      // minted a session — including a server leaking one across workspaces.
      // A browser sends conditionally and always stores; so does this.
      jar.absorb(readSetCookie(response.headers))

      const exchange: Exchange = {
        workspace: options.slot,
        method,
        url,
        status: response.status,
        requestBody: typeof body === 'string' ? body : '',
        requestHeaders: headers,
        responseText: text,
        responseHeaders: headersToObject(response.headers),
        durationMs: Date.now() - startedAt,
        expectsForeignMarkers: init.expectsForeignMarkers === true,
      }
      // The hits are carried back to the caller rather than dropped: a probe
      // that never coded a check for the marker that leaked still gets to see
      // it, and the runner counts it either way.
      tripwireHits.push(...options.tripwire.record(exchange))
      options.onExchange?.(exchange)

      const location = response.headers.get('location')
      const isRedirect = REDIRECT_STATUSES.has(response.status) && Boolean(location)

      if (init.followRedirects === true && isRedirect) {
        const next = new URL(location!, url)
        if (next.origin !== ownOrigin) {
          // Never chase a redirect off this workspace's origin. The response the
          // caller judges must be one this host served.
          crossOriginRedirect = next.href
        } else if (hop >= MAX_REDIRECT_HOPS) {
          redirectLimitExceeded = true
        } else {
          redirectChain.push(next.href)
          // 307/308 preserve the method and body; everything else degrades to a
          // bodiless GET, as a browser does.
          if (response.status !== 307 && response.status !== 308) {
            method = 'GET'
            body = undefined
          }
          url = next.href
          continue
        }
      }

      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        headers: exchange.responseHeaders,
        text,
        url,
        tripwireHits,
        redirectChain,
        ...(crossOriginRedirect ? { crossOriginRedirect } : {}),
        ...(redirectLimitExceeded ? { redirectLimitExceeded } : {}),
        json<T = unknown>(): T | null {
          try {
            return JSON.parse(text) as T
          } catch {
            return null
          }
        },
      }
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
