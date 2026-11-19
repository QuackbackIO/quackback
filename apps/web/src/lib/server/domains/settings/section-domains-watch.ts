/**
 * The daily re-check that each verified section hostname on a self-hosted
 * server still reaches it, with the check Verify uses (`probeCustomDomain`),
 * judged by `section-domain-check.ts`.
 *
 * Without it a hostname is only judged when someone presses Verify, so one
 * whose DNS stopped pointing at this server, or that now points somewhere
 * else, would stay trusted for sign-in indefinitely. A check is one of:
 *
 * - reaches: any warning, first miss or mark is cleared.
 * - unreachable (DNS still gives the hostname an address, nothing else
 *   answers there, and the workspace's verification record still covers it)
 *   or unsure (a lookup went unanswered): a warning only (`reachWarning`), for
 *   the Custom domains card. Routing and sign-in keep the hostname and no
 *   grace starts. A server behind NAT without hairpin routing, with split DNS,
 *   or whose egress rules block its own address may never reach itself
 *   through a hostname that works for everyone else, and must not lose the
 *   hostname for it. An unreachable check also ends a mark: the record says
 *   the hostname is still ours.
 * - failed (no address, something else answers, or the record is gone): it
 *   is judged much as a domain added by name is (`domain-ownership-watch.ts`).
 *   A hostname that fails on two daily runs in a row is marked unconfirmed
 *   (`unconfirmedSince`) and the people who manage the workspace's domains
 *   are told; one still failing once the grace (`UNCONFIRMED_GRACE_MS`, from
 *   the mark) is over stops being verified, so only a person's Verify brings
 *   it back.
 *
 * A mark takes the hostname out of sign-in at once (`confirmedSectionDomains`)
 * while routing keeps serving it through the grace: the hostname may be
 * someone else's now, and a sign-in handoff must never mint a session there.
 * So it is never made on one blip: the first run that fails only notes when
 * (`missedAt`), and a run that answers clears the note. Within a run a miss is
 * checked once more after a short wait, and each DNS lookup is tried twice.
 *
 * On Cloud nothing is checked: a section's hostname is verified there while
 * the control plane reports its custom domain ready, which routing and sign-in
 * read live (`routableSectionDomains`).
 */
import { logger } from '@/lib/server/logger'
import { getBaseUrl } from '@/lib/server/config'
import { probeCustomDomain } from '@/lib/server/domains/domain-proof/reachability-probe'
import {
  PORTAL_SECTIONS,
  UNCONFIRMED_GRACE_MS,
  type SectionDomain,
  type SectionDomainMap,
  type SectionDomainReachWarning,
} from '@/lib/shared/section-domains'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { judgeSectionDomainProbe, type SectionDomainCheck } from './section-domain-check'
import {
  getSectionDomains,
  readHostingIfSetUp,
  readStoredSectionDomains,
  writeSectionDomains,
} from './section-domains.service'
import {
  notifySectionDomainLapsed,
  notifySectionDomainNotAnswering,
} from './section-domains-notify'

const log = logger.child({ component: 'section-domains-watch' })

/** How long to wait before checking a missed hostname once more. */
export const SECTION_RECHECK_DELAY_MS = 10_000

/**
 * How old the first miss must be for a second one to mark the hostname: from
 * an earlier daily run, not a retry of the same one.
 */
export const SECOND_MISS_AFTER_MS = 12 * 60 * 60 * 1000

export interface SectionDomainWatchResult {
  checked: number
  /** Hostnames that failed for the first time, noted but not yet marked. */
  missed: number
  /** Hostnames marked unconfirmed by this run. */
  unconfirmed: number
  /** Marked hostnames that answered again, or whose verification record still holds. */
  confirmed: number
  /** Hostnames that stopped being verified when their grace ran out. */
  lapsed: number
  /** Hostnames newly warned about: not reached, or not looked up, but still verified. */
  warned: number
}

