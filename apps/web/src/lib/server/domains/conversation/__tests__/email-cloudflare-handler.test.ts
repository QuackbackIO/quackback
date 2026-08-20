/**
 * The front door for mail delivered by the fleet's edge mail bridge.
 *
 * Four properties are worth more than the rest of this file put together.
 *
 * THE SIGNATURE IS OVER BYTES. A raw message is 8-bit, and a body decoded to a
 * string before hashing is a different message — so {@link VECTOR} carries a
 * body that is deliberately not valid UTF-8. Anything that decodes first fails
 * it, and nothing else in the suite would notice.
 *
 * THE WORKSPACE LABEL IS INSIDE THE SIGNATURE. The label is what decides whose
 * mail this is, so a delivery that carried it outside the digest would have the
 * guard ruling on a value its caller chose. It is in the signed prefix, which
 * makes rewriting it a 401 rather than a routing decision, and {@link VECTOR}
 * pins a digest for the rewritten label so that stays true.
 *
 * THE GUARD REJECTS BEFORE THE DATABASE IS TOUCHED. `ingestParsedEmail` runs a
 * Message-ID dedupe query before it looks up a conversation and before any rate
 * limit, so a front door that authorized late would let one valid request drive
 * an unauthenticated query — and a duplicate-versus-not oracle — against every
 * workspace on the fleet. Two assertions hold the line: `ingestParsedEmail` is
 * never entered (that query lives inside it), and none of the module specifiers
 * a query would have to arrive through is touched (see {@link dbTouches}).
 *
 * THE REASON CODE IS THE OPERATOR'S ONLY DIAGNOSTIC. Nothing on this path may
 * log an address, so what an operator has when mail stops arriving is a status
 * and a reason code. Several refusals share a status deliberately, which means a
 * suite reading status alone cannot tell them apart either — and a check that
 * vanished would be invisible. So the reason codes are asserted beside the
 * statuses, and they are part of the contract rather than incidental text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import { workspaceSlugFromInboundAddress } from '../conversation.email-channel'

const ingestParsedEmail = vi.fn()
const isConversationsEnabled = vi.fn<() => Promise<boolean>>()

/**
 * Every route to the database that this module could plausibly grow, wired to
 * record the attempt instead of serving it. Nothing before the guard may reach
 * one, so a non-empty list is the failure.
 *
 * WHAT THIS IS AND IS NOT. It is a tripwire on module specifiers, not a proof
 * that no query ran: a read that arrived through some specifier not listed here
 * would still pass. The list is what makes it worth anything, so it is chosen
 * rather than assumed:
 *
 * - `@/lib/server/db` is the single-workspace handle, and the one this file used
 *   to watch alone. On this path it is watched for the future rather than the
 *   present: nothing in the handler's import graph reaches it today, so on its
 *   own this entry proves nothing at all.
 * - `getScopedDatabase` is the POOLED per-workspace handle and never passes
 *   through `@/lib/server/db`. It is what a query on a fleet actually uses, and
 *   the test scope hands a stub for it, so a pre-guard read through it costs
 *   nothing and would have gone unnoticed.
 * - `createDb` is a handle built from scratch, which is how someone who found
 *   both of the above inconvenient would reach a database anyway.
 * - `rate-bucket` is the shared Redis primitive. Not a database, and listed for
 *   the same reason as the rest: a pre-auth rate limiter is the most likely
 *   thing to be added above the guard, and it would put an unauthenticated
 *   caller's key into shared per-workspace state.
 */
const dbTouches: string[] = []

/** A module whose every property read is recorded and answered with nothing. A
 *  caller that goes on to CALL what it read fails too, which is the same red. */
function tripwireModule(specifier: string): Record<string, unknown> {
  const ignored = new Set(['then', '__esModule', 'default'])
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === 'string' && !ignored.has(property)) {
          dbTouches.push(`${specifier}#${property}`)
        }
        return undefined
      },
    }
  )
}

vi.mock('@/lib/server/db', () => tripwireModule('@/lib/server/db'))
vi.mock('@/lib/server/utils/rate-bucket', () => tripwireModule('rate-bucket'))
// Real module with one function wrapped: `withWorkspace` opens the scope through
// this same specifier, so replacing it wholesale would leave the suite with no
// workspace identity to be.
vi.mock('@/lib/server/workspaces/workspace-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/workspaces/workspace-context')>()
  return {
    ...actual,
    getScopedDatabase: () => {
      dbTouches.push('workspace-context#getScopedDatabase')
      return actual.getScopedDatabase()
    },
  }
})
vi.mock('@quackback/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/db/client')>()
  return {
    ...actual,
    createDb: (...args: Parameters<typeof actual.createDb>) => {
      dbTouches.push('@quackback/db/client#createDb')
      return actual.createDb(...args)
    },
  }
})

/**
 * Every line this request logged, so the reason codes can be read back.
 *
 * A fake rather than a transport spy because the reason code is what is being
 * asserted, not the formatting: `(fields, msg)` is the house call shape and both
 * halves are captured. Shaped to tolerate the `(msg)` form too, since other
 * modules in the import graph share this logger.
 */
type LogLine = { level: string; fields: Record<string, unknown>; msg: string }
const logLines: LogLine[] = []

vi.mock('@/lib/server/logger', () => {
  const record =
    (level: string) =>
    (first?: unknown, second?: unknown): void => {
      logLines.push({
        level,
        fields: typeof first === 'object' && first !== null ? { ...first } : {},
        msg: typeof first === 'string' ? first : typeof second === 'string' ? second : '',
      })
    }
  const makeLogger = (): Record<string, unknown> => ({
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => makeLogger(),
  })
  return { logger: makeLogger(), createLogger: () => makeLogger() }
})
vi.mock('../conversation.email-inbound.service', () => ({
  ingestParsedEmail: (...a: unknown[]) => ingestParsedEmail(...a),
  // The provider webhook handler is imported for its body cap, so its own
  // dependency has to resolve.
  ingestInboundEmail: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: () => isConversationsEnabled(),
}))

import {
  deliveryNamesThisWorkspace,
  handleCloudflareInboundEmail,
  INBOUND_REPLAY_TOLERANCE_SECONDS,
  isCloudflareInboundConfigured,
  isCloudflareInboundRequest,
  isFreshInboundTimestamp,
  verifyInboundSignature,
} from '../email-cloudflare-handler'
import { MAX_EMAIL_WEBHOOK_BODY_BYTES } from '../email-webhook-handler'
import {
  inboundDedupeKey,
  MAX_DEDUPE_KEY_CHARS,
  MAX_TRANSPORT_MESSAGE_ID_CHARS,
} from '../conversation.email-inbound'

