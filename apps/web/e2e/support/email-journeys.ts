/**
 * Helpers for the support email journeys (email-inbound, email-outbound and
 * email-outbound-csat specs): cold mail in, lookups by Message-ID, the raw-MIME
 * edge door, seeded customers and conversations, agent actions over the REST
 * API, and Mailpit reads that match on a marker in the body.
 *
 * Everything here keys on data the calling test made unique (a marker in the
 * subject or body, a fresh customer address). Nothing clears Mailpit or counts
 * all rows.
 */
import { createHmac, randomUUID } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type FrameLocator,
  type Page,
  type Playwright,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'
import { sendInboundEmail, supportInboxAddress, type InboundMail } from './inbound-email'
import { getMail, mailTo, type MailpitMessage } from './mailpit'
import { createSupportApiKey } from '../utils/db-helpers'

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export const conversationTypeId = (uuid: string) => fromUuid('conversation', uuid)
export const principalTypeId = (uuid: string) => fromUuid('principal', uuid)
export const ticketTypeId = (uuid: string) => fromUuid('ticket', uuid)
export const uuidOf = (typeId: string) => toUuid(typeId)

/** A Message-ID as stored in conversation_messages.metadata.emailMessageId. */
export function bareMessageId(messageId: string): string {
  return messageId.replace(/[<>]/g, '')
}

// ---------------------------------------------------------------------------
// The REST API as a teammate (personal key: acts as its creator)
// ---------------------------------------------------------------------------

const keyCache = new Map<string, string>()

/** A personal API key for `email`, minted once per worker. */
export function personalKeyFor(email: string, kind: 'personal' | 'workspace' = 'personal') {
  const cacheKey = `${kind}:${email}`
  let key = keyCache.get(cacheKey)
  if (!key) {
    key = createSupportApiKey(email, kind)
    keyCache.set(cacheKey, key)
  }
  return key
}

/** An API request context authenticated with `key`. Dispose it when done. */
export async function apiAs(
  playwright: Playwright,
  baseURL: string,
  key: string
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  })
}

