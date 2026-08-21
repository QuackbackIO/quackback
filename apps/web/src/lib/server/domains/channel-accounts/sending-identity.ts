/**
 * Customer-owned sending domains: provisioning one, and deciding when it counts
 * as verified.
 *
 * A workspace that sends as `support@theircompany.com` needs an identity the
 * mail provider will sign for. The provider verifies a domain from records its
 * owner publishes rather than from a zone the provider hosts, so the whole flow
 * is: create the identity, read back the records the owner has to publish, show
 * them, and poll until they resolve.
 *
 * ## Two authorities, and why there have to be two
 *
 * Every workspace on a fleet shares one provider account. The provider will
 * therefore report a domain verified to any workspace that asks about it, and
 * will sign mail for that domain sent by any of them — it has no notion of which
 * workspace the domain belongs to, because from its side the domain belongs to
 * the account. If a domain were marked verified on the provider's answer alone,
 * a second workspace could add a domain the first one owns, be told it is
 * already verified, and start sending as it.
 *
 * So verification here needs both:
 *
 * - **The provider** decides whether it can SIGN: DKIM found, custom MAIL FROM
 *   found. Only it knows that, and its scans are the thing a send is checked
 *   against.
 * - **We** decide whether this WORKSPACE owns the domain, from a record whose
 *   value is minted per row and stored nowhere else. A second workspace adding
 *   the same domain gets a different token and cannot publish it, because
 *   publishing it means writing in a zone it does not control.
 *
 * Neither answer is sufficient and the missing one is not the obvious one, which
 * is why the split is stated here rather than left to the shape of a query.
 *
 * ## Where the provider calls run
 *
 * In this tier, with a credential that is not the sending credential and that
 * carries no delete. See `@quackback/email/ses-identity` for what that
 * credential needs and why deletion is excluded from it.
 */
import { randomBytes } from 'node:crypto'
import {
  createSesDomainIdentity,
  getSesDomainIdentity,
  isSesIdentityConfigured,
  putSesMailFromDomain,
  sesDkimCnameTarget,
  sesMailFromMxValue,
  SES_MAIL_FROM_MX_PRIORITY,
  SES_MAIL_FROM_SPF_VALUE,
} from '@quackback/email/ses-identity'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import { sesRegion } from '@quackback/email/ses'
import type { SendingDomainId, TeamId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  db,
  eq,
  emailSendingDomains,
  type EmailSendingDomain,
  type SendingDomainDnsRecord,
  type SendingDomainOwnershipRecord,
} from '@/lib/server/db'
import {
  createSendingDomain,
  deleteSendingDomain,
  getSendingDomain,
  listAllSendingDomains,
} from './channel-account.service'
import { verifySendingDomainDns } from './domain-verification'
import { MAIL_DOMAIN_RE } from '@/lib/server/utils/mail-domain'
import { isAtOrUnder, platformSendingDomains, toAsciiDomain } from './outbound-identity'

const log = logger.child({
  component: 'sending-identity',
})

/**
 * The label the ownership token is published under.
 *
 * Underscore-prefixed, because that is the convention for a record meant for a
 * machine rather than a host, and it keeps the name out of the space a domain
 * owner might already be using for something real.
 */
export const OWNERSHIP_RECORD_HOST = '_quackback'

/** The prefix on the ownership TXT value, so a zone's owner can see what it is for. */
export const OWNERSHIP_VALUE_PREFIX = 'quackback-domain-verification='

/**
 * The subdomain the envelope sender moves to.
 *
 * A custom MAIL FROM domain must be a subdomain of the verified domain and must
 * not be one that receives mail, because the provider publishes an MX there for
 * bounce handling and that MX would otherwise displace the owner's real mail
 * routing. `bounce` says what it is for.
 */
export const MAIL_FROM_LABEL = 'bounce'

/** Thrown when a domain cannot be added at all, with a reason for the operator. */
export class SendingDomainRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendingDomainRefusedError'
  }
}

/** The MAIL FROM subdomain for a verified domain. */
export function mailFromDomainFor(domain: string): string {
  return `${MAIL_FROM_LABEL}.${domain}`
}

/** A fresh ownership token: unguessable, and unique to one row. */
export function mintOwnershipToken(): string {
  return randomBytes(16).toString('hex')
}