const SECRET = 'worker-inbound-test-key'
/** The plus-address signing secret: a different key with a different job. */
const ADDRESS_SECRET = 'whsec_dGVzdHNlY3JldA=='
const DOMAIN = 'quackback.co.uk'
/** A domain this install still RECEIVES on and no longer mints addresses on. */
const RETIRED_DOMAIN = 'mail.retired.test'
const SLUG = mailSlugFor('ws-t1')
const OTHER_SLUG = mailSlugFor('ws-t2')

/**
 * THE SHARED VECTOR. This constant is reproduced in the control-plane repo,
 * where it is checked against the edge sender's WebCrypto implementation.
 * Changing any value here means changing it there in the same breath: that is
 * the entire point of duplicating it, because the two implementations drifting
 * then fails a test on whichever side moved rather than silently bouncing
 * customer mail.
 *
 * The body is deliberately not valid UTF-8, and the two negative digests are
 * not arbitrary wrong values — each is the digest a specific mistake produces,
 * so a reader who "fixes" the positive by regenerating it still fails.
 */
const VECTOR = {
  secret: 's3cr3t-key',
  timestamp: 1_754_870_400,
  mailSlug: 'ws-t1',
  /** `Subject: \xff\xfe\x80\xe9\r\n\r\nA` — 18 bytes, four of them illegal UTF-8. */
  body: Uint8Array.from(Buffer.from('5375626a6563743a20fffe80e90d0a0d0a41', 'hex')),
  signature: '9c8c8a0aedbba0ebfae028c8fe48a431660313e40f66e0a6c65600b58e61916f',
  /** What hashing the body as a decoded string produces: 26 bytes, not 18. */
  signatureOverDecodedBody: 'e0381799a16ad67e2ade3151cc00c0a8a780ebc518823db39574335a89c86e01',
  /** The same body signed for `ws-t2`: what a re-aimed capture would need. */
  signatureUnderOtherSlug: 'cf13024213845a58892cc66b887b040c52b2a8c8a6e99e27db3471753d31ed43',
} as const

/** A real message whose `To:` is the CUSTOMER's own address: the envelope is the
 *  only place our address appears, exactly as it is under forwarding. */
const RAW = [
  'From: Visitor <visitor@example.com>',
  'To: support@customer.example',
  'Subject: Help please',
  'Message-ID: <m-1@example.com>',
  '',
  'It is broken.',
  '',
].join('\r\n')

/**
 * The edge sender's digest: timestamp, workspace label, then the raw bytes.
 *
 * The label and the secret are both strings with very different jobs, so they
 * are named rather than positional — a suite whose "wrong key" case could be
 * silently read as a "wrong label" case proves neither.
 */
function sign(
  body: Uint8Array,
  opts: { timestamp: number; mailSlug?: string; secret?: string }
): string {
  const { timestamp, mailSlug = SLUG, secret = SECRET } = opts
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(`${timestamp}.${mailSlug}.`, 'utf8'))
    .update(body)
    .digest('hex')
}

function inboundRequest(
  opts: {
    body?: Uint8Array | string
    timestamp?: number
    /** The label on the wire. `null` omits the header entirely. */
    mailSlug?: string | null
    /** The label the signature is made over. Defaults to the one on the wire,
     *  so they part company only where a test says so. */
    signedSlug?: string
    signature?: string | null
    envelopeTo?: string | null
    contentType?: string
    /** The transport's own id. Omitted entirely unless a case sets it, so the
     *  default request is the one every other front door sends. */
    transportMessageId?: string
  } = {}
): Request {
  const source = opts.body ?? RAW
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const mailSlug = opts.mailSlug === undefined ? SLUG : opts.mailSlug
  const headers = new Headers({
    'content-type': opts.contentType ?? 'message/rfc822',
    'x-qb-envelope-from': 'visitor@example.com',
    'x-qb-timestamp': String(timestamp),
  })
  if (mailSlug !== null) headers.set('x-qb-mail-slug', mailSlug)
  const signature =
    opts.signature === undefined
      ? sign(bytes, { timestamp, mailSlug: opts.signedSlug ?? mailSlug ?? '' })
      : opts.signature
  if (signature !== null) headers.set('x-qb-signature', signature)
  const envelopeTo = opts.envelopeTo === undefined ? `${SLUG}@${DOMAIN}` : opts.envelopeTo
  if (envelopeTo !== null) headers.set('x-qb-envelope-to', envelopeTo)
  if (opts.transportMessageId !== undefined) {
    headers.set('x-qb-transport-message-id', opts.transportMessageId)
  }
  return new Request('http://ws-t1.example.com/api/chat/email/inbound', {
    method: 'POST',
    headers,
    // Through a Blob, so the request carries the exact bytes: a string body
    // would be encoded by the runtime, and a body this suite deliberately fills
    // with invalid UTF-8 would not survive the trip.
    body: new Blob([bytes.slice()]),
  })
}

/** Deliver as the workspace the request was routed to. */
function post(request: Request, workspaceKey = 'ws-t1'): Promise<Response> {
  return withWorkspace(workspaceKey, () => handleCloudflareInboundEmail(request))
}

/** No database work happened on this request. */
function expectNoDatabaseWork(): void {
  expect(ingestParsedEmail).not.toHaveBeenCalled()
  expect(isConversationsEnabled).not.toHaveBeenCalled()
  expect(dbTouches).toEqual([])
}

/** The reason codes this request logged, in the order it logged them. */
function reasons(): string[] {
  return logLines.flatMap((line) =>
    typeof line.fields.reason === 'string' ? [line.fields.reason] : []
  )
}