async function expectOk(res: APIResponse, what: string): Promise<unknown> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${await res.text()}`)
  return res.json()
}

export async function agentReply(
  api: APIRequestContext,
  conversationId: string,
  content: string
): Promise<{ id: string }> {
  const body = (await expectOk(
    await api.post(`/api/v1/conversations/${conversationId}/reply`, { data: { content } }),
    'agent reply'
  )) as { data: { id: string } }
  return body.data
}

export async function agentNote(api: APIRequestContext, conversationId: string, content: string) {
  await expectOk(
    await api.post(`/api/v1/conversations/${conversationId}/note`, { data: { content } }),
    'agent note'
  )
}

export async function setConversationStatus(
  api: APIRequestContext,
  conversationId: string,
  status: 'open' | 'closed' | 'snoozed'
) {
  await expectOk(
    await api.post(`/api/v1/conversations/${conversationId}/status`, { data: { status } }),
    `set status ${status}`
  )
}

export async function assignConversation(
  api: APIRequestContext,
  conversationId: string,
  body: Record<string, unknown>
) {
  await expectOk(
    await api.post(`/api/v1/conversations/${conversationId}/assign`, { data: body }),
    'assign'
  )
}

export interface ApiTicket {
  id: string
  number: number
  title: string
}

/** Open a customer ticket for `requesterPrincipalId` (with its backing conversation). */
export async function createCustomerTicket(
  api: APIRequestContext,
  requesterPrincipalId: string,
  title: string,
  description = `Details for ${title}`
): Promise<ApiTicket> {
  const body = (await expectOk(
    await api.post('/api/v1/tickets', {
      data: { type: 'customer', title, description, requesterPrincipalId },
    }),
    'create ticket'
  )) as { data: ApiTicket }
  return body.data
}

export async function ticketReply(api: APIRequestContext, ticketId: string, content: string) {
  await expectOk(
    await api.post(`/api/v1/tickets/${ticketId}/reply`, { data: { content } }),
    'ticket reply'
  )
}

export async function ticketNote(api: APIRequestContext, ticketId: string, content: string) {
  await expectOk(
    await api.post(`/api/v1/tickets/${ticketId}/note`, { data: { content } }),
    'ticket note'
  )
}

export async function setTicketStatus(api: APIRequestContext, ticketId: string, statusId: string) {
  await expectOk(
    await api.post(`/api/v1/tickets/${ticketId}/status`, { data: { statusId } }),
    'ticket status'
  )
}

/** A seeded ticket status by name, as a TypeID. */
export async function ticketStatusId(name: string): Promise<string> {
  const [row] = await supportDb()<{ id: string }[]>`
    SELECT id FROM ticket_statuses WHERE name = ${name} AND deleted_at IS NULL LIMIT 1`
  if (!row) throw new Error(`no ticket status named ${name}`)
  return fromUuid('ticket_status', row.id)
}

// ---------------------------------------------------------------------------
// Inbound mail
// ---------------------------------------------------------------------------

export interface ColdMail extends Omit<InboundMail, 'to'> {
  to?: string | string[]
}

/** Post a signed provider event; returns the HTTP status and parsed status field. */
export async function deliver(
  request: APIRequestContext,
  mail: InboundMail
): Promise<{ http: number; status: string | null; messageId: string }> {
  const messageId = mail.messageId ?? `<${randomUUID()}@customers.example>`
  const res = await sendInboundEmail(request, { ...mail, messageId })
  const text = await res.text()
  let status: string | null = null
  try {
    status = (JSON.parse(text) as { status?: string }).status ?? null
  } catch {
    status = null
  }
  return { http: res.status(), status, messageId }
}

/** Cold mail to the workspace support address (DMARC pass unless headers say otherwise). */
export async function sendColdMail(request: APIRequestContext, mail: ColdMail) {
  return deliver(request, {
    ...mail,
    to: mail.to ?? supportInboxAddress(),
    headers: { 'authentication-results': 'mx.inbound.test; dmarc=pass', ...mail.headers },
  })
}

export interface ConversationRow {
  id: string
  visitor_principal_id: string
  status: string
  channel: string
  source: string
  subject: string | null
  visitor_email: string | null
  end_reason: string | null
  end_note: string | null
  spam_reason: string | null
  resolved_at: Date | null
  waiting_since: Date | null
  channel_account_id: string | null
  assigned_agent_principal_id: string | null
  custom_attributes: Record<string, unknown>
  csat_rating: number | null
  csat_comment: string | null
  csat_submitted_at: Date | null
  thread_sender_address: string | null
}

const CONVERSATION_COLUMNS = `c.id, c.visitor_principal_id, c.status, c.channel, c.source, c.subject,
  c.visitor_email, c.end_reason, c.end_note, c.spam_reason, c.resolved_at, c.waiting_since,
  c.channel_account_id, c.assigned_agent_principal_id, c.custom_attributes, c.csat_rating,
  c.csat_comment, c.csat_submitted_at, c.thread_sender_address`

/** The conversation holding the message with this Message-ID (null if none). */
export async function findConversationForMessage(
  messageId: string
): Promise<ConversationRow | null> {
  const rows = await supportDb().unsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS}
     FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.metadata ->> 'emailMessageId' = $1 LIMIT 1`,
    [bareMessageId(messageId)]
  )
  if (rows[0]) return rows[0]
  // Some paths keep the angle brackets; accept either spelling.
  const [bracketed] = await supportDb().unsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS}
     FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.metadata ->> 'emailMessageId' = $1 LIMIT 1`,
    [`<${bareMessageId(messageId)}>`]
  )
  return bracketed ?? null
}

export async function conversationForMessage(messageId: string): Promise<ConversationRow> {
  return pollFor(`a conversation for ${messageId}`, () => findConversationForMessage(messageId))
}

export async function conversation(uuid: string): Promise<ConversationRow> {
  const [row] = await supportDb().unsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations c WHERE c.id = $1`,
    [uuid]
  )
  if (!row) throw new Error(`no conversation ${uuid}`)
  return row
}

/** Wait until the conversation row satisfies `check`. */
export async function waitForConversation(
  uuid: string,
  what: string,
  check: (row: ConversationRow) => boolean,
  timeoutMs = 10_000
): Promise<ConversationRow> {
  return pollFor(
    what,
    async () => {
      const row = await conversation(uuid)
      return check(row) ? row : null
    },
    { timeoutMs }
  )
}

