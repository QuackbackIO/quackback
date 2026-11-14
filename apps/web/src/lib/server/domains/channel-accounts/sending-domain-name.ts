/**
 * Which names may become a sending domain: the form a domain is stored in, and
 * the names that are refused because they belong to the platform.
 */
import { ValidationError } from '@/lib/shared/errors'
import { MAIL_DOMAIN_RE } from '@/lib/server/utils/mail-domain'
import { isAtOrUnder, platformSendingDomains, toAsciiDomain } from './outbound-identity'

/** Thrown when a domain cannot be added at all, with a reason for the operator. */
export class SendingDomainRefusedError extends ValidationError {
  constructor(message: string) {
    super('SENDING_DOMAIN_REFUSED', message)
  }
}

/**
 * Is `candidate` the same as, under, or above `domain`?
 *
 * Both directions matter. A workspace claiming a subdomain of a platform domain
 * would be claiming addresses the platform mints for other workspaces; a
 * workspace claiming a PARENT of one would be worse, because a verified parent
 * domain covers every subdomain under it at the provider.
 */
export function domainsOverlap(candidate: string, domain: string): boolean {
  const a = toAsciiDomain(candidate)
  const b = toAsciiDomain(domain)
  if (!a || !b) return false
  // The same dot-anchored test the send guard applies, run both ways round. One
  // reading of "is this domain under that one", so the two cannot drift.
  return isAtOrUnder(a, b) || isAtOrUnder(b, a)
}

/**
 * Normalise and refuse a domain that must never become a sending identity.
 *
 * The platform check is a security boundary, not tidiness. The platform's own
 * domains are already verified on the shared provider account, so a workspace
 * that got one of them into its table would be handed a verified identity it
 * never proved anything about — and the platform's inbound domain is where every
 * other workspace's reply addresses live.
 */
export function normalizeSendingDomain(
  input: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const typed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
  if (typed.includes('@')) {
    throw new SendingDomainRefusedError('Enter a domain, not an email address.')
  }
  // Stored in the A-label form, because that is the form DNS resolves, the form
  // the provider registers an identity under, and the form the send-time guard
  // compares against. Normalising at the door means a customer who typed their
  // domain in its own script and a reply addressed in ASCII are the same domain
  // rather than two that never match.
  const domain = toAsciiDomain(typed)
  // The shared rule, not a copy of it: what a customer may claim and what the
  // platform may be configured with are the same question, and two spellings of
  // the answer are two answers waiting to drift.
  if (!MAIL_DOMAIN_RE.test(domain)) {
    throw new SendingDomainRefusedError(`${input.trim()} is not a valid domain name.`)
  }
  for (const platform of platformSendingDomains(env)) {
    if (domainsOverlap(domain, platform)) {
      throw new SendingDomainRefusedError(
        `${domain} can't be added because it's part of the platform's own email domain.`
      )
    }
  }
  return domain
}
