/**
 * Email in: the provider webhook and the raw-MIME edge door, cold mail to the
 * workspace, replies by signed address and by threading headers, sender
 * authentication, spam and loop handling, blocks, rate limits, auto-ack and
 * ticket replies (journeys CUS-E-02..33).
 *
 * Oracles: the HTTP answer, the rows the app wrote (conversations, messages,
 * email_log, events), and Mailpit for anything the app sends back.
 */
import { randomUUID } from 'node:crypto'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  conversationReplyAddress,
  inboundEvent,
  signInboundBody,
  supportInboxAddress,
  ticketReplyAddress,
} from '../../support/inbound-email'
import { getMailHeaders } from '../../support/mailpit'
import {
  agentReply,
  apiAs,
  bareMessageId,
  bellsForConversation,
  blockPrincipal,
  conversation,
  conversationForMessage,
  conversationTypeId,
  conversationsForContact,
  createCustomerTicket,
  deliver,
  enableAutoAck,
  eventTypesFor,
  eventsFor,
  findConversationForMessage,
  header,
  inboundLogFor,
  mailsMatching,
  messagesIn,
  messagesWithEmailId,
  personalKeyFor,
  principalTypeId,
  principalsWithContact,
  rawMime,
  seedCustomer,
  sendColdMail,
  sendRawMime,
  setConversationStatus,
  setTicketStatus,
  signRawMime,
  ticketStatusId,
  uuidOf,
  waitForConversation,
  waitForMailMatching,
} from '../../support/email-journeys'
import { testEmailAlias } from '../../../src/lib/server/domains/conversation/conversation.email-channel'

const DMARC_PASS = 'mx.inbound.test; dmarc=pass header.from=customers.example'
const DMARC_QUARANTINE = 'mx.inbound.test; dmarc=fail (p=quarantine dis=none) header.from=x'
const DMARC_REJECT = 'mx.inbound.test; dmarc=fail (p=reject dis=none) header.from=x'
const DMARC_REJECT_ARC = 'mx.inbound.test; dmarc=fail (p=reject dis=none) header.from=x; arc=pass'

/** Cold mail from `from` and the conversation it opened. */
async function coldConversation(
  request: Parameters<typeof deliver>[0],
  from: string,
  marker: string,
  extra: { headers?: Record<string, string>; subject?: string; text?: string } = {}
) {
  const sent = await sendColdMail(request, {
    from,
    subject: extra.subject ?? `Help with ${marker}`,
    text: extra.text ?? `Hello, I need help with ${marker}.`,
    headers: extra.headers,
  })
  expect(sent.http).toBe(200)
  const row = await conversationForMessage(sent.messageId)
  return { ...sent, row, id: conversationTypeId(row.id) }
}

test.describe('provider webhook transport', () => {
  test(
    'CUS-E-02 bad, stale or missing signatures are 401, bad JSON 400, oversize 413',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const secret = supportEnv().app.EMAIL_INBOUND_SIGNING_SECRET
      const messageId = `<${marker}@customers.example>`
      const body = JSON.stringify(
        inboundEvent({
          from: customerEmail,
          to: supportInboxAddress(),
          subject: `Forged ${marker}`,
          text: `Forged ${marker}`,
          messageId,
        })
      )
      const post = (data: string | Buffer, headers: Record<string, string>) =>
        request.post('/api/chat/email/inbound', {
          data,
          headers: { 'content-type': 'application/json', ...headers },
        })

      // 1. No signature headers at all.
      const unsigned = await post(body, {})
      expect(unsigned.status()).toBe(401)
      expect(await unsigned.text()).toBe('Invalid signature')
      // 2. Stale, in either direction (more than 300 s).
      const now = Math.floor(Date.now() / 1000)
      for (const timestamp of [now - 400, now + 400]) {
        const res = await post(body, signInboundBody(body, secret, { timestamp }))
        expect(res.status(), `timestamp ${timestamp - now}s`).toBe(401)
      }
      // 3. A signature made with another key.
      const forged = await post(
        body,
        signInboundBody(body, 'whsec_' + Buffer.from('not-the-key').toString('base64'))
      )
      expect(forged.status()).toBe(401)
      // 4. Signed, but not JSON.
      const notJson = `not json ${marker}`
      const bad = await post(Buffer.from(notJson), signInboundBody(notJson, secret))
      expect(bad.status()).toBe(400)
      expect(await bad.text()).toBe('Invalid JSON')
      // 5. Over 40 MB is refused before the signature is read.
      const huge = Buffer.alloc(40 * 1024 * 1024 + 16, 0x61)
      const tooBig = await post(huge, signInboundBody('x', secret))
      expect(tooBig.status()).toBe(413)

      // Nothing was written for this message or sender.
      expect(await messagesWithEmailId(messageId)).toEqual([])
      expect(await inboundLogFor(customerEmail)).toEqual([])

      // The svix-* aliases are accepted, and any matching v1 token among several passes.
      const signed = signInboundBody(body, secret)
      const aliased = await post(body, {
        'svix-id': signed['webhook-id'],
        'svix-timestamp': signed['webhook-timestamp'],
        'svix-signature': `v1,${Buffer.from('nope').toString('base64')} ${signed['webhook-signature']}`,
      })
      expect(aliased.status(), await aliased.text()).toBe(200)
      expect(await messagesWithEmailId(messageId)).toHaveLength(1)
    }
  )

  test(
    'CUS-E-03 non-receipt events are acked; bounce and complaint mark the email_log row',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const sql = supportDb()
      const bounceId = randomUUID()
      const complaintId = randomUUID()
      for (const id of [bounceId, complaintId]) {
        await sql`
          INSERT INTO email_log (id, direction, email_type, provider, message_id,
                                 provider_message_id, address, subject, status)
          VALUES (${randomUUID()}, 'outbound', 'ConversationMessageEmail', 'resend',
                  ${`<${id}@acme.test>`}, ${id}, ${customerEmail}, ${`Re: ${marker}`}, 'sent')`
      }
      const send = async (event: unknown) => {
        const body = JSON.stringify(event)
        return request.post('/api/chat/email/inbound', {
          data: body,
          headers: {
            'content-type': 'application/json',
            ...signInboundBody(body, supportEnv().app.EMAIL_INBOUND_SIGNING_SECRET),
          },
        })
      }

      const delivered = await send({ type: 'email.delivered', data: { email_id: bounceId } })
      expect(delivered.status()).toBe(200)
      expect(await delivered.text()).toBe('')

      const bounced = await send({ type: 'email.bounced', data: { email_id: bounceId } })
      expect(bounced.status()).toBe(200)
      expect(await bounced.text()).toBe('')
      const complained = await send({ type: 'email.complained', data: { email_id: complaintId } })
      expect(complained.status()).toBe(200)

      const rows = await sql<{ provider_message_id: string; status: string; error: string }[]>`
        SELECT provider_message_id, status, error FROM email_log
        WHERE provider_message_id IN (${bounceId}, ${complaintId})`
      const byId = Object.fromEntries(rows.map((r) => [r.provider_message_id, r]))
      expect(byId[bounceId]).toMatchObject({ status: 'bounced', error: 'bounce' })
      expect(byId[complaintId]).toMatchObject({ status: 'complaint', error: 'complaint' })
      // No conversation came of any of it.
      expect(await conversationsForContact(customerEmail)).toEqual([])
    }
  )

  test.fixme(
    'CUS-E-06 conversations disabled: webhook acks {status:disabled}, edge door 503',
    { tag: '@nightly' },
    async () => {
      // Needs every visitor surface OFF for the whole workspace. The support
      // suite shares one database per shard with the surfaces on, and settings
      // are only ever turned on (README, shared-state rules), so this journey
      // needs its own project or database before it can run here.
    }
  )
})