export interface MessageRow {
  id: string
  sender_type: string
  content: string
  is_internal: boolean
  metadata: Record<string, unknown> | null
  ticket_id: string | null
  attachments: unknown
  content_json: unknown
  created_at: Date
}

export async function messagesIn(conversationUuid: string): Promise<MessageRow[]> {
  return supportDb()<MessageRow[]>`
    SELECT id, sender_type, content, is_internal, metadata, ticket_id, attachments,
           content_json, created_at
    FROM conversation_messages WHERE conversation_id = ${conversationUuid}
    ORDER BY created_at ASC`
}

/** Messages carrying this inbound Message-ID (either spelling). */
export async function messagesWithEmailId(messageId: string): Promise<MessageRow[]> {
  const bare = bareMessageId(messageId)
  return supportDb()<MessageRow[]>`
    SELECT id, sender_type, content, is_internal, metadata, ticket_id, attachments,
           content_json, created_at
    FROM conversation_messages
    WHERE metadata ->> 'emailMessageId' IN (${bare}, ${`<${bare}>`})`
}

/** Conversations whose visitor principal has this contact email. */
export async function conversationsForContact(email: string): Promise<ConversationRow[]> {
  return supportDb().unsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations c
     JOIN principal p ON p.id = c.visitor_principal_id
     WHERE lower(p.contact_email) = lower($1) ORDER BY c.created_at ASC`,
    [email]
  )
}

export async function principalsWithContact(email: string) {
  return supportDb()<{ id: string; type: string; user_id: string | null }[]>`
    SELECT id, type, user_id FROM principal WHERE lower(contact_email) = lower(${email})`
}

/** email_log rows by conversation (newest first). */
export async function emailLogForConversation(conversationUuid: string) {
  return supportDb()<
    {
      direction: string
      email_type: string
      address: string
      subject: string | null
      status: string
      error: string | null
      message_id: string | null
    }[]
  >`
    SELECT direction, email_type, address, subject, status, error, message_id
    FROM email_log WHERE conversation_id = ${conversationUuid} ORDER BY created_at DESC`
}

/** Inbound email_log rows whose address contains `needle` (the raw From). */
export async function inboundLogFor(needle: string) {
  return supportDb()<
    {
      email_type: string
      status: string
      error: string | null
      conversation_id: string | null
      ticket_id: string | null
    }[]
  >`
    SELECT email_type, status, error, conversation_id, ticket_id FROM email_log
    WHERE direction = 'inbound' AND address ILIKE ${`%${needle}%`}
    ORDER BY created_at DESC`
}

// ---------------------------------------------------------------------------
// The raw-MIME edge door
// ---------------------------------------------------------------------------

export const SELF_HOSTED_MAIL_SLUG = 'reply'

export function inboundHmacSecret(): string {
  const secret = supportEnv().app.INBOUND_HMAC_SECRET
  if (!secret) throw new Error('INBOUND_HMAC_SECRET is not set in support.env')
  return secret
}

export function signRawMime(opts: {
  timestamp: string
  slug: string
  body: Buffer
  secret?: string
}): string {
  return createHmac('sha256', Buffer.from(opts.secret ?? inboundHmacSecret(), 'utf8'))
    .update(Buffer.from(`${opts.timestamp}.${opts.slug}.`, 'utf8'))
    .update(opts.body)
    .digest('hex')
}

/** Build a small RFC 5322 message. */
export function rawMime(opts: {
  from: string
  to: string
  subject: string
  text: string
  messageId?: string
  headers?: Record<string, string>
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${new Date().toUTCString()}`,
    ...(opts.messageId ? [`Message-ID: ${opts.messageId}`] : []),
    ...Object.entries(opts.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.text,
    '',
  ]
  return lines.join('\r\n')
}