/** Back to a clean slate mid-test, for the cases that loop over several inputs. */
function resetBetweenCases(): void {
  vi.clearAllMocks()
  dbTouches.length = 0
  logLines.length = 0
  isConversationsEnabled.mockResolvedValue(true)
  ingestParsedEmail.mockResolvedValue({ status: 'ingested', conversationId: 'conversation_1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbTouches.length = 0
  logLines.length = 0
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  vi.stubEnv('INBOUND_HMAC_SECRET', SECRET)
  vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
  // The addressing half of the channel. Set for every case because a front door
  // that cannot mint the reply address for what it accepts is unconfigured, not
  // half-configured — see the configuration suite.
  vi.stubEnv('EMAIL_INBOUND_SIGNING_SECRET', ADDRESS_SECRET)
  isConversationsEnabled.mockResolvedValue(true)
  ingestParsedEmail.mockResolvedValue({ status: 'ingested', conversationId: 'conversation_1' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('the signed wire contract', () => {
  it('ingests a validly signed message', async () => {
    const res = await post(inboundRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ingested' })
    expect(ingestParsedEmail).toHaveBeenCalledOnce()
    expect(ingestParsedEmail.mock.calls[0][0]).toMatchObject({
      from: 'Visitor <visitor@example.com>',
      subject: 'Help please',
      messageId: '<m-1@example.com>',
    })
    expect(ingestParsedEmail.mock.calls[0][0].text.trim()).toBe('It is broken.')
  })

  it('agrees with the edge sender byte for byte, on the shared vector', () => {
    // See {@link VECTOR}: this constant lives in the control-plane repo too, and
    // it only earns that duplication if both sides assert it.
    const { secret, timestamp, mailSlug, body } = VECTOR
    const check = (signature: string): boolean =>
      verifyInboundSignature({ timestamp: String(timestamp), mailSlug, signature, body, secret })

    expect(check(VECTOR.signature)).toBe(true)
    // Each negative is the digest one specific mistake would have produced.
    expect(check(VECTOR.signatureOverDecodedBody)).toBe(false)
    expect(check(VECTOR.signatureUnderOtherSlug)).toBe(false)
  })

  it('ingests the shared vector end to end', async () => {
    // The same trap through the handler: a real request that verifies only if
    // nothing decoded the body on the way to the digest and nothing dropped the
    // label from the prefix. Only the clock is faked — faking timers as well
    // would stall the body stream.
    expect(SLUG).toBe(VECTOR.mailSlug)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(VECTOR.timestamp * 1000)
    vi.stubEnv('INBOUND_HMAC_SECRET', VECTOR.secret)

    const res = await post(
      inboundRequest({
        body: VECTOR.body,
        timestamp: VECTOR.timestamp,
        mailSlug: VECTOR.mailSlug,
        signature: VECTOR.signature,
      })
    )

    expect(res.status).toBe(200)
    expect(ingestParsedEmail).toHaveBeenCalledOnce()
  })

  it('401s a signature made with the wrong secret', async () => {
    const bytes = new TextEncoder().encode(RAW)
    const timestamp = Math.floor(Date.now() / 1000)

    const res = await post(
      inboundRequest({ timestamp, signature: sign(bytes, { timestamp, secret: 'not-the-key' }) })
    )

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['bad_signature'])
    expectNoDatabaseWork()
  })

  it('401s a signature made with the plus-address signing secret', async () => {
    // The two keys are separate on purpose: one leak must not be able to do both
    // jobs. A request signed with the address secret is a stranger here.
    const bytes = new TextEncoder().encode(RAW)
    const timestamp = Math.floor(Date.now() / 1000)

    const res = await post(
      inboundRequest({ timestamp, signature: sign(bytes, { timestamp, secret: ADDRESS_SECRET }) })
    )

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['bad_signature'])
    expectNoDatabaseWork()
  })

  it('401s a body tampered with after signing', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(new TextEncoder().encode(RAW), { timestamp })
    const tampered = RAW.replace('visitor@example.com', 'attacker@evil.test')

    const res = await post(inboundRequest({ body: tampered, timestamp, signature }))

    expect(res.status).toBe(401)
    expectNoDatabaseWork()
  })

  it('401s a delivery whose workspace label was rewritten after signing', async () => {
    // The attack the signed label closes: capture a delivery the edge signed for
    // one workspace, relabel it and aim it at another workspace's front door.
    // The label is inside the digest, so it is refused AT THE SIGNATURE — before
    // the guard, and before there is any question of whose mail this is.
    //
    // Both reachable shapes, because they fail for the same reason and a 404
    // from either would mean the label had been believed far enough to be
    // compared against something. The first is the sharper one: only the header
    // moves, so a verifier that derived the label from the envelope instead of
    // taking the signed one would still agree with the digest.
    for (const envelopeTo of [`${SLUG}@${DOMAIN}`, `${OTHER_SLUG}@${DOMAIN}`]) {
      resetBetweenCases()

      const res = await post(
        inboundRequest({ mailSlug: OTHER_SLUG, signedSlug: SLUG, envelopeTo }),
        'ws-t2'
      )

      expect(res.status, envelopeTo).toBe(401)
      expect(reasons(), envelopeTo).toEqual(['bad_signature'])
      expectNoDatabaseWork()
    }
  })

  it('401s raw MIME carrying no workspace label', async () => {
    // A delivery with no label is not a delivery this contract can verify. 401
    // rather than 404 because the one thing that produces it is an edge sender
    // older than the signed label, and a deferred message survives that where a
    // bounce would not.
    const res = await post(inboundRequest({ mailSlug: null }))

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['no_mail_slug'])
    expectNoDatabaseWork()
  })

  it('401s a stale timestamp', async () => {
    const stale = Math.floor(Date.now() / 1000) - INBOUND_REPLAY_TOLERANCE_SECONDS - 1

    const res = await post(inboundRequest({ timestamp: stale }))

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['stale_timestamp'])
    expectNoDatabaseWork()
  })

  it('401s a timestamp far in the future', async () => {
    // A receiver that only rejects stale timestamps accepts a far-future one for
    // as long as it names, which turns one wrongly-clocked signer into a
    // standing replay window. With no nonce in the signed material, this bound
    // is the only replay defence there is.
    const future = Math.floor(Date.now() / 1000) + INBOUND_REPLAY_TOLERANCE_SECONDS + 1

    const res = await post(inboundRequest({ timestamp: future }))

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['stale_timestamp'])
    expectNoDatabaseWork()
  })

  it('401s raw MIME carrying no signature at all', async () => {
    // The reason code is the assertion. A missing header and a wrong digest are
    // the same 401, so a suite that read only the status would not notice the
    // header check disappearing — and an operator staring at a 401 could not
    // tell an old sender from a rotated key.
    const res = await post(inboundRequest({ signature: null }))

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['unsigned'])
    expectNoDatabaseWork()
  })

  it('401s raw MIME carrying no timestamp', async () => {
    const request = inboundRequest()
    request.headers.delete('x-qb-timestamp')

    const res = await post(request)

    expect(res.status).toBe(401)
    // `unsigned`, not `stale_timestamp`: an absent timestamp is an incomplete
    // signed set, and calling it stale would point an operator at clock skew.
    expect(reasons()).toEqual(['unsigned'])
    expectNoDatabaseWork()
  })

  it('413s an oversized body before it verifies anything', async () => {
    const res = await post(
      inboundRequest({
        body: 'x'.repeat(MAX_EMAIL_WEBHOOK_BODY_BYTES + 1),
        signature: 'deadbeef',
      })
    )

    expect(res.status).toBe(413)
    expect(reasons()).toEqual(['body_too_large'])
    expectNoDatabaseWork()
  })

  it('refuses on the headers before it reads the body at all', async () => {
    // Ordering, pinned by making the two refusals visibly different: an
    // oversized body would 413 if it were read, so a 401 proves it was not.
    // Every header-only check has to hold this, because the whole point of
    // checking them first is that a replayed or unsignable capture costs this
    // side no bytes — the body cap bounds what a request can spend, but only
    // after something has decided to spend it.
    const stale = Math.floor(Date.now() / 1000) - INBOUND_REPLAY_TOLERANCE_SECONDS - 1
    const oversized = 'x'.repeat(MAX_EMAIL_WEBHOOK_BODY_BYTES + 1)

    for (const [label, request] of [
      ['stale_timestamp', inboundRequest({ body: oversized, timestamp: stale })],
      ['no_mail_slug', inboundRequest({ body: oversized, mailSlug: null })],
      ['unsigned', inboundRequest({ body: oversized, signature: null })],
    ] as const) {
      resetBetweenCases()

      const res = await post(request)

      expect(res.status, label).toBe(401)
      expect(reasons(), label).toEqual([label])
      expectNoDatabaseWork()
    }
  })

  it('carries the envelope recipient into routing, and leaves the author alone', async () => {
    // Under forwarding the address that routes the message appears only on the
    // envelope: `To:` is still the customer's own support address, which is what
    // later resolves their channel account, so both have to survive. `From:`
    // stays the author — it is what DMARC was evaluated against — and never
    // becomes the envelope sender, which is only a bounce address.
    await post(inboundRequest({ envelopeTo: `${SLUG}+c01kw8qxn1eeh4t2rek7varh032.sig@${DOMAIN}` }))

    expect(ingestParsedEmail.mock.calls[0][0]).toMatchObject({
      toAddresses: [
        `${SLUG}+c01kw8qxn1eeh4t2rek7varh032.sig@${DOMAIN}`,
        'support@customer.example',
      ],
      from: 'Visitor <visitor@example.com>',
    })
  })

  it('500s when ingestion throws, so the message is retried rather than bounced', async () => {
    ingestParsedEmail.mockRejectedValue(new Error('db down'))

    const res = await post(inboundRequest())

    expect(res.status).toBe(500)
  })

  it('logs an ingest failure without shipping the message into the logs', async () => {
    // The one value on this path whose text this module did not write. Pino's
    // redact list matches the KEY `email`, so nothing stops an address inside
    // `err.message` — a query echoing its parameters, or a parser naming the
    // recipient it choked on — from being logged verbatim.
    ingestParsedEmail.mockRejectedValue(
      new Error(
        `insert failed for recipient visitor@example.com <${SLUG}@${DOMAIN}>: ` + 'x'.repeat(500)
      )
    )

    const res = await post(inboundRequest())

    expect(res.status).toBe(500)
    const failure = logLines.find((line) => line.level === 'error')!
    const logged = JSON.stringify(failure.fields)
    expect(logged).not.toContain('visitor@example.com')
    expect(logged).not.toContain(`${SLUG}@${DOMAIN}`)
    expect(logged).not.toContain('@')
    // Bounded as well as scrubbed: masking removes the shape worth worrying
    // about, the cap bounds whatever it did not think of.
    expect(logged.length).toBeLessThan(400)
    // Still a usable log line: the fault is named.
    expect(logged).toContain('insert failed')
  })

  it('acks every ingest outcome, including the drops', async () => {
    // The ingest core's refusals are policy — a blocked sender, a throttle, a
    // conversation that is gone. Bouncing on them would leak that policy to
    // whoever probed it and would make temporary refusals permanent.
    ingestParsedEmail.mockResolvedValue({ status: 'rate_limited' })

    const res = await post(inboundRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'rate_limited' })
  })
})

