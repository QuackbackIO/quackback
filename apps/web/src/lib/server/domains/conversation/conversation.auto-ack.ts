/**
 * Cold-inbound auto-acknowledgement. Default off. Loop-guarded: never ack an
 * auto-submitted / bulk / list / own-domain message, and cap per sender.
 */
import { incrementBucket } from '@/lib/server/utils/rate-bucket'
import { logger } from '@/lib/server/logger'
import type { ConversationId } from '@quackback/ids'
import type { ParsedInboundEmail } from './conversation.email-inbound'
import { ownEmailDomains } from './conversation.email-channel'
import { normalizeSenderAddress } from './conversation.email-inbound'

const log = logger.child({ component: 'conversation-auto-ack' })

const ACK_WINDOW_SECONDS = 3600
const ACK_MAX = 2

export type AutoAckRefusal =
  | 'disabled'
  | 'auto_submitted'
  | 'precedence'
  | 'list'
  | 'own_domain'
  | 'no_sender'
  | 'rate_capped'

export function evaluateAutoAckGuards(
  parsed: ParsedInboundEmail,
  env: NodeJS.ProcessEnv = process.env
): AutoAckRefusal | null {
  const auto = parsed.autoSubmitted?.trim().toLowerCase()
  if (auto && auto !== 'no') return 'auto_submitted'

  const precedence = parsed.precedence?.trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') {
    return 'precedence'
  }
  if (parsed.hasListHeaders) return 'list'

  const sender = normalizeSenderAddress(parsed.from)
  if (!sender) return 'no_sender'

  const domain = sender.split('@')[1]?.toLowerCase()
  if (domain && ownEmailDomains(env).has(domain)) return 'own_domain'

  return null
}

export async function assertAutoAckRate(senderEmail: string): Promise<boolean> {
  const spec = { key: `email:auto-ack:${senderEmail}`, windowSeconds: ACK_WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)
  if (count !== null && count > ACK_MAX) return false
  return true
}

export async function maybeSendColdInboundAck(opts: {
  parsed: ParsedInboundEmail
  conversationId: ConversationId
  conversationSubject: string | null
}): Promise<AutoAckRefusal | 'sent' | 'skipped'> {
  const { getEmailAutoAck } = await import('@/lib/server/domains/settings/settings.email-auto-ack')
  const setting = await getEmailAutoAck()
  if (!setting.enabled) return 'disabled'

  const guard = evaluateAutoAckGuards(opts.parsed)
  if (guard) {
    log.info({ reason: guard }, 'auto-ack suppressed')
    return guard
  }

  const sender = normalizeSenderAddress(opts.parsed.from)
  if (!sender) return 'no_sender'
  if (!(await assertAutoAckRate(sender))) {
    log.info({ reason: 'rate_capped' }, 'auto-ack suppressed')
    return 'rate_capped'
  }

  const { emailBudgetAvailable } = await import('@/lib/server/domains/settings/tier-enforce')
  if (!(await emailBudgetAvailable())) {
    log.warn({ reason: 'budget' }, 'auto-ack skipped')
    return 'skipped'
  }

  try {
    const { sendConversationAutoAckEmail } = await import('@quackback/email')
    const { inboundReplyToAddress, mintOutboundMessageId } =
      await import('./conversation.email-channel')
    const { currentMailSlug } = await import('./conversation.mail-slug')
    const { typedAddressRecipient } = await import('@/lib/server/email/recipient')
    const { recordOutboundEmail } = await import('./conversation.email-store')
    const { requireSettings } = await import('@/lib/server/domains/settings/settings.helpers')
    const org = await requireSettings()
    const workspaceName = org.name ?? 'Support'
    const to = typedAddressRecipient(sender)
    if (!to) return 'no_sender'
    const replyTo = inboundReplyToAddress(opts.conversationId, currentMailSlug())
    const inboundId = opts.parsed.messageId
    const minted = mintOutboundMessageId(opts.conversationId) ?? undefined
    const result = await sendConversationAutoAckEmail({
      to,
      workspaceName,
      conversationSubject: opts.conversationSubject,
      replyTo: replyTo ?? undefined,
      messageId: minted,
      inReplyTo: inboundId ?? undefined,
      references: inboundId ? [inboundId] : undefined,
      conversationId: opts.conversationId,
    })
    const outboundId = result.messageId === undefined ? minted : (result.messageId ?? undefined)
    if (outboundId) await recordOutboundEmail(outboundId, opts.conversationId)
    return 'sent'
  } catch (err) {
    log.warn({ err }, 'auto-ack send failed')
    return 'skipped'
  }
}
