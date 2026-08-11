/**
 * Cloudflare Email Sending transport.
 *
 * One POST to `/accounts/{id}/email/sending/send` with a Bearer token carrying
 * `Email Sending: Edit`. No Worker is involved: the REST API is reachable from
 * any backend, which is the whole reason this is usable from a container tier.
 * DKIM and ARC signing, the account suppression list, and the delivery log are
 * all on Cloudflare's side of the call.
 *
 * The sending domain must be onboarded for Email Sending **on the account that
 * owns the token**. That is a hard boundary, not a verification step we can
 * automate away: a customer-owned domain living on someone else's DNS can never
 * be onboarded here, which is why the caller keeps a Resend rung for those. See
 * {@link canCloudflareSendFrom}.
 *
 * ## What this transport cannot do
 *
 * `Message-ID` is platform-controlled. Cloudflare generates it and rejects a
 * caller-supplied one, along with Date, MIME-Version, Content-Type, Return-Path,
 * DKIM-Signature and the ARC set. Anything that needs to pin its own outbound
 * Message-ID (the conversation email channel's threading does) has to read the
 * assigned id back off the response instead of choosing it.
 * {@link sendViaCloudflare} returns that id when the response carries it — see
 * `messageId` below for why the caller must handle its absence rather than
 * assume it. `In-Reply-To`, `References`, `List-*`, `Auto-Submitted`,
 * `Precedence` and any `X-*` header are accepted and pass through untouched.
 */
import { createLogger } from '@quackback/logger'

const log = createLogger({ base: { service_name: 'quackback-email' } }).child({
  component: 'email-cloudflare',
})

/** Cloudflare's documented ceiling for a whole message, attachments included. */
export const CLOUDFLARE_MAX_MESSAGE_BYTES = 5 * 1024 * 1024

/** Named or bare address; the API accepts either shape. */
export type CloudflareAddress = string | { address: string; name?: string }

/**
 * Split an RFC 5322 `Display Name <addr@host>` into the API's object form.
 *
 * `EMAIL_FROM` is configured in the display-name form, and Cloudflare's own
 * examples only ever show a bare address in the string position. Rather than
 * gamble that the API also parses a display name out of a string — a bet that
 * would 400 every single send if wrong — split it here and always hand over the
 * unambiguous object. A bare address passes through as a plain string.
 *
 * Quoted display names (`"Doe, Jane" <j@x>`) lose their quotes, which is right:
 * the quoting exists to escape the comma inside a header, and the API takes the
 * name as data rather than as header text.
 */
export function parseAddress(value: string): CloudflareAddress {
  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(value)
  if (!match) return value.trim()
  const name = match[1].replace(/^"(.*)"$/, '$1').trim()
  const address = match[2]
  return name ? { address, name } : address
}

/** The domain of an `addr` or `Name <addr>` value, lower-cased, or null. */
export function addressDomain(value: string | undefined): string | null {
  if (!value) return null
  const parsed = parseAddress(value)
  const bare = typeof parsed === 'string' ? parsed : parsed.address
  const at = bare.lastIndexOf('@')
  if (at === -1) return null
  const domain = bare
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain === '' ? null : domain
}

/** The domain either form of a sending identity is on, lower-cased, or null. */
function sendingDomain(from: CloudflareAddress): string | null {
  return addressDomain(typeof from === 'string' ? from : from.address)
}

/**
 * Headers Cloudflare generates itself and rejects when a caller supplies them.
 *
 * Lower-cased for comparison; header names are case-insensitive on the wire.
 */
const PLATFORM_CONTROLLED_HEADERS = new Set([
  'message-id',
  'date',
  'mime-version',
  'content-type',
  'return-path',
  'dkim-signature',
  'arc-seal',
  'arc-message-signature',
  'arc-authentication-results',
])

/**
 * Drop the headers the platform owns, keeping everything else.
 *
 * Supplying one is not a warning, it is a rejected send, so this is a filter
 * rather than a check. The dropped names come back so the caller can say what
 * it lost: for `Message-ID` in particular, losing it costs a routing mechanism
 * (see the conversation email channel's Message-ID fallback), and silently
 * dropping something with that consequence is worse than not sending it.
 */
