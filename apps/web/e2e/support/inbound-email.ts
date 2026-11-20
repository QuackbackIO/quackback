/**
 * Inbound email, as the provider webhook delivers it: Svix-signed JSON
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature`) posted to
 * /api/chat/email/inbound with the suite's EMAIL_INBOUND_SIGNING_SECRET.
 *
 * Reply addresses are minted with the app's own exported helpers, so a test
 * reply lands exactly where a customer's would.
 */
import { createHmac, randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import type { ConversationId, TicketId } from '@quackback/ids'
import {
  inboundReplyToAddress,
  inboundTicketReplyToAddress,
  platformInboxAddress,
} from '../../src/lib/server/domains/conversation/conversation.email-channel'
import { supportEnv } from './env'

/** The self-hosted mail slug (conversation.mail-slug.ts SELF_HOSTED_MAIL_SLUG). */
const MAIL_SLUG = 'reply'

function appEnv(): Record<string, string> {
  return supportEnv().app
}

/** `<slug>+c<id>.<tag>@<inbound domain>` for a conversation. */
export function conversationReplyAddress(conversationId: string): string {
  const address = inboundReplyToAddress(conversationId as ConversationId, MAIL_SLUG, appEnv())
  if (!address) throw new Error('inbound email is not configured in support.env')
  return address
}

/** `<slug>+t<id>.<tag>@<inbound domain>` for a ticket. */
export function ticketReplyAddress(ticketId: string): string {
  const address = inboundTicketReplyToAddress(ticketId as TicketId, MAIL_SLUG, appEnv())
  if (!address) throw new Error('inbound email is not configured in support.env')
  return address
}

/** The workspace's support address; cold mail to it opens a new conversation. */
export function supportInboxAddress(): string {
  const address = platformInboxAddress(MAIL_SLUG, appEnv())
  if (!address) throw new Error('inbound email is not configured in support.env')
  return address
}

export interface InboundMail {
  from: string
  to: string | string[]
  cc?: string[]
  subject: string
  text?: string
  html?: string
  /** Defaults to a fresh unique id. */
  messageId?: string
  inReplyTo?: string
  references?: string[]
  /** Extra raw headers. */
  headers?: Record<string, string>
}

/** The provider's `email.received` event for a message. */
export function inboundEvent(mail: InboundMail): { type: string; data: Record<string, unknown> } {
  const messageId = mail.messageId ?? `<${randomUUID()}@sender.example>`
  const headers: Record<string, string> = { 'message-id': messageId, ...mail.headers }
  if (mail.inReplyTo) headers['in-reply-to'] = mail.inReplyTo
  if (mail.references?.length) headers.references = mail.references.join(' ')
  return {
    type: 'email.received',
    data: {
      email_id: randomUUID(),
      from: mail.from,
      to: Array.isArray(mail.to) ? mail.to : [mail.to],
      cc: mail.cc ?? [],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers,
    },
  }
}

/**
 * Svix signature headers for `body`: base64(HMAC-SHA256(key, `${id}.${ts}.${body}`))
 * where key is the base64 after `whsec_`.
 */
export function signInboundBody(
  body: string,
  secret: string,
  opts: { id?: string; timestamp?: number } = {}
): Record<string, string> {
  const id = opts.id ?? `msg_${randomUUID()}`
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000))
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  }
}

/**
 * Post a signed inbound email to the app. Returns the response; a 200's JSON
 * body carries the ingest status (`ingested`, `no_conversation`, ...).
 * `secret` overrides the signing secret (to prove a wrong one is refused).
 */
export async function sendInboundEmail(
  request: APIRequestContext,
  mail: InboundMail,
  opts: { secret?: string } = {}
): Promise<APIResponse> {
  const body = JSON.stringify(inboundEvent(mail))
  const secret = opts.secret ?? appEnv().EMAIL_INBOUND_SIGNING_SECRET
  return request.post('/api/chat/email/inbound', {
    data: body,
    headers: { 'content-type': 'application/json', ...signInboundBody(body, secret) },
  })
}