/** POST raw MIME to the edge door. Every header can be overridden or dropped (null). */
export async function sendRawMime(
  request: APIRequestContext,
  raw: string | Buffer,
  opts: {
    slug?: string | null
    envelopeTo?: string | null
    timestamp?: string | null
    signature?: string | null
    signSlug?: string
    secret?: string
  } = {}
): Promise<APIResponse> {
  const body = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
  const timestamp =
    opts.timestamp === undefined ? String(Math.floor(Date.now() / 1000)) : opts.timestamp
  const slug = opts.slug === undefined ? SELF_HOSTED_MAIL_SLUG : opts.slug
  const signature =
    opts.signature !== undefined
      ? opts.signature
      : signRawMime({
          timestamp: timestamp ?? '0',
          slug: opts.signSlug ?? slug ?? SELF_HOSTED_MAIL_SLUG,
          body,
          secret: opts.secret,
        })
  const envelopeTo = opts.envelopeTo === undefined ? supportInboxAddress() : opts.envelopeTo
  const headers: Record<string, string> = { 'content-type': 'message/rfc822' }
  if (timestamp !== null) headers['x-qb-timestamp'] = timestamp
  if (slug !== null) headers['x-qb-mail-slug'] = slug
  if (signature !== null) headers['x-qb-signature'] = signature
  if (envelopeTo !== null) headers['x-qb-envelope-to'] = envelopeTo
  return request.post('/api/chat/email/inbound', { data: body, headers })
}

// ---------------------------------------------------------------------------
// Seeded customers and conversations
// ---------------------------------------------------------------------------

export interface SeededCustomer {
  email: string
  name: string
  userUuid: string
  principalUuid: string
  principalId: string
}

