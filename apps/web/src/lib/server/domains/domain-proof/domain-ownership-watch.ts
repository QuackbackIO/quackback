/**
 * The daily check that a verified domain added by name still holds its
 * ownership record.
 *
 * A verified domain proves its name and the names under it for every use in
 * the workspace (see `proven-zones.ts`), so its record has to stay published.
 * It is judged the way a sending domain is (`ownership-grace.ts`): the first
 * check that finds the record gone starts a grace period and warns the people
 * who manage the workspace's domains, the domain keeps its proof for the
 * period, and it is demoted only if the record is still gone when the period
 * ends. An unanswered lookup is not evidence either way and changes nothing.
 *
 * Demotion also takes verification off the sign-in domains that rested on this
 * proof alone (`sso-domain-lapse.ts`), in the same transaction. One whose own
 * lookup went unanswered is judged again on later runs; it never holds the
 * demotion back. A sign-in domain that holds its own `_quackback-verify`
 * record, or that another proof still covers, keeps it.
 *
 * Everything is read from this workspace's own database: nothing proven in
 * another workspace is ever looked at.
 */
import {
  and,
  db,
  domains,
  emailSendingDomains,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  ssoVerifiedDomain,
  type Domain,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import { logger } from '@/lib/server/logger'
import { kvDel, kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { lookupVerificationTxt } from '@/lib/server/auth/dns-verify'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import {
  OWNERSHIP_RECORD_HOST,
  ownershipRecord,
} from '@/lib/server/domains/channel-accounts/sending-domain-records'
import type { OwnershipAnswer } from '@/lib/server/domains/channel-accounts/domain-verification'
import {
  OWNERSHIP_WARNING_LEASE_MS,
  ownershipGrace,
  ownershipGraceEnds,
} from '@/lib/server/domains/channel-accounts/ownership-grace'
import { domainOwnershipValue } from './domains.service'
import { signInDomainsLosingProof, type LapsingSignInDomain } from './sso-domain-lapse'
import {
  notifyDomainOwnershipLapsed,
  notifyDomainOwnershipMissing,
} from './domain-ownership-notify'

const log = logger.child({ component: 'domain-ownership-watch' })

/**
 * How long one run may spend before it leaves the rest for the next. Domains
 * least recently checked go first, so the ones left over lead the next run.
 */
export const DOMAIN_WATCH_BUDGET_MS = 20_000

/** What the zone says about a domain's own record now. */
export async function readDomainOwnership(row: Domain): Promise<OwnershipAnswer> {
  // A verified domain has something to lose, so the lookup gets two tries.
  const result = await lookupVerificationTxt(
    `${OWNERSHIP_RECORD_HOST}.${row.name}`,
    interactiveResolver
  )
  if (result.ok) {
    return result.values.includes(domainOwnershipValue(row.ownershipToken)) ? 'proven' : 'absent'
  }
  return result.reason === 'no-record' ? 'absent' : 'unknown'
}

/** Start a domain's grace period, once, however many checks see the first miss. */
async function startGrace(row: Domain, since: Date): Promise<Domain | null> {
  const [started] = await db
    .update(domains)
    .set({
      ownershipMissingSince: since,
      ownershipWarningClaimedAt: null,
      ownershipWarningSentAt: null,
    })
    .where(and(eq(domains.id, row.id), isNull(domains.ownershipMissingSince)))
    .returning()
  if (started) {
    log.warn(
      { domain: row.name },
      'domain ownership record is missing; keeping it verified for the grace period'
    )
  }
  return started ?? null
}

/** A warning claim given back after a failed delivery: retaken at once, and never rings again. */
const releasedClaim = (): Date => new Date(0)

/**
 * Warn about the missing record unless that was already delivered for this
 * period: a lease first, so one check sends, confirmed on delivery and given
 * back on failure so the next check tries again. A lease nobody confirmed
 * expires. The same shape as a sending domain's warning, except that the bell
 * rings only on the first claim of a period: a claim given back keeps a mark
 * (never null again until the period ends), so a retry only emails.
 */
async function deliverWarning(row: Domain): Promise<void> {
  const since = row.ownershipMissingSince
  if (row.status !== 'verified' || !since || row.ownershipWarningSentAt) return
  const claimedAt = new Date()
  const claimable = and(
    eq(domains.id, row.id),
    eq(domains.status, 'verified'),
    eq(domains.ownershipMissingSince, since),
    isNull(domains.ownershipWarningSentAt)
  )
  const claim = (free: SQL | undefined) =>
    db
      .update(domains)
      .set({ ownershipWarningClaimedAt: claimedAt })
      .where(and(claimable, free))
      .returning()
  // The first claim of the period rings the bell; any later one (after a
  // failed delivery, or a lease that expired) only emails.
  const [first] = await claim(isNull(domains.ownershipWarningClaimedAt))
  const [retry] = first
    ? [undefined]
    : await claim(
        lt(
          domains.ownershipWarningClaimedAt,
          new Date(claimedAt.getTime() - OWNERSHIP_WARNING_LEASE_MS)
        )
      )
  const claimed = first ?? retry
  if (!claimed) return
  const delivered = await notifyDomainOwnershipMissing(claimed, ownershipGraceEnds(since), {
    ring: !!first,
  })
  const ours = and(eq(domains.id, row.id), eq(domains.ownershipWarningClaimedAt, claimedAt))
  await db
    .update(domains)
    .set(
      delivered
        ? { ownershipWarningSentAt: new Date() }
        : { ownershipWarningClaimedAt: releasedClaim() }
    )
    .where(ours)
  if (!delivered) {
    log.warn({ domain: row.name }, 'domain ownership warning was not delivered; next check retries')
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Take verification off the sign-in domains judged to have lost their proof,
 * each only as it was judged: one whose token was rotated since is left.
 */
async function unverifySignIn(
  tx: Tx,
  losing: readonly LapsingSignInDomain[]
): Promise<LapsingSignInDomain[]> {
  const unverified: LapsingSignInDomain[] = []
  for (const sso of losing) {
    const [cleared] = await tx
      .update(ssoVerifiedDomain)
      .set({ verifiedAt: null })
      .where(
        and(
          eq(ssoVerifiedDomain.id, sso.id),
          eq(ssoVerifiedDomain.verificationToken, sso.verificationToken),
          sql`${ssoVerifiedDomain.verifiedAt} IS NOT NULL`
        )
      )
      .returning({ id: ssoVerifiedDomain.id })
    if (cleared) unverified.push(sso)
  }
  if (unverified.length > 0) {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    await bumpAuthConfigVersionInTx(tx)
  }
  return unverified
}

/** After sign-in changed: every pod rebuilds sign-in on its next request. */
async function signInChanged(): Promise<void> {
  const { resetAuth } = await import('@/lib/server/auth')
  const { invalidateSettingsCache } = await import('@/lib/server/domains/settings/settings.helpers')
  resetAuth()
  await invalidateSettingsCache()
}

function logUndecided(row: Domain, undecided: readonly string[]): void {
  if (undecided.length === 0) return
  log.warn(
    { domain: row.name, sign_in_domains: undecided },
    'a sign-in domain under a lapsed domain could not be checked; judging it again next run'
  )
}

/**
 * Demote a domain whose record stayed missing past its grace period, and take
 * verification off the sign-in domains that rested on it alone, in one
 * transaction. Conditional on the period still being the one judged, so a
 * record found again meanwhile (a person's check) cancels it.
 *
 * Always demotes once the period is over: a sign-in domain whose own lookup
 * went unanswered is left for a later run to judge
 * ({@link rejudgeLapsedDomains}), never a reason to keep the lapsed proof. A
 * sending row issued this domain's token rests on the same record, so its own
 * grace period is started too, if it had not started. It starts now, at the
 * demotion, so the sending domain gets its own warning and its own period
 * rather than one that ran out with the domain's.
 */
async function demote(row: Domain, since: Date, now: Date): Promise<void> {
  const { losing, undecided } = await signInDomainsLosingProof(row)
  const result = await db.transaction(async (tx) => {
    const [moved] = await tx
      .update(domains)
      .set({
        status: 'pending',
        ownershipMissingSince: null,
        ownershipWarningClaimedAt: null,
        ownershipWarningSentAt: null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(domains.id, row.id),
          eq(domains.status, 'verified'),
          eq(domains.ownershipMissingSince, since)
        )
      )
      .returning({ id: domains.id })
    if (!moved) return null
    const shared = ownershipRecord(row.ownershipToken)
    await tx
      .update(emailSendingDomains)
      .set({
        ownershipMissingSince: now,
        ownershipWarningClaimedAt: null,
        ownershipWarningSentAt: null,
      })
      .where(
        and(
          eq(emailSendingDomains.status, 'verified'),
          isNull(emailSendingDomains.ownershipMissingSince),
          sql`${emailSendingDomains.dnsRecords} @> ${JSON.stringify([{ purpose: shared.purpose, value: shared.value }])}::jsonb`
        )
      )
    // A sign-in domain left undecided is judged again on later runs.
    if (undecided.length > 0) await markForRejudging(tx, [row.id])
    return unverifySignIn(tx, losing)
  })
  if (!result) return

  log.warn(
    { domain: row.name, sign_in_domains: result.map((s) => s.name) },
    'domain ownership record stayed missing past the grace period; it is no longer verified'
  )
  logUndecided(row, undecided)
  if (result.length > 0) await signInChanged()
  await notifyDomainOwnershipLapsed(
    row,
    result.map((s) => s.name)
  )
}

/**
 * The lapsed domains with a sign-in domain under them still to be judged: one
 * whose own lookup went unanswered when the domain was demoted, or on a later
 * run. Kept beside the workspace's other durable markers, written in the same
 * transaction as the demotion, and emptied as each domain's sign-in domains
 * are all decided, so a domain is judged again only while something under it
 * is left to judge.
 */
const REJUDGE_KEY = 'domain-ownership-watch:rejudge'
/** `kv_store` rows always expire; this one is rewritten on every run that judges. */
const REJUDGE_TTL_SECONDS = 10 * 365 * 24 * 60 * 60

async function markForRejudging(tx: Tx, ids: readonly string[]): Promise<void> {
  const held = (await kvGet<string[]>(REJUDGE_KEY, { executor: tx })) ?? []
  const next = [...new Set([...held, ...ids])]
  await kvSet(REJUDGE_KEY, next, REJUDGE_TTL_SECONDS, { executor: tx })
}

/**
 * Judge again the sign-in domains under each lapsed domain that still has one
 * undecided. One left alone because its own lookup went unanswered loses
 * verification here once it can be judged, if nothing proves it by then.
 * Inside the run's budget: a domain not reached is left for the next run.
 */
async function rejudgeLapsedDomains(outOfTime: () => boolean): Promise<void> {
  const ids = (await kvGet<string[]>(REJUDGE_KEY)) ?? []
  if (ids.length === 0) return
  const lapsed = await db
    .select()
    .from(domains)
    .where(
      and(
        inArray(domains.id, ids as Domain['id'][]),
        eq(domains.status, 'pending'),
        isNotNull(domains.verifiedAt)
      )
    )
  // A domain verified again, or removed, has nothing left to judge.
  const left: string[] = []
  for (const [i, row] of lapsed.entries()) {
    if (outOfTime()) {
      left.push(...lapsed.slice(i).map((r) => r.id))
      log.info({ left: lapsed.length - i }, 'judging lapsed domains out of time; rest next run')
      break
    }
    try {
      const { losing, undecided } = await signInDomainsLosingProof(row)
      logUndecided(row, undecided)
      if (undecided.length > 0) left.push(row.id)
      if (losing.length === 0) continue
      const unverified = await db.transaction((tx) => unverifySignIn(tx, losing))
      if (unverified.length === 0) continue
      log.warn(
        { domain: row.name, sign_in_domains: unverified.map((s) => s.name) },
        'sign-in domains under a lapsed domain are no longer verified'
      )
      await signInChanged()
      await notifyDomainOwnershipLapsed(
        row,
        unverified.map((s) => s.name)
      )
    } catch (err) {
      left.push(row.id)
      log.warn({ err, domain: row.name }, 'judging sign-in domains under a lapsed domain failed')
    }
  }
  const remaining = [...new Set(left)]
  if (remaining.length > 0) await kvSet(REJUDGE_KEY, remaining, REJUDGE_TTL_SECONDS)
  else await kvDel(REJUDGE_KEY)
}

/** Check one verified domain and act on what its zone says. */
async function checkDomain(row: Domain, now: Date): Promise<'kept' | 'warned' | 'demoted'> {
  const ownership = await readDomainOwnership(row)
  if (ownership === 'proven') {
    await db
      .update(domains)
      .set({
        ownershipMissingSince: null,
        ownershipWarningClaimedAt: null,
        ownershipWarningSentAt: null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(domains.id, row.id))
    return 'kept'
  }
  await db.update(domains).set({ lastCheckedAt: now }).where(eq(domains.id, row.id))
  if (ownership === 'unknown') {
    log.warn({ domain: row.name }, 'domain ownership lookup went unanswered; keeping it verified')
    return 'kept'
  }
  const grace = ownershipGrace(row, ownership, now)
  if (!grace.since) return 'kept'
  if (grace.inGrace) {
    const started = row.ownershipMissingSince ? null : await startGrace(row, grace.since)
    await deliverWarning(started ?? row)
    return 'warned'
  }
  await demote(row, grace.since, now)
  return 'demoted'
}

/**
 * Check every verified domain added by name, then judge again what is left
 * under lapsed ones, all inside one time budget. Cheap when idle: two reads
 * (the verified domains and the marker of lapsed ones still to judge), which
 * return nothing for a workspace that has added none.
 */
export async function watchDomainOwnership(
  now: Date = new Date(),
  opts: { clock?: () => number } = {}
): Promise<{ checked: number; demoted: number }> {
  const clock = opts.clock ?? Date.now
  const rows = await db
    .select()
    .from(domains)
    .where(eq(domains.status, 'verified'))
    .orderBy(sql`${domains.lastCheckedAt} ASC NULLS FIRST`, domains.name)
  const started = clock()
  let checked = 0
  let demoted = 0
  for (const row of rows) {
    if (clock() - started >= DOMAIN_WATCH_BUDGET_MS) {
      log.info({ left: rows.length - checked }, 'domain ownership watch out of time; rest next run')
      break
    }
    checked += 1
    try {
      if ((await checkDomain(row, now)) === 'demoted') demoted += 1
    } catch (err) {
      // One domain's failure must not stop the others being checked.
      log.warn({ err, domain: row.name }, 'domain ownership check failed')
    }
  }
  await rejudgeLapsedDomains(() => clock() - started >= DOMAIN_WATCH_BUDGET_MS)
  return { checked, demoted }
}
