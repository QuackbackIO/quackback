import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addressDomain,
  canCloudflareSendFrom,
  CloudflareEmailError,
  isCloudflareEmailConfigured,
  parseAddress,
  sendViaCloudflare,
  stripPlatformControlledHeaders,
} from '../cloudflare'
import { getEmailProvider, sendRawEmail } from '../index'

/**
 * The Cloudflare rung, offline. Every send here goes through an injected or
 * stubbed `fetch`; nothing in this file may touch the network.
 *
 * Two properties carry most of the weight. The ladder order is a compatibility
 * promise (an install that named an SMTP host keeps it), and the per-send
 * fall-through is the only place the ladder is not per process — a workspace
 * sending as its own verified domain cannot use this rung at all, because the
 * domain has to be a zone on Cloudflare DNS in our account.
 */

const ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_EMAIL_TOKEN',
  'CLOUDFLARE_EMAIL_DOMAINS',
  'EMAIL_SMTP_HOST',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
] as const

function withCleanEnv() {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key]
      else delete process.env[key]
    }
  })
}

/** A `fetch` that records its one call and answers with a Cloudflare envelope. */
function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} })
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response
  })
  return { fetch: fn as unknown as typeof globalThis.fetch, calls }
}

const OK_BODY = {
  success: true,
  errors: [],
  result: { message_id: 'cf-assigned-1@mx.cloudflare.net', delivered: ['a@b.test'], queued: [] },
}

const DEPS = (fetch: typeof globalThis.fetch) => ({
  accountId: 'acct_1',
  apiToken: 'tok_1',
  fetch,
})

/** The last request body the stub saw, decoded. */
function sentBody(calls: Array<{ init: RequestInit }>): Record<string, unknown> {
  return JSON.parse(String(calls[calls.length - 1].init.body))
}

describe('parseAddress', () => {
  it('splits a display-name address into the API object form', () => {
    expect(parseAddress('Support <support@acme.test>')).toEqual({
      address: 'support@acme.test',
      name: 'Support',
    })
    expect(parseAddress('"Doe, Jane" <jane@acme.test>')).toEqual({
      address: 'jane@acme.test',
      name: 'Doe, Jane',
    })
  })

  it('passes a bare address through as a string', () => {
    expect(parseAddress('  support@acme.test ')).toBe('support@acme.test')
  })
})

describe('addressDomain', () => {
  it('reads the domain out of either address form, lower-cased', () => {
    expect(addressDomain('Support <Support@Acme.TEST>')).toBe('acme.test')
    expect(addressDomain('support@acme.test')).toBe('acme.test')
    expect(addressDomain('not-an-address')).toBeNull()
    expect(addressDomain(undefined)).toBeNull()
  })
})

describe('provider ladder', () => {
  withCleanEnv()

  it('selects console when nothing is configured', () => {
    expect(getEmailProvider()).toBe('console')
  })

  it('selects resend when only a Resend key is set', () => {
    process.env.RESEND_API_KEY = 're_test'
    expect(getEmailProvider()).toBe('resend')
  })

  it('selects smtp over resend', () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_SMTP_HOST = 'smtp.acme.test'
    expect(getEmailProvider()).toBe('smtp')
  })

  it('selects cloudflare over smtp and resend when both halves of the pair are set', () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_SMTP_HOST = 'smtp.acme.test'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_1'
    process.env.CLOUDFLARE_EMAIL_TOKEN = 'tok_1'
    expect(getEmailProvider()).toBe('cloudflare')
  })

  it('keeps SMTP when only half the Cloudflare pair is set', () => {
    // Half a pair is a misconfiguration, not a partial capability: the account
    // id is in the URL and the token authorizes it.
    process.env.EMAIL_SMTP_HOST = 'smtp.acme.test'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_1'
    expect(getEmailProvider()).toBe('smtp')
    expect(isCloudflareEmailConfigured()).toBe(false)
    delete process.env.CLOUDFLARE_ACCOUNT_ID
    process.env.CLOUDFLARE_EMAIL_TOKEN = 'tok_1'
    expect(getEmailProvider()).toBe('smtp')
    expect(isCloudflareEmailConfigured()).toBe(false)
  })
})

