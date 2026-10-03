import type { PrincipalId } from '@quackback/ids'
import { db, principal, and, eq, inArray, isNotNull, isNull } from '@/lib/server/db'
import {
  testAliasTokenMatches,
  testAliasTokensIn,
} from '@/lib/server/domains/conversation/conversation.email-channel'

/**
 * The teammate whose test alias one of these recipients is, or null. Only
 * current teammates have a working alias, so a former teammate's stops
 * routing the moment they leave the team.
 */
export async function testAliasOwnerFor(
  recipients: string[],
  slug: string | null
): Promise<PrincipalId | null> {
  if (slug === null) return null
  const tokens = recipients.flatMap((value) => testAliasTokensIn(value, slug))
  if (tokens.length === 0) return null
  const teammates = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        eq(principal.type, 'user'),
        inArray(principal.role, ['admin', 'member']),
        isNotNull(principal.userId),
        isNull(principal.testOwnerPrincipalId)
      )
    )
  for (const token of tokens) {
    const owner = teammates.find((teammate) => testAliasTokenMatches(token, teammate.id, slug))
    if (owner) return owner.id as PrincipalId
  }
  return null
}
