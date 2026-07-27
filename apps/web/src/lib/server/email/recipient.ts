/**
 * THE decision about which address a piece of mail goes to.
 *
 * The rule this exists to make structural: **mail that can grant account access
 * must never follow a user-settable address.** `principal.contactEmail` has two
 * unverified writers — an agent typing an address into the inbox, and a visitor
 * typing one into a pre-chat form — so letting a password reset fall back to it
 * would be an account-takeover path: set the contact address, trigger a reset,
 * receive it. Nothing enforced that before this module; it simply happened not
 * to be wired up.
 *
 * The axis is NOT "security vs product". That framing breaks on magic links and
 * invitations, which have no user row to look up — for an invitee one does not
 * exist yet. The honest axis is where the mail's authority comes from:
 *
 *   account   a capability over an EXISTING account. Recipient is `user.email`
 *             looked up by id, and nothing else.
 *   sealed    a capability over whoever owns an address. The address IS the
 *             claim being minted, so there is nothing to look up: the rule is
 *             "mail exactly the address the token was minted for".
 *   contact   carries no capability. May follow the contact address.
 *
 * `contact` is never usable for the other two, and there is deliberately no
 * "but this contactEmail was verified" carve-out — no column distinguishes the
 * verified writer from the two unverified ones, so the distinction is not
 * expressible and a carve-out would be a lie.
 */

import { eq, inArray } from 'drizzle-orm'
import type { PrincipalId, UserId } from '@quackback/ids'
import { db, user, principal } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'

declare const ACCOUNT: unique symbol
declare const SEALED: unique symbol
declare const CONTACT: unique symbol

/** An address read from `user.email` by id. */
export type AccountEmail = string & { readonly [ACCOUNT]: true }
/** The exact address a verification token was minted for. */
export type SealedEmail = string & { readonly [SEALED]: true }
/** A reachable address that may have been supplied by someone other than the owner. */
export type ContactEmail = string & { readonly [CONTACT]: true }

/**
 * Anything a capability may be put in front of. Deliberately excludes
 * `ContactEmail` — that exclusion is the whole point of the type.
 */
export type SecureRecipient = AccountEmail | SealedEmail

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

/** Single-principal convenience over {@link resolveContactRecipients}. */
export async function resolveContactRecipient(id: PrincipalId): Promise<ContactEmail | null> {
  return (await resolveContactRecipients([id])).get(id) ?? null
}

type Sender<P extends { to: string }> = (params: P) => Promise<{ sent: boolean }>

/**
 * Send capability-bearing mail. Accepts only an account or sealed address.
 *
 * `packages/email` types every `to` as a bare string, so the brand alone proves
 * nothing at the send site; routing through here is what makes passing a
 * contact address a compile error. Note the residual hole honestly: nothing
 * forces a caller to use this wrapper. That is what the lint rule and the
 * source-scan test are for.
 */
export function mailSecure<P extends { to: string }>(
  send: Sender<P>,
  to: SecureRecipient,
  rest: Omit<P, 'to'>
): Promise<{ sent: boolean }> {
  return send({ ...rest, to } as unknown as P)
}

/** Send mail that carries no capability. */
export function mailContact<P extends { to: string }>(
  send: Sender<P>,
  to: ContactEmail,
  rest: Omit<P, 'to'>
): Promise<{ sent: boolean }> {
  return send({ ...rest, to } as unknown as P)
}
