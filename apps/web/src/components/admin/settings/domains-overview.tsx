/**
 * The Verified domains card on Settings > Domains: the domains the workspace
 * owns and verifies, for email, sign-in and the like, one row per domain name
 * with a chip for each use. Section hostnames are listed only on the Custom
 * domains card. Rows are status only. Each opens the domain's own page; a row
 * only a use holds is linked for a viewer who can open one of its uses.
 */
import { Fragment } from 'react'
import { DOMAIN_USE_ORDER, DOMAIN_VIEW_ROUTE } from '@/lib/shared/domain-uses'
import type { DomainUse, DomainUseLinks } from '@/lib/shared/domains-permissions'
import { GlobeAltIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { Badge } from '@/components/ui/badge'
import { AddDomainButton } from '@/components/admin/settings/add-domain-dialog'
import { domainPhase, type DomainPhase } from '@/components/admin/channels/sending-domain-view'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
import { coveringName, usedForLabel, type CustomDomainUsedFor } from '@/lib/shared/custom-domains'
import type { AddedDomainSummary } from '@/lib/server/functions/domains'
import type {
  SendingDomainSummary,
  SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'
import { PORTAL_SECTIONS, sectionOfHost, type SectionDomainMap } from '@/lib/shared/section-domains'
import { sectionDomainState, type SectionDomainState } from '@/lib/shared/section-domains'

export const VERIFIED_DOMAINS_TITLE = 'Verified domains'
export const EMPTY_DESCRIPTION = 'Verify a domain you own to send email from it or set up sign-in.'

/** Each use's words: its chip on the list, its row title and what it is for on a domain's page. */
export const USE_COPY: Record<DomainUse, { chip: string; title: string; description: string }> = {
  email: {
    chip: 'Email',
    title: 'Email sending',
    description: 'Send replies and announcements from your own address.',
  },
  customDomain: {
    chip: 'Custom domain',
    title: 'Custom domains',
    description: 'Use this domain for your portal.',
  },
  signIn: {
    chip: 'Sign-in',
    title: 'Sign-in',
    description: 'Let everyone with an address at your domain sign in with SSO.',
  },
}

/** A custom domain on or under a domain, and what it is used for. */
export interface CustomDomainEntry {
  hostname: string
  usedFor: CustomDomainUsedFor
  /** Null when healthy. */
  state: BadgeState | null
}

export interface DomainUseStatus {
  use: DomainUse
  /** The use's own row, where its removal needs it (a sign-in domain). */
  id?: string
  /** Null when healthy: a normal state shows no badge. */
  state: BadgeState | null
  detail?: string
  /** The web addresses on or under the domain (its web address use only), by hostname. */
  addresses?: CustomDomainEntry[]
}

export interface DomainRow {
  name: string
  uses: DomainUseStatus[]
  /** Added by name, so it has a page of its own whatever its uses. */
  added: boolean
  /** Added and its ownership not yet verified. */
  ownershipPending: boolean
}

export const PHASE_STATE = {
  live: null,
  'setting-up': 'pending',
  attention: 'attention',
  'not-found': 'attention',
} as const satisfies Record<DomainPhase, BadgeState | null>

function sendingDetail(domain: SendingDomainSummary): string | undefined {
  const parts = [domain.localParts.join(', ')]
  if (domain.ownershipProven) parts.push('Domain verified')
  return parts.filter(Boolean).join(' · ') || undefined
}

/** A Cloud web address as the rows read it: where the operator has it. */
export interface WebAddressSummary {
  hostname: string
  readiness: 'pending' | 'ready' | 'failed'
}

const SECTION_STATE = {
  verified: null,
  pending: 'pending',
  'not-answering': 'attention',
} as const satisfies Record<SectionDomainState, BadgeState | null>

const READINESS_STATE = {
  ready: null,
  pending: 'pending',
  failed: 'attention',
} as const satisfies Record<WebAddressSummary['readiness'], BadgeState | null>

/** The state a set of addresses shows as one: attention first, then pending. */
function worstState(entries: CustomDomainEntry[]): BadgeState | null {
  const states = entries.map((e) => e.state)
  return states.find((s) => s === 'attention') ?? states.find((s) => s !== null) ?? null
}

/** A custom domain as a row reads it: what it is used for, named when it is not the row's own name. */
export function customDomainLine(entry: CustomDomainEntry, rowName: string): string {
  const label = usedForLabel(entry.usedFor)
  return entry.hostname === rowName ? label : `${entry.hostname} · ${label}`
}

function signInDetail(d: SignInDomainSummary): string | undefined {
  if (d.verified) return d.provenBy ? verifiedThroughLabel(d.provenBy) : undefined
  return d.provenBy ? 'Already verified. Click Verify to use it.' : undefined
}

/** One row per domain name, its uses in a fixed order, the rows by name. */
export function domainRows({
  sending,
  signIn,
  sectionDomains,
  webAddresses = [],
  added = [],
  now = new Date(),
}: {
  sending: SendingDomainSummary[]
  signIn: SignInDomainSummary[]
  /** The hostname each portal section is served at. */
  sectionDomains?: SectionDomainMap | null
  /** Cloud's web addresses, each its hostname's custom domain use. */
  webAddresses?: WebAddressSummary[]
  added?: AddedDomainSummary[]
  now?: Date
}): DomainRow[] {
  const byName = new Map<string, DomainUseStatus[]>()
  const keyOf = (name: string) => name.trim().toLowerCase()
  const add = (name: string, status: DomainUseStatus) => {
    const key = keyOf(name)
    byName.set(key, [...(byName.get(key) ?? []), status])
  }
  const addedByName = new Map(added.map((d) => [keyOf(d.name), d]))
  for (const name of addedByName.keys()) byName.set(name, byName.get(name) ?? [])
  for (const d of sending) {
    add(d.domain, {
      use: 'email',
      state: PHASE_STATE[domainPhase(d, now)],
      detail: sendingDetail(d),
    })
  }
  // A web address under a domain added by name is listed on that domain.
  const web = new Map<string, CustomDomainEntry[]>()
  const addWeb = (entry: CustomDomainEntry) => {
    const key = coveringName(entry.hostname, addedByName.keys()) ?? keyOf(entry.hostname)
    web.set(key, [...(web.get(key) ?? []), { ...entry, hostname: keyOf(entry.hostname) }])
  }
  const sections = sectionDomains ?? {}
  // A Cloud custom domain serves the whole portal unless a section has it.
  const cloudHosts = new Set<string>()
  for (const w of webAddresses) {
    cloudHosts.add(keyOf(w.hostname))
    addWeb({
      hostname: w.hostname,
      usedFor: sectionOfHost(w.hostname, sections) ?? 'portal',
      state: READINESS_STATE[w.readiness],
    })
  }
  for (const section of PORTAL_SECTIONS) {
    const entry = sections[section]
    if (!entry || cloudHosts.has(keyOf(entry.hostname))) continue
    addWeb({
      hostname: entry.hostname,
      usedFor: section,
      state: SECTION_STATE[sectionDomainState(entry)],
    })
  }
  for (const [name, entries] of web) {
    const addresses = entries.sort((a, b) => (a.hostname < b.hostname ? -1 : 1))
    add(name, {
      use: 'customDomain',
      state: worstState(addresses),
      detail: addresses.map((a) => customDomainLine(a, name)).join(', '),
      addresses,
    })
  }
  for (const d of signIn) {
    add(d.name, {
      use: 'signIn',
      id: d.id,
      state: d.verified ? null : 'pending',
      detail: signInDetail(d),
    })
  }
  return [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, uses]) => ({
      name,
      uses: uses.sort((a, b) => DOMAIN_USE_ORDER.indexOf(a.use) - DOMAIN_USE_ORDER.indexOf(b.use)),
      added: addedByName.has(name),
      ownershipPending: addedByName.get(name)?.verified === false,
    }))
}