test.describe('raw-MIME edge door', () => {
  test(
    'CUS-E-05 transport refusals: 401 unsigned or stale or bad HMAC, 413 oversize, 404 wrong workspace',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const messageId = `<${marker}@customers.example>`
      const raw = rawMime({
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Edge ${marker}`,
        text: `Edge door ${marker}`,
        messageId,
      })
      const expectStatus = async (
        what: string,
        opts: Parameters<typeof sendRawMime>[2],
        status: number,
        body: string | Buffer = raw
      ) => {
        const res = await sendRawMime(request, body, opts)
        expect(res.status(), what).toBe(status)
        return res
      }

      await expectStatus('no signature', { signature: null }, 401)
      await expectStatus('no timestamp', { timestamp: null }, 401)
      await expectStatus('no mail slug', { slug: null }, 401)
      const now = Math.floor(Date.now() / 1000)
      await expectStatus('stale timestamp', { timestamp: String(now - 200) }, 401)
      await expectStatus('future timestamp', { timestamp: String(now + 200) }, 401)
      await expectStatus('bad HMAC', { secret: 'not-the-edge-key' }, 401)
      // Upper-case hex is the same digest, not a forgery.
      const ts = String(now)
      const upper = signRawMime({ timestamp: ts, slug: 'reply', body: Buffer.from(raw) })
      const accepted = await sendRawMime(request, raw, {
        timestamp: ts,
        signature: upper.toUpperCase(),
        envelopeTo: 'reply@inbound.test',
      })
      expect(accepted.status(), await accepted.text()).toBe(200)

      const tooBig = await expectStatus(
        'over 40 MB',
        {},
        413,
        Buffer.alloc(40 * 1024 * 1024 + 16, 0x61)
      )
      expect(await tooBig.text()).toBe('Payload too large')

      const otherMessage = rawMime({
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Edge other ${marker}`,
        text: `Edge door other ${marker}`,
        messageId: `<${marker}-other@customers.example>`,
      })
      // Signed for another workspace's label: authenticated, but not ours.
      await expectStatus(
        'signed slug of another workspace',
        { slug: 'other', envelopeTo: 'other@inbound.test' },
        404,
        otherMessage
      )
      await expectStatus('no envelope recipient', { envelopeTo: null }, 404, otherMessage)
      await expectStatus(
        'envelope on a foreign domain',
        { envelopeTo: 'reply@elsewhere.example' },
        404,
        otherMessage
      )
      await expectStatus(
        'envelope on a subdomain',
        { envelopeTo: 'reply@sub.inbound.test' },
        404,
        otherMessage
      )
      await expectStatus(
        'envelope label differs from the signed slug',
        { envelopeTo: 'other@inbound.test' },
        404,
        otherMessage
      )
      expect(await messagesWithEmailId(`<${marker}-other@customers.example>`)).toEqual([])
      // The accepted delivery stored exactly one message.
      expect(await messagesWithEmailId(messageId)).toHaveLength(1)
    }
  )

  test(
    'CUS-E-33 envelope recipient routes a forwarded mail; From is the author; drops are 200 JSON',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      const messageId = `<${marker}@customers.example>`
      const raw = rawMime({
        from: `=?UTF-8?B?${Buffer.from('Zoë Forwarded').toString('base64')}?= <${customerEmail}>`,
        // The customer's own support address: no route of ours names it.
        to: `support@${marker}.example`,
        subject: `=?UTF-8?B?${Buffer.from(`Café ${marker}`).toString('base64')}?=`,
        text: `Forwarded in ${marker}`,
        messageId,
        headers: { 'Authentication-Results': DMARC_PASS },
      })
      const res = await sendRawMime(request, raw, { envelopeTo: supportInboxAddress() })
      expect(res.status()).toBe(200)
      expect(await res.json()).toEqual({ status: 'ingested' })
      const row = await conversationForMessage(messageId)
      expect(row.subject).toBe(`Café ${marker}`)
      expect(row.visitor_email).toBe(customerEmail)
      const [lead] = await principalsWithContact(customerEmail)
      expect(lead.id).toBe(row.visitor_principal_id)

      // A drop inside ingest is still a 2xx with its status (here: a reply from a stranger).
      const stranger = rawMime({
        from: `stranger-${marker}@elsewhere.example`,
        to: conversationReplyAddress(conversationTypeId(row.id)),
        subject: `Re: ${marker}`,
        text: `Not yours ${marker}`,
        messageId: `<${marker}-stranger@elsewhere.example>`,
      })
      const dropped = await sendRawMime(request, stranger, {
        envelopeTo: conversationReplyAddress(conversationTypeId(row.id)),
      })
      expect(dropped.status()).toBe(200)
      expect(await dropped.json()).toEqual({ status: 'from_mismatch' })
    }
  )
})