/** The ownership record for a token. */
function ownershipRecord(token: string): SendingDomainOwnershipRecord {
  return {
    type: 'TXT',
    host: OWNERSHIP_RECORD_HOST,
    value: `${OWNERSHIP_VALUE_PREFIX}${token}`,
    purpose: 'ownership',
  }
}

/**
 * The USABLE ownership records among a stored set.
 *
 * A record is usable only if it is a TXT under the ownership purpose AND its
 * value carries the prefix a token is issued under. The prefix test is not
 * decoration: the token is read back by removing that prefix, and a value
 * without it yields a slice of somebody else's string — a token that was never
 * issued, that the owner cannot publish, and that would keep the row pending
 * forever while looking like it was being checked. Discarding the record
 * instead makes the row re-issue a real one on the next poll.
 */
export function ownershipRecordsOf(
  records: SendingDomainDnsRecord[]
): SendingDomainOwnershipRecord[] {
  return records.filter(
    (r): r is SendingDomainOwnershipRecord =>
      r.purpose === 'ownership' && r.type === 'TXT' && r.value.startsWith(OWNERSHIP_VALUE_PREFIX)
  )
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
        `${domain} cannot be added: it is part of the platform's own mail domain.`
      )
    }
  }
  return domain
}

/**
 * The records a domain owner has to publish, composed from what the provider
 * reported plus the ownership token this row was minted with.
 *
 * The DKIM records come out empty while the provider is still issuing tokens,
 * which is a real state on a freshly created identity. The row is written with
 * whatever exists and the poll fills the rest in, rather than failing a create
 * over a value that arrives a moment later.
 */
export function sendingDomainDnsRecords(args: {
  domain: string
  region: string
  ownershipToken: string
  identity: SesDomainIdentity | null
}): SendingDomainDnsRecord[] {
  const records: SendingDomainDnsRecord[] = [ownershipRecord(args.ownershipToken)]
  for (const token of args.identity?.dkimTokens ?? []) {
    records.push({
      type: 'CNAME',
      host: `${token}._domainkey`,
      value: sesDkimCnameTarget(token, {
        region: args.region,
        signingHostedZone: args.identity?.signingHostedZone,
      }),
      purpose: 'dkim',
    })
  }
  records.push(
    {
      type: 'MX',
      host: MAIL_FROM_LABEL,
      value: sesMailFromMxValue(args.region),
      priority: SES_MAIL_FROM_MX_PRIORITY,
      purpose: 'mail-from',
    },
    {
      type: 'TXT',
      host: MAIL_FROM_LABEL,
      value: SES_MAIL_FROM_SPF_VALUE,
      purpose: 'mail-from',
    }
  )
  return records
}

/**
 * What a domain's status should be, given both authorities.
 *
 * Verified means every one of: this workspace proved it owns the zone, the
 * provider will sign for the domain, and the custom MAIL FROM is in place. The
 * last of those is required rather than treated as a bonus, because a domain
 * verified without it has no aligned SPF and rests on DKIM alone — which is the
 * arrangement that fails as soon as a message is forwarded and rewritten.
 *
 * Failed is reserved for the provider's own terminal verdict. Records that have
 * not appeared yet are pending however long they take, because the person who
 * has to publish them is not the person clicking the button.
 */
export function sendingDomainStatusFrom(args: {
  identity: SesDomainIdentity | null
  ownershipProven: boolean
}): 'pending' | 'verified' | 'failed' {
  const { identity, ownershipProven } = args
  if (identity?.dkimStatus === 'FAILED') return 'failed'
  if (!ownershipProven || !identity) return 'pending'
  const signable = identity.dkimStatus === 'SUCCESS' && identity.verifiedForSending
  const mailFromReady = identity.mailFrom?.status === 'SUCCESS'
  return signable && mailFromReady ? 'verified' : 'pending'
}

/** The region every identity call and every composed record is built against. */
function requireRegion(): string {
  const region = sesRegion()
  if (!region) {
    throw new SendingDomainRefusedError(
      'EMAIL_SES_REGION is not set, so there is no region to verify a sending domain in.'
    )
  }
  return region
}