/** An identified customer (user + principal) with a unique address. */
export async function seedCustomer(
  email: string,
  name = 'Casey Customer'
): Promise<SeededCustomer> {
  const sql = supportDb()
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, true, now(), now())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalUuid}, ${userUuid}, 'user', 'user', ${name}, now())`
  return { email, name, userUuid, principalUuid, principalId: principalTypeId(principalUuid) }
}

/** An anonymous visitor principal (widget shape), optionally with a contact email. */
export async function seedAnonymousVisitor(contactEmail: string | null = null): Promise<string> {
  const principalUuid = toUuid(generateId('principal'))
  await supportDb()`
    INSERT INTO principal (id, user_id, role, type, display_name, contact_email, created_at)
    VALUES (${principalUuid}, NULL, 'user', 'anonymous', 'Visitor', ${contactEmail}, now())`
  return principalUuid
}

/**
 * A conversation with one visitor message, as the widget or the email door
 * would leave it. Returns the conversation uuid and TypeID.
 */
export async function seedConversation(opts: {
  visitorPrincipalUuid: string
  subject: string | null
  channel?: 'messenger' | 'email'
  visitorEmail?: string | null
  message?: string
  status?: 'open' | 'closed'
}): Promise<{ uuid: string; id: string }> {
  const sql = supportDb()
  const uuid = toUuid(generateId('conversation'))
  const message = opts.message ?? `${opts.subject ?? 'Hello'}: visitor message`
  const channel = opts.channel ?? 'messenger'
  await sql`
    INSERT INTO conversations
      (id, visitor_principal_id, status, channel, source, priority, subject, visitor_email,
       last_message_preview, last_message_at, waiting_since, created_at)
    VALUES
      (${uuid}, ${opts.visitorPrincipalUuid}, ${opts.status ?? 'open'}, ${channel},
       ${channel === 'email' ? 'email' : 'messenger'}, 'none', ${opts.subject},
       ${opts.visitorEmail ?? null}, ${message}, now(), now(), now() - interval '1 minute')`
  await sql`
    INSERT INTO conversation_messages
      (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
    VALUES
      (${toUuid(generateId('conversation_msg'))}, ${uuid}, ${opts.visitorPrincipalUuid},
       'visitor', ${message}, false, now() - interval '1 minute')`
  return { uuid, id: conversationTypeId(uuid) }
}

export interface CachedSettings {
  featureFlags?: Record<string, unknown>
  settings?: { metadata?: string | null }
}

/**
 * Make the app's cached workspace settings (kv_store `settings:workspace`)
 * agree with a direct settings write. On a miss the app re-reads the row and
 * caches it for an hour, so a request that read the row just before the write
 * can cache the old value just after it, and it then stays stale. Drop any
 * cached copy that fails `fresh` until none is left (a miss is fine: the next
 * read is current), looking twice a beat apart for a writer still in flight.
 */
export async function settleSettingsCache(
  fresh: (cached: CachedSettings) => boolean
): Promise<void> {
  const read = async () => {
    const [row] = await supportDb()<{ value: CachedSettings }[]>`
      SELECT value FROM kv_store WHERE key = 'settings:workspace'`
    return row?.value ?? null
  }
  await pollFor(
    'the cached workspace settings to match the database',
    async () => {
      const first = await read()
      if (!first || fresh(first)) {
        await new Promise((r) => setTimeout(r, 300))
        const again = await read()
        if (!again || fresh(again)) return true
      }
      await supportDb()`DELETE FROM kv_store WHERE key = 'settings:workspace'`
      return null
    },
    { timeoutMs: 10_000, intervalMs: 100 }
  )
}

/** Turn the workspace's cold-mail auto-acknowledgement on (it stays on). */
export async function enableAutoAck(): Promise<void> {
  await supportDb()`
    UPDATE settings
    SET metadata = jsonb_set(coalesce(nullif(metadata, '')::jsonb, '{}'::jsonb),
                             '{emailAutoAck}', '{"enabled": true}'::jsonb)::text
    WHERE coalesce((nullif(metadata, '')::jsonb -> 'emailAutoAck' ->> 'enabled')::boolean, false)
          IS NOT TRUE`
  await settleSettingsCache((cached) => {
    try {
      const meta = JSON.parse(cached.settings?.metadata ?? '{}') as {
        emailAutoAck?: { enabled?: boolean }
      }
      return meta.emailAutoAck?.enabled === true
    } catch {
      return false
    }
  })
}

/** Turn support tickets on (ticket mail is sent only then; it stays on). */
export async function enableSupportTickets(): Promise<void> {
  await supportDb()`
    UPDATE settings
    SET feature_flags = jsonb_set(coalesce(nullif(feature_flags, '')::jsonb, '{}'::jsonb),
                                  '{supportTickets}', 'true'::jsonb)::text
    WHERE coalesce((nullif(feature_flags, '')::jsonb ->> 'supportTickets')::boolean, false)
          IS NOT TRUE`
  await settleSettingsCache((cached) => cached.featureFlags?.supportTickets === true)
}

export async function blockPrincipal(principalUuid: string): Promise<void> {
  await supportDb()`UPDATE principal SET blocked_at = now() WHERE id = ${principalUuid}`
}

// ---------------------------------------------------------------------------
// Mailpit: match on body text as well as subject
// ---------------------------------------------------------------------------

const fullMailCache = new Map<string, MailpitMessage>()

async function fullMail(id: string): Promise<MailpitMessage> {
  let mail = fullMailCache.get(id)
  if (!mail) {
    mail = await getMail(id)
    fullMailCache.set(id, mail)
  }
  return mail
}

export interface MailMatch {
  to: string
  subject?: string
  /** Text that must appear in the HTML or plain body. */
  body?: string
}

/** Every message to `to` matching subject/body (newest first). */
export async function mailsMatching(match: MailMatch): Promise<MailpitMessage[]> {
  const out: MailpitMessage[] = []
  for (const summary of await mailTo(match.to)) {
    if (match.subject && !summary.Subject.includes(match.subject)) continue
    if (match.body) {
      const mail = await fullMail(summary.ID)
      if (!mail.HTML.includes(match.body) && !mail.Text.includes(match.body)) continue
      out.push(mail)
    } else {
      out.push(await fullMail(summary.ID))
    }
  }
  return out
}

export async function waitForMailMatching(
  match: MailMatch,
  timeoutMs = 20_000
): Promise<MailpitMessage> {
  return pollFor(
    `mail to ${match.to} (${match.subject ?? ''} / ${match.body ?? ''})`,
    async () => (await mailsMatching(match))[0] ?? null,
    { timeoutMs, intervalMs: 300 }
  )
}

/** Plain text of a mail's HTML (tags stripped, entities decoded, spaces collapsed). */
export function mailText(mail: MailpitMessage): string {
  return (
    mail.HTML.replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x27;|&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // Invisible preheader padding.
      .replace(/[\u200b-\u200f\u034f\u00ad\u2060\ufeff]|&#8202;|&#8203;/g, '')
      // Last, so an escaped entity such as &amp;lt; is decoded only once.
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      // React leaves a comment between text and an adjacent expression.
      .replace(/ ([.,!?:;])/g, '$1')
      .trim()
  )
}

/** One header value (first) from Mailpit's header map, case-insensitive. */
export function header(headers: Record<string, string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key][0] : undefined
}

// ---------------------------------------------------------------------------
// CSAT links
// ---------------------------------------------------------------------------

/** Mint a CSAT email token the way the app does (csat-email-token.ts). */
export function mintCsatToken(
  conversationId: string,
  principalId: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000
): string {
  const payload = `${conversationId}.${principalId}.${Date.now() + ttlMs}`
  const sig = createHmac('sha256', supportEnv().app.SECRET_KEY)
    .update(`csat-email:v1\n${payload}`)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

// ---------------------------------------------------------------------------
// Events and bells
// ---------------------------------------------------------------------------

export interface EventRow {
  type: string
  payload: Record<string, unknown>
  occurred_at: Date
}

/** Domain events recorded for an entity (a conversation or ticket TypeID), oldest first. */
export async function eventsFor(entityId: string): Promise<EventRow[]> {
  return supportDb()<EventRow[]>`
    SELECT type, payload, occurred_at FROM events WHERE entity_id = ${entityId} ORDER BY id ASC`
}

export async function eventTypesFor(entityId: string): Promise<string[]> {
  return (await eventsFor(entityId)).map((e) => e.type)
}

/** In-app bell rows that point at a conversation (TypeID). */
export async function bellsForConversation(conversationId: string) {
  return supportDb()<{ type: string; principal_id: string }[]>`
    SELECT type, principal_id FROM in_app_notifications
    WHERE metadata ->> 'conversationId' = ${conversationId}`
}

// ---------------------------------------------------------------------------
// A visitor's live stream (presence) without a browser
// ---------------------------------------------------------------------------

/** A stream token as the app mints it (stream-token.ts), signed with the suite's SECRET_KEY. */
export function mintStreamToken(principalId: string, scope: 'widget' | 'portal' = 'widget') {
  const payload = `${principalId}.${scope}.${Date.now() + 2 * 60 * 1000}`
  const sig = createHmac('sha256', supportEnv().app.SECRET_KEY)
    .update(`chat-stream:v1\n${payload}`)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

/** Open the visitor's conversation stream from the test process (they are "online"). */
export async function holdVisitorStream(
  principalId: string,
  conversationId: string
): Promise<{ release: () => void }> {
  const controller = new AbortController()
  const token = encodeURIComponent(mintStreamToken(principalId))
  const url = `${supportEnv().baseUrl}/api/chat/stream?token=${token}&conversationId=${encodeURIComponent(conversationId)}`
  const res = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  })
  if (!res.ok || !res.body) {
    controller.abort()
    throw new Error(`visitor stream answered ${res.status}`)
  }
  const reader = res.body.getReader()
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        // drain
      }
    } catch {
      // aborted
    }
  })()
  return { release: () => controller.abort() }
}

/** Wait until the principal (uuid) has, or has no, live presence row. */
export async function waitForVisitorPresence(principalUuid: string, present: boolean) {
  // presence_stream keys rows by the principal's TypeID.
  const principalId = principalTypeId(principalUuid)
  return pollFor(`${present ? 'a' : 'no'} presence row for ${principalId}`, async () => {
    const rows = await supportDb()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM presence_stream WHERE principal_id = ${principalId}`
    return rows[0].n > 0 === present ? true : null
  })
}

