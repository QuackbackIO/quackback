/**
 * Resolve the email address an agent reply should be sent to when the visitor
 * is offline. Pure so the precedence is unit-tested directly. Precedence:
 *   1. an identified visitor's account email;
 *   2. the principal-level contact email (survives across conversations);
 *   3. the pre-chat email captured on this conversation.
 */
export function resolveReplyRecipient(
  visitor: { type: string; email: string | null } | undefined | null,
  contactEmail: string | null | undefined,
  capturedEmail: string | null | undefined
): string | null {
  if (visitor && visitor.type !== 'anonymous' && visitor.email) return visitor.email
  return contactEmail ?? capturedEmail ?? null
}
