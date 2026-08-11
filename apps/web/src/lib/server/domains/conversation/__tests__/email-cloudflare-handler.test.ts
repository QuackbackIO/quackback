/**
 * The front door for mail delivered by the fleet's edge mail bridge.
 *
 * Three properties are worth more than the rest of this file put together.
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
 * never entered (that query lives inside it), and the `@/lib/server/db` module
 * is never touched by the handler itself (a tripwire on anyone adding a read to
 * this module later).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'

const ingestParsedEmail = vi.fn()
const isConversationsEnabled = vi.fn<() => Promise<boolean>>()
const dbTouches: string[] = []

// Records any property read off the database module. Nothing on the pre-ingest
// path may read one, so a non-empty list is the failure.
vi.mock('@/lib/server/db', () => {
  const ignored = new Set(['then', '__esModule', 'default'])
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === 'string' && !ignored.has(property)) dbTouches.push(property)
        return undefined
      },
    }
  )
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

const SECRET = 'worker-inbound-test-key'
const DOMAIN = 'quackback.co.uk'
const SLUG = mailSlugFor('neon-t1')
const OTHER_SLUG = mailSlugFor('neon-t2')

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
  mailSlug: 'neon-t1',
  /** `Subject: \xff\xfe\x80\xe9\r\n\r\nA` — 18 bytes, four of them illegal UTF-8. */
  body: Uint8Array.from(Buffer.from('5375626a6563743a20fffe80e90d0a0d0a41', 'hex')),
  signature: 'ef90676f1d9a36d5338e95ad74d39cfc9bae2c612e059630ac6b1e23ed1074a7',
  /** What hashing the body as a decoded string produces: 26 bytes, not 18. */
  signatureOverDecodedBody: 'be1ad00395e6e912c7b40cbd773b3ee64bc5bff38f68f02a843acb6871ea659d',
  /** The same body signed for `neon-t2`: what a re-aimed capture would need. */
  signatureUnderOtherSlug: 'b35dde39260d106e8959a7fe6845b3c12cfb5b8a71b744c9912661e92a380d72',
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
  return new Request('http://neon-t1.example.com/api/chat/email/inbound', {
    method: 'POST',
    headers,
    // Through a Blob, so the request carries the exact bytes: a string body
    // would be encoded by the runtime, and a body this suite deliberately fills
    // with invalid UTF-8 would not survive the trip.
    body: new Blob([bytes.slice()]),
  })
}

/** Deliver as the workspace the request was routed to. */
function post(request: Request, workspaceKey = 'neon-t1'): Promise<Response> {
  return withWorkspace(workspaceKey, () => handleCloudflareInboundEmail(request))
}

/** No database work happened on this request. */
function expectNoDatabaseWork(): void {
  expect(ingestParsedEmail).not.toHaveBeenCalled()
  expect(isConversationsEnabled).not.toHaveBeenCalled()
  expect(dbTouches).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  dbTouches.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  vi.stubEnv('INBOUND_HMAC_SECRET', SECRET)
  vi.stubEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)
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
    expectNoDatabaseWork()
  })

  it('401s a signature made with the plus-address signing secret', async () => {
    // The two keys are separate on purpose: one leak must not be able to do both
    // jobs. A request signed with the address secret is a stranger here.
    const svix = 'whsec_dGVzdHNlY3JldA=='
    vi.stubEnv('EMAIL_INBOUND_SIGNING_SECRET', svix)
    const bytes = new TextEncoder().encode(RAW)
    const timestamp = Math.floor(Date.now() / 1000)

    const res = await post(
      inboundRequest({ timestamp, signature: sign(bytes, { timestamp, secret: svix }) })
    )

    expect(res.status).toBe(401)
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
      vi.clearAllMocks()
      dbTouches.length = 0
      isConversationsEnabled.mockResolvedValue(true)

      const res = await post(
        inboundRequest({ mailSlug: OTHER_SLUG, signedSlug: SLUG, envelopeTo }),
        'neon-t2'
      )

      expect(res.status, envelopeTo).toBe(401)
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
    expectNoDatabaseWork()
  })

  it('401s a stale timestamp', async () => {
    const stale = Math.floor(Date.now() / 1000) - INBOUND_REPLAY_TOLERANCE_SECONDS - 1

    const res = await post(inboundRequest({ timestamp: stale }))

    expect(res.status).toBe(401)
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
    expectNoDatabaseWork()
  })

  it('401s raw MIME carrying no signature at all', async () => {
    const res = await post(inboundRequest({ signature: null }))

    expect(res.status).toBe(401)
    expectNoDatabaseWork()
  })

  it('401s raw MIME carrying no timestamp', async () => {
    const request = inboundRequest()
    request.headers.delete('x-qb-timestamp')

    const res = await post(request)

    expect(res.status).toBe(401)
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
    expectNoDatabaseWork()
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
    expectNoDatabaseWork()
  })

  it('404s an envelope that disagrees with the signed label, in either direction', async () => {
    // The cross-check. The envelope is forwarded verbatim so a reply's
    // case-sensitive sub-address survives, which makes it the one field an
    // attacker can still edit without breaking the digest. Editing it can only
    // produce a refusal: it can never name a workspace other than the one the
    // edge signed for.
    for (const [mailSlug, envelopeTo] of [
      [SLUG, `${OTHER_SLUG}@${DOMAIN}`],
      [OTHER_SLUG, `${SLUG}@${DOMAIN}`],
    ]) {
      vi.clearAllMocks()
      dbTouches.length = 0
      isConversationsEnabled.mockResolvedValue(true)

      const res = await post(inboundRequest({ mailSlug, envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expectNoDatabaseWork()
    }
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
      vi.clearAllMocks()
      dbTouches.length = 0
      isConversationsEnabled.mockResolvedValue(true)

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(404)
      expectNoDatabaseWork()
    }
  })

  it('404s a missing envelope header, with no database work', async () => {
    const res = await post(inboundRequest({ envelopeTo: null }))

    expect(res.status).toBe(404)
    expectNoDatabaseWork()
  })

  it('404s when the process has no workspace to be', async () => {
    // A pooled process outside a workspace scope names no workspace, so it can
    // accept mail for none.
    const res = await handleCloudflareInboundEmail(inboundRequest())

    expect(res.status).toBe(404)
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
      vi.clearAllMocks()
      dbTouches.length = 0
      isConversationsEnabled.mockResolvedValue(true)
      ingestParsedEmail.mockResolvedValue({ status: 'ingested' })

      const res = await post(inboundRequest({ envelopeTo }))

      expect(res.status, envelopeTo).toBe(200)
    }
  })

  it('folds case the Unicode way the edge sender does', async () => {
    // `toLowerCase()` maps U+212A KELVIN SIGN to `k`, on both sides, so an
    // envelope carrying one derives the same label the edge signed. Pinned
    // because a cross-check comparing raw bytes instead would refuse mail the
    // edge had already decided belonged here.
    const kelvinEnvelope = `\u{212A}ilo-1@${DOMAIN}`
    expect(kelvinEnvelope).not.toContain(mailSlugFor('kilo-1'))

    const res = await post(
      inboundRequest({ mailSlug: mailSlugFor('kilo-1'), envelopeTo: kelvinEnvelope }),
      'kilo-1'
    )

    expect(res.status).toBe(200)
  })

  it('splits on the last `@`, so a local part carrying one cannot spoof a label', async () => {
    // `<slug>@evil@<domain>` reads as the local part `<slug>@evil`, which is no
    // slug at all, so the cross-check refuses it. Splitting on the first `@`
    // would read it as ours and let a stranger's domain through.
    const res = await post(inboundRequest({ envelopeTo: `${SLUG}@evil.test@${DOMAIN}` }))

    expect(res.status).toBe(404)
    expectNoDatabaseWork()
  })

  it('404s when no visitor surface can receive the mail', async () => {
    // Rejected rather than acked: this answers a sending mail server, and
    // telling it "delivered" for mail that has nowhere to land is silent loss.
    isConversationsEnabled.mockResolvedValue(false)

    const res = await post(inboundRequest())

    expect(res.status).toBe(404)
    expect(ingestParsedEmail).not.toHaveBeenCalled()
  })
})