// ---------------------------------------------------------------------------
// The widget, identified as a customer of the test's own
// ---------------------------------------------------------------------------

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = enc({ alg: 'HS256', typ: 'JWT' })
  const body = enc(payload)
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

/** The workspace widget secret (the app's own e2e harness page mints it on first use). */
export async function widgetSecret(request: APIRequestContext): Promise<string> {
  const read = async () => {
    const [row] = await supportDb()<{ widget_secret: string | null }[]>`
      SELECT widget_secret FROM settings LIMIT 1`
    return row?.widget_secret ?? null
  }
  let secret = await read()
  if (!secret) {
    await request.get('/e2e/widget?persona=customer')
    secret = await read()
  }
  if (!secret) throw new Error('no widget secret')
  return secret
}

export interface WidgetIdentity {
  id: string
  email: string
  name: string
}

/**
 * Open the widget on a host page as `identity` (a signed identity token, as a
 * customer's own app would mint it). Returns the widget frame.
 */
export async function openWidgetAs(page: Page, identity: WidgetIdentity): Promise<FrameLocator> {
  const secret = await widgetSecret(page.request)
  const now = Math.floor(Date.now() / 1000)
  const ssoToken = signHs256(
    {
      sub: identity.id,
      id: identity.id,
      email: identity.email,
      name: identity.name,
      iat: now,
      exp: now + 3600,
    },
    secret
  )
  const origin = supportEnv().baseUrl
  const path = `/e2e/widget-host-${encodeURIComponent(identity.id)}`
  const init = JSON.stringify({ instanceUrl: origin, identity: { ssoToken } })
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Host</title></head>
<body><h1>Host app</h1>
<script src="/api/widget/sdk.js"></script>
<script>
  (function () {
    var Quackback = window.Quackback
    Quackback('on', 'identify', function (ev) {
      document.documentElement.dataset.identified = ev && ev.success ? '1' : '0'
    })
    Quackback('init', ${init})
    Quackback('open')
  })()
</script></body></html>`
  await page.route(`${origin}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  )
  // The SDK reports identify once per load; a load whose identify did not
  // succeed is reloaded (seen about once in ten full runs, not traced).
  await expect(async () => {
    await page.goto(`${origin}${path}`)
    await expect(page.locator('html')).toHaveAttribute('data-identified', '1', {
      timeout: 10_000,
    })
  }).toPass({ timeout: 25_000 })
  return page.frameLocator('iframe.quackback-widget-iframe')
}