test.describe('cold mail opens a conversation', () => {
  test(
    'CUS-E-07 cold email to the platform inbox opens an open email conversation',
    { tag: '@smoke' },
    async ({ request, asPerson, customerEmail, marker }) => {
      const subject = `Order question ${marker}`
      const sent = await sendColdMail(request, {
        from: `"Jane Cold" <${customerEmail.toUpperCase()}>`,
        subject,
        text: `My order ${marker} has not arrived.`,
      })
      expect(sent).toMatchObject({ http: 200, status: 'ingested' })

      const row = await conversationForMessage(sent.messageId)
      expect(row).toMatchObject({
        status: 'open',
        channel: 'email',
        source: 'email',
        subject,
        end_reason: null,
        spam_reason: null,
      })
      expect(row.visitor_email?.toLowerCase()).toBe(customerEmail)
      expect(row.channel_account_id).not.toBeNull()
      expect(row.waiting_since).not.toBeNull()
      expect(row.custom_attributes.unverifiedSender).toBeUndefined()

      const [visitor] = await supportDb()<
        { type: string; role: string; user_id: string | null; contact_email: string }[]
      >`SELECT type, role, user_id, contact_email FROM principal WHERE id = ${row.visitor_principal_id}`
      expect(visitor).toMatchObject({
        type: 'anonymous',
        role: 'user',
        user_id: null,
        contact_email: customerEmail,
      })

      const messages = await messagesIn(row.id)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ sender_type: 'visitor', is_internal: false })
      expect(messages[0].content).toContain(`My order ${marker}`)
      expect(messages[0].metadata).toMatchObject({ source: 'email' })

      const id = conversationTypeId(row.id)
      await expect
        .poll(() => eventTypesFor(id))
        .toEqual(expect.arrayContaining(['conversation.created', 'message.created']))
      const logRow = await pollFor('inbound email_log row', async () => {
        const rows = await inboundLogFor(customerEmail)
        return rows[0] ?? null
      })
      expect(logRow).toMatchObject({
        email_type: 'reply',
        status: 'received',
        conversation_id: row.id,
      })

      // The thread is in the admin inbox.
      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${id}`)
      await expect(admin.getByText(`My order ${marker} has not arrived.`).first()).toBeVisible({
        timeout: 15_000,
      })
    }
  )

  test(
    'CUS-E-07 a new cold email conversation appears live in an open inbox',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description: 'Known bug: an unrouted new email conversation publishes no realtime frame',
      },
    },
    async ({ request, asPerson, customerEmail, marker }) => {
      // Known bug: an unrouted new email conversation publishes no realtime
      // frame, so an open inbox does not show it until a refetch (QUARANTINE.md).
      const admin = await asPerson('admin')
      await admin.goto('/admin/inbox')
      await expect(admin.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
      // Let the list load and its stream connect before the mail arrives.
      await admin.waitForTimeout(2_000)
      const subject = `Live arrival ${marker}`
      const sent = await sendColdMail(request, {
        from: customerEmail,
        subject,
        text: `Arrived live ${marker}`,
      })
      expect(sent.status).toBe('ingested')
      await expect(admin.getByText(`Arrived live ${marker}`).first()).toBeVisible({
        timeout: 10_000,
      })
    }
  )

  test(
    'CUS-E-08 a configured forwarding address routes to its inbound route; a sending-only address does not',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const sql = supportDb()
      const [team] = await sql<{ id: string }[]>`SELECT id FROM teams WHERE name = 'E2E Support'`
      const forwarding = `support-${marker}@customer.example`
      const sendingOnly = `hello-${marker}@customer.example`
      // One inbound route per team: the E2E Support team's route is (re)pointed
      // at this test's forwarding address. No other spec routes by it.
      const [route] = await sql<{ id: string }[]>`
        INSERT INTO channel_accounts (id, owning_team_id, channel, role, config)
        VALUES (${randomUUID()}, ${team.id}, 'email', 'inbound',
                ${sql.json({ forwardingTarget: forwarding })})
        ON CONFLICT (owning_team_id) WHERE role = 'inbound' AND channel = 'email'
          AND deleted_at IS NULL
        DO UPDATE SET config = excluded.config
        RETURNING id`
      const routeId = route.id
      await sql`
        INSERT INTO channel_accounts (id, owning_team_id, channel, role, address)
        VALUES (${randomUUID()}, ${team.id}, 'email', 'sending', ${sendingOnly})`

      const routed = await sendColdMail(request, {
        from: customerEmail,
        to: forwarding,
        subject: `Forwarded ${marker}`,
        text: `Forwarded ${marker}`,
      })
      expect(routed.status).toBe('ingested')
      const row = await conversationForMessage(routed.messageId)
      expect(row.channel_account_id).toBe(routeId)

      const other = `${marker}-2@customers.example`
      const refused = await sendColdMail(request, {
        from: other,
        to: sendingOnly,
        subject: `To a From identity ${marker}`,
        text: marker,
      })
      expect(refused.status).toBe('no_conversation')
      const logRow = await pollFor('rejected email_log row', async () => {
        const [r] = await inboundLogFor(other)
        return r ?? null
      })
      expect(logRow).toMatchObject({
        email_type: 'cold_inbound',
        status: 'rejected',
        error: 'no_conversation',
      })
    }
  )

  test(
    'CUS-E-09 mail to an address the workspace does not receive on is refused and mints no one',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const sent = await sendColdMail(request, {
        from: customerEmail,
        to: `nobody-${marker}@elsewhere.example`,
        subject: `Wrong door ${marker}`,
        text: marker,
      })
      expect(sent).toMatchObject({ http: 200, status: 'no_conversation' })
      expect(await principalsWithContact(customerEmail)).toEqual([])
      expect(await messagesWithEmailId(sent.messageId)).toEqual([])
      const logRow = await pollFor('rejected email_log row', async () => {
        const [r] = await inboundLogFor(customerEmail)
        return r ?? null
      })
      expect(logRow).toMatchObject({
        email_type: 'cold_inbound',
        status: 'rejected',
        error: 'no_conversation',
      })
    }
  )

  test(
    'CUS-E-29 a second cold email from a lead opens a new conversation on the same person',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      const first = await coldConversation(request, `"Jane" <${customerEmail}>`, marker)
      const second = await sendColdMail(request, {
        from: customerEmail,
        subject: `Another thing ${marker}`,
        text: `Second mail ${marker}`,
        headers: { 'authentication-results': 'mx.inbound.test; dmarc=none' },
      })
      expect(second.status).toBe('ingested')
      const row2 = await conversationForMessage(second.messageId)
      expect(row2.id).not.toBe(first.row.id)
      expect(row2.visitor_principal_id).toBe(first.row.visitor_principal_id)
      expect(await principalsWithContact(customerEmail)).toHaveLength(1)
      expect(row2.custom_attributes.unverifiedSender).toBe(true)
    }
  )

  test(
    'CUS-E-31 mail to a teammate test alias opens a test conversation owned by that teammate',
    { tag: '@nightly' },
    async ({ request, people, marker }) => {
      await enableAutoAck()
      const owner = people.people.agentB
      const alias = testEmailAlias(owner.principalId, 'reply', supportEnv().app)
      expect(alias, 'the alias is mintable with the suite env').toBeTruthy()
      const sender = `${marker}@customers.example`
      const sent = await sendColdMail(request, {
        from: sender,
        to: alias!,
        subject: `Test alias ${marker}`,
        text: `Trying my alias ${marker}`,
      })
      expect(sent.status).toBe('ingested')
      const row = await conversationForMessage(sent.messageId)
      expect(row.visitor_email).toBeNull()
      expect(row.assigned_agent_principal_id).toBe(uuidOf(owner.principalId))
      const [visitor] = await supportDb()<{ test_owner_principal_id: string | null }[]>`
        SELECT test_owner_principal_id FROM principal WHERE id = ${row.visitor_principal_id}`
      expect(visitor.test_owner_principal_id).toBe(uuidOf(owner.principalId))
      // No spam filing and no SLA on a test thread.
      expect(row.spam_reason).toBeNull()
      const [sla] = await supportDb()<{ sla_applied: unknown }[]>`
        SELECT sla_applied FROM conversations WHERE id = ${row.id}`
      expect(sla.sla_applied).toBeNull()
      // No auto-ack to the sender: a later real cold mail from them IS acked,
      // and still only that one ack exists.
      const real = await sendColdMail(request, {
        from: sender,
        subject: `Real question ${marker}`,
        text: marker,
      })
      expect(real.status).toBe('ingested')
      await waitForMailMatching({ to: sender, subject: `Real question ${marker}` })
      expect(await mailsMatching({ to: sender, subject: `Test alias ${marker}` })).toEqual([])
    }
  )
})

test.describe('sender authentication', () => {
  test(
    'CUS-E-10 DMARC pass attaches to the user; weak or missing auth makes an unverified lead',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail, 'Dana Verified')

      const pass = await coldConversation(request, customerEmail, `${marker}-pass`, {
        headers: { 'authentication-results': DMARC_PASS },
      })
      expect(pass.row.visitor_principal_id).toBe(customer.principalUuid)
      expect(pass.row.custom_attributes.unverifiedSender).toBeUndefined()

      // Weak auth from the same address never attaches to the account.
      for (const [label, auth] of [
        ['no header', ''],
        ['dmarc=none', 'mx.inbound.test; dmarc=none'],
      ] as const) {
        const weak = await sendColdMail(request, {
          from: customerEmail,
          subject: `Weak ${label} ${marker}`,
          text: `Weak ${label} ${marker}`,
          headers: { 'authentication-results': auth },
        })
        expect(weak.status, label).toBe('ingested')
        const row = await conversationForMessage(weak.messageId)
        expect(row.visitor_principal_id, label).not.toBe(customer.principalUuid)
        expect(row.custom_attributes.unverifiedSender, label).toBe(true)
        expect(row.spam_reason, label).toBeNull()
      }

      // DMARC fail under quarantine: unverified and filed to Spam.
      const q = await coldConversation(request, `q-${customerEmail}`, `${marker}-q`, {
        headers: { 'authentication-results': DMARC_QUARANTINE },
      })
      const filed = await waitForConversation(
        q.row.id,
        'sender-auth filing',
        (r) => !!r.spam_reason
      )
      expect(filed).toMatchObject({ spam_reason: 'sender_auth_failure', end_reason: 'spam' })
      expect(filed.custom_attributes.unverifiedSender).toBe(true)

      // A reject rescued by a passing ARC chain: unverified, filed as forwarder-vouched.
      const arc = await coldConversation(request, `arc-${customerEmail}`, `${marker}-arc`, {
        headers: { 'authentication-results': DMARC_REJECT_ARC },
      })
      expect(arc.status).toBe('ingested')
      const arcFiled = await waitForConversation(arc.row.id, 'arc filing', (r) => !!r.spam_reason)
      expect(arcFiled.spam_reason).toBe('sender_auth_arc_rescued')
      expect(arcFiled.end_note).toContain('Forwarder-vouched, unverified')
    }
  )

  test(
    'CUS-E-11 a hard DMARC reject is quarantined closed in Spam and raises nothing',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      await enableAutoAck()
      const sent = await sendColdMail(request, {
        from: customerEmail,
        subject: `Spoofed ${marker}`,
        text: `Spoofed ${marker}`,
        headers: { 'authentication-results': DMARC_REJECT },
      })
      expect(sent).toMatchObject({ http: 200, status: 'quarantined' })
      const row = await conversationForMessage(sent.messageId)
      expect(row).toMatchObject({
        status: 'closed',
        end_reason: 'spam',
        spam_reason: 'sender_auth_reject',
        waiting_since: null,
      })
      expect(row.end_note).toMatch(/^DMARC fail under p=reject/)
      expect(row.resolved_at).not.toBeNull()
      expect(await messagesIn(row.id)).toHaveLength(1)

      const logRow = await pollFor('quarantine email_log row', async () => {
        const [r] = await inboundLogFor(customerEmail)
        return r ?? null
      })
      expect(logRow).toMatchObject({
        email_type: 'rejected',
        status: 'rejected',
        error: 'quarantined',
      })

      // A later genuine mail from the same sender is acked; the spoof never was.
      const genuine = await sendColdMail(request, {
        from: customerEmail,
        subject: `Genuine ${marker}`,
        text: `Genuine ${marker}`,
      })
      expect(genuine.status).toBe('ingested')
      await waitForMailMatching({ to: customerEmail, subject: `Genuine ${marker}` })
      expect(await mailsMatching({ to: customerEmail, subject: `Spoofed ${marker}` })).toEqual([])
      const id = conversationTypeId(row.id)
      expect(await eventTypesFor(id)).toEqual([])
      expect(await bellsForConversation(id)).toEqual([])
    }
  )

  test(
    'CUS-E-12 an agent restores a quarantined conversation from Spam',
    { tag: '@core' },
    async ({ request, asPerson, customerEmail, marker }) => {
      const subject = `Quarantined ${marker}`
      const sent = await sendColdMail(request, {
        from: customerEmail,
        subject,
        text: `Spoofed body ${marker}`,
        headers: { 'authentication-results': DMARC_REJECT },
      })
      expect(sent.status).toBe('quarantined')
      const row = await conversationForMessage(sent.messageId)
      const id = conversationTypeId(row.id)

      const admin = await asPerson('admin')
      await admin.setViewportSize({ width: 1800, height: 1000 })
      await admin.goto(`/admin/inbox?view=spam&i=${id}`)
      await expect(admin.getByText(`Spoofed body ${marker}`).first()).toBeVisible({
        timeout: 15_000,
      })
      // The Details panel's Status control (always shown from 1680 px) knows the thread is spam.
      const statusControl = admin
        .getByRole('button', { name: 'Spam', exact: true })
        .filter({ has: admin.locator('span.capitalize') })
      await expect(async () => {
        await statusControl.click()
        await expect(admin.getByRole('menuitem', { name: 'Restore from spam' })).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 15_000 })
      await admin.getByRole('menuitem', { name: 'Restore from spam' }).click()
      await expect(admin.getByText('Conversation restored from spam').first()).toBeVisible()

      const restored = await waitForConversation(row.id, 'restore', (r) => r.status === 'open')
      expect(restored).toMatchObject({
        resolved_at: null,
        end_reason: null,
        end_note: null,
        spam_reason: null,
      })
      const notes = (await messagesIn(row.id)).filter((m) => m.sender_type === 'system')
      expect(notes.map((m) => [m.content, m.is_internal])).toContainEqual([
        'Conversation restored from spam',
        true,
      ])
      await expect.poll(() => eventTypesFor(id)).toContain('conversation.status_changed')
    }
  )
})

test.describe('replies to an existing conversation', () => {
  test(
    'CUS-E-13 a reply to the signed Reply-To of a teammate email lands in the same conversation',
    { tag: '@smoke' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const replyText = `Agent answer ${marker}`
      await agentReply(api, cold.id, replyText)
      await api.dispose()

      const mail = await waitForMailMatching({ to: customerEmail, body: replyText })
      const headers = await getMailHeaders(mail.ID)
      const replyTo = header(headers, 'Reply-To')
      expect(replyTo).toBe(conversationReplyAddress(cold.id))

      const reply = await deliver(request, {
        from: customerEmail,
        to: replyTo!,
        subject: `Re: ${mail.Subject}`,
        text: `Thanks, one more question ${marker}`,
      })
      expect(reply).toMatchObject({ http: 200, status: 'ingested' })
      const replyRow = await conversationForMessage(reply.messageId)
      expect(replyRow.id).toBe(cold.row.id)
      expect(replyRow.channel).toBe('email')
      const visitorMessages = (await messagesIn(cold.row.id)).filter(
        (m) => m.sender_type === 'visitor'
      )
      expect(visitorMessages).toHaveLength(2)
      expect(visitorMessages[1].content).toContain(`one more question ${marker}`)
      expect(visitorMessages[1].metadata).toMatchObject({
        source: 'email',
        emailMessageId: expect.stringContaining(bareMessageId(reply.messageId)),
      })
      await expect
        .poll(async () =>
          (await eventsFor(cold.id))
            .filter(
              (e) =>
                e.type === 'message.created' &&
                (e.payload as { message?: { senderType?: string } }).message?.senderType ===
                  'visitor'
            )
            .map((e) => (e.payload as { isFirstMessage?: boolean }).isFirstMessage)
        )
        .toEqual([true, false])

      // A tampered tag does not resolve: the mail goes cold and opens a new thread.
      const tampered = replyTo!.replace(/\.([A-Za-z0-9_-])/, (_m, c: string) =>
        c === 'A' ? '.B' : '.A'
      )
      const forged = await deliver(request, {
        from: customerEmail,
        to: tampered,
        subject: `Re: tampered ${marker}`,
        text: `Tampered ${marker}`,
      })
      expect(forged.status).not.toBe('ingested_ticket')
      const forgedRow = await findConversationForMessage(forged.messageId)
      expect(forgedRow?.id ?? null).not.toBe(cold.row.id)
    }
  )

  test(
    'CUS-E-14 a reply with no plus-address threads by In-Reply-To / References to our Message-ID',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const replyText = `Threading answer ${marker}`
      await agentReply(api, cold.id, replyText)
      await api.dispose()
      const mail = await waitForMailMatching({ to: customerEmail, body: replyText })
      const ourId = header(await getMailHeaders(mail.ID), 'Message-ID')!
      expect(ourId).toBeTruthy()

      const byInReplyTo = await deliver(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Re: ${mail.Subject}`,
        text: `By in-reply-to ${marker}`,
        inReplyTo: ourId,
      })
      expect(byInReplyTo.status).toBe('ingested')
      expect((await conversationForMessage(byInReplyTo.messageId)).id).toBe(cold.row.id)

      const byReferences = await deliver(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Re: ${mail.Subject}`,
        text: `By references ${marker}`,
        references: [`<unknown-${marker}@elsewhere.example>`, ourId.toUpperCase()],
      })
      expect(byReferences.status).toBe('ingested')
      expect((await conversationForMessage(byReferences.messageId)).id).toBe(cold.row.id)

      // A chain of only the customer's own ids does not thread: it opens a new conversation.
      const ownChain = await deliver(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Re: own chain ${marker}`,
        text: `Own chain ${marker}`,
        inReplyTo: cold.messageId,
        references: [cold.messageId],
        headers: { 'authentication-results': DMARC_PASS },
      })
      expect(ownChain.status).toBe('ingested')
      expect((await conversationForMessage(ownChain.messageId)).id).not.toBe(cold.row.id)
    }
  )

  test(
    'CUS-E-15 an email reply to a closed conversation reopens it',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      await setConversationStatus(api, cold.id, 'closed')
      await api.dispose()
      await waitForConversation(cold.row.id, 'closed', (r) => r.status === 'closed')

      const reply = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${marker}`,
        text: `Still broken ${marker}`,
      })
      expect(reply.status).toBe('ingested')
      const row = await conversation(cold.row.id)
      expect(row).toMatchObject({ status: 'open', resolved_at: null })
      expect(await conversationsForContact(customerEmail)).toHaveLength(1)
    }
  )

  test(
    'CUS-E-15 a reply to a spam-filed thread is kept but stays closed in Spam',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description: 'Waits for #1084 (a customer message on a spam conversation stays in Spam)',
      },
    },
    async ({ request, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker, {
        headers: { 'authentication-results': DMARC_QUARANTINE },
      })
      await waitForConversation(cold.row.id, 'spam filing', (r) => r.end_reason === 'spam')
      const reply = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${marker}`,
        text: `I am real ${marker}`,
      })
      expect(reply.status).toBe('ingested')
      // The message is stored, but the conversation stays closed and in Spam.
      expect(await messagesIn(cold.row.id)).toHaveLength(2)
      const row = await conversation(cold.row.id)
      expect(row.status).toBe('closed')
      expect(row.end_reason).toBe('spam')
    }
  )

  test(
    'CUS-E-16 a reply from a sender the conversation does not belong to stores nothing',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const thirdParty = `cc-${marker}@elsewhere.example`
      const reply = await deliver(request, {
        from: `"Someone Else" <${thirdParty}>`,
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${marker}`,
        text: `Injected ${marker}`,
      })
      expect(reply).toMatchObject({ http: 200, status: 'from_mismatch' })
      expect(await messagesWithEmailId(reply.messageId)).toEqual([])
      expect(await messagesIn(cold.row.id)).toHaveLength(1)
      const logRow = await pollFor('from_mismatch log row', async () => {
        const [r] = await inboundLogFor(thirdParty)
        return r ?? null
      })
      expect(logRow).toMatchObject({ status: 'rejected', error: 'from_mismatch' })

      const unparseable = await deliver(request, {
        from: 'not an address',
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${marker}`,
        text: `Garbage ${marker}`,
      })
      expect(unparseable.status).toBe('from_mismatch')
    }
  )

  test(
    'CUS-E-23 a redelivered Message-ID is a duplicate on the reply, cold and ticket paths',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      // Cold.
      const coldMail = {
        from: customerEmail,
        subject: `Dup ${marker}`,
        text: `Dup ${marker}`,
        messageId: `<${marker}-cold@customers.example>`,
      }
      expect((await sendColdMail(request, coldMail)).status).toBe('ingested')
      expect((await sendColdMail(request, coldMail)).status).toBe('duplicate')
      expect(await messagesWithEmailId(coldMail.messageId)).toHaveLength(1)
      const row = await conversationForMessage(coldMail.messageId)

      // Reply.
      const reply = {
        from: customerEmail,
        to: conversationReplyAddress(conversationTypeId(row.id)),
        subject: `Re: Dup ${marker}`,
        text: `Dup reply ${marker}`,
        messageId: `<${marker}-reply@customers.example>`,
      }
      expect((await deliver(request, reply)).status).toBe('ingested')
      expect((await deliver(request, reply)).status).toBe('duplicate')
      expect(await messagesWithEmailId(reply.messageId)).toHaveLength(1)

      // Ticket.
      const customer = await seedCustomer(`t-${customerEmail}`)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const ticket = await createCustomerTicket(api, customer.principalId, `Dup ticket ${marker}`)
      await api.dispose()
      const ticketMail = {
        from: customer.email,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ticket ${marker}`,
        text: `Dup ticket reply ${marker}`,
        messageId: `<${marker}-ticket@customers.example>`,
      }
      expect((await deliver(request, ticketMail)).status).toBe('ingested_ticket')
      expect((await deliver(request, ticketMail)).status).toBe('duplicate')
      expect(await messagesWithEmailId(ticketMail.messageId)).toHaveLength(1)
    }
  )
})

test.describe('spam, loops and floods', () => {
  test(
    'CUS-E-17 deterministic signals file a cold conversation to Spam with the labelled note',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      // Auto-responder headers on cold mail.
      const auto = await coldConversation(request, `auto-${customerEmail}`, `${marker}-auto`, {
        headers: { 'auto-submitted': 'auto-replied' },
      })
      expect(auto.status).toBe('ingested')
      const autoRow = await waitForConversation(auto.row.id, 'auto filing', (r) => !!r.spam_reason)
      expect(autoRow).toMatchObject({
        status: 'closed',
        end_reason: 'spam',
        spam_reason: 'auto_responder',
        end_note: 'Auto-filed by the spam filter (Auto-responder)',
      })
      // Filed as it arrived, like quarantined mail: nothing was announced, so
      // no bell, workflow or webhook reacts to it. (Settle briefly first: an
      // event would be written in the same request.)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      const types = await eventTypesFor(auto.id)
      expect(types).not.toContain('conversation.created')
      expect(types).not.toContain('message.created')

      // Sender-auth failure short of a reject.
      const weak = await coldConversation(request, `weak-${customerEmail}`, `${marker}-weak`, {
        headers: { 'authentication-results': DMARC_QUARANTINE },
      })
      const weakRow = await waitForConversation(weak.row.id, 'auth filing', (r) => !!r.spam_reason)
      expect(weakRow.end_note).toBe('Auto-filed by the spam filter (Sender-auth failure)')

      // Burst: the fourth new thread from one address inside ten minutes.
      const burstSender = `burst-${customerEmail}`
      const rows = []
      for (let i = 1; i <= 4; i++) {
        const c = await coldConversation(request, burstSender, `${marker}-burst-${i}`)
        rows.push(c.row.id)
      }
      const fourth = await waitForConversation(rows[3], 'burst filing', (r) => !!r.spam_reason)
      expect(fourth.spam_reason).toBe('burst_rate')
      expect(fourth.end_note).toBe('Auto-filed by the spam filter (Burst rate)')
      for (const early of rows.slice(0, 3)) {
        expect((await conversation(early)).spam_reason).toBeNull()
      }
    }
  )

  test(
    'CUS-E-18 our own outbound mail echoing back is suppressed and stores nothing',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const replyText = `Echo me ${marker}`
      await agentReply(api, cold.id, replyText)
      await api.dispose()
      const mail = await waitForMailMatching({ to: customerEmail, body: replyText })
      const ourId = header(await getMailHeaders(mail.ID), 'Message-ID')!

      // 1. The very message we sent, redirected back under its own id.
      const echoed = await deliver(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: mail.Subject,
        text: replyText,
        messageId: ourId,
      })
      expect(echoed).toMatchObject({ http: 200, status: 'suppressed' })

      // 2. Any id minted on our own sending host.
      const ownHost = await deliver(request, {
        from: `loop-${customerEmail}`,
        to: supportInboxAddress(),
        subject: `Loop ${marker}`,
        text: `Loop ${marker}`,
        messageId: `<c.loop-${marker}.abc@acme.test>`,
      })
      expect(ownHost.status).toBe('suppressed')
      expect(await messagesWithEmailId(ownHost.messageId)).toEqual([])
      expect(await principalsWithContact(`loop-${customerEmail}`)).toEqual([])
      const logRow = await pollFor('suppressed log row', async () => {
        const [r] = await inboundLogFor(`loop-${customerEmail}`)
        return r ?? null
      })
      expect(logRow).toMatchObject({ status: 'rejected', error: 'suppressed' })
    }
  )

  test(
    'CUS-E-19 auto-replies: dropped if threaded, filed to Spam if cold, quarantined with our Reply-To',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      await enableAutoAck()
      const cold = await coldConversation(request, customerEmail, marker)

      // 1. A vacation reply to our thread.
      const threaded = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(cold.id),
        subject: `Out of office: ${marker}`,
        text: `I am away ${marker}`,
        headers: { 'auto-submitted': 'auto-replied' },
      })
      expect(threaded.status).toBe('suppressed')
      expect(await messagesIn(cold.row.id)).toHaveLength(1)

      // 2. Cold bulk mail: filed to Spam, never acked.
      const bulkSender = `bulk-${customerEmail}`
      const bulk = await coldConversation(request, bulkSender, `${marker}-bulk`, {
        headers: { precedence: 'bulk', 'list-unsubscribe': '<mailto:unsub@lists.example>' },
      })
      const bulkRow = await waitForConversation(bulk.row.id, 'bulk filing', (r) => !!r.spam_reason)
      expect(bulkRow.spam_reason).toBe('auto_responder')

      // 3. Mail carrying a Reply-To we minted: quarantined as a suspected loop.
      const loop = await sendColdMail(request, {
        from: `loopy-${customerEmail}`,
        subject: `Suspected loop ${marker}`,
        text: `Loop ${marker}`,
        headers: { 'reply-to': conversationReplyAddress(cold.id) },
      })
      expect(loop.status).toBe('quarantined')
      const loopRow = await conversationForMessage(loop.messageId)
      expect(loopRow).toMatchObject({
        status: 'closed',
        spam_reason: 'mail_loop_suspected',
        end_note:
          'Refused as a suspected mail loop: the message carried a reply address this workspace minted.',
      })
      expect(await eventTypesFor(conversationTypeId(loopRow.id))).toEqual([])

      // The bulk sender got no ack; a normal mail from them does get one.
      const normal = await sendColdMail(request, {
        from: bulkSender,
        subject: `Normal ${marker}`,
        text: marker,
      })
      expect(normal.status).toBe('ingested')
      await waitForMailMatching({ to: bulkSender, subject: `Normal ${marker}` })
      expect(await mailsMatching({ to: bulkSender, subject: `${marker}-bulk` })).toEqual([])
    }
  )

  test(
    'CUS-E-20 a blocked sender is suppressed on the cold, conversation and ticket paths',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const cold = await coldConversation(request, customerEmail, marker)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const ticket = await createCustomerTicket(
        api,
        principalTypeId(cold.row.visitor_principal_id),
        `Blocked ticket ${marker}`
      )
      await api.dispose()
      await blockPrincipal(cold.row.visitor_principal_id)

      const replyPath = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${marker}`,
        text: `Blocked reply ${marker}`,
      })
      const coldPath = await sendColdMail(request, {
        from: customerEmail,
        subject: `Blocked cold ${marker}`,
        text: `Blocked cold ${marker}`,
      })
      const ticketPath = await deliver(request, {
        from: customerEmail,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ticket ${marker}`,
        text: `Blocked ticket reply ${marker}`,
      })
      expect([replyPath.status, coldPath.status, ticketPath.status]).toEqual([
        'suppressed',
        'suppressed',
        'suppressed',
      ])
      for (const sent of [replyPath, coldPath, ticketPath]) {
        expect(await messagesWithEmailId(sent.messageId)).toEqual([])
      }
      // No cold conversation was opened (the other row is the ticket's own thread).
      const opened = await conversationsForContact(customerEmail)
      expect(opened.filter((c) => c.subject?.includes('Blocked cold'))).toEqual([])
    }
  )

  test(
    'CUS-E-21 the 11th cold mail in an hour and the 21st reply in 30 s are rate limited',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      test.setTimeout(90_000)
      const statuses: string[] = []
      // Paced: each accepted mail fans out team alerts and an ack, and a
      // burst of SMTP connections can stall the shared Mailpit for everyone.
      for (let i = 1; i <= 11; i++) {
        if (i > 1) await new Promise((r) => setTimeout(r, 1_000))
        const sent = await sendColdMail(request, {
          from: customerEmail,
          subject: `Flood ${i} ${marker}`,
          text: `Flood ${i} ${marker}`,
        })
        statuses.push(sent.status ?? '')
      }
      expect(statuses.slice(0, 10).every((s) => s === 'ingested')).toBe(true)
      expect(statuses[10]).toBe('rate_limited')
      expect(await conversationsForContact(customerEmail)).toHaveLength(10)

      // A fresh sender with no lead yet: the throttle sits before minting.
      const replier = `r-${customerEmail}`
      const cold = await coldConversation(request, replier, `${marker}-replies`)
      const replies: string[] = []
      for (let i = 1; i <= 21; i++) {
        if (i > 1) await new Promise((r) => setTimeout(r, 700))
        const sent = await deliver(request, {
          from: replier,
          to: conversationReplyAddress(cold.id),
          subject: `Re: ${marker}`,
          text: `Reply ${i} ${marker}`,
        })
        replies.push(sent.status ?? '')
      }
      expect(replies.slice(0, 20).every((s) => s === 'ingested')).toBe(true)
      expect(replies[20]).toBe('rate_limited')
    }
  )
})

test.describe('auto-acknowledgement', () => {
  test(
    'CUS-E-22 a cold email gets one auto-ack threaded to it with the signed Reply-To',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      await enableAutoAck()
      const subject = `Ack me ${marker}`
      const cold = await coldConversation(request, customerEmail, marker, { subject })
      const ack = await waitForMailMatching({ to: customerEmail, subject })
      const headers = await getMailHeaders(ack.ID)
      expect(header(headers, 'Reply-To')).toBe(conversationReplyAddress(cold.id))
      expect(header(headers, 'In-Reply-To')).toBe(cold.messageId)
      expect(header(headers, 'References')).toContain(cold.messageId)
      const ackId = header(headers, 'Message-ID')!
      expect(ackId).not.toBe(cold.messageId)
      const [recorded] = await supportDb()<{ conversation_id: string }[]>`
        SELECT conversation_id FROM conversation_outbound_emails
        WHERE message_id IN (${bareMessageId(ackId)}, ${ackId}, ${bareMessageId(ackId).toLowerCase()})`
      expect(recorded?.conversation_id).toBe(cold.row.id)

      // A reply on the thread is never acked: after it, an agent reply arrives
      // and there is still exactly one ack.
      const reply = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(cold.id),
        subject: `Re: ${subject}`,
        text: `Follow-up ${marker}`,
      })
      expect(reply.status).toBe('ingested')
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      await agentReply(api, cold.id, `Answer after ack ${marker}`)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, body: `Answer after ack ${marker}` })
      const acks = (await mailsMatching({ to: customerEmail })).filter((m) =>
        m.Text.includes('We received your email')
      )
      expect(acks).toHaveLength(1)
    }
  )
})

test.describe('ticket replies by email', () => {
  test(
    'CUS-E-27 a reply to a ticket email address lands on the ticket and reopens it',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const ticket = await createCustomerTicket(api, customer.principalId, `Printer ${marker}`)
      await setTicketStatus(api, ticket.id, await ticketStatusId('Resolved'))
      await api.dispose()
      const ticketUuid = uuidOf(ticket.id)
      const before = await supportDb()<{ reopened_count: number }[]>`
        SELECT reopened_count FROM tickets WHERE id = ${ticketUuid}`

      const reply = await deliver(request, {
        from: customer.email,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: Printer ${marker}`,
        text: `Still jammed ${marker}`,
      })
      expect(reply).toMatchObject({ http: 200, status: 'ingested_ticket' })
      const [stored] = await messagesWithEmailId(reply.messageId)
      expect(stored).toMatchObject({ sender_type: 'visitor', is_internal: false })
      expect(stored.content).toContain(`Still jammed ${marker}`)

      const [after] = await supportDb()<
        { reopened_count: number; category: string; name: string }[]
      >`
        SELECT t.reopened_count, s.category, s.name FROM tickets t
        JOIN ticket_statuses s ON s.id = t.status_id WHERE t.id = ${ticketUuid}`
      expect(after.category).toBe('open')
      expect(after.reopened_count).toBe(before[0].reopened_count + 1)
      const activity = await supportDb()<{ type: string; metadata: Record<string, unknown> }[]>`
        SELECT type, metadata FROM ticket_activity WHERE ticket_id = ${ticketUuid}`
      expect(activity.map((a) => a.type)).toContain('ticket.reopened')
      await expect.poll(() => eventTypesFor(ticket.id)).toContain('ticket.replied')
      const [sub] = await supportDb()<{ reason: string }[]>`
        SELECT reason FROM ticket_subscriptions
        WHERE ticket_id = ${ticketUuid} AND principal_id = ${customer.principalUuid}`
      expect(sub?.reason).toBe('requester')
    }
  )

  test(
    'CUS-E-28 ticket addresses refuse bad tags, unknown or non-customer tickets and other senders',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const ticket = await createCustomerTicket(api, customer.principalId, `Refusals ${marker}`)
      const backOffice = (await (
        await api.post('/api/v1/tickets', {
          data: { type: 'back_office', title: `Back office ${marker}` },
        })
      ).json()) as { data: { id: string } }
      await api.dispose()

      const good = ticketReplyAddress(ticket.id)
      const badTag = good.replace(/\.([A-Za-z0-9_-])/, (_m, c: string) => (c === 'A' ? '.B' : '.A'))
      const unknown = ticketReplyAddress(generateId('ticket'))
      const cases: Array<[string, string, string, string]> = [
        ['bad tag', customer.email, badTag, 'no_ticket'],
        ['unknown ticket', customer.email, unknown, 'no_ticket'],
        ['back-office ticket', customer.email, ticketReplyAddress(backOffice.data.id), 'no_ticket'],
        ['another sender', `other-${customerEmail}`, good, 'from_mismatch'],
      ]
      for (const [label, from, to, status] of cases) {
        const sent = await deliver(request, {
          from,
          to,
          subject: `Re: ${label} ${marker}`,
          text: `${label} ${marker}`,
          headers: { 'authentication-results': DMARC_PASS },
        })
        expect(sent.status, label).toBe(status)
        // Never falls through to a conversation or cold inbound.
        expect(await messagesWithEmailId(sent.messageId), label).toEqual([])
      }
      expect(await principalsWithContact(`other-${customerEmail}`)).toEqual([])
    }
  )
})

