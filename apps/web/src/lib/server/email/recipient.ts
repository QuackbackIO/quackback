/**
 * Where every mail recipient in this app comes from.
 *
 * The three classes and the rule they encode are defined next to the senders
 * that demand them, in `@quackback/email/recipient` — a capability-bearing
 * sender's `to` is typed `SecureRecipient`, so handing one a contact address is
 * a compile error at the send site rather than something a convention has to
 * catch. This module is the other half of that: the ONLY place in the app that
 * mints those brands, which is what makes the type mean anything.
 *
 * Each constructor below is the single cast for its class, and each is written
 * so the rule is enforced by the shape of the code rather than by whoever edits
 * it next:
 *
 *   account   selects only `user.email`, by id, and never joins `principal` —
 *             so it cannot read a contact address even by accident.
 *   sealed    takes the mint result, not a bare string, so the mailed address
 *             cannot drift from the one written into the verification row.
 *   contact   the only one allowed to fall back to `principal.contactEmail`.
 */

import { eq, inArray } from 'drizzle-orm'
import type { PrincipalId, UserId } from '@quackback/ids'
import type { AccountEmail, ContactEmail, SealedEmail } from '@quackback/email/recipient'
import { db, user, principal } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'

export type {
  AccountEmail,
  ContactEmail,
  SealedEmail,
  SecureRecipient,
} from '@quackback/email/recipient'

/**
 * The account's own address, or null when it has none that can receive mail.
 *
 * Selects ONLY `user.email` and never joins `principal`, so the rule is
 * enforced by the shape of the query rather than by whoever edits it next.
 */
export async function resolveAccountRecipient(userId: UserId): Promise<AccountEmail | null> {
  const row = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { email: true },
  })
  return (realEmail(row?.email) as AccountEmail | null) ?? null
}

/**
 * The address a token was minted for.
 *
 * Takes the mint result rather than a bare string so the address cannot drift
 * between what was written into the verification row and what is mailed — a
 * normalisation difference there would send the token somewhere it cannot be
 * redeemed, or worse, somewhere it can.
 */
export function sealedRecipient(minted: { sealedAddress: string }): SealedEmail {
  // Throw rather than hand back undefined. A missing seal means the caller
  // passed something that is not a mint result, and the failure mode of
  // continuing is mailing a capability to `undefined` — which the transport
  // would reject, but only after the token is already live and unreachable.
  if (!minted?.sealedAddress) {
    throw new Error('sealedRecipient: mint result carries no sealed address')
  }
  return minted.sealedAddress as SealedEmail
}

/**
 * An address a visitor typed into a form, nothing more.
 *
 * Contact class, which is the honest one: nobody has proven they own it, so it
 * may only carry mail that grants nothing. That is why the cast lives here
 * beside the other three rather than at a call site — the class is what stops
 * a future caller from handing this to a capability-bearing sender, and the
 * compiler enforces it because those senders demand a `SecureRecipient`.
 *
 * Returns null for a synthetic placeholder address, which is never a person.
 */
export function typedAddressRecipient(raw: string): ContactEmail | null {
  return (realEmail(raw.trim().toLowerCase()) ?? null) as ContactEmail | null
}

/**
 * The contact-class precedence, pure so it can be unit-tested without a
 * database and shared by every caller that has the two fields to hand.
 */
export function contactRecipientFrom(src: {
  accountEmail: string | null | undefined
  contactEmail: string | null | undefined
}): ContactEmail | null {
  return (realEmail(src.accountEmail) ?? realEmail(src.contactEmail) ?? null) as ContactEmail | null
}

/**
 * A deliverable address per principal id, dropping placeholders and principals
 * with no real address. One joined query for the whole set.
 */
export async function resolveContactRecipients(
  principalIds: PrincipalId[]
): Promise<Map<PrincipalId, ContactEmail>> {
  const out = new Map<PrincipalId, ContactEmail>()
  if (principalIds.length === 0) return out
  const rows = await db
    .select({ id: principal.id, email: user.email, contactEmail: principal.contactEmail })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, principalIds))
  for (const row of rows) {
    const email = contactRecipientFrom({ accountEmail: row.email, contactEmail: row.contactEmail })
    if (email) out.set(row.id as PrincipalId, email)
  }
  return out
}

type Sender<P extends { to: string }> = (params: P) => Promise<{ sent: boolean }>

/**
 * Send mail that carries no capability.
 *
 * There is no `mailSecure` counterpart: the capability-bearing senders declare
 * `to: SecureRecipient` themselves, so the compiler already refuses a contact
 * address and a wrapper would add nothing but a layer to forget to use.
 *
 * This one still earns its place, because the product senders take a plain
 * `to: string` — they have to, since the outbox calls them with addresses that
 * came back from JSON and carry no brand. Routing through here is what makes a
 * caller that has NOT resolved a recipient fail to compile.
 */
export function mailContact<P extends { to: string }>(
  send: Sender<P>,
  to: ContactEmail,
  rest: Omit<P, 'to'>
): Promise<{ sent: boolean }> {
  // The cast is unavoidable: TypeScript cannot see that spreading `Omit<P,'to'>`
  // back together with a `to` reconstitutes `P`.
  return send({ ...rest, to } as unknown as P)
}