/**
 * Whether the identity's MAIL FROM is already the subdomain this domain needs.
 *
 * Attaching one is a write only the domain's owner may perform, and the
 * provider's account is shared, so the question "is it already right" is what
 * separates a legitimate attach from an attack that resets somebody else's.
 */
function mailFromAlreadyAttached(identity: SesDomainIdentity | null, domain: string): boolean {
  const attached = identity?.mailFrom?.domain?.trim().toLowerCase()
  return attached === mailFromDomainFor(domain)
}

/**
 * Create the provider identity for a customer's domain and record what they have
 * to publish.
 *
 * ## The row is written FIRST, and that ordering is the quota
 *
 * The identity quota is account-wide: the create that must not happen is the one
 * that consumes a slot every other workspace on the fleet depends on. A limit
 * that reads a count, compares it and only then makes the provider call leaves a
 * window in which every concurrent caller reads the same count and every one of
 * them passes — the check is honest and the resource is still overspent. So the
 * row is inserted under a lock that serialises the count against it (see
 * `createSendingDomain`), and the provider call happens after the slot is held.
 * A provider failure then releases the slot by deleting the row, which is why
 * the create is wrapped rather than awaited bare.
 *
 * ## The MAIL FROM attach is not unconditional
 *
 * `AlreadyExistsException` means the identity was there before this call, which
 * on a shared account includes the case where ANOTHER workspace created and
 * verified it. Attaching a MAIL FROM to that identity is a write on their
 * identity that resets its MAIL FROM state to pending, and their sending then
 * degrades until the provider re-scans — an outage one form submission long.
 * So the attach happens here only for an identity this call actually created,
 * and otherwise waits until ownership has been proved, in `refreshSendingDomain`.
 * The records the owner has to publish are the same either way, so nothing is
 * hidden from them by waiting.
 */
export async function provisionSendingDomain(input: {
  owningTeamId: TeamId
  domain: string
}): Promise<EmailSendingDomain> {
  const region = requireRegion()
  const domain = normalizeSendingDomain(input.domain)
  const ownershipToken = mintOwnershipToken()

  // The slot, taken before anything account-wide is consumed. Carries the
  // ownership record already, so a row can never exist without the one record
  // that makes it provable.
  const row = await createSendingDomain({
    owningTeamId: input.owningTeamId,
    domain,
    dnsRecords: [ownershipRecord(ownershipToken)],
  })

  let identity: SesDomainIdentity
  try {
    const created = await createSesDomainIdentity(domain)
    if (!created.preexisting) {
      await putSesMailFromDomain(domain, mailFromDomainFor(domain))
    }
    // Re-read so the stored MAIL FROM state is the provider's, not our assumption
    // of what the call we just made implies.
    identity = (await getSesDomainIdentity(domain)) ?? created.identity
  } catch (err) {
    // Release the slot. A row whose provider identity was never created promises
    // records that will never verify and holds a seat against the plan's cap.
    await deleteSendingDomain(row.id)
    throw err
  }

  // Records only: the status and the verified stamp are the poll's to move.
  const [updated] = await db
    .update(emailSendingDomains)
    .set({
      dnsRecords: sendingDomainDnsRecords({ domain, region, ownershipToken, identity }),
      updatedAt: new Date(),
    })
    .where(eq(emailSendingDomains.id, row.id))
    .returning()

  log.info(
    { domain, sending_domain_id: row.id, dkim_status: identity.dkimStatus },
    'sending domain provisioned'
  )
  return updated ?? row
}

/**
 * Re-ask both authorities and write the answer back.
 *
 * Records are recomposed on every poll rather than only on create, because the
 * provider issues DKIM tokens asynchronously and a row created a second too
 * early would otherwise carry an incomplete instruction list forever. The
 * ownership token is carried across, never re-minted: rotating it would silently
 * invalidate a record the owner has already published.
 */