describe('canCloudflareSendFrom', () => {
  withCleanEnv()

  it('allows any From when no sendable domains are declared', () => {
    expect(canCloudflareSendFrom('anything@wherever.test')).toBe(true)
  })

  it('allows only the declared domains once any are declared', () => {
    process.env.CLOUDFLARE_EMAIL_DOMAINS = ' Platform.test , other.test '
    expect(canCloudflareSendFrom('Support <hi@platform.test>')).toBe(true)
    expect(canCloudflareSendFrom('hi@other.test')).toBe(true)
    expect(canCloudflareSendFrom('hi@customer.test')).toBe(false)
    // Exact match: onboarding is per domain, so a parent zone says nothing
    // about a subdomain.
    expect(canCloudflareSendFrom('hi@mail.platform.test')).toBe(false)
    expect(canCloudflareSendFrom(undefined)).toBe(false)
  })
})

describe('sendViaCloudflare', () => {
  it('POSTs the account send endpoint with a bearer token and the wire shape', async () => {
    const { fetch, calls } = fakeFetch(OK_BODY)
    const result = await sendViaCloudflare(
      {
        from: { address: 'hi@platform.test', name: 'Support' },
        to: 'a@b.test',
        subject: 'Hello',
        html: '<p>hi</p>',
        replyTo: 'reply@platform.test',
        headers: { 'In-Reply-To': '<parent@platform.test>' },
      },
      DEPS(fetch)
    )

    expect(calls[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct_1/email/sending/send'
    )
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok_1')
    expect(sentBody(calls)).toEqual({
      from: { address: 'hi@platform.test', name: 'Support' },
      to: 'a@b.test',
      subject: 'Hello',
      html: '<p>hi</p>',
      reply_to: 'reply@platform.test',
      headers: { 'In-Reply-To': '<parent@platform.test>' },
    })
    expect(result.messageId).toBe('cf-assigned-1@mx.cloudflare.net')
    expect(result.delivered).toEqual(['a@b.test'])
  })

  it('treats a permanent bounce in a 200 response as a failure', async () => {
    // The API answers success:true with the rejected recipient listed, so an
    // HTTP-status-only reading would report a bounce as a send.
    const { fetch } = fakeFetch({
      success: true,
      errors: [],
      result: { delivered: [], queued: [], permanent_bounces: ['nope@b.test'] },
    })
    await expect(
      sendViaCloudflare({ from: 'hi@platform.test', to: 'nope@b.test', subject: 's' }, DEPS(fetch))
    ).rejects.toBeInstanceOf(CloudflareEmailError)
  })

  it('throws with the API error codes on a failure status', async () => {
    const { fetch } = fakeFetch(
      { success: false, errors: [{ code: 1001, message: 'bad domain' }] },
      { ok: false, status: 403 }
    )
    await expect(
      sendViaCloudflare({ from: 'hi@platform.test', to: 'a@b.test', subject: 's' }, DEPS(fetch))
    ).rejects.toMatchObject({ status: 403, codes: [1001] })
  })

  it('reports a null message id rather than inventing one', async () => {
    const { fetch } = fakeFetch({ success: true, errors: [], result: { delivered: ['a@b.test'] } })
    const result = await sendViaCloudflare(
      { from: 'hi@platform.test', to: 'a@b.test', subject: 's' },
      DEPS(fetch)
    )
    expect(result.messageId).toBeNull()
  })

  // The guard belongs with the constraint it enforces. A caller that assembles
  // its own headers and calls this directly must not be able to reach the API
  // with a platform-controlled one and take a hard rejection for it.
  it('drops platform-controlled headers even when the caller supplies them directly', async () => {
    const { fetch, calls } = fakeFetch(OK_BODY)
    await sendViaCloudflare(
      {
        from: 'hi@platform.test',
        to: 'a@b.test',
        subject: 's',
        headers: {
          'Message-ID': '<ours@platform.test>',
          Date: 'Mon, 1 Jan 2024 00:00:00 +0000',
          'In-Reply-To': '<parent@platform.test>',
        },
      },
      DEPS(fetch)
    )
    expect(sentBody(calls).headers).toEqual({ 'In-Reply-To': '<parent@platform.test>' })
  })

  it('omits the headers field entirely when the strip empties it', async () => {
    const { fetch, calls } = fakeFetch(OK_BODY)
    await sendViaCloudflare(
      {
        from: 'hi@platform.test',
        to: 'a@b.test',
        subject: 's',
        headers: { 'Message-ID': '<x@y>' },
      },
      DEPS(fetch)
    )
    expect(sentBody(calls)).not.toHaveProperty('headers')
  })
})

/**
 * A send that cannot succeed should not be attempted three times. The caller
 * retries everything by default (a hand-maintained transient-error allow-list
 * fails closed), so the transport is what declares the exceptions.
 */
describe('failure classification', () => {
  it('marks a 4xx rejection permanent — the usual cause is a domain we cannot send from', async () => {
    const { fetch } = fakeFetch(
      { success: false, errors: [{ code: 1001, message: 'domain not onboarded' }] },
      { ok: false, status: 403 }
    )
    await expect(
      sendViaCloudflare(
        { from: 'Support <hi@not-ours.test>', to: 'a@b.test', subject: 's' },
        DEPS(fetch)
      )
    ).rejects.toMatchObject({ status: 403, retryable: false })
  })

  it('marks a 5xx, a timeout and a rate limit worth another attempt', async () => {
    for (const status of [500, 502, 408, 429]) {
      const { fetch } = fakeFetch({ success: false, errors: [] }, { ok: false, status })
      await expect(
        sendViaCloudflare({ from: 'hi@platform.test', to: 'a@b.test', subject: 's' }, DEPS(fetch))
      ).rejects.toMatchObject({ status, retryable: true })
    }
  })

  it('marks a permanent bounce permanent', async () => {
    const { fetch } = fakeFetch({
      success: true,
      errors: [],
      result: { delivered: [], queued: [], permanent_bounces: ['nope@b.test'] },
    })
    await expect(
      sendViaCloudflare({ from: 'hi@platform.test', to: 'nope@b.test', subject: 's' }, DEPS(fetch))
    ).rejects.toMatchObject({ retryable: false })
  })
})

describe('stripPlatformControlledHeaders', () => {
  it('drops the platform-controlled set and keeps threading + extension headers', () => {
    const { headers, dropped } = stripPlatformControlledHeaders({
      'Message-ID': '<ours@platform.test>',
      'In-Reply-To': '<parent@platform.test>',
      References: '<root@platform.test> <parent@platform.test>',
      Date: 'Mon, 1 Jan 2024 00:00:00 +0000',
      'X-Quackback-Kind': 'reply',
    })
    expect(headers).toEqual({
      'In-Reply-To': '<parent@platform.test>',
      References: '<root@platform.test> <parent@platform.test>',
      'X-Quackback-Kind': 'reply',
    })
    expect(dropped.sort()).toEqual(['Date', 'Message-ID'])
  })

  it('matches header names case-insensitively', () => {
    const { headers, dropped } = stripPlatformControlledHeaders({ 'message-id': '<x@y>' })
    expect(headers).toEqual({})
    expect(dropped).toEqual(['message-id'])
  })
})

describe('dispatch on the cloudflare rung', () => {
  withCleanEnv()

  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_1'
    process.env.CLOUDFLARE_EMAIL_TOKEN = 'tok_1'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('strips Message-ID but sends In-Reply-To and References', async () => {
    const { fetch, calls } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch

    const result = await sendRawEmail({
      from: 'Support <support@platform.test>',
      to: 'customer@example.test',
      subject: 'Re: your question',
      html: '<p>hi</p>',
      messageId: 'c.abc.nonce@platform.test',
      inReplyTo: 'parent@platform.test',
      references: ['root@platform.test', 'parent@platform.test'],
    })

    const body = sentBody(calls) as { headers?: Record<string, string> }
    expect(body.headers).toEqual({
      'In-Reply-To': '<parent@platform.test>',
      References: '<root@platform.test> <parent@platform.test>',
    })
    expect(body.headers).not.toHaveProperty('Message-ID')
    // The assigned id comes back so the caller stores the id that was actually
    // sent rather than the one it minted and never got.
    expect(result).toEqual({ sent: true, messageId: 'cf-assigned-1@mx.cloudflare.net' })
  })

  it('reports messageId null when the response carries none', async () => {
    // The contract the conversation store depends on: null means "sent, but no
    // id to record", which is not the same as "our minted id went out".
    const { fetch } = fakeFetch({ success: true, errors: [], result: { delivered: ['x@y.test'] } })
    globalThis.fetch = fetch

    const result = await sendRawEmail({
      from: 'Support <support@platform.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
      messageId: 'c.abc.nonce@platform.test',
    })
    expect(result).toEqual({ sent: true, messageId: null })
  })

  it('splits a display-name From into the API object form', async () => {
    const { fetch, calls } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch
    await sendRawEmail({
      from: 'Support <support@platform.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
    })
    expect(sentBody(calls).from).toEqual({ address: 'support@platform.test', name: 'Support' })
  })

  it('still refuses a synthetic anonymous recipient before any request', async () => {
    const { fetch } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch
    const result = await sendRawEmail({
      from: 'Support <support@platform.test>',
      to: 'temp-abc123@anon.quackback.io',
      subject: 's',
      html: '<p>hi</p>',
    })
    expect(result).toEqual({ sent: false, reason: 'anon_recipient' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('customer-domain fall-through (per-send, not per-process)', () => {
  withCleanEnv()

  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_1'
    process.env.CLOUDFLARE_EMAIL_TOKEN = 'tok_1'
    process.env.CLOUDFLARE_EMAIL_DOMAINS = 'platform.test'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends a platform-domain From on the cloudflare rung', async () => {
    const { fetch } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch
    const result = await sendRawEmail({
      from: 'Support <support@platform.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.messageId).toBe('cf-assigned-1@mx.cloudflare.net')
  })

  it('drops a customer-domain From to Resend even though the process provider is cloudflare', async () => {
    // A workspace that verified its own domain (email_sending_domains) publishes
    // SPF/DKIM on DNS we do not hold, and Email Sending requires the zone to be
    // ours. The process stays on cloudflare; this one send does not.
    process.env.RESEND_API_KEY = 're_test'
    const { fetch } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch

    expect(getEmailProvider()).toBe('cloudflare')
    // The Resend client will reject a fake key; what matters is that the
    // Cloudflare endpoint was never called for this send.
    await sendRawEmail({
      from: 'Support <support@customer-owned.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
    }).catch(() => undefined)

    const cloudflareCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => String(call[0]).includes('/email/sending/send')
    )
    expect(cloudflareCalls).toHaveLength(0)
  })

  it('drops a customer-domain From to SMTP when SMTP is the next configured rung', async () => {
    process.env.EMAIL_SMTP_HOST = 'smtp.invalid.test'
    const { fetch } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch

    await sendRawEmail({
      from: 'Support <support@customer-owned.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
    }).catch(() => undefined)

    expect(fetch).not.toHaveBeenCalled()
  })

  // Not sending is not one outcome. An install with a provider that cannot carry
  // this identity has LOST the mail, and a caller has to be able to tell that
  // apart from a development box with no provider at all — the two look
  // identical from `sent: false` alone, and only one of them is a defect.
  it('reports an unsendable identity as its own reason, distinct from no provider', async () => {
    const { fetch } = fakeFetch(OK_BODY)
    globalThis.fetch = fetch
    const result = await sendRawEmail({
      from: 'Support <support@customer-owned.test>',
      to: 'customer@example.test',
      subject: 's',
      html: '<p>hi</p>',
    })
    expect(result).toEqual({ sent: false, reason: 'unsendable_identity' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('why a send did not happen', () => {
  withCleanEnv()

  it('reports no provider when nothing is configured', async () => {
    expect(
      await sendRawEmail({ from: 'a@b.test', to: 'c@d.test', subject: 's', html: '<p>hi</p>' })
    ).toEqual({ sent: false, reason: 'no_provider' })
  })
})
