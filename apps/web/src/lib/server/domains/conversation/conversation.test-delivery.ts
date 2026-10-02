import { db, principal, user, eq } from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { isTestRecord } from '@/lib/server/test-data'
import { isTeamMember } from '@/lib/shared/roles'
import { contactRecipientFrom } from '@/lib/server/email/recipient'

type TestDelivery =
  { test: false } | { test: true; ownerPrincipalId: PrincipalId | null; recipient: string | null }

/** Test delivery uses the stored owner, never a visitor-controlled address. */
export async function conversationTestDelivery(
  conversationId: ConversationId
): Promise<TestDelivery> {
  const conversation = await db.query.conversations.findFirst({
    where: (table, { eq }) => eq(table.id, conversationId),
    columns: { customAttributes: true, visitorPrincipalId: true },
  })
  if (!conversation) return { test: true, ownerPrincipalId: null, recipient: null }
  const visitor = await db.query.principal.findFirst({
    where: eq(principal.id, conversation.visitorPrincipalId),
    columns: { testOwnerPrincipalId: true },
  })
  const marked = isTestRecord(conversation.customAttributes)
  if (!marked && !visitor?.testOwnerPrincipalId) return { test: false }
  const markerOwner = conversation.customAttributes?.testOwnerPrincipalId
  const ownerPrincipalId =
    visitor?.testOwnerPrincipalId ??
    (typeof markerOwner === 'string' ? (markerOwner as PrincipalId) : null)
  if (!ownerPrincipalId) return { test: true, ownerPrincipalId: null, recipient: null }
  const [owner] = await db
    .select({
      type: principal.type,
      role: principal.role,
      accountEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, ownerPrincipalId))
    .limit(1)
  return {
    test: true,
    ownerPrincipalId,
    recipient:
      owner?.type === 'user' && isTeamMember(owner.role) ? contactRecipientFrom(owner) : null,
  }
}
