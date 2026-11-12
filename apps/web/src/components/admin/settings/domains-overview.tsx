/**
 * The Domains page body: every domain the workspace uses, one row per domain
 * name with a chip for each use, or, with none yet, the uses and where each is
 * set up. Rows are status only. Each links to the page that owns its setup,
 * and a viewer who cannot open that page sees the row without the link.
 */
import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { EnvelopeIcon, GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { domainPhase, type DomainPhase } from '@/components/admin/channels/sending-domain-view'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type {
  HelpCenterDomainSummary,
  SendingDomainSummary,
  SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'

export const WEB_ADDRESSES_TITLE = 'Custom domains'
export const WEB_ADDRESSES_DESCRIPTION = 'Where people reach your portal and help center.'

/** The Custom domains card on this page (Cloud), where the empty state's Custom domain action lands. */
export const CUSTOM_DOMAINS_ANCHOR = 'custom-domains'

const HELP_CENTER_SETTINGS = '/admin/settings/help-center'

export const EMPTY_DESCRIPTION = 'Use your own domain for email, web addresses and sign-in.'

type DomainUse = 'email' | 'customDomain' | 'signIn'

const USE_ORDER: readonly DomainUse[] = ['email', 'customDomain', 'signIn']

const USE_LABEL: Record<DomainUse, string> = {
  email: 'Email',
  customDomain: 'Custom domain',
  signIn: 'Sign-in',
}

interface UseLink {
  to: string
  search?: Record<string, string>
  hash?: string
}

/** Where each use is set up, for the uses this viewer may set up. */
export type DomainUseLinks = Partial<Record<DomainUse, UseLink>>

/**
 * The setup page for each use, gated by that page's own permission. Email and
 * Sign-in sit behind no product. Custom domains on Cloud are set up on this
 * page; on an install that serves its help center itself, the only domain it
 * takes is the help center's, set on Help center settings.
 */
export function domainUseLinks({
  permissions,
  cloudEnabled,
  helpCenterOn,
}: {
  permissions: readonly string[]
  cloudEnabled: boolean
  helpCenterOn: boolean
}): DomainUseLinks {
  const can = (permission: string) => permissions.includes(permission)
  const links: DomainUseLinks = {}
  if (can(EMAIL_SENDING_PERMISSION)) links.email = { to: '/admin/settings/email' }
  if (can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)) {
    if (cloudEnabled) {
      links.customDomain = { to: '/admin/settings/domains', hash: CUSTOM_DOMAINS_ANCHOR }
    } else if (helpCenterOn && can(PERMISSIONS.HELP_CENTER_MANAGE)) {
      links.customDomain = {
        to: HELP_CENTER_SETTINGS,
        search: { tab: 'domains-languages' },
      }
    }
  }
  if (can(PERMISSIONS.AUTH_MANAGE)) {
    links.signIn = { to: '/admin/settings/security/authentication', search: { tab: 'sign-in' } }
  }
  return links
}

interface DomainUseStatus {
  use: DomainUse
  /** Null when healthy: a normal state shows no badge. */
  state: BadgeState | null
  detail?: string
}

export interface DomainRow {
  name: string
  uses: DomainUseStatus[]
}

const PHASE_STATE = {
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
      uses: uses.sort((a, b) => USE_ORDER.indexOf(a.use) - USE_ORDER.indexOf(b.use)),
    }))
}

/** The use a row opens: the first that needs attention, else the first, among those the viewer may open. */
function rowLink(row: DomainRow, links: DomainUseLinks): UseLink | undefined {
  const openable = row.uses.filter((u) => links[u.use])
  const target = openable.find((u) => u.state) ?? openable[0]
  return target ? links[target.use] : undefined
}

export function DomainList({ rows, links }: { rows: DomainRow[]; links: DomainUseLinks }) {
  return (
    <SettingsCard flush>
      <SettingsList>
        {rows.map((row) => {
          const link = rowLink(row, links)
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
              to={link?.to}
              search={link?.search}
            />
          )
        })}
      </SettingsList>
    </SettingsCard>
  )
}

const USES = [
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
