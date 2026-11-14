/**
 * The Domains page body: every domain the workspace uses or has added, one row
 * per domain name with a chip for each use, or, with none yet, one way to add a
 * domain. Rows are status only. Each opens the domain's own page; a row only a
 * use holds is linked for a viewer who can open one of its uses.
 */
import { Fragment } from 'react'
import { DOMAIN_USE_ORDER, DOMAIN_VIEW_ROUTE } from '@/lib/shared/domain-uses'
import type { DomainUse, DomainUseLinks } from '@/lib/shared/domains-permissions'
import { EnvelopeIcon, GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { Badge } from '@/components/ui/badge'
import { AddDomainButton } from '@/components/admin/settings/add-domain-dialog'
import { domainPhase, type DomainPhase } from '@/components/admin/channels/sending-domain-view'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
import type { AddedDomainSummary } from '@/lib/server/functions/domains'
import type {
  HelpCenterDomainSummary,
  SendingDomainSummary,
  SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'

export const WEB_ADDRESSES_TITLE = 'Custom domains'
export const WEB_ADDRESSES_DESCRIPTION = 'Where people reach your portal and help center.'

export const EMPTY_DESCRIPTION = 'Use your own domain for email, web addresses and sign-in.'

const USE_LABEL: Record<DomainUse, string> = {
  email: 'Email',
  customDomain: 'Custom domain',
  signIn: 'Sign-in',
}

export interface DomainUseStatus {
  use: DomainUse
  /** The use's own row, where its removal needs it (a sign-in domain). */
  id?: string
  /** Null when healthy: a normal state shows no badge. */
  state: BadgeState | null
  detail?: string
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
  if (domain.ownershipProven) parts.push('Ownership verified')
  return parts.filter(Boolean).join(' · ') || undefined
}

/** A Cloud web address as the rows read it: where the operator has it. */
export interface WebAddressSummary {
  hostname: string
  readiness: 'pending' | 'ready' | 'failed'
}

const READINESS_STATE = {
  ready: null,
  pending: 'pending',
  failed: 'attention',
} as const satisfies Record<WebAddressSummary['readiness'], BadgeState | null>

function signInDetail(d: SignInDomainSummary): string | undefined {
  if (d.verified) return d.provenBy ? verifiedThroughLabel(d.provenBy) : undefined
  return d.provenBy ? 'Already verified. Click Verify to use it.' : undefined
}

/** One row per domain name, its uses in a fixed order, the rows by name. */
export function domainRows({
  sending,
  signIn,
  helpCenterDomain,
  webAddresses = [],
  added = [],
  now = new Date(),
}: {
  sending: SendingDomainSummary[]
  signIn: SignInDomainSummary[]
  helpCenterDomain: HelpCenterDomainSummary | null
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
  if (helpCenterDomain) {
    add(helpCenterDomain.domain, {
      use: 'customDomain',
      state: helpCenterDomain.verified ? null : 'pending',
      detail: 'Help center',
    })
  }
  for (const w of webAddresses) {
    add(w.hostname, { use: 'customDomain', state: READINESS_STATE[w.readiness] })
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

export function DomainList({ rows, links }: { rows: DomainRow[]; links: DomainUseLinks }) {
  return (
    <SettingsCard flush>
      <SettingsList>
        {rows.map((row) => {
          const linked = opens(row, links)
          const meta = row.uses.flatMap((u) => (u.detail ? [u.detail] : [])).join(' · ')
          return (
            <SettingsListRow
              key={row.name}
              leading={<RowIcon icon={GlobeAltIcon} />}
              title={row.name}
              meta={meta || undefined}
              badges={
                // With no use yet, the domain's own ownership is what it waits on.
                row.uses.length === 0 && row.ownershipPending ? (
                  <StateBadge state="pending" />
                ) : (
                  row.uses.map((u) => (
                    <Fragment key={u.use}>
                      <Badge variant="outline" size="sm">
                        {USE_LABEL[u.use]}
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
    </SettingsCard>
  )
}

export const USES = [
  {
    use: 'email',
    icon: EnvelopeIcon,
    title: 'Email sending',
    description: 'Send replies and announcements from your own address.',
  },
  {
    use: 'customDomain',
    icon: GlobeAltIcon,
    title: 'Custom domain',
    description: 'Put your portal on feedback.yourcompany.com.',
  },
  {
    use: 'signIn',
    icon: LockClosedIcon,
    title: 'Sign-in',
    description: 'Let everyone with an address at your domain sign in with SSO.',
  },
] as const satisfies readonly {
  use: DomainUse
  icon: typeof EnvelopeIcon
  title: string
  description: string
}[]

/** With no domains yet: one way to add one, for a viewer who may. */
export function DomainsEmptyState({ canAdd }: { canAdd: boolean }) {
  return (
    <SettingsCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{EMPTY_DESCRIPTION}</p>
        {canAdd && <AddDomainButton />}
      </div>
    </SettingsCard>
  )
}