export function stripPlatformControlledHeaders(headers: Record<string, string>): {
  headers: Record<string, string>
  dropped: string[]
} {
  const kept: Record<string, string> = {}
  const dropped: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (PLATFORM_CONTROLLED_HEADERS.has(name.toLowerCase())) dropped.push(name)
    else kept[name] = value
  }
  return { headers: kept, dropped }
}

export interface CloudflareSendRequest {
  from: CloudflareAddress
  to: CloudflareAddress | CloudflareAddress[]
  subject: string
  html?: string
  text?: string
  replyTo?: CloudflareAddress
  /** Threading and `X-*` headers. The platform-controlled set above is dropped
   *  on the way out rather than rejected by the API — see
   *  {@link stripPlatformControlledHeaders}. */
  headers?: Record<string, string>
}

export interface CloudflareSendResult {
  /**
   * Cloudflare's assigned Message-ID, or null when the response omitted it.
   *
   * Null is a real case, not a defensive flourish: Cloudflare's own docs
   * disagree with each other here. The API reference schema lists
   * `result.message_id`, while the REST API guide states the opposite — that
   * the REST path returns recipient-grouped status only and the Workers binding
   * is what returns a single id. Rather than pick a winner from the docs, this
   * reads the field when present and reports null when not, so a caller that
   * depends on the id (threading, bounce joins) fails visibly on a fleet where
   * it is absent instead of silently threading nothing.
   */
  messageId: string | null
  delivered: string[]
  queued: string[]
}

/** Injectable so tests never touch the network. */
export interface CloudflareEmailDeps {
  accountId: string
  apiToken: string
  fetch: typeof globalThis.fetch
}

/**
 * Is an HTTP status worth sending the same message again for?
 *
 * Only the statuses that describe a moment rather than the request: a rate
 * limit, a timeout, and anything the far side calls its own fault. Everything
 * else in the 4xx range is the API saying this message is wrong — most often
 * that its sending domain is not onboarded for Email Sending on our account —
 * and no number of retries onboards a domain.
 */
function statusIsRetryable(status: number | null): boolean {
  if (status === null) return false
  if (status === 408 || status === 429) return true
  return status >= 500
}

export class CloudflareEmailError extends Error {
  /**
   * Whether sending this exact message again could plausibly succeed.
   *
   * Declared by the error rather than inferred by the caller, because only the
   * transport knows which of its failures are about the moment and which are
   * about the message. A caller that retries everything (the conversation send
   * path deliberately does, so a new provider error name cannot quietly stop
   * being retried) can still honour a `false` here and skip a wait that has no
   * chance of paying off.
   */
  readonly retryable: boolean

  constructor(
    message: string,
    readonly status: number | null,
    readonly codes: number[],
    retryable: boolean = statusIsRetryable(status)
  ) {
    super(message)
    this.name = 'CloudflareEmailError'
    this.retryable = retryable
  }
}

function readEnv(key: string): string | undefined {
  return process.env[key]
}

/**
 * Both halves are required: the account id is in the URL path and the token
 * authorizes it. One without the other is a misconfiguration, not a partial
 * capability, so the ladder treats it as "not configured" and falls through.
 */
export function isCloudflareEmailConfigured(): boolean {
  return Boolean(
    readEnv('CLOUDFLARE_ACCOUNT_ID')?.trim() && readEnv('CLOUDFLARE_EMAIL_TOKEN')?.trim()
  )
}

/**
 * The domains Email Sending is onboarded for on our account, or null for "no
 * restriction declared".
 *
 * Naming them is configuration rather than something we can discover: the
 * account's onboarded set lives on Cloudflare, and asking for it on the send
 * path would put a second network call in front of every email. An unset value
 * therefore means "do not second-guess the From", which keeps an installation
 * that has not declared anything behaving exactly as it did before this rung
 * existed.
 */
export function cloudflareSendableDomains(): Set<string> | null {
  const raw = readEnv('CLOUDFLARE_EMAIL_DOMAINS')?.trim()
  if (!raw) return null
  const domains = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '')
  return domains.length > 0 ? new Set(domains) : null
}

/**
 * Can this rung send as `from`?
 *
 * Email Sending requires the sending domain to be a zone on Cloudflare DNS in
 * the account that owns the token. A workspace that verified its OWN domain by
 * publishing SPF/DKIM (`email_sending_domains`) has a domain on someone else's
 * DNS, so no amount of configuration makes this rung able to send as it. The
 * caller uses this to drop that one send to the rung below rather than fail it.
 *
 * Exact match, not suffix match: onboarding is per domain, so `acme.com` being
 * onboarded says nothing about `mail.acme.com`.
 */
