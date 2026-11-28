/**
 * A person's language as the API and MCP show it: the language they chose in
 * Preferences (null for "Automatic") and the one their browser, the widget's
 * host page or an API caller last reported (null until one does).
 */
import type { PrincipalId } from '@quackback/ids'
import { db, eq, principal, user } from '@/lib/server/db'
import type { PersonLanguage } from './user.types'

/** The language of the person behind a principal, or null when it has no user. */
export async function readPersonLanguage(principalId: PrincipalId): Promise<PersonLanguage | null> {
  const [row] = await db
    .select({ chosen: user.preferredLanguage, detected: user.detectedLocale })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, principalId))
    .limit(1)
  return row ?? null
}
