/**
 * Cold-inbound sender resolution (support platform §4.8 Layer 2). When an email
 * arrives that isn't a reply to an existing conversation, this decides WHO it is
 * from, gated by the DMARC trust verdict and the decided identity model
 * (IDENTITY-MODEL-ANALYSIS.md): inbound email attaches by address only under a
 * DMARC pass ("verified lead"); anything weaker becomes a standalone unverified
 * lead; a hard reject is dropped.
 *
 *   - drop   → hard DMARC reject; the caller creates nothing.
 *   - attach → DMARC pass AND the From matches an existing user → reuse that
 *              identity's principal (a verified lead adopting a known contact).
 *   - create → a new anonymous principal carrying the (verified-or-not) contact
 *              email; `unverified` drives the agent-facing "unverified sender"
 *              badge and blocks silent attachment to a known identity.
 *
 * Resolution only touches identity; the caller owns creating the conversation.
 */
import { db, sql, eq, user } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  createPrincipal,
  ensurePrincipalForUser,
} from '@/lib/server/domains/principals/principal.factory'
import { evaluateInboundAuth, type InboundAuthResult } from './email-auth'

export type ColdInboundResolution =
  | { action: 'drop'; verdict: InboundAuthResult }
  | {
      action: 'attach' | 'create'
      principalId: PrincipalId
      /** True for a weak-auth lead — drives the unverified-sender badge. */
      unverified: boolean
      verdict: InboundAuthResult
    }

/**
 * Resolve the sender of a cold inbound email to a principal (or a drop), gated by
 * the Authentication-Results header. `fromEmail` is the raw From address.
 */
export async function resolveColdInboundSender(
  fromEmail: string | null,
  authResultsHeader: string | null
): Promise<ColdInboundResolution> {
  const verdict = evaluateInboundAuth(authResultsHeader)
  if (verdict.verdict === 'reject') return { action: 'drop', verdict }

  const email = realEmail(fromEmail)?.toLowerCase() ?? null

  // Attach only under a DMARC pass to an existing user (the trust gate is the
  // only path that adopts a known identity by address).
  if (email && verdict.verdict === 'pass') {
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email))
      .limit(1)
    if (existing) {
      const { principal } = await ensurePrincipalForUser({ userId: existing.id, role: 'user' })
      return { action: 'attach', principalId: principal.id, unverified: false, verdict }
    }
  }

  // Otherwise a new standalone lead: an anonymous principal carrying the contact
  // email. A DMARC pass with no existing account is still a verified lead; a weak
  // verdict is unverified and gets the badge.
  const lead = await createPrincipal({ role: 'user', type: 'anonymous', contactEmail: email })
  return {
    action: 'create',
    principalId: lead.id,
    unverified: verdict.verdict !== 'pass',
    verdict,
  }
}
