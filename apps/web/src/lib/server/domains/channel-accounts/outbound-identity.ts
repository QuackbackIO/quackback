/**
 * Which identities this workspace may send as.
 *
 * ## The property, and why nothing else provides it
 *
 * Every workspace on a fleet sends through one mail provider account. The
 * provider will sign for any identity verified on that account, and it has no
 * idea which workspace an identity belongs to — from its side they all belong to
 * the account. So the provider will happily sign a message from workspace B
 * claiming to be `support@workspace-a.example`, and no credential scoping, no
 * per-workspace key and no configuration on the provider's side can change that.
 *
 * The only thing that can is this. It is written as a guard with one entry point
 * rather than left to emerge from the shape of a query, because "the query
 * happens to be scoped" is a property that survives exactly until someone writes
 * a second query.
 *
 * ## The four ways an address earns the right to be sent from
 *
 * 1. Its domain is one THIS workspace verified, which means someone published a
 *    token in that zone that exists in no other workspace's row.
 * 2. It is exactly the platform's own default sender. Exactly, not
 *    domain-matched: matching its domain would let any workspace mint any local
 *    part on the platform's brand. Under pooled tenancy this is the workspace's
 *    registry `email.from`; self-host it is `EMAIL_FROM`.
 * 3. It is an address on the platform's shared MINTING domain whose label is
 *    THIS workspace's mail slug. That domain is where every workspace's new
 *    reply addresses live, so the slug is what separates them.
 *
 *    The minting domain alone, even on a platform that still receives on a
 *    domain it has retired. What this rule grants is the right to put an
 *    address in a From, and a From is only worth granting where the provider
 *    holds a verified identity to send it with — which is the minting domain
 *    and not the ones kept open to catch replies. Granting more would turn a
 *    refusal that falls back to the platform sender into a send the provider
 *    rejects outright.
 * 4. There is only one workspace. A self-hosted install owns its whole provider
 *    account, its operator typed every address in it by hand, and there is no
 *    second workspace to be impersonated. Refusing an address there would break
 *    a working install to defend against nobody.
 *
 * Anything else falls back to the platform default. Falling back rather than
 * throwing on the send path is deliberate: the message still goes, from an
 * identity that is honestly ours, and the refusal is a log line rather than a
 * lost reply. The CREATE path throws instead, because that is where a person is
 * present to read it.
 *
 * ## This module is the only minter of `SendingIdentity`
 *
 * The senders in `@quackback/email` type their `from` as that brand, so an
 * address that did not come out of the two functions at the bottom of this file
 * cannot be handed to one. The casts here are the only casts to it in
 * application code, which is what makes the brand a fact about the value rather
 * than a claim about the code path.
 *
 * ## Why this imports the conversation domain
 *
 * Rule 3 needs the shared inbound domain's local-part grammar, which the
 * inbound side owns, and rule 3's own slug, which the mail-slug module owns.
 * Both live under `domains/conversation`, so importing them records a cycle in
 * the dependency graph. Re-reading the local part here instead would put a
 * second copy of the inbound grammar in the tree, and two readings of the same
 * address that can drift is the failure this rule exists to prevent. The
 * alternative that costs neither is relocating the mail-slug grammar out of
 * `domains/conversation` entirely, which is a move across modules this change
 * does not otherwise touch. The cycle is the deliberate choice until then.
 */
import { addressDomain, applyDisplayName, parseAddress } from '@quackback/email/ses'
import type { SendingIdentity } from '@quackback/email/sender'
import { logger } from '@/lib/server/logger'
import { db, eq, emailSendingDomains } from '@/lib/server/db'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { toAsciiDomain } from '@/lib/server/utils/mail-domain'
import {
  inboundAcceptDomains,
  inboundMintDomain,
  workspaceSlugFromInboundAddress,
} from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

const log = logger.child({
  component: 'outbound-identity',
})

const EMAIL_FROM_ENV = 'EMAIL_FROM'

type EnvLike = Record<string, string | undefined>

/** The bare addr-spec of an `addr` or `Name <addr>` value, lower-cased. */
function bareAddress(value: string): string {
  const parsed = parseAddress(value)
  return (typeof parsed === 'string' ? parsed : parsed.address).trim().toLowerCase()
}

