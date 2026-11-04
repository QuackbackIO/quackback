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
import {
  createSesDomainIdentity,
  getSesDomainIdentity,
  isSesIdentityConfigured,
  putSesMailFromDomain,
} from '@quackback/email/ses-identity'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import { sesRegion } from '@quackback/email/ses'
import { resolveEmailProvider } from '@quackback/email/provider'
import type { SendingDomainId, TeamId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  and,
  db,
  eq,
  ne,
  emailSendingDomains,
  type EmailSendingDomain,
  type SendingDomainDkimMode,
  type SendingDomainProofRecord,
  type SendingDomainPreflight,
} from '@/lib/server/db'
import {
  createSendingDomain,
  deleteSendingDomain,
  getSendingDomain,
  listAllSendingDomains,
} from './channel-account.service'
import { checkSendingDomainOwnership, type ZoneReader } from './domain-verification'
import { interactiveResolver, systemResolver } from '@/lib/server/dns/resolver'
import { checkRecords } from './record-check'
import { readDmarc, runPreflight } from './preflight'
import { generateDkimKey, isKeyRecord } from './dkim-key'
import { returnPathTarget as operatorReturnPathTarget } from './return-path'
import {
  OWNERSHIP_VALUE_PREFIX,
  mintOwnershipToken,
  ownershipRecord,
  ownershipRecordsOf,
  sendingDomainDnsRecords,
  storedReturnPathTarget,
  withPreviousChecks,
} from './sending-domain-records'

export {
  OWNERSHIP_RECORD_HOST,
  OWNERSHIP_VALUE_PREFIX,
  mintOwnershipToken,
  ownershipRecordsOf,
  sendingDomainDnsRecords,
  storedReturnPathTarget,
  withPreviousChecks,
} from './sending-domain-records'
import { notifySendingDomainLive, notifySendingDomainNeedsAttention } from './sending-domain-notify'
import { enqueueSesTenantReconcile } from './ses-tenant-queue'
import { rekeyToHeldSigningKey, sealSigningKey, shouldHoldSigningKey } from './pending-signing-key'
import { MAIL_DOMAIN_RE } from '@/lib/server/utils/mail-domain'
import { isAtOrUnder, platformSendingDomains, toAsciiDomain } from './outbound-identity'

const log = logger.child({
  component: 'sending-identity',
})

/**
 * The subdomain the envelope sender moves to, for a domain added from here on.
 *
 * A custom MAIL FROM domain must be a subdomain of the verified domain and must
 * not be one that receives mail, because the provider publishes an MX there for
 * bounce handling and that MX would otherwise displace the owner's real mail
 * routing. Prefixed so it is unlikely to be a name the owner already uses;
 * pre-flight refuses the domain when it is.
 *
 * Stored on each row (`mail_from_label`) and read from there everywhere else:
 * domains verified before the label was stored keep {@link LEGACY_MAIL_FROM_LABEL},
 * and their published records must keep matching.
 */
export const MAIL_FROM_LABEL = 'qb-bounce'

/** The label domains verified before it was stored were set up with. */
export const LEGACY_MAIL_FROM_LABEL = 'bounce'

/** How long a new or restarted domain is checked automatically. */
export const AUTO_CHECK_WINDOW_MS = 72 * 60 * 60 * 1000

/** Thrown when a domain cannot be added at all, with a reason for the operator. */
export class SendingDomainRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendingDomainRefusedError'
  }
}

/** The one line a person sees when this server cannot provision a domain at all. */
export const CUSTOM_DOMAINS_UNAVAILABLE_MESSAGE =
  "Custom sending addresses aren't available on this server."

/**
 * Can this server provision a customer-owned sending domain at all?
 *
 * Three conditions, all process-wide: mail leaves through SES (a domain
 * verified with SES signs nothing sent through another provider), the separate
 * identity credential is present, and a region names where the identity lives.
 * The settings page and the server function read this same answer, so the form
 * is never offered where the action would be refused.
 */
export function customSendingDomainsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  let provider: string
  try {
    provider = resolveEmailProvider(env)
  } catch {
    // Two providers configured: boot refuses that environment, and nothing
    // here can say which one a verified domain would sign for.
    return false
  }
  return provider === 'ses' && isSesIdentityConfigured(env) && sesRegion(env) !== null
}

