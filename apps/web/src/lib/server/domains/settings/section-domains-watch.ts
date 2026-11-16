/**
 * The daily re-check that each verified section hostname on a self-hosted
 * server still reaches it, with the check Verify uses (`probeCustomDomain`).
 *
 * Without it a hostname is only judged when someone presses Verify, so one
 * whose DNS stopped answering, or that now points somewhere else, would stay
 * trusted for sign-in indefinitely. It is judged the way a domain added by
 * name is (`domain-ownership-watch.ts`): the first check that fails marks the
 * hostname unconfirmed (`unconfirmedSince`) and tells the people who manage
 * the workspace's domains, a check that answers again clears the mark, and a
 * hostname still failing once the grace (`UNCONFIRMED_GRACE_MS`) is over stops
 * being verified, so only a person's Verify brings it back.
 *
 * A mark takes the hostname out of sign-in at once (`confirmedSectionDomains`)
 * while routing keeps serving it through the grace. Unlike the record lookup
 * of a domain added by name, a lookup that goes unanswered counts as a miss
 * here: a hostname whose DNS stopped answering is the case this exists for.
 * A miss is checked once more after a short wait before anything is marked,
 * so a blink on this server's own network changes nothing.
 *
 * On Cloud nothing is checked: a section's hostname is verified there while
 * the control plane reports its custom domain ready, which routing and sign-in
 * read live (`routableSectionDomains`).
 */
import { logger } from '@/lib/server/logger'
import { probeCustomDomain } from '@/lib/server/domains/domain-proof/reachability-probe'
import {
  PORTAL_SECTIONS,
  UNCONFIRMED_GRACE_MS,
  type SectionDomain,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { getSectionDomains, readHosting, writeSectionDomains } from './section-domains.service'
import {
  notifySectionDomainLapsed,
  notifySectionDomainNotAnswering,
} from './section-domains-notify'

const log = logger.child({ component: 'section-domains-watch' })

/** How long to wait before checking a missed hostname once more. */
export const SECTION_RECHECK_DELAY_MS = 10_000

export interface SectionDomainWatchResult {
  checked: number
  /** Hostnames marked unconfirmed by this run. */
  unconfirmed: number
  /** Marked hostnames that answered again. */
  confirmed: number
  /** Hostnames that stopped being verified when their grace ran out. */
  lapsed: number
}

type Decision =
  { kind: 'confirm' } | { kind: 'mark'; since: string } | { kind: 'lapse' } | { kind: 'keep' }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Whether the hostname reaches this server, checked once more after a miss. */
async function answers(hostname: string, wait: (ms: number) => Promise<void>): Promise<boolean> {
  const first = await probeCustomDomain(hostname)
  if (first.status.verified) return true
  await wait(SECTION_RECHECK_DELAY_MS)
  const second = await probeCustomDomain(hostname)
  if (!second.status.verified) {
    log.info(
      { hostname, status: second.status, dns_answered: second.dnsAnswered },
      'section domain did not reach this server on two checks'
    )
  }
  return second.status.verified
}

function decide(entry: SectionDomain, answered: boolean, now: Date): Decision {
  if (answered) return entry.unconfirmedSince ? { kind: 'confirm' } : { kind: 'keep' }
  if (!entry.unconfirmedSince) return { kind: 'mark', since: now.toISOString() }
  const since = Date.parse(entry.unconfirmedSince)
  // The same boundary routing uses: a mark it cannot read has no grace left.
  return now.getTime() - since <= UNCONFIRMED_GRACE_MS ? { kind: 'keep' } : { kind: 'lapse' }
}

function apply(entry: SectionDomain, decision: Decision): SectionDomain {
  const { unconfirmedSince: _previous, ...rest } = entry
  switch (decision.kind) {
    case 'confirm':
      return rest
    case 'mark':
      return { ...rest, unconfirmedSince: decision.since }
    case 'lapse':
      return { ...rest, verifiedAt: null }
    case 'keep':
      return entry
  }
}

/** Still the entry that was judged: an admin's change since then wins. */
function unchanged(a: SectionDomain | undefined, b: SectionDomain): boolean {
  return (
    !!a &&
    a.hostname === b.hostname &&
    a.verifiedAt === b.verifiedAt &&
    (a.unconfirmedSince ?? null) === (b.unconfirmedSince ?? null)
  )
}

/**
 * Check every verified section hostname and keep what was found. Cheap when
 * idle: one settings read on Cloud, two on a self-hosted server with no
 * section hostname, and no write unless something changed.
 */
export async function watchSectionDomains(
  now: Date = new Date(),
  opts: { wait?: (ms: number) => Promise<void> } = {}
): Promise<SectionDomainWatchResult> {
  const result: SectionDomainWatchResult = { checked: 0, unconfirmed: 0, confirmed: 0, lapsed: 0 }
  const hosting = await readHosting()
  if (hosting.cloud) return result

  const judged = await getSectionDomains('fresh')
  const verified = PORTAL_SECTIONS.flatMap((section) => {
    const entry = judged[section]
    return entry?.verifiedAt ? [{ section, entry }] : []
  })
  if (verified.length === 0) return result

  const wait = opts.wait ?? sleep
  // Each check can take seconds; the hostnames are few, so they run together.
  const decisions = await Promise.all(
    verified.map(async ({ section, entry }) => {
      try {
        return { section, entry, decision: decide(entry, await answers(entry.hostname, wait), now) }
      } catch (err) {
        // One hostname's failure must not stop the others being judged.
        log.warn({ err, hostname: entry.hostname }, 'section domain check failed')
        return { section, entry, decision: { kind: 'keep' } as Decision }
      }
    })
  )
  result.checked = verified.length

  // Read again just before writing, so the window for an admin's edit is the
  // write itself, not the seconds the checks took.
  const current = await getSectionDomains('fresh')
  const next: SectionDomainMap = { ...current }
  const changed: { section: PortalSection; entry: SectionDomain; decision: Decision }[] = []
  for (const judgedEntry of decisions) {
    const { section, entry, decision } = judgedEntry
    if (decision.kind === 'keep') continue
    if (!unchanged(current[section], entry)) continue
    next[section] = apply(entry, decision)
    changed.push(judgedEntry)
  }
  if (changed.length === 0) return result
  await writeSectionDomains(next, hosting)

  for (const { section, entry, decision } of changed) {
    const hostname = entry.hostname
    if (decision.kind === 'confirm') {
      result.confirmed += 1
      log.info({ section, hostname }, 'section domain reaches this server again')
    } else if (decision.kind === 'mark') {
      result.unconfirmed += 1
      log.warn(
        { section, hostname },
        'section domain no longer reaches this server; sign-in stops there, routing keeps its grace'
      )
      const deadline = new Date(Date.parse(decision.since) + UNCONFIRMED_GRACE_MS)
      await notifySectionDomainNotAnswering(section, hostname, deadline)
    } else if (decision.kind === 'lapse') {
      result.lapsed += 1
      log.warn(
        { section, hostname },
        'section domain still does not reach this server after the grace; it is no longer verified'
      )
      await notifySectionDomainLapsed(section, hostname)
    }
  }
  return result
}