/**
 * The one spelling every domain comparison in this module is made in.
 *
 * Re-exported rather than defined here: a workspace's stored domain, the
 * platform's configured ones and the envelope a reply arrives on are compared
 * against each other, so the normalisation cannot belong to whichever of those
 * modules happened to define it. See `@/lib/server/utils/mail-domain`.
 */
export { toAsciiDomain }

/**
 * The domains the platform itself sends and receives on.
 *
 * Read by the guard below, and by the provisioning path to refuse a workspace
 * that tries to claim one of them as its own sending domain.
 *
 * EVERY domain the front door receives on, not only the one addresses are
 * currently minted on. A domain the platform has retired from minting is still
 * a domain it answers for: every reply address issued before the change is on
 * it, so a workspace allowed to claim it would be verifying the zone another
 * workspace's mail arrives at, and would then be able to prove ownership of
 * addresses it never held.
 *
 * WHO PAYS FOR THAT, because it is not the platform. `normalizeSendingDomain`
 * refuses an overlap in BOTH directions, so listing `mail.oldbrand.example`
 * here also refuses `oldbrand.example` and every zone above it to every
 * customer, forever, with a message that does not explain itself. That is
 * accepted rather than narrowed: the both-direction rule is what stops a
 * customer who verifies a parent zone from being handed sending rights over the
 * subdomain our own reply addresses live on, and a rule with a hole in it on
 * this path is worth less than the customers it inconveniences. The cost is
 * instead bounded by what may be LISTED — a zone this platform operates, retired
 * from minting but still ours — which is stated where the list is read.
 *
 * So this refusal tightens as the list grows, and the tightening lands on
 * customers. It is not the reassurance it reads as, and an entry is not free.
 */
export function platformSendingDomains(env: EnvLike = process.env): Set<string> {
  // The accept-set arrives already in the one spelling; only the sender address,
  // which is parsed out of a display-name form here, still has to be folded.
  const domains = inboundAcceptDomains(env)
  const from = addressDomain(env[EMAIL_FROM_ENV])
  if (from) domains.add(toAsciiDomain(from))
  return domains
}

/**
 * Is `candidate` the domain itself, or a subdomain of it?
 *
 * The subtree is granted deliberately, because that is what the provider does
 * with a verified parent domain and a rule that disagreed with the provider
 * would be a rule about nothing. It is not guarded by a public-suffix list, and
 * the reason is that the grant is bounded by what can be PROVED rather than by
 * what can be typed: a row only reaches this set once a token minted for it was
 * found in the domain's zone, and publishing a TXT record in `co.uk` means
 * being the registry that operates it. A suffix list would be a second,
 * incomplete answer to a question the ownership token has already answered.
 */
export function isAtOrUnder(candidate: string, domain: string): boolean {
  return candidate === domain || candidate.endsWith(`.${domain}`)
}

/** Everything the decision depends on, gathered so the decision itself is pure. */
export interface SendingIdentityContext {
  /** The domains this workspace has verified, in whatever spelling they are stored. */
  verifiedDomains: Iterable<string>
  /** The platform's own default sender, in whatever form it is configured. */
  platformFrom: string | null
  /**
   * The shared inbound mail domain the fleet MINTS on, in whatever spelling it
   * is configured.
   *
   * Singular, and deliberately not the wider set of domains the front door
   * receives on. Receiving is a fact about mail that has already been addressed;
   * sending is a claim that the provider will accept a From, and only the
   * minting domain has a verified identity behind it. A workspace permitted to
   * send from a retired domain would pass this guard and then have the send
   * REJECTED by the provider, where refusing it here falls back to the platform
   * sender and the mail goes out.
   */
  inboundDomain: string | null
  /** This workspace's label on that shared domain. */
  mailSlug: string | null
  /** Whether this process serves more than one workspace. */
  pooled: boolean
}

/**
 * May this workspace send as this address?
 *
 * Pure and total, so the rule can be read and tested without a database, an
 * environment or a provider. Every caller that produces a From goes through it.
 */