/** Whether the viewer can open the row's page: an added domain, or one of its uses. */
const opens = (row: DomainRow, links: DomainUseLinks): boolean =>
  row.added || row.uses.some((u) => links[u.use])

export function VerifiedDomainsCard({
  rows,
  links,
  canAdd,
}: {
  rows: DomainRow[]
  links: DomainUseLinks
  canAdd: boolean
}) {
  // A custom domain is listed on the Custom domains card, not here.
  const listed = rows.flatMap((row) => {
    const uses = row.uses.filter((u) => u.use !== 'customDomain')
    return uses.length || row.added ? [{ ...row, uses }] : []
  })
  return (
    <SettingsCard
      title={VERIFIED_DOMAINS_TITLE}
      action={canAdd ? <AddDomainButton /> : undefined}
      flush
    >
      {listed.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground sm:px-6">{EMPTY_DESCRIPTION}</p>
      ) : (
        <SettingsList>
          {listed.map((row) => {
            const linked = opens(row, links)
            const meta = row.uses.flatMap((u) => (u.detail ? [u.detail] : [])).join(' · ')
            return (
              <SettingsListRow
                key={row.name}
                leading={<RowIcon icon={GlobeAltIcon} />}
                title={row.name}
                meta={meta || undefined}
                badges={
                  // With no use yet, the domain's own verification is what it waits on.
                  row.uses.length === 0 && row.ownershipPending ? (
                    <StateBadge state="pending" />
                  ) : (
                    row.uses.map((u) => (
                      <Fragment key={u.use}>
                        <Badge variant="outline" size="sm">
                          {USE_COPY[u.use].chip}
                        </Badge>
                        {u.state && <StateBadge state={u.state} />}
                      </Fragment>
                    ))
                  )
                }
                to={linked ? DOMAIN_VIEW_ROUTE : undefined}
                params={linked ? { domain: row.name } : undefined}
              />
            )
          })}
        </SettingsList>
      )}
    </SettingsCard>
  )
}