describe('the guard', () => {
  it('404s a delivery signed for another workspace, with no database work', async () => {
    // The isolation property of the whole design: a message the edge signed for
    // one workspace and delivered to another host, whether by mistake or on
    // purpose, is refused here. Perfectly signed, and still not ours.
    const res = await post(
      inboundRequest({ mailSlug: OTHER_SLUG, envelopeTo: `${OTHER_SLUG}@${DOMAIN}` })
    )

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('404s a signed reply address minted for another workspace', async () => {
    const res = await post(
      inboundRequest({
        mailSlug: OTHER_SLUG,
        envelopeTo: `${OTHER_SLUG}+c01kw8qxn1eeh4t2rek7varh032.sig@${DOMAIN}`,
      })
    )

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('404s an envelope naming another workspace under a label that is ours', async () => {
    // THE CROSS-CHECK, on its own. The envelope is forwarded verbatim so a
    // reply's case-sensitive sub-address survives, which makes it the one field
    // an attacker on the path can still edit without breaking the digest.
    //
    // This is the only shape that exercises the cross-check: the signed label
    // has to be OURS, or the rule above it refuses first and the cross-check is
    // never reached. Pairing it with the mirror case (a signed label that is not
    // ours, envelope agreeing) would be pairing two different rules, and the
    // suite would still pass with the cross-check deleted.
    //
    // What the cross-check does NOT do: stop the envelope being edited to
    // another address under the SAME label. That re-aim is bounded by the
    // plus-address HMAC and by the ingest core's From-binding, neither of which
    // lives here.
    const res = await post(
      inboundRequest({ mailSlug: SLUG, envelopeTo: `${OTHER_SLUG}@${DOMAIN}` })
    )

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('404s an envelope on a domain this install does not receive on', async () => {
    // The label is only unique inside the domain it was minted under. One zone
    // in front of the edge sender makes this unreachable; a second zone makes
    // `<our label>@<someone else's domain>` a delivery that reads as ours.
    for (const envelopeTo of [
      `${SLUG}@not-our-domain.test`,
      `${SLUG}+c01kw8qxn1eeh4t2rek7varh032.sig@not-our-domain.test`,
      `${SLUG}@sub.${DOMAIN}`,
      `${SLUG}@`,
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expect(reasons(), envelopeTo).toEqual(['not_this_workspace'])
      expectNoDatabaseWork()
    }
  })

  it('reads the domain the way it reads the label', async () => {
    // Same normalisation on both halves of the address. A domain check that
    // compared raw bytes would bounce mail a receiving server, and the edge
    // sender, both considered ours.
    for (const envelopeTo of [
      `${SLUG}@${DOMAIN.toUpperCase()}`,
      ` ${SLUG}@${DOMAIN} `,
      `${SLUG}@${DOMAIN}\t`,
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(200)
    }
  })

  it('404s a delivery signed for another workspace even when the envelope is ours', async () => {
    // The mirror of the cross-check case, and a DIFFERENT rule: the signed label
    // is the authority, so it is refused for not being ours before the envelope
    // beside it is read at all.
    const res = await post(
      inboundRequest({ mailSlug: OTHER_SLUG, envelopeTo: `${SLUG}@${DOMAIN}` })
    )

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('404s an unreadable envelope, with no database work', async () => {
    // Each of these is signed for this workspace and would be accepted on the
    // label alone, so the cross-check is what refuses them. `unreadable` is
    // never "no workspace named, so allow": a cross-check shaped "reject only
    // when the envelope names a DIFFERENT workspace" would wave every one of
    // these through, because none of them names one at all.
    for (const envelopeTo of [
      'NOT_A_SLUG!!@quackback.co.uk',
      'a.very.long.customer.local.part@example.com',
      '@quackback.co.uk',
      'not-an-address-at-all',
      '',
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expect(reasons(), envelopeTo).toEqual(['not_this_workspace'])
      expectNoDatabaseWork()
    }
  })

  it('404s a missing envelope header, with no database work', async () => {
    const res = await post(inboundRequest({ envelopeTo: null }))

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('404s when the process has no workspace to be', async () => {
    // A pooled process outside a workspace scope names no workspace, so it can
    // accept mail for none.
    const res = await handleCloudflareInboundEmail(inboundRequest())

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('is checked after the signature, so it cannot be probed for which workspace a host serves', async () => {
    // A wrong label AND a wrong signature answers on the signature. If the guard
    // ran first, the 404-versus-401 difference would tell an unauthenticated
    // caller which slug this host answers for.
    const res = await post(
      inboundRequest({
        mailSlug: OTHER_SLUG,
        envelopeTo: `${OTHER_SLUG}@${DOMAIN}`,
        signature: 'deadbeef',
      })
    )

    expect(res.status).toBe(401)
    expect(reasons()).toEqual(['bad_signature'])
    expectNoDatabaseWork()
  })

  it('reads the envelope the way the edge sender normalised it', async () => {
    // The cross-check only holds if this side derives the label from the
    // verbatim envelope exactly as the edge derived the one it signed: trim the
    // local part, fold its case, and take everything before the FIRST `+`. A
    // difference of one step here bounces correctly routed mail.
    for (const envelopeTo of [
      ` ${SLUG}@${DOMAIN} `,
      `\t${SLUG}\t@${DOMAIN}`,
      `${SLUG.toUpperCase()}@${DOMAIN}`,
      `${SLUG}+anything@${DOMAIN}`,
      `${SLUG}++@${DOMAIN}`,
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(200)
    }
  })

  it('folds case the Unicode way the edge sender does', async () => {
    // `toLowerCase()` maps U+212A KELVIN SIGN to `k`, on both sides, so an
    // envelope carrying one derives the same label the edge signed. Pinned
    // because a cross-check comparing raw bytes instead would refuse mail the
    // edge had already decided belonged here.
    //
    // Asserted against the derivation directly rather than through a request:
    // `x-qb-envelope-to` is an HTTP header, headers are ByteStrings, and a code
    // point above 255 cannot be put in one at all — `Headers.set` throws. So a
    // request carrying a raw U+212A is not a case the handler can ever meet,
    // and building one tested the test harness rather than the folding rule.
    const kelvinEnvelope = `\u{212A}ilo-1@${DOMAIN}`
    expect(kelvinEnvelope).not.toContain(mailSlugFor('kilo-1'))

    const named = workspaceSlugFromInboundAddress(kelvinEnvelope)
    expect(named).toEqual({ kind: 'slug', slug: mailSlugFor('kilo-1') })
  })

  it('splits on the last `@`, so a local part carrying one cannot spoof a label', async () => {
    // `<slug>@evil@<domain>` reads as the local part `<slug>@evil`, which is no
    // slug at all, so the cross-check refuses it. Splitting on the first `@`
    // would read it as ours and let a stranger's domain through.
    const res = await post(inboundRequest({ envelopeTo: `${SLUG}@evil.test@${DOMAIN}` }))

    expect(res.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
    expectNoDatabaseWork()
  })

  it('defers when no visitor surface can receive the mail', async () => {
    // Not acked: this answers a sending mail server, and telling it "delivered"
    // for mail that has nowhere to land is silent loss.
    //
    // Not rejected either, which is the sharper half. This gate is the OR of
    // three settings an admin flips from the app, so "off" is a state and not a
    // property of the address — and the sender is told the difference. A 503
    // defers, so a workspace that switches a surface on gets the mail that was
    // waiting; a 404 would have bounced it and told the sender the recipient
    // does not accept mail, which nothing done afterwards recalls.
    isConversationsEnabled.mockResolvedValue(false)

    const res = await post(inboundRequest())

    expect(res.status).toBe(503)
    expect(reasons()).toEqual(['conversations_disabled'])
    expect(ingestParsedEmail).not.toHaveBeenCalled()
  })
})

describe('the accept-set', () => {
  /** The state a domain change leaves behind: minting on one, receiving on both. */
  function afterTheChange(): void {
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
    vi.stubEnv('EMAIL_INBOUND_EXTRA_DOMAINS', RETIRED_DOMAIN)
  }

  it('accepts a delivery on a retired domain the install still receives on', async () => {
    // THE CUTOVER, stated as behaviour. Every reply address minted before the
    // change is on the retired domain and is still sitting in somebody's mail
    // client. A door that answered for one domain refuses each of them, and a
    // refused delivery is one nobody has: it faults, is retried, and ends up
    // parked on the edge sender's replay queue waiting for a person.
    afterTheChange()

    for (const envelopeTo of [
      `${SLUG}@${RETIRED_DOMAIN}`,
      `${SLUG}+c01kw8qxn1eeh4t2rek7varh032.sig@${RETIRED_DOMAIN}`,
      // Read exactly as the current domain is: folded and trimmed.
      `${SLUG}@${RETIRED_DOMAIN.toUpperCase()}`,
      ` ${SLUG}@${RETIRED_DOMAIN} `,
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(200)
      expect(ingestParsedEmail, envelopeTo).toHaveBeenCalledOnce()
    }
  })

  it('still accepts the minting domain, so the set adds rather than replaces', async () => {
    afterTheChange()

    const res = await post(inboundRequest({ envelopeTo: `${SLUG}@${DOMAIN}` }))

    expect(res.status).toBe(200)
  })

  it('refuses a domain that is in neither, however close it looks', async () => {
    // The set widens the door by exactly the domains named in it and by nothing
    // else. A suffix or substring reading would make every neighbouring zone
    // ours, which is the failure the domain rule exists to prevent: the
    // workspace label is unique only inside the zone it was minted under.
    afterTheChange()

    for (const envelopeTo of [
      `${SLUG}@not-our-domain.test`,
      `${SLUG}@sub.${RETIRED_DOMAIN}`,
      `${SLUG}@${RETIRED_DOMAIN}.evil.test`,
      `${SLUG}@evil-${RETIRED_DOMAIN}`,
      `${SLUG}@retired.test`,
    ]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expect(reasons(), envelopeTo).toEqual(['not_this_workspace'])
      expectNoDatabaseWork()
    }
  })

  it('widens the door and not the guard: another workspace is still refused on every domain', async () => {
    afterTheChange()

    // Delivered to THIS workspace's host, signed for the other one: refused on
    // both the current domain and the retired one.
    for (const envelopeTo of [`${OTHER_SLUG}@${RETIRED_DOMAIN}`, `${OTHER_SLUG}@${DOMAIN}`]) {
      resetBetweenCases()

      const res = await post(inboundRequest({ mailSlug: OTHER_SLUG, envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expect(reasons(), envelopeTo).toEqual(['not_this_workspace'])
      expectNoDatabaseWork()
    }
  })

  it('is exactly the minting domain when no extras are configured', async () => {
    // The self-hosted install, which sets one value and must keep behaving as it
    // always has. `beforeEach` leaves the extras unset, so this is the default.
    const res = await post(inboundRequest({ envelopeTo: `${SLUG}@${DOMAIN}` }))
    expect(res.status).toBe(200)

    resetBetweenCases()
    const refused = await post(inboundRequest({ envelopeTo: `${SLUG}@${RETIRED_DOMAIN}` }))
    expect(refused.status).toBe(404)
    expect(reasons()).toEqual(['not_this_workspace'])
  })

  it('treats a blank or comma-padded extras value as no extras at all', async () => {
    for (const extras of ['', '   ', ',', ' , , ']) {
      resetBetweenCases()
      vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
      vi.stubEnv('EMAIL_INBOUND_EXTRA_DOMAINS', extras)

      const accepted = await post(inboundRequest({ envelopeTo: `${SLUG}@${DOMAIN}` }))
      expect(accepted.status, extras).toBe(200)

      resetBetweenCases()
      const refused = await post(inboundRequest({ envelopeTo: `${SLUG}@${RETIRED_DOMAIN}` }))
      expect(refused.status, extras).toBe(404)
    }
  })

  it('accepts several extras, separated by commas or spaces', async () => {
    const third = 'mail.older.test'
    for (const extras of [
      `${RETIRED_DOMAIN},${third}`,
      `${RETIRED_DOMAIN}, ${third}`,
      `${RETIRED_DOMAIN} ${third}`,
      `  ${RETIRED_DOMAIN.toUpperCase()} , ${third}  `,
    ]) {
      for (const domain of [DOMAIN, RETIRED_DOMAIN, third]) {
        resetBetweenCases()
        vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
        vi.stubEnv('EMAIL_INBOUND_EXTRA_DOMAINS', extras)

        const res = await post(inboundRequest({ envelopeTo: `${SLUG}@${domain}` }))

        expect(res.status, `${extras} -> ${domain}`).toBe(200)
      }
    }
  })

  it('does not open the transport on extras alone', async () => {
    // The extras name domains this door ANSWERS for. They say nothing about
    // whether an address can be minted, which is what the transport gate asks,
    // so a deployment with extras and no minting domain is still unconfigured —
    // and unconfigured still DEFERS rather than bouncing.
    resetBetweenCases()
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', '')
    vi.stubEnv('EMAIL_INBOUND_EXTRA_DOMAINS', RETIRED_DOMAIN)

    const res = await post(inboundRequest({ envelopeTo: `${SLUG}@${RETIRED_DOMAIN}` }))

    expect(res.status).toBe(503)
    expect(reasons()).toEqual(['transport_unconfigured'])
    expectNoDatabaseWork()
  })
})

describe('the transport dedupe id', () => {
  /** A message with no `Message-ID` of its own: the case the transport id is for. */
  const NO_MESSAGE_ID = [
    'From: Visitor <visitor@example.com>',
    'To: support@customer.example',
    'Subject: Help please',
    '',
    'It is broken.',
    '',
  ].join('\r\n')

  it('carries the transport id to the ingest core for a message with no Message-ID', async () => {
    await post(inboundRequest({ body: NO_MESSAGE_ID, transportMessageId: 'ses-abc-123' }))

    expect(ingestParsedEmail).toHaveBeenCalledOnce()
    expect(ingestParsedEmail.mock.calls[0][0]).toMatchObject({
      messageId: null,
      transportMessageId: 'ses-abc-123',
    })
  })

  it('carries it beside a real Message-ID too, and never over it', async () => {
    // Plumbed unconditionally; which of the two is SPENT is the ingest core's
    // decision, and it prefers the message's own id. Asserting that here as well
    // would be asserting it in the wrong place.
    await post(inboundRequest({ transportMessageId: 'ses-abc-123' }))

    expect(ingestParsedEmail.mock.calls[0][0]).toMatchObject({
      messageId: '<m-1@example.com>',
      transportMessageId: 'ses-abc-123',
    })
  })

  it('leaves the field unset when the header is absent, blank or implausible', async () => {
    // The other front doors send no such header, and a message that arrives
    // without one has to reach the ingest core exactly as it did before this
    // header existed. An over-long value is dropped rather than trusted: it is
    // written into indexed metadata, where an oversized entry is not a bad
    // dedupe key but an INSERT that throws.
    for (const transportMessageId of [
      undefined,
      '',
      '   ',
      'x'.repeat(MAX_TRANSPORT_MESSAGE_ID_CHARS + 1),
    ]) {
      resetBetweenCases()

      await post(
        inboundRequest({
          body: NO_MESSAGE_ID,
          ...(transportMessageId === undefined ? {} : { transportMessageId }),
        })
      )

      const parsed = ingestParsedEmail.mock.calls[0][0]
      expect(parsed.messageId, String(transportMessageId)).toBeNull()
      expect(parsed.transportMessageId ?? null, String(transportMessageId)).toBeNull()
    }
  })

  it('keeps a value at the ceiling, and the ceiling is the ingest core’s', async () => {
    // The door's bound is derived from the key ceiling rather than typed a
    // second time, so a value this door accepts always produces a key the
    // insert can store. Two independently chosen numbers would eventually
    // differ, and the difference would read as a message that deduplicates on
    // nothing for no visible reason.
    const atCeiling = 'x'.repeat(MAX_TRANSPORT_MESSAGE_ID_CHARS)

    await post(inboundRequest({ body: NO_MESSAGE_ID, transportMessageId: atCeiling }))

    const parsed = ingestParsedEmail.mock.calls[0][0]
    expect(parsed.transportMessageId).toBe(atCeiling)
    expect(inboundDedupeKey(parsed)!.length).toBeLessThanOrEqual(MAX_DEDUPE_KEY_CHARS)
  })
})

describe('deliveryNamesThisWorkspace', () => {
  /** The accept-set as {@link inboundAcceptDomains} builds it: folded, trimmed. */
  const accepts = (...domains: string[]): ReadonlySet<string> => new Set(domains)
  const OURS = accepts(DOMAIN)

  it('accepts a signed label equal to ours whose envelope agrees', () => {
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, SLUG, OURS)).toBe(true)
    expect(deliveryNamesThisWorkspace(`${SLUG}+c1.sig@${DOMAIN}`, SLUG, SLUG, OURS)).toBe(true)
  })

  it('rejects another workspace, an absent label, an absent header and no identity', () => {
    // Each of these fails on the LABEL rule: the envelope agrees with the signed
    // label every time, so nothing here is the cross-check answering.
    expect(deliveryNamesThisWorkspace(`${OTHER_SLUG}@${DOMAIN}`, OTHER_SLUG, SLUG, OURS)).toBe(
      false
    )
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, null, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, '', SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(null, SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace('', SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, null, OURS)).toBe(false)
  })

  it('rejects an envelope that disagrees with the signed label, however it disagrees', () => {
    // The CROSS-CHECK, isolated: the signed label is ours in every case, so the
    // label rule has already passed and only the envelope can refuse. Naming a
    // different workspace, and naming no workspace at all, are the same answer.
    expect(deliveryNamesThisWorkspace(`${OTHER_SLUG}@${DOMAIN}`, SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(`NOT_A_SLUG!!@${DOMAIN}`, SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace('not-an-address-at-all', SLUG, SLUG, OURS)).toBe(false)
  })

  it('rejects an envelope on a domain this install does not receive on', () => {
    expect(deliveryNamesThisWorkspace(`${SLUG}@elsewhere.test`, SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@sub.${DOMAIN}`, SLUG, SLUG, OURS)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@`, SLUG, SLUG, OURS)).toBe(false)
    // No domain to answer for is no delivery to accept.
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, SLUG, accepts())).toBe(false)
    // Folded and trimmed on the envelope side, as a receiving server would.
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN.toUpperCase()}`, SLUG, SLUG, OURS)).toBe(
      true
    )
    expect(deliveryNamesThisWorkspace(` ${SLUG}@${DOMAIN} `, SLUG, SLUG, OURS)).toBe(true)
  })

  it('accepts an envelope on ANY domain in the set, and only an exact member', () => {
    // The switch this whole change exists for. Every reply address ever minted
    // sits on the domain that was minting when it was sent, so a retired domain
    // has to keep answering for as long as that mail circulates — while exactly
    // one domain mints. One string here made that a cliff.
    const both = accepts(DOMAIN, RETIRED_DOMAIN)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${RETIRED_DOMAIN}`, SLUG, SLUG, both)).toBe(true)
    expect(deliveryNamesThisWorkspace(`${SLUG}+c1.sig@${RETIRED_DOMAIN}`, SLUG, SLUG, both)).toBe(
      true
    )
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, SLUG, both)).toBe(true)

    // Membership is exact. A wider set is still not a suffix rule: the label is
    // unique only inside the zone it was minted under, so a neighbouring zone
    // reading as ours is the failure the domain check exists to prevent.
    expect(deliveryNamesThisWorkspace(`${SLUG}@sub.${RETIRED_DOMAIN}`, SLUG, SLUG, both)).toBe(
      false
    )
    expect(
      deliveryNamesThisWorkspace(`${SLUG}@${RETIRED_DOMAIN}.evil.test`, SLUG, SLUG, both)
    ).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@not-ours.test`, SLUG, SLUG, both)).toBe(false)

    // And a wider domain set widens nothing about WHOSE mail this is: the label
    // rules still answer first, on every domain in the set.
    expect(deliveryNamesThisWorkspace(`${OTHER_SLUG}@${RETIRED_DOMAIN}`, SLUG, SLUG, both)).toBe(
      false
    )
    expect(
      deliveryNamesThisWorkspace(`${OTHER_SLUG}@${RETIRED_DOMAIN}`, OTHER_SLUG, SLUG, both)
    ).toBe(false)
  })

  it('does not let a slug-shaped label anywhere else in the value stand in for ours', () => {
    // The envelope is one address. A value carrying several is not one, and the
    // one that routed the message is not identifiable among them.
    expect(
      deliveryNamesThisWorkspace(`someone@example.com, ${SLUG}@${DOMAIN}`, SLUG, SLUG, OURS)
    ).toBe(false)
    expect(deliveryNamesThisWorkspace(`<${SLUG}@${DOMAIN}>`, SLUG, SLUG, OURS)).toBe(false)
  })
})

describe('isFreshInboundTimestamp', () => {
  const now = 1_754_870_400_000

  it('accepts the window and rejects both sides of it', () => {
    expect(isFreshInboundTimestamp('1754870400', now)).toBe(true)
    expect(isFreshInboundTimestamp(String(1754870400 - 120), now)).toBe(true)
    expect(isFreshInboundTimestamp(String(1754870400 + 120), now)).toBe(true)
    expect(isFreshInboundTimestamp(String(1754870400 - 121), now)).toBe(false)
    expect(isFreshInboundTimestamp(String(1754870400 + 121), now)).toBe(false)
  })

  it('rejects what is not a timestamp', () => {
    expect(isFreshInboundTimestamp(null, now)).toBe(false)
    expect(isFreshInboundTimestamp('', now)).toBe(false)
    expect(isFreshInboundTimestamp('yesterday', now)).toBe(false)
    expect(isFreshInboundTimestamp('Infinity', now)).toBe(false)
  })
})

describe('verifyInboundSignature', () => {
  const body = new TextEncoder().encode('hello')
  /** Everything the digest covers except the one field a case is varying. */
  const base = { timestamp: '1', mailSlug: SLUG, body, secret: SECRET }

  it('spends the secret as raw bytes, not as a base64 provider key', () => {
    // The edge sender signs with `TextEncoder().encode(secret)`. A verifier that
    // base64-decoded it, the way the `whsec_` provider secret is decoded, would
    // agree with nothing.
    const secret = 'whsec_dGVzdHNlY3JldA=='
    const prefix = Buffer.from(`1.${SLUG}.`, 'utf8')
    const raw = createHmac('sha256', Buffer.from(secret, 'utf8'))
      .update(prefix)
      .update(body)
      .digest('hex')
    const decoded = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
      .update(prefix)
      .update(body)
      .digest('hex')

    expect(verifyInboundSignature({ ...base, signature: raw, secret })).toBe(true)
    expect(verifyInboundSignature({ ...base, signature: decoded, secret })).toBe(false)
  })

  it('covers the timestamp, so it cannot be edited to widen the replay window', () => {
    const signature = sign(body, { timestamp: 1 })
    expect(verifyInboundSignature({ ...base, signature })).toBe(true)
    expect(verifyInboundSignature({ ...base, timestamp: '2', signature })).toBe(false)
  })

  it('covers the workspace label, so a capture cannot be re-aimed', () => {
    // Without this the label would be an unauthenticated header, and every
    // rejection downstream of it would be ruling on a value its caller chose.
    const signature = sign(body, { timestamp: 1 })
    expect(verifyInboundSignature({ ...base, signature })).toBe(true)
    expect(verifyInboundSignature({ ...base, mailSlug: OTHER_SLUG, signature })).toBe(false)
    expect(verifyInboundSignature({ ...base, mailSlug: '', signature })).toBe(false)
  })

  it('fails closed on a missing signature, a missing secret and a malformed digest', () => {
    const signature = sign(body, { timestamp: 1 })
    expect(verifyInboundSignature({ ...base, signature: null })).toBe(false)
    expect(verifyInboundSignature({ ...base, signature, secret: '' })).toBe(false)
    // Truncated hex must not compare equal to a prefix of the digest.
    expect(verifyInboundSignature({ ...base, signature: signature.slice(0, 16) })).toBe(false)
    expect(verifyInboundSignature({ ...base, signature: 'zz' })).toBe(false)
  })

  it('tolerates the other spelling of hex', () => {
    const signature = sign(body, { timestamp: 1 })
    expect(verifyInboundSignature({ ...base, signature: signature.toUpperCase() })).toBe(true)
  })
})

describe('configuration', () => {
  const CONFIGURED = {
    EMAIL_INBOUND_DOMAIN: DOMAIN,
    EMAIL_INBOUND_SIGNING_SECRET: ADDRESS_SECRET,
    INBOUND_HMAC_SECRET: SECRET,
  }

  it('needs its own transport key AND the addressing half of the channel', () => {
    // Three values, and dropping any one of them is a front door that cannot do
    // the whole job. The signing secret is the one worth naming: with it unset
    // every address this install mints comes back null, so mail is accepted into
    // threads that can never issue a reply address — a one-way conversation, and
    // a silent one, because nothing about it looks like a failure from here.
    expect(isCloudflareInboundConfigured(CONFIGURED)).toBe(true)
    for (const missing of Object.keys(CONFIGURED)) {
      expect(isCloudflareInboundConfigured({ ...CONFIGURED, [missing]: undefined }), missing).toBe(
        false
      )
      expect(isCloudflareInboundConfigured({ ...CONFIGURED, [missing]: '' }), missing).toBe(false)
    }
    expect(isCloudflareInboundConfigured({})).toBe(false)
  })

  it('is not opened by the addressing secret alone', () => {
    // Each transport authenticates its own caller with its own credential. The
    // addressing half being present says an address can be minted and read back,
    // never that this door's caller is who it says it is.
    expect(
      isCloudflareInboundConfigured({
        EMAIL_INBOUND_DOMAIN: DOMAIN,
        EMAIL_INBOUND_SIGNING_SECRET: ADDRESS_SECRET,
      })
    ).toBe(false)
  })

  it('DEFERS the transport when it is not configured, reading nothing', async () => {
    // The finding this suite exists for. The rollout that produces an
    // unconfigured transport is the ordinary one — the edge sender ships, the
    // routing rule points at it, the app's environment is set some minutes later
    // — and a rejection in that window tells every sender the address does not
    // exist. Nothing recalls a bounce. So an unset value has to produce a status
    // the edge sender DEFERS on, and 5xx is that status: 404 and 4xx generally
    // are its bounce, and its one downgrade for a refusal through a remembered
    // route buys exactly one retry before bouncing anyway.
    for (const unset of [
      'INBOUND_HMAC_SECRET',
      'EMAIL_INBOUND_DOMAIN',
      'EMAIL_INBOUND_SIGNING_SECRET',
    ]) {
      resetBetweenCases()
      vi.stubEnv('INBOUND_HMAC_SECRET', SECRET)
      vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
      vi.stubEnv('EMAIL_INBOUND_SIGNING_SECRET', ADDRESS_SECRET)
      vi.stubEnv(unset, '')

      const res = await post(inboundRequest())

      expect(res.status, unset).toBe(503)
      expect(reasons(), unset).toEqual(['transport_unconfigured'])
      expectNoDatabaseWork()
    }
  })
})

describe('isCloudflareInboundRequest', () => {
  function withContentType(contentType: string | null): Request {
    // No body when the point is an absent header: a string body would have the
    // runtime supply `text/plain` and the case would never be tested.
    return new Request('http://localhost/api/chat/email/inbound', {
      method: 'POST',
      ...(contentType === null ? {} : { headers: { 'content-type': contentType }, body: 'x' }),
    })
  }

  it('claims raw MIME however it is spelled', () => {
    expect(isCloudflareInboundRequest(withContentType('message/rfc822'))).toBe(true)
    expect(isCloudflareInboundRequest(withContentType('Message/RFC822'))).toBe(true)
    expect(isCloudflareInboundRequest(withContentType('message/rfc822; charset=utf-8'))).toBe(true)
  })

  it('leaves everything else to the provider webhook path', () => {
    expect(isCloudflareInboundRequest(withContentType('application/json'))).toBe(false)
    expect(isCloudflareInboundRequest(withContentType('text/plain'))).toBe(false)
    expect(isCloudflareInboundRequest(withContentType('message/rfc822-headers'))).toBe(false)
    expect(isCloudflareInboundRequest(withContentType(null))).toBe(false)
  })

  it('reads the first member when a header was appended in flight', () => {
    // A repeated `content-type` is joined by `Headers.get` into one
    // comma-separated value, which is no media type and would send raw MIME to
    // the provider door: a 401 there, and an indefinite deferral for a message
    // that was in fact perfectly signed. A media type cannot contain a comma, so
    // the first member is what the sender set.
    const headers = new Headers({ 'content-type': 'message/rfc822' })
    headers.append('content-type', 'application/json')
    const request = new Request('http://localhost/api/chat/email/inbound', {
      method: 'POST',
      headers,
      body: 'x',
    })

    expect(request.headers.get('content-type')).toContain(',')
    expect(isCloudflareInboundRequest(request)).toBe(true)
    // And the mirror: a provider payload with something appended stays the
    // provider's, so this does not become a door that claims everything.
    expect(isCloudflareInboundRequest(withContentType('application/json, message/rfc822'))).toBe(
      false
    )
  })
})