describe('deliveryNamesThisWorkspace', () => {
  it('accepts a signed label equal to ours whose envelope agrees', () => {
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, SLUG)).toBe(true)
    expect(deliveryNamesThisWorkspace(`${SLUG}+c1.sig@${DOMAIN}`, SLUG, SLUG)).toBe(true)
  })

  it('rejects another workspace, an absent label, an absent header and no identity', () => {
    expect(deliveryNamesThisWorkspace(`${OTHER_SLUG}@${DOMAIN}`, OTHER_SLUG, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, null, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, '', SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace(null, SLUG, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace('', SLUG, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace(`${SLUG}@${DOMAIN}`, SLUG, null)).toBe(false)
  })

  it('rejects an envelope that disagrees with the signed label, however it disagrees', () => {
    // Naming a different workspace, and naming no workspace at all, are the same
    // answer. Only agreement is acceptance.
    expect(deliveryNamesThisWorkspace(`${OTHER_SLUG}@${DOMAIN}`, SLUG, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace(`NOT_A_SLUG!!@${DOMAIN}`, SLUG, SLUG)).toBe(false)
    expect(deliveryNamesThisWorkspace('not-an-address-at-all', SLUG, SLUG)).toBe(false)
  })

  it('does not let a slug-shaped label anywhere else in the value stand in for ours', () => {
    // The envelope is one address. A value carrying several is not one, and the
    // one that routed the message is not identifiable among them.
    expect(deliveryNamesThisWorkspace(`someone@example.com, ${SLUG}@${DOMAIN}`, SLUG, SLUG)).toBe(
      false
    )
    expect(deliveryNamesThisWorkspace(`<${SLUG}@${DOMAIN}>`, SLUG, SLUG)).toBe(false)
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
  it('needs an inbound domain and its own transport key', () => {
    expect(isCloudflareInboundConfigured({})).toBe(false)
    expect(isCloudflareInboundConfigured({ EMAIL_INBOUND_DOMAIN: DOMAIN })).toBe(false)
    expect(isCloudflareInboundConfigured({ INBOUND_HMAC_SECRET: SECRET })).toBe(false)
    expect(
      isCloudflareInboundConfigured({ EMAIL_INBOUND_DOMAIN: DOMAIN, INBOUND_HMAC_SECRET: SECRET })
    ).toBe(true)
  })

  it('does not read the provider webhook secret', () => {
    // Each transport answers for its own credential. A fleet that has moved off
    // the provider must not have to keep its secret set to receive mail.
    expect(
      isCloudflareInboundConfigured({
        EMAIL_INBOUND_DOMAIN: DOMAIN,
        EMAIL_INBOUND_SIGNING_SECRET: 'whsec_x',
      })
    ).toBe(false)
  })

  it('404s the transport when it is not configured, reading nothing', async () => {
    vi.stubEnv('INBOUND_HMAC_SECRET', '')

    const res = await post(inboundRequest())

    expect(res.status).toBe(404)
    expectNoDatabaseWork()
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
})