export function isSendingIdentityPermitted(from: string, ctx: SendingIdentityContext): boolean {
  const address = bareAddress(from)
  const rawDomain = addressDomain(from)
  if (!rawDomain) return false
  const domain = toAsciiDomain(rawDomain)

  // A verified domain covers its subdomains, matching what the provider itself
  // does with a verified parent domain. Both sides of that are this workspace's
  // own zone, proved by a token published inside it.
  for (const verified of ctx.verifiedDomains) {
    if (isAtOrUnder(domain, toAsciiDomain(verified))) return true
  }

  if (ctx.platformFrom && address === bareAddress(ctx.platformFrom)) return true

  // The slug is the whole of what separates two workspaces on the shared
  // minting domain. Only that domain: widening this to every domain the fleet
  // RECEIVES on would grant a send right on a zone with no verified provider
  // identity behind it, turning a graceful fallback into a rejected send.
  const inbound = ctx.inboundDomain ? toAsciiDomain(ctx.inboundDomain) : ''
  if (inbound && domain === inbound && ctx.mailSlug) {
    const claimed = workspaceSlugFromInboundAddress(address)
    if (claimed.kind === 'slug' && claimed.slug === ctx.mailSlug.toLowerCase()) return true
  }

  // One workspace, one provider account, nobody to impersonate.
  return !ctx.pooled
}

/** Gather the context from this process and this workspace's database. */
async function sendingIdentityContext(env: EnvLike = process.env): Promise<SendingIdentityContext> {
  // Scoped by the database this runs against, and the guard above is what makes
  // that scoping load-bearing rather than incidental. The domains are handed
  // over as stored: the rule normalises every domain it compares, so doing it
  // here too would be a second spelling authority that could disagree with it.
  const verified = await db
    .select({ domain: emailSendingDomains.domain })
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.status, 'verified'))
  return {
    verifiedDomains: verified.map((r) => r.domain),
    platformFrom: getCurrentWorkspace()?.email.from ?? env[EMAIL_FROM_ENV] ?? null,
    inboundDomain: inboundMintDomain(env),
    mailSlug: currentMailSlug(),
    pooled: isPooledTenancy(env),
  }
}

/**
 * The From to actually send with: the one asked for when it is permitted, else
 * null so the caller falls back to the platform default.
 *
 * Null rather than a throw, because this sits on the path a customer's reply
 * takes. A refusal here means someone configured an address this workspace
 * cannot prove it owns, and the right answer to that is a reply that arrives
 * from an honest address plus a line saying so — not a reply that never arrives.
 */
/**
 * Wrap an already-permitted address with an RFC 5322 display name. The address
 * is unchanged; only the phrase in front of it is. The brand is preserved
 * because this is formatting, not a new identity claim.
 */
export function withSendingDisplayName(
  identity: SendingIdentity,
  displayName: string
): SendingIdentity {
  return applyDisplayName(identity, displayName) as SendingIdentity
}

export async function permittedSendingIdentity(
  from: string | null
): Promise<SendingIdentity | null> {
  if (!from) return null
  const ctx = await sendingIdentityContext()
  // The one cast to the brand, alongside its twin below. Reached only after the
  // rule above has said yes, which is the whole meaning of the type.
  if (isSendingIdentityPermitted(from, ctx)) return from as SendingIdentity
  // The domain, never the local part: the domain is the configuration that is
  // wrong and the local part beside it is a person.
  log.warn(
    { from_domain: addressDomain(from) },
    'refusing to send as a domain this workspace has not verified'
  )
  return null
}

/** Thrown when an address is configured that this workspace could not send as. */
export class SendingIdentityRefusedError extends Error {
  constructor(readonly address: string) {
    super(
      `This workspace cannot send as ${address}. Add and verify its domain under sending ` +
        `domains first.`
    )
    this.name = 'SendingIdentityRefusedError'
  }
}

/** The create-path counterpart: refuse out loud, where someone is reading. */
export async function assertSendingIdentityPermitted(from: string): Promise<SendingIdentity> {
  const ctx = await sendingIdentityContext()
  if (!isSendingIdentityPermitted(from, ctx)) throw new SendingIdentityRefusedError(from)
  return from as SendingIdentity
}
