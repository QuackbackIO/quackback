import { realEmail } from '@/lib/shared/anonymous-email'
import { contactRecipientFrom } from '@/lib/server/email/recipient'

/**
 * Resolve the email address an agent reply should be sent to when the visitor
 * is offline. Pure so the precedence is unit-tested directly. Precedence:
 *   1. an identified visitor's account email;
 *   2. the principal-level contact email (survives across conversations);
 *   3. the pre-chat email captured on this conversation.
 *
 * Every step is filtered through `realEmail`, because "has a non-null account
 * email" stopped meaning "is reachable" once providers that release no address
 * got minted placeholders. A placeholder is truthy, so a plain truthiness check
 * hands it back as the recipient and the transport then drops the send — the
 * agent sees a reply that never arrived, which is worse than knowing there is
 * nowhere to send it.
 *
 * The first two tiers ARE the shared contact-class precedence, so they come
 * from `contactRecipientFrom` rather than being restated here. The third tier
 * is conversation-only — no other caller has a per-conversation captured
 * address — which is why this function still exists rather than being replaced.
 */
export function resolveReplyRecipient(
  visitor: { type: string; email: string | null } | undefined | null,
  contactEmail: string | null | undefined,
  capturedEmail: string | null | undefined
): string | null {
  // An anonymous visitor's account email is plumbing (the anonymous plugin
  // mints one per browser), never a real address, so it is not offered here.
  const accountEmail = visitor && visitor.type !== 'anonymous' ? visitor.email : null
  return contactRecipientFrom({ accountEmail, contactEmail }) ?? realEmail(capturedEmail) ?? null
}