export function canCloudflareSendFrom(from: string | undefined): boolean {
  const allowed = cloudflareSendableDomains()
  if (!allowed) return true
  const domain = addressDomain(from)
  return domain !== null && allowed.has(domain)
}

function depsFromEnv(): CloudflareEmailDeps {
  const accountId = readEnv('CLOUDFLARE_ACCOUNT_ID')?.trim() ?? ''
  const apiToken = readEnv('CLOUDFLARE_EMAIL_TOKEN')?.trim() ?? ''
  if (!accountId || !apiToken) {
    throw new CloudflareEmailError(
      'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_TOKEN are both required to send',
      null,
      []
    )
  }
  return { accountId, apiToken, fetch: globalThis.fetch }
}

/** Wire shape. Snake_case on the API, camelCase in our call sites. */
function toWire(
  request: CloudflareSendRequest,
  headers: Record<string, string>
): Record<string, unknown> {
  return {
    from: request.from,
    to: request.to,
    subject: request.subject,
    ...(request.html !== undefined ? { html: request.html } : {}),
    ...(request.text !== undefined ? { text: request.text } : {}),
    ...(request.replyTo !== undefined ? { reply_to: request.replyTo } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Send one message. Throws `CloudflareEmailError` on any outcome that is not a
 * clean hand-off.
 *
 * A permanent bounce is one of those outcomes. The API answers 200 with
 * `success: true` and the failed recipient listed under `permanent_bounces`, so
 * treating an HTTP 200 as success would report a rejected address as sent. The
 * caller's contract is "this reached the provider for delivery", and a permanent
 * bounce is the provider saying it did not.
 */
export async function sendViaCloudflare(
  request: CloudflareSendRequest,
  deps: CloudflareEmailDeps = depsFromEnv()
): Promise<CloudflareSendResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${deps.accountId}/email/sending/send`

  // The filter lives here, with the constraint it enforces, rather than in one
  // caller: supplying a platform-controlled header is a hard rejection, so every
  // route into this transport has to be covered, not just the first one written.
  const { headers, dropped } = stripPlatformControlledHeaders(request.headers ?? {})
  if (dropped.length > 0) {
    log.debug({ dropped_headers: dropped }, 'platform-controlled headers dropped before send')
  }

  const response = await deps.fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deps.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(toWire(request, headers)),
  })

  // A non-JSON body on an error status is normal for gateway failures; do not
  // let the parse failure mask the status the caller actually needs to see.
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean
    errors?: Array<{ code?: number; message?: string }>
    result?: {
      message_id?: string
      delivered?: unknown
      queued?: unknown
      permanent_bounces?: unknown
    }
  } | null

  const errors = payload?.errors ?? []
  if (!response.ok || payload?.success !== true) {
    const codes = errors.map((e) => e.code).filter((c): c is number => typeof c === 'number')
    const detail =
      errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ') || `HTTP ${response.status}`
    // The sending DOMAIN, never the address: the single most common cause of a
    // rejection here is a From on a domain this account has not onboarded for
    // Email Sending, and a status code alone leaves that undiagnosable. The
    // domain is configuration; the local part beside it is PII.
    log.error(
      { status: response.status, codes, from_domain: sendingDomain(request.from) },
      'cloudflare email send failed'
    )
    throw new CloudflareEmailError(
      `Cloudflare email send failed: ${detail}`,
      response.status,
      codes
    )
  }

  const bounces = asStringArray(payload?.result?.permanent_bounces)
  if (bounces.length > 0) {
    // Recipients are PII; count them rather than logging the addresses.
    log.error({ bounced: bounces.length }, 'cloudflare email permanently bounced')
    // Permanent by name: the recipient rejected the message, and re-sending it
    // reproduces the rejection.
    throw new CloudflareEmailError(
      `Cloudflare email permanently bounced for ${bounces.length} recipient(s)`,
      response.status,
      [],
      false
    )
  }

  const messageId =
    typeof payload?.result?.message_id === 'string' ? payload.result.message_id : null
  const delivered = asStringArray(payload?.result?.delivered)
  const queued = asStringArray(payload?.result?.queued)
  return { messageId, delivered, queued }
}
