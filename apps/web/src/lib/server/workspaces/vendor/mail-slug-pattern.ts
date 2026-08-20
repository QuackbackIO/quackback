/**
 * The mail slug vocabulary, alone in a module with no dependencies.
 *
 * `contract.ts` still owns what a registry record IS, still re-exports both
 * constants, and is still where server code should import them from. They live
 * here because one more reader applies the same rule from outside this build:
 * the inbound Email Worker runs on workerd at the edge and tests a recipient's
 * local part against this pattern before it will spend a control-plane round
 * trip on it. Importing the registry contract to learn one regex would pull
 * zod and the whole record schema into a bundle whose only job is to look at a
 * local part; restating the regex in the Worker would give the routing chain
 * two vocabularies free to drift apart. A dependency-free module is how there
 * comes to be exactly one.
 */

/**
 * How much of an inbound address's local part a workspace label may spend.
 *
 * RFC 5321 caps a local part at 64 characters. One shared inbound domain serves
 * the whole fleet, so the local part has to carry both the workspace and the
 * conversation, and the conversation half is fixed: `+<marker><26-character id
 * suffix>.<22-character signature>` is 51. That leaves 13, exactly, and the
 * remainder is not negotiable by shortening something else — the id suffix is
 * the identifier's own length and the signature is what makes the address
 * unforgeable without a lookup table.
 *
 * Over-length does not degrade gracefully. It produces an address the receiving
 * MTA rejects outright, so the limit is enforced at mint time, by the database,
 * and here.
 */
export const MAIL_SLUG_MAX_LENGTH = 13

/**
 * The entire legal vocabulary of a mail slug, and the same expression the
 * database CHECK constraint carries.
 *
 * Lowercase only, because a local part is case-sensitive to the letter of the
 * standard and one canonical form removes the question. Digits and hyphen
 * because they are the characters that are safe simultaneously in a local part,
 * in the `+` sub-address grammar and in a log line. No dot: the reply grammar
 * separates the conversation suffix from its signature with a dot, so a dot in
 * a slug would let one workspace's label impersonate part of another address.
 * No `+` for the same reason one level up.
 *
 * No `g` flag, deliberately: a global regex carries `lastIndex` between calls,
 * and this one is a shared module-level constant that several callers `.test()`
 * against in turn.
 *
 * It is a VOCABULARY, not a description of what the minter emits. `-` and `---`
 * match it and no minted slug is ever either, because `mailSlugStem` strips
 * boundary hyphens and collapses runs. Deliberately not tightened to close that
 * gap: this expression is also the database CHECK and the app's vendored copy,
 * so the three enforcers agree only while it stays one expression that is
 * trivially the same on all three, and a hyphen-position rule stated three times
 * in three dialects is a rule with three chances to be stated differently. The
 * looseness costs nothing — a slug is only ever compared for equality against a
 * unique index, never parsed — and the minter, which is the only writer, is
 * strictly narrower.
 */
export const MAIL_SLUG_PATTERN = new RegExp(`^[a-z0-9-]{1,${MAIL_SLUG_MAX_LENGTH}}$`)