/** The MAIL FROM subdomain for a domain, under the label its row stores. */
export function mailFromDomainFor(domain: string, label: string): string {
  return `${label}.${domain}`
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
  // Whatever key signs (the provider's, this row's, or one the identity already
  // had), its DKIM status is required, so a signing problem always shows.
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
 * The prefix of the MAIL FROM already attached to an identity, relative to the
 * domain (`bounce`, or `mail.bounces` for a nested name); null when none is
 * attached or it is not a name under the domain.
 *
 * An identity on the shared account may already carry a MAIL FROM from an
 * earlier setup of the same domain. A new row adopts that prefix, so its records
 * match what the identity already uses and nothing has to be re-pointed.
 */
export function attachedMailFromLabel(
  identity: SesDomainIdentity | null,
  domain: string
): string | null {
  const attached = identity?.mailFrom?.domain?.trim().toLowerCase().replace(/\.$/, '')
  // A valid name under the domain has a prefix of valid DNS labels.
  if (!attached?.endsWith(`.${domain}`) || !MAIL_DOMAIN_RE.test(attached)) return null
  return attached.slice(0, -(domain.length + 1))
}

/**
 * The pre-flight for a new domain, and the return path it is set up with: one
 * CNAME when the operator serves bounce records under a domain of its own,
 * otherwise an MX and SPF TXT.
 *
 * Our MX and SPF cannot sit beside a CNAME, another MX or another SPF record at
 * the same name, and a return path CNAME cannot sit beside anything. An adopted
 * label whose earlier setup left its MX and TXT in place keeps them, rather
 * than being refused for records that already work.
 */
async function preflightReturnPath(
  domain: string,
  mailFromLabel: string,
  adopted: boolean,
  region: string
): Promise<{ preflight: SendingDomainPreflight; returnPathTarget: string | null }> {
  const target = operatorReturnPathTarget()
  const preflight = await runPreflight(
    domain,
    mailFromLabel,
    region,
    systemResolver,
    new Date(),
    target
  )
  if (!target || !adopted || preflight.mailFromFree !== false) {
    return { preflight, returnPathTarget: target }
  }
  return {
    preflight: await runPreflight(domain, mailFromLabel, region, systemResolver),
    returnPathTarget: null,
  }
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
 * A failed create then releases the slot by deleting the row, which is why
 * the create is wrapped rather than awaited bare. Only the create: once the
 * identity exists, the row holds the only copy of the key it signs with.
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
  // A label already in use on the identity wins over ours: re-pointing the
  // identity would reset the MAIL FROM an existing setup verified with.
  const adopted = attachedMailFromLabel(await getSesDomainIdentity(domain), domain)
  const mailFromLabel = adopted ?? MAIL_FROM_LABEL
  const { preflight, returnPathTarget } = await preflightReturnPath(
    domain,
    mailFromLabel,
    adopted !== null,
    region
  )
  if (preflight.mailFromFree === false) {
    throw new SendingDomainRefusedError(
      `${mailFromDomainFor(domain, mailFromLabel)} already has records that would conflict, ` +
        `so it can't be used for bounces. Remove them and try again.`
    )
  }

  // A key of the row's own: its public half is the one signing record the
  // owner publishes, and proves ownership too. The private half goes to the
  // provider in the create call below and is not kept, except encrypted on a
  // row that joins an identity signing with a key nobody can publish (see
  // `pending-signing-key.ts`).
  const key = generateDkimKey()

  // The slot, taken before anything account-wide is consumed. Carries the key
  // record already, so a row can never exist without the one record that makes
  // it provable.
  const row = await createSendingDomain({
    owningTeamId: input.owningTeamId,
    domain,
    dnsRecords: [key.record],
    dkimMode: 'byo',
  })

  let created: SesIdentityCreation
  try {
    // An identity that already exists (another workspace's, or a re-add) keeps
    // its key for now: this row's record proves this workspace's ownership.
    created = await createSesDomainIdentity(domain, undefined, {
      selector: key.selector,
      privateKey: key.privateKey,
    })
  } catch (err) {
    // Release the slot. A row whose provider identity was never created promises
    // records that will never verify and holds a seat against the plan's cap.
    await deleteSendingDomain(row.id)
    throw err
  }
  const preexisting = created.preexisting

  // From here the identity exists, and one this call created signs with this
  // row's key, whose public half lives nowhere else. A failed follow-up keeps
  // the row: the check attaches a missing MAIL FROM once ownership is proved,
  // and re-reads the identity every time.
  let identity: SesDomainIdentity = created.identity
  try {
    if (!preexisting) {
      await putSesMailFromDomain(domain, mailFromDomainFor(domain, mailFromLabel))
    }
    // Re-read so the stored MAIL FROM state is the provider's, not our assumption
    // of what the call we just made implies.
    identity = (await getSesDomainIdentity(domain)) ?? created.identity
  } catch (err) {
    log.warn(
      { err, domain, sending_domain_id: row.id },
      'sending domain identity created, but finishing its setup failed; the next check retries'
    )
  }

  // An identity that was already there keeps signing with its own key; this
  // row's key then proves ownership only. When that key is one nobody can
  // publish, the row holds its own until ownership is proved and the identity
  // is re-keyed to it.
  const dkimMode: SendingDomainDkimMode = preexisting ? 'shared' : 'byo'
  const pendingSigningKey = shouldHoldSigningKey(created) ? sealSigningKey(key.privateKey) : null

  // Records and setup only: the status and the verified stamp are the poll's
  // to move.
  const [updated] = await db
    .update(emailSendingDomains)
    .set({
      mailFromLabel,
      dkimMode,
      pendingSigningKey,
      autoCheckUntil: new Date(Date.now() + AUTO_CHECK_WINDOW_MS),
      preflight,
      dnsRecords: sendingDomainDnsRecords({
        domain,
        region,
        identity,
        mailFromLabel,
        signingKeys: [key.record],
        dkimMode,
        returnPathTarget,
      }),
      updatedAt: new Date(),
    })
    .where(eq(emailSendingDomains.id, row.id))
    .returning()

  log.info(
    { domain, sending_domain_id: row.id, dkim_status: identity.dkimStatus },
    'sending domain provisioned'
  )
  // Associates the new identity with the workspace's provider tenant early, so
  // the domain can send under it the moment it verifies.
  await enqueueSesTenantReconcile('sending-domain-added')
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
  const stored = await getSendingDomain(id)
  if (!stored) return null
  const region = requireRegion()

  // A row signed with its own key proves ownership with that key, which cannot
  // be re-minted (the provider holds the private half). A row on the provider's own
  // keys proves it with its `_quackback` token.
  const byo = stored.dkimMode !== 'easy'
  const signingKeys = byo ? (stored.dnsRecords ?? []).filter(isKeyRecord) : undefined
  const existing = ownershipRecordsOf(stored.dnsRecords ?? [])
  const ownershipToken = byo
    ? undefined
    : existing[0]?.value.slice(OWNERSHIP_VALUE_PREFIX.length) || mintOwnershipToken()
  // Only ever this row's own proof records. Anything else in the set is a value
  // published from our instructions and therefore identical for every
  // workspace, which is the definition of a record that proves nothing.
  const proofRecords: SendingDomainProofRecord[] = signingKeys
    ? signingKeys
    : existing.length > 0
      ? existing
      : [ownershipRecord(ownershipToken ?? '')]

  // A verified row is read with two tries, so one dropped packet does not cost
  // a live domain its status; a pending row has nothing to lose and keeps the
  // single bounded try.
  const wasVerified = stored.status === 'verified'
  const resolver = wasVerified ? interactiveResolver : systemResolver
  const readZone: ZoneReader = (host) => resolver.resolveTxt(host)
  const [found, ownership] = await Promise.all([
    getSesDomainIdentity(stored.domain),
    checkSendingDomainOwnership(stored.domain, proofRecords, readZone),
  ])
  // Proven only on a read that found the proof: the owner-only writes below
  // need it. A verified row whose lookup went unanswered keeps the proof it
  // already has for its status, so only the zone saying the record is gone, or
  // the provider changing its answer, can demote it.
  const ownershipProven = ownership === 'proven'
  const ownershipKept = wasVerified && ownership === 'unknown'
  if (ownershipKept) {
    log.warn(
      { sending_domain_id: id, domain: stored.domain },
      'sending domain ownership lookup went unanswered; keeping its verified status until the next check'
    )
  }

  let identity = found
  // A row holding its own key re-keys the identity once, after it proves
  // ownership; until then the identity's key is not one anybody can publish.
  const rekey = await rekeyToHeldSigningKey(stored, identity, ownershipProven)
  const row = rekey.row
  if (rekey.rekeyed) identity = (await getSesDomainIdentity(row.domain)) ?? identity
  // The owner-only write, performed once there is an owner and only onto an
  // identity with no MAIL FROM at all. Provisioning skips it for an identity
  // that already existed, so it cannot land on another workspace's; and an
  // identity that already has one, under any label, is never re-pointed,
  // because that would reset the setup that attached it.
  if (ownershipProven && identity && !identity.mailFrom?.domain) {
    await putSesMailFromDomain(row.domain, mailFromDomainFor(row.domain, row.mailFromLabel))
    identity = (await getSesDomainIdentity(row.domain)) ?? identity
  }

  // A row still holding its key is waiting to replace the identity's key, so
  // that key failing is not this row's verdict.
  const verdict = sendingDomainStatusFrom({
    identity,
    ownershipProven: ownershipProven || ownershipKept,
  })
  const status = verdict === 'failed' && row.pendingSigningKey ? 'pending' : verdict

  const now = new Date()
  // Each record's own state, for the person publishing them. Recorded beside
  // the status and never feeding it: the provider's scan is what decides.
  const composed = withPreviousChecks(
    sendingDomainDnsRecords({
      domain: row.domain,
      region,
      ownershipToken,
      identity,
      mailFromLabel: row.mailFromLabel,
      signingKeys,
      dkimMode: row.dkimMode,
      returnPathTarget: storedReturnPathTarget(row.dnsRecords ?? []),
    }),
    row.dnsRecords ?? []
  )
  // DMARC is read on every check because it is one lookup and the owner may
  // add one while setting up; a failed read keeps what was there.
  const [dnsRecords, dmarc] = await Promise.all([
    checkRecords(row.domain, composed, resolver, now),
    readDmarc(row.domain, resolver),
  ])
  // Every field but the move to verified, which is made below on its own.
  const promoted = status === 'verified'
  const [written] = await db
    .update(emailSendingDomains)
    .set({
      ...(promoted ? {} : { status }),
      dnsRecords,
      ...(dmarc ? { preflight: { ...row.preflight, dmarc } } : {}),
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(emailSendingDomains.id, id))
    .returning()
  let updated = written

  // The one place a domain goes live, whether the watch job, the daily sweep or
  // a person's click got it there. Conditional, so when two checks find it
  // live at once only the one whose update moved it rings the bell. The
  // verified stamp is set once: a domain that regressed and recovered keeps the
  // date it first became trustworthy.
  if (written && promoted) {
    const [won] = await db
      .update(emailSendingDomains)
      .set({ status: 'verified', ...(row.verifiedAt ? {} : { verifiedAt: now }), updatedAt: now })
      .where(and(eq(emailSendingDomains.id, id), ne(emailSendingDomains.status, 'verified')))
      .returning()
    if (won) {
      updated = won
      await notifySendingDomainLive(won)
      await enqueueSesTenantReconcile('sending-domain-verified')
    } else {
      updated = (await getSendingDomain(id)) ?? written
    }
  }

  log.info(
    {
      sending_domain_id: id,
      domain: row.domain,
      status,
      ownership,
      dkim_status: identity?.dkimStatus ?? null,
      mail_from_status: identity?.mailFrom?.status ?? null,
    },
    'sending domain checked'
  )
  return updated ?? null
}

/**
 * Open a fresh automatic check window on a domain and check it now: the
 * "Verify" action, for a domain whose window ran out before its records
 * were published.
 */
export async function restartSendingDomainChecks(
  id: SendingDomainId
): Promise<EmailSendingDomain | null> {
  const [row] = await db
    .update(emailSendingDomains)
    .set({ autoCheckUntil: new Date(Date.now() + AUTO_CHECK_WINDOW_MS), updatedAt: new Date() })
    .where(eq(emailSendingDomains.id, id))
    .returning({ id: emailSendingDomains.id })
  if (!row) return null
  return refreshSendingDomain(id)
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
        await notifySendingDomainNeedsAttention(updated)
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
