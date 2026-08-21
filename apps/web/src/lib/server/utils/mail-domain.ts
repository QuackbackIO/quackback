/**
 * One spelling for a mail domain, and one answer to whether a configured value
 * is a mail domain at all.
 *
 * Every reader of a domain — the address minter, the front door's accept-set,
 * the outbound `Message-ID` host, the loop guard, the provisioning refusal —
 * compares strings. A value read raw by one of them and normalised by another
 * is two different domains wearing one name, and on this path that asymmetry is
 * not cosmetic: the door can end up refusing the only spelling a real mail
 * server delivers, while the minter builds an address on a spelling no zone
 * answers for. So the normalisation lives here, once, and every reader spends
 * it.
 *
 * It is its own leaf module rather than an export of either domain that uses
 * it, because both of them use it: the conversation domain owns the inbound
 * grammar and the channel-accounts domain owns sending identities, and either
 * one importing this from the other would tie a domain rule to whichever module
 * happened to define it first.
 */
import { domainToASCII } from 'node:url'

/**
 * A domain in the one form comparisons are made in: lower-case ASCII, A-labels.
 *
 * An internationalised domain has two spellings that name the same zone, and
 * they never match as strings. DNS, the mail provider's identity list, the
 * envelope a receiving MTA hands us and the sending-domain table all speak the
 * A-label form, so a configured value left in its unicode spelling would be
 * refused at the door in the only spelling that can actually arrive.
 *
 * Returns the input lower-cased when the label cannot be converted, so a
 * malformed value fails the comparison rather than becoming an empty string
 * that could match another empty string. {@link normalizeMailDomain} is what
 * turns that failure into a refusal rather than a silent mismatch.
 */
export function toAsciiDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\.$/, '').toLowerCase()
  if (!trimmed) return ''
  return domainToASCII(trimmed) || trimmed
}

/**
 * A syntactically usable domain: labels, dots, at least one dot, no address.
 *
 * Applied to the A-label form, so the character class is the only one DNS
 * carries. The dot is required: a single label is a host on somebody's search
 * path, never a mail domain we could receive on.
 */
export const MAIL_DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/**
 * The one domain this value names, or null when it names none.
 *
 * Null for absent, blank, and — the case this exists for — a value that is not
 * one domain. A comma-separated pair is the likeliest typo in a variable that
 * names exactly one domain, and the shapes it produces are each silently wrong
 * in a different direction: an address minted on it is undeliverable, and an
 * accept-set holding it matches no envelope any mail server would send. Refused
 * here, the same value instead reads as "inbound email is not configured",
 * which mints nothing, defers rather than bounces, and says so where an
 * operator is looking.
 */
export function normalizeMailDomain(value: string | null | undefined): string | null {
  const domain = toAsciiDomain(value ?? '')
  return domain && MAIL_DOMAIN_RE.test(domain) ? domain : null
}
