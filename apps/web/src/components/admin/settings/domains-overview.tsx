/**
 * The Domains page body: every domain the workspace uses, one row per domain
 * name with a chip for each use, or, with none yet, the uses and where each is
 * set up. Rows are status only. Each opens the domain's own page, and a viewer
 * who can open none of the row's uses sees the row without the link.
 */
import { Fragment } from 'react'
import { DOMAIN_USE_ORDER, DOMAIN_VIEW_ROUTE } from '@/lib/shared/domain-uses'
import {
  HELP_CENTER_SETTINGS,
  type DomainUse,
  type DomainUseLinks,
} from '@/lib/shared/domains-permissions'
import { Link } from '@tanstack/react-router'
import { EnvelopeIcon, GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { domainPhase, type DomainPhase } from '@/components/admin/channels/sending-domain-view'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
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
  /** Null when healthy: a normal state shows no badge. */
  state: BadgeState | null
  detail?: string
}

export interface DomainRow {
  name: string
  uses: DomainUseStatus[]
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

function signInDetail(d: SignInDomainSummary): string | undefined {
  if (d.verified) return d.provenBy ? verifiedThroughLabel(d.provenBy) : undefined
  return d.provenBy ? 'Already verified. Click Verify to use it.' : undefined
}

/** One row per domain name, its uses in a fixed order, the rows by name. */
export function domainRows({
  sending,
  signIn,
  helpCenterDomain,
  now = new Date(),
}: {
  sending: SendingDomainSummary[]
  signIn: SignInDomainSummary[]
  helpCenterDomain: HelpCenterDomainSummary | null
  now?: Date
}): DomainRow[] {
  const byName = new Map<string, DomainUseStatus[]>()
  const add = (name: string, status: DomainUseStatus) => {
    const key = name.trim().toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), status])
  }
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
  for (const d of signIn) {
    add(d.name, { use: 'signIn', state: d.verified ? null : 'pending', detail: signInDetail(d) })
  }
  return [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, uses]) => ({
      name,
      uses: uses.sort((a, b) => DOMAIN_USE_ORDER.indexOf(a.use) - DOMAIN_USE_ORDER.indexOf(b.use)),
    }))
}

/** Whether the viewer can open the setup of at least one of the row's uses. */
const opens = (row: DomainRow, links: DomainUseLinks): boolean => row.uses.some((u) => links[u.use])

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
              badges={row.uses.map((u) => (
                <Fragment key={u.use}>
                  <Badge variant="outline" size="sm">
                    {USE_LABEL[u.use]}
                  </Badge>
                  {u.state && <StateBadge state={u.state} />}
                </Fragment>
              ))}
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

/** With no domains yet: each use the viewer may set up, with its own way there. */
export function DomainsEmptyState({ links }: { links: DomainUseLinks }) {
  const uses = USES.filter((u) => links[u.use])
  if (uses.length === 0) return null
  return (
    <SettingsCard flush>
      <SettingsList>
        {uses.map((u) => {
          const link = links[u.use]!
          // Off Cloud the only web address an install takes is its help center's.
          const description =
            u.use === 'customDomain' && link.to === HELP_CENTER_SETTINGS
              ? 'Put your help center on help.yourcompany.com.'
              : u.description
          return (
            <SettingsListRow
              key={u.use}
              leading={<RowIcon icon={u.icon} />}
              title={u.title}
              meta={description}
              trailing={
                <Button variant="outline" size="sm" asChild>
                  <Link to={link.to} search={link.search} hash={link.hash}>
                    Set up
                  </Link>
                </Button>
              }
            />
          )
        })}
      </SettingsList>
    </SettingsCard>
  )
}