export async function refreshSendingDomain(
  id: SendingDomainId
): Promise<EmailSendingDomain | null> {
  const row = await getSendingDomain(id)
  if (!row) return null
  const region = requireRegion()

  const existing = ownershipRecordsOf(row.dnsRecords ?? [])
  const ownershipToken =
    existing[0]?.value.slice(OWNERSHIP_VALUE_PREFIX.length) || mintOwnershipToken()
  // Only ever this row's own ownership records. Anything else in the set is a
  // value published from our instructions and therefore identical for every
  // workspace, which is the definition of a record that proves nothing.
  const proofRecords = existing.length > 0 ? existing : [ownershipRecord(ownershipToken)]

  const [found, ownershipProven] = await Promise.all([
    getSesDomainIdentity(row.domain),
    verifySendingDomainDns(row.domain, proofRecords),
  ])

  let identity = found
  // The owner-only write, performed once there is an owner. Provisioning skips
  // it for an identity that already existed, precisely so it cannot land on
  // another workspace's; here the ownership token has just been found in this
  // domain's zone, so the workspace asking is the one entitled to ask.
  if (ownershipProven && identity && !mailFromAlreadyAttached(identity, row.domain)) {
    await putSesMailFromDomain(row.domain, mailFromDomainFor(row.domain))
    identity = (await getSesDomainIdentity(row.domain)) ?? identity
  }

  const status = sendingDomainStatusFrom({ identity, ownershipProven })

  const now = new Date()
  const [updated] = await db
    .update(emailSendingDomains)
    .set({
      status,
      dnsRecords: sendingDomainDnsRecords({ domain: row.domain, region, ownershipToken, identity }),
      lastCheckedAt: now,
      // Stamped once, on the transition. A domain that was verified and then
      // regressed keeps the date it first became trustworthy, which is the
      // question that date is ever asked.
      ...(status === 'verified' && !row.verifiedAt ? { verifiedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(emailSendingDomains.id, id))
    .returning()

  log.info(
    {
      sending_domain_id: id,
      domain: row.domain,
      status,
      ownership_proven: ownershipProven,
      dkim_status: identity?.dkimStatus ?? null,
      mail_from_status: identity?.mailFrom?.status ?? null,
    },
    'sending domain checked'
  )
  return updated ?? null
}

/**
 * Re-ask both authorities about every sending domain this workspace holds.
 *
 * ## Why a schedule and not a button
 *
 * Verification is a statement about the present tense that a button can only
 * make about the past. Three things can stop being true after a row is marked
 * verified, and none of them announces itself:
 *
 * - the ownership TXT is deleted, so the workspace no longer demonstrably
 *   controls the zone it is sending as;
 * - the MAIL FROM MX is removed or moved, so the envelope sender falls back to
 *   the provider's own domain and SPF stops aligning, leaving DMARC resting on
 *   DKIM alone — the arrangement that fails as soon as a message is forwarded;
 * - the provider stops signing, so mail leaves unsigned as a domain whose DMARC
 *   policy tells receivers to reject exactly that.
 *
 * Each demotes the row here, and a row that is not verified is not an identity
 * the send guard will hand out, so the workspace drops back to the platform
 * sender. That is a visible, honest degradation instead of three silent ones,
 * and it is the reason the provider's MAIL FROM failure behaviour can be the
 * lenient one.
 *
 * ## Why it does nothing when identity provisioning is not configured
 *
 * A self-hosted install with no provisioning credential has no way to ask the
 * provider anything, and its rows were never created through this path. Asking
 * would produce a configuration error per row per day and change no answer.
 */
export async function sweepSendingDomains(): Promise<{ checked: number; demoted: number }> {
  if (!isSesIdentityConfigured() || !sesRegion()) return { checked: 0, demoted: 0 }

  const rows = await listAllSendingDomains()
  let checked = 0
  let demoted = 0
  for (const row of rows) {
    try {
      const updated = await refreshSendingDomain(row.id)
      checked += 1
      if (row.status === 'verified' && updated && updated.status !== 'verified') {
        demoted += 1
        // Named at warn because it is a live deliverability change for a
        // customer: replies for this domain go out as the platform sender from
        // now on. The domain is configuration, not a person.
        log.warn(
          { sending_domain_id: row.id, domain: row.domain, status: updated.status },
          'sending domain is no longer verified; falling back to the platform sender'
        )
      }
    } catch (err) {
      // One domain's provider or DNS failure must not stop the rest being
      // checked: the whole value of the sweep is that it runs on every row.
      log.warn(
        { err, sending_domain_id: row.id, domain: row.domain },
        'sending domain check failed'
      )
    }
  }
  return { checked, demoted }
}