test.describe('inbound attachments', () => {
  test(
    'CUS-E-26 inline images are rehosted, executables refused, files stored on the message',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      // A 1x1 PNG.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
      const pdf = Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`)
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 1)])
      const messageId = `<${marker}@customers.example>`
      const event = inboundEvent({
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Files ${marker}`,
        text: `See attached ${marker}`,
        html: `<p>See attached ${marker}</p><img src="cid:shot-${marker}">`,
        messageId,
        headers: { 'authentication-results': DMARC_PASS },
      })
      event.data.attachments = [
        {
          filename: 'shot.png',
          content_type: 'image/png',
          content_id: `<shot-${marker}>`,
          content_disposition: 'inline',
          content: png.toString('base64'),
        },
        {
          filename: 'invoice.pdf',
          content_type: 'application/pdf',
          content: pdf.toString('base64'),
        },
        {
          filename: 'setup.exe',
          content_type: 'application/octet-stream',
          content: exe.toString('base64'),
        },
      ]
      const body = JSON.stringify(event)
      const res = await request.post('/api/chat/email/inbound', {
        data: body,
        headers: {
          'content-type': 'application/json',
          ...signInboundBody(body, supportEnv().app.EMAIL_INBOUND_SIGNING_SECRET),
        },
      })
      expect(res.status(), await res.text()).toBe(200)
      const [message] = await pollFor('the stored message', async () => {
        const rows = await messagesWithEmailId(messageId)
        return rows.length ? rows : null
      })
      const attachments = (message.attachments ?? []) as Array<{ name?: string; filename?: string }>
      const names = attachments.map((a) => a.name ?? a.filename)
      expect(names).toContain('invoice.pdf')
      expect(names).not.toContain('setup.exe')
      const doc = JSON.stringify(message.content_json)
      expect(doc).not.toContain('cid:')
      expect(doc).toContain('chat-images')
    }
  )
})
