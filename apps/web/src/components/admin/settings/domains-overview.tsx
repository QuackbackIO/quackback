/**
 * The Domains page's status sections: every domain the workspace uses, grouped
 * by what it is for. Rows are status only. Each links to the page that owns its
 * setup, and a viewer who cannot open that page sees the row without the link.
 */
import { EnvelopeIcon, GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge } from '@/components/shared/state-badge'
import { PhaseBadge } from '@/components/admin/channels/phase-badge'
import { domainPhase } from '@/components/admin/channels/sending-domain-view'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
import type {
  HelpCenterDomainSummary,
  SendingDomainSummary,
  SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'

export const WEB_ADDRESSES_TITLE = 'Custom domains'
export const WEB_ADDRESSES_DESCRIPTION = 'Where people reach your portal and help center.'

/** The help center's own domain, on an install that serves it itself. */
export function HelpCenterAddressSection({
  domain,
  canOpen,
}: {
  domain: HelpCenterDomainSummary
  canOpen: boolean
}) {
  return (
    <SettingsCard title={WEB_ADDRESSES_TITLE} description={WEB_ADDRESSES_DESCRIPTION} flush>
      <SettingsList>
        <SettingsListRow
          leading={<RowIcon icon={GlobeAltIcon} />}
          title={domain.domain}
          meta="Help center"
          badges={domain.verified ? undefined : <StateBadge state="pending" />}
          {...(canOpen
            ? { to: '/admin/settings/help-center', search: { tab: 'domains-languages' } }
            : {})}
        />
      </SettingsList>
    </SettingsCard>
  )
}

function sendingMeta(domain: SendingDomainSummary): string | undefined {
  const parts = [domain.localParts.join(', ')]
  if (domain.ownershipProven) parts.push('Ownership verified')
  return parts.filter(Boolean).join(' · ') || undefined
}

export function EmailSendingSection({
  domains,
  canOpen,
  now = new Date(),
}: {
  domains: SendingDomainSummary[]
  canOpen: boolean
  now?: Date
}) {
  return (
    <SettingsCard
      title="Email sending"
      description="Domains replies and announcements are sent from."
      flush
    >
      <SettingsList>
        {domains.map((d) => (
          <SettingsListRow
            key={d.id}
            leading={<RowIcon icon={EnvelopeIcon} />}
            title={d.domain}
            meta={sendingMeta(d)}
            badges={<PhaseBadge phase={domainPhase(d, now)} />}
            to={canOpen ? '/admin/settings/channels/email' : undefined}
          />
        ))}
      </SettingsList>
    </SettingsCard>
  )
}

function signInMeta(d: SignInDomainSummary): string | undefined {
  if (d.verified) return d.provenBy ? verifiedThroughLabel(d.provenBy) : undefined
  return d.provenBy ? 'Already verified. Click Verify to use it.' : undefined
}

export function SignInSection({
  domains,
  canOpen,
}: {
  domains: SignInDomainSummary[]
  canOpen: boolean
}) {
  return (
    <SettingsCard title="Sign-in" description="Email domains that can use single sign-on." flush>
      <SettingsList>
        {domains.map((d) => (
          <SettingsListRow
            key={d.id}
            leading={<RowIcon icon={LockClosedIcon} />}
            title={d.name}
            meta={signInMeta(d)}
            badges={d.verified ? undefined : <StateBadge state="pending" />}
            to={canOpen ? '/admin/settings/security/authentication' : undefined}
          />
        ))}
      </SettingsList>
    </SettingsCard>
  )
}

export function NoDomains() {
  return (
    <p className="text-sm text-muted-foreground">
      No domains yet. Add one from Email, Help center or Security.
    </p>
  )
}