type Event = 'missed' | 'unconfirmed' | 'confirmed' | 'lapsed' | 'warned' | 'cleared'

interface Decision {
  next: SectionDomain
  event: Event
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One check of the hostname, made once more after anything but an answer. */
async function check(
  hostname: string,
  primaryOrigin: string,
  wait: (ms: number) => Promise<void>
): Promise<SectionDomainCheck> {
  const first = await probeCustomDomain(hostname, { primaryOrigin })
  if (first.status.verified) return 'reaches'
  await wait(SECTION_RECHECK_DELAY_MS)
  const second = await probeCustomDomain(hostname, { primaryOrigin })
  const judged = await judgeSectionDomainProbe(hostname, second)
  if (judged !== 'reaches') {
    log.info(
      { hostname, status: second.status, dns: second.dns, instance: second.instance, judged },
      'section domain did not reach this server on two checks'
    )
  }
  return judged
}

/** The entry without any of the watch's own notes. */
function bare(entry: SectionDomain): SectionDomain {
  const { unconfirmedSince: _mark, missedAt: _missed, reachWarning: _warning, ...rest } = entry
  return rest
}

function warning(
  entry: SectionDomain,
  reason: SectionDomainReachWarning['reason'],
  now: Date
): SectionDomainReachWarning {
  const since = entry.reachWarning?.reason === reason ? entry.reachWarning.since : null
  return { reason, since: since ?? now.toISOString() }
}

/** What a check means for an entry, or null when it changes nothing. */
function decide(entry: SectionDomain, result: SectionDomainCheck, now: Date): Decision | null {
  if (result === 'reaches') {
    if (entry.unconfirmedSince) return { next: bare(entry), event: 'confirmed' }
    return entry.missedAt || entry.reachWarning ? { next: bare(entry), event: 'cleared' } : null
  }
  if (result === 'unreachable') {
    // The verification record still holds: the hostname is ours, so no grace.
    const next = { ...bare(entry), reachWarning: warning(entry, 'unreachable', now) }
    if (entry.unconfirmedSince) return { next, event: 'confirmed' }
    if (same(entry, next)) return null
    return { next, event: entry.reachWarning ? 'cleared' : 'warned' }
  }
  if (result === 'unsure') {
    // Says nothing either way: a mark or a first miss stays as it was.
    if (entry.unconfirmedSince) return null
    const next = { ...entry, reachWarning: warning(entry, 'dns', now) }
    if (same(entry, next)) return null
    return { next, event: entry.reachWarning ? 'cleared' : 'warned' }
  }
  // Failed: the warning gives way to the miss, the mark and the grace.
  const { reachWarning: _warning, ...rest } = entry
  if (!entry.unconfirmedSince) {
    if (!entry.missedAt) return { next: { ...rest, missedAt: now.toISOString() }, event: 'missed' }
    // A first miss it cannot read counts as an earlier run's.
    const missed = Date.parse(entry.missedAt)
    if (now.getTime() - missed < SECOND_MISS_AFTER_MS) {
      return entry.reachWarning ? { next: rest, event: 'cleared' } : null
    }
    return { next: { ...bare(entry), unconfirmedSince: now.toISOString() }, event: 'unconfirmed' }
  }
  const since = Date.parse(entry.unconfirmedSince)
  // The same boundary routing uses: a mark it cannot read has no grace left.
  if (now.getTime() - since <= UNCONFIRMED_GRACE_MS) return null
  return { next: { ...bare(entry), verifiedAt: null }, event: 'lapsed' }
}

/** Whether two entries say the same thing. */
function same(a: SectionDomain | undefined, b: SectionDomain): boolean {
  return (
    !!a &&
    a.hostname === b.hostname &&
    a.verifiedAt === b.verifiedAt &&
    (a.unconfirmedSince ?? null) === (b.unconfirmedSince ?? null) &&
    (a.missedAt ?? null) === (b.missedAt ?? null) &&
    (a.reachWarning?.reason ?? null) === (b.reachWarning?.reason ?? null) &&
    (a.reachWarning?.since ?? null) === (b.reachWarning?.since ?? null)
  )
}

/**
 * Check every verified section hostname and keep what was found. Cheap when
 * idle: one settings read on Cloud or before the workspace is set up, two on a
 * self-hosted server with no section hostname, and no write unless something
 * changed.
 */
export async function watchSectionDomains(
  now: Date = new Date(),
  opts: { wait?: (ms: number) => Promise<void> } = {}
): Promise<SectionDomainWatchResult> {
  const result: SectionDomainWatchResult = {
    checked: 0,
    missed: 0,
    unconfirmed: 0,
    confirmed: 0,
    lapsed: 0,
    warned: 0,
  }
  const hosting = await readHostingIfSetUp()
  // Not set up yet (no settings row), or Cloud: nothing to check.
  if (!hosting || hosting.cloud) return result

  const judged = await getSectionDomains('fresh')
  const verified = PORTAL_SECTIONS.flatMap((section) => {
    const entry = judged[section]
    return entry?.verifiedAt ? [{ section, entry }] : []
  })
  if (verified.length === 0) return result

  const wait = opts.wait ?? sleep
  const primaryOrigin = getBaseUrl()
  // Each check can take seconds; the hostnames are few, so they run together.
  const decisions = await Promise.all(
    verified.map(async ({ section, entry }) => {
      try {
        const checked = await check(entry.hostname, primaryOrigin, wait)
        return { section, entry, decision: decide(entry, checked, now) }
      } catch (err) {
        // One hostname's failure must not stop the others being judged.
        log.warn({ err, hostname: entry.hostname }, 'section domain check failed')
        return { section, entry, decision: null }
      }
    })
  )
  result.checked = verified.length

  // Read again just before writing, so the window for an admin's edit is the
  // write itself, not the seconds the checks took.
  // As stored, so an entry hidden as the primary domain's is kept.
  const current = await readStoredSectionDomains('fresh')
  const next: SectionDomainMap = { ...current }
  const changed: { section: PortalSection; entry: SectionDomain; decision: Decision }[] = []
  for (const { section, entry, decision } of decisions) {
    if (!decision) continue
    // Still the entry that was judged: an admin's change since then wins.
    if (!same(current[section], entry)) continue
    next[section] = decision.next
    changed.push({ section, entry, decision })
  }
  if (changed.length === 0) return result
  await writeSectionDomains(next, hosting)

  for (const { section, entry, decision } of changed) {
    const hostname = entry.hostname
    switch (decision.event) {
      case 'missed':
        result.missed += 1
        log.info(
          { section, hostname },
          'section domain did not reach this server; marked if the next run misses too'
        )
        break
      case 'confirmed':
        result.confirmed += 1
        log.info({ section, hostname }, 'section domain confirmed again')
        break
      case 'warned':
        result.warned += 1
        log.warn(
          { section, hostname, reason: decision.next.reachWarning?.reason },
          'section domain could not be reached or looked up; it stays verified'
        )
        break
      case 'unconfirmed': {
        result.unconfirmed += 1
        log.warn(
          { section, hostname },
          'section domain no longer reaches this server; sign-in stops there, routing keeps its grace'
        )
        const since = Date.parse(decision.next.unconfirmedSince ?? '')
        await notifySectionDomainNotAnswering(
          section,
          hostname,
          new Date(since + UNCONFIRMED_GRACE_MS)
        )
        break
      }
      case 'lapsed':
        result.lapsed += 1
        log.warn(
          { section, hostname },
          'section domain still does not reach this server after the grace; it is no longer verified'
        )
        await notifySectionDomainLapsed(section, hostname)
        break
      case 'cleared':
        break
    }
  }
  return result
}
