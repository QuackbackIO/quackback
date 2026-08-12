import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sendRawEmail } from '@quackback/email'
import {
  normalizeSenderAddress,
  parseRawEmail,
  stripAngleBrackets,
} from '../conversation.email-inbound'

/**
 * Round-trip: our outbound sender -> a real MTA -> our inbound parser.
 *
 * The existing parseRawEmail suite is thorough but every fixture is
 * hand-authored, so it verifies what we believe MIME looks like. A real MTA
 * emits things nobody writes by hand: a folded multi-line `Received:` header, a
 * `Return-Path`, its own Content-Transfer-Encoding choices, and CRLF line
 * endings throughout.
 *
 * This also closes the loop the conversation email channel actually runs. We
 * set Message-ID / In-Reply-To / References on the way out and read them back
 * on the way in; if the two halves ever disagree, threading breaks silently and
 * unit tests on either side stay green.
 */

const API = process.env.MAILPIT_API_URL ?? 'http://localhost:8025'

async function mailpitUp(): Promise<boolean> {
  try {
    return (await fetch(`${API}/api/v1/info`, { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}
const available = await mailpitUp()

/**
 * Deliver through the real SMTP transport and hand back the raw MIME received.
 *
 * `from` is widened here rather than at each call. The sender demands a
 * `SendingIdentity`, which only the send guard mints, and this suite is about
 * what an MTA does to a message rather than about who is entitled to send it —
 * so the one cast lives in the harness, where it is visible, instead of being
 * repeated in every case.
 */
async function roundTrip(
  options: Omit<Parameters<typeof sendRawEmail>[0], 'from'> & { from: string }
): Promise<string> {
  const result = await sendRawEmail(options as Parameters<typeof sendRawEmail>[0])
  expect(result.sent).toBe(true)

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/api/v1/messages?limit=1`)
    const body = (await res.json()) as { messages: Array<{ ID: string }> }
    if (body.messages?.length) {
      return await (await fetch(`${API}/api/v1/message/${body.messages[0].ID}/raw`)).text()
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('mailpit: message never arrived')
}

describe.skipIf(!available)('inbound parsing of real MTA output (round-trip)', () => {
  const saved: Record<string, string | undefined> = {}
  const keys = [
    'EMAIL_SMTP_HOST',
    'EMAIL_SMTP_PORT',
    'EMAIL_SES_ACCESS_KEY_ID',
    'EMAIL_SES_SECRET_ACCESS_KEY',
  ]

  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k]
    process.env.EMAIL_SMTP_HOST = 'localhost'
    process.env.EMAIL_SMTP_PORT = '1025'
    // SES would otherwise win provider selection.
    delete process.env.EMAIL_SES_ACCESS_KEY_ID
    delete process.env.EMAIL_SES_SECRET_ACCESS_KEY
  })
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
  beforeEach(() => fetch(`${API}/api/v1/messages`, { method: 'DELETE' }))

  it('parses a message an MTA actually produced, folded headers and all', async () => {
    const raw = await roundTrip({
      from: 'Acme Support <support@acme.test>',
      to: 'customer@example.test',
      subject: 'Re: your question about billing',
      html: '<p>Thanks for getting in touch.</p>',
      text: 'Thanks for getting in touch.',
    })

    // Mailpit inserts a folded multi-line Received: header ahead of ours.
    expect(raw).toMatch(/^Received:/m)
    expect(raw).toMatch(/\n\s+by .*Mailpit/)

    const parsed = parseRawEmail(raw)
    expect(parsed.from).toContain('support@acme.test')
    expect(parsed.toAddresses).toContain('customer@example.test')
    expect(parsed.subject).toBe('Re: your question about billing')
    expect(parsed.text?.trim()).toBe('Thanks for getting in touch.')
    expect(parsed.html).toContain('Thanks for getting in touch.')
  })

  it('round-trips the threading ids the channel replies on', async () => {
    const rootId = 'conv-77-root@quackback.test'
    const parentId = 'conv-77-msg-1@quackback.test'
    const ownId = 'conv-77-msg-2@quackback.test'

    const raw = await roundTrip({
      from: 'Acme Support <support@acme.test>',
      to: 'customer@example.test',
      subject: 'Re: your question',
      html: '<p>Following up.</p>',
      messageId: ownId,
      inReplyTo: parentId,
      references: [rootId, parentId],
    })

    const parsed = parseRawEmail(raw)

    // The outbound side wraps in angle brackets; the inbound side strips them.
    // These two have to agree or a reply starts a new thread.
    expect(stripAngleBrackets(parsed.messageId ?? '')).toBe(ownId)
    expect(parsed.inReplyTo).toBe(parentId)
    // Already unwrapped by readThreadingHeaders -> parseMessageIdList.
    expect(parsed.references).toEqual([rootId, parentId])
  })

  it('normalizes a display-name sender the MTA rewrote', async () => {
    // normalizeSenderAddress had no test coverage, and it is what the reply
    // path uses to decide which participant a message came from.
    const raw = await roundTrip({
      from: 'Acme Support <support@acme.test>',
      to: 'customer@example.test',
      subject: 'Naming',
      html: '<p>hi</p>',
    })

    const parsed = parseRawEmail(raw)
    expect(normalizeSenderAddress(parsed.from)).toBe('support@acme.test')
  })

  it('preserves a body that forces quoted-printable encoding', async () => {
    // Non-ASCII and long lines make the MTA pick an encoding for us, which is
    // exactly the decision a hand-written fixture bakes in rather than exercises.
    const body = `Café — naïve résumé. ${'x'.repeat(200)}`
    const raw = await roundTrip({
      from: 'Acme Support <support@acme.test>',
      to: 'customer@example.test',
      subject: 'Encoding — café',
      html: `<p>${body}</p>`,
      text: body,
    })

    const parsed = parseRawEmail(raw)
    expect(parsed.subject).toBe('Encoding — café')
    expect(parsed.text?.replace(/\s+/g, ' ').trim()).toContain('Café — naïve résumé.')
  })
})