/** The principal (uuid) behind a user address. */
export async function principalForUserEmail(email: string): Promise<string> {
  return pollFor(`a principal for ${email}`, async () => {
    const [row] = await supportDb()<{ id: string }[]>`
      SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
      WHERE lower(u.email) = lower(${email}) LIMIT 1`
    return row?.id ?? null
  })
}

/** The newest conversation of a visitor principal (uuid). */
export async function latestConversationOf(principalUuid: string): Promise<ConversationRow> {
  return pollFor(`a conversation for ${principalUuid}`, async () => {
    const [row] = await supportDb().unsafe<ConversationRow[]>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations c
       WHERE c.visitor_principal_id = $1 ORDER BY c.created_at DESC LIMIT 1`,
      [principalUuid]
    )
    return row ?? null
  })
}

// ---------------------------------------------------------------------------
// Workflows and group threads
// ---------------------------------------------------------------------------

/**
 * A live workflow that only acts on conversations of `personEmail` (its first
 * step is that condition), so it never touches another test's rows. Retire it
 * with `retireWorkflow` when the test is done.
 */
export async function seedLiveWorkflow(opts: {
  name: string
  triggerType: string
  triggerSettings?: Record<string, unknown>
  personEmail: string
  then: Array<Record<string, unknown>>
}): Promise<string> {
  const id = randomUUID()
  const nodes: Array<Record<string, unknown>> = [
    { id: 'trigger', type: 'trigger' },
    {
      id: 'only-me',
      type: 'condition',
      condition: { field: 'person.email', op: 'eq', value: opts.personEmail },
    },
    ...opts.then.map((node, i) => ({ id: `step-${i}`, ...node })),
  ]
  const ids = nodes.map((n) => n.id as string)
  const edges = ids.slice(1).map((to, i) => ({ from: ids[i], to }))
  const sql = supportDb()
  await sql`
    INSERT INTO workflows (id, name, class, status, trigger_type, trigger_settings, graph)
    VALUES (${id}, ${opts.name}, 'customer_facing', 'live', ${opts.triggerType},
            ${sql.json((opts.triggerSettings ?? {}) as never)}, ${sql.json({ nodes, edges } as never)})`
  return id
}

export async function retireWorkflow(id: string): Promise<void> {
  await supportDb()`UPDATE workflows SET status = 'paused', deleted_at = now() WHERE id = ${id}`
}

export async function addParticipant(conversationUuid: string, principalUuid: string) {
  await supportDb()`
    INSERT INTO conversation_participants (conversation_id, principal_id)
    VALUES (${conversationUuid}, ${principalUuid})`
}

/** A TipTap doc with one paragraph. */
export function tiptapDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
