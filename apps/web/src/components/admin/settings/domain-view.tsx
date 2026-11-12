/**
 * One domain's page body: a card for each use the domain has, in a fixed
 * order, then the uses themselves, removed one at a time. Email is checked and
 * removed here with the pieces Settings → Email uses. Sign-in and a custom
 * domain are set up and removed on the pages that own them, so their cards
 * say where they stand and link there. A viewer sees only the uses whose
 * permission they hold.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  HELP_CENTER_SETTINGS,
  type DomainUse,
  type DomainUseLinks,
  type UseLink,
} from '@/lib/shared/domains-permissions'
import { DomainSetupPanel } from '@/components/admin/channels/domain-setup-panel'
import { errorText } from '@/lib/client/error-text'
import { domainPhase } from '@/components/admin/channels/sending-domain-view'
import {
  domainOf,
  removalNote,
  RemoveAddressDialog,
  RemoveDomainDialog,
  type AddressRemoval,
  type DomainRemoval,
} from '@/components/admin/channels/sending-removal'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { Button } from '@/components/ui/button'
import { useRestartSendingDomainChecks } from '@/lib/client/mutations/channel-accounts'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { PHASE_STATE, USES, type DomainRow, type DomainUseStatus } from './domains-overview'

const USE_TITLE = Object.fromEntries(USES.map((u) => [u.use, u.title])) as Record<DomainUse, string>

/** The name of the page a use is set up on, as its link reads. */
function pageName(use: DomainUse, link: UseLink): string {
  if (use === 'email') return 'Email settings'
  if (use === 'signIn') return 'Sign-in settings'
  return link.to === HELP_CENTER_SETTINGS ? 'Help center settings' : 'Custom domains'
}

function PageLink({ use, link }: { use: DomainUse; link: UseLink }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={link.to} search={link.search} hash={link.hash}>
        {pageName(use, link)}
      </Link>
    </Button>
  )
}

/** Where a use stands. A use with nothing wrong is verified. */
function UseStatus({ state }: { state: BadgeState | null }) {
  return state ? (
    <StateBadge state={state} />
  ) : (
    <span className="text-[13px] text-muted-foreground">Verified</span>
  )
}

function ErrorLine({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="border-t border-border/50 px-4 py-3 text-sm text-destructive sm:px-6"
    >
      {children}
    </p>
  )
}

/** This domain's sending row and the addresses on it, oldest first, from the email config. */
function useSendingDomain(name: string) {
  const { data } = useQuery(emailChannelConfigQuery())
  const domains = data?.domains ?? []
  const domain = domains.find((d) => d.domain.toLowerCase() === name) ?? null
  const addresses = domain
    ? (data?.sendingAddresses ?? [])
        .filter((a) => domainOf(a, domains)?.id === domain.id)
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    : []
  return { data, domain, addresses }
}

function EmailCard({
  use,
  domain,
  link,
  onChanged,
}: {
  use: DomainUseStatus
  /** Null when the email config could not be read: the status still shows. */
  domain: SendingDomainDTO | null
  link: UseLink | undefined
  onChanged: () => void
}) {
  const restart = useRestartSendingDomainChecks()
  const [error, setError] = useState<string | null>(null)
  const phase = domain ? domainPhase(domain) : null
  return (
    <SettingsCard
      title={USE_TITLE.email}
      action={<UseStatus state={phase ? PHASE_STATE[phase] : use.state} />}
      flush
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="text-[13px] text-muted-foreground">
          {use.detail ?? 'No address uses this domain'}
        </p>
        {link && <PageLink use="email" link={link} />}
      </div>
      {domain && phase && (
        <DomainSetupPanel
          domain={domain}
          phase={phase}
          checking={restart.isPending}
          onCheckAgain={() => {
            setError(null)
            restart.mutate(domain.id, {
              onSuccess: onChanged,
              onError: (e) => setError(errorText(e, "Couldn't check the records.")),
            })
          }}
        />
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </SettingsCard>
  )
}

/** A use set up on another page: where it stands, and the way there. */
function LinkedUseCard({ use, link }: { use: DomainUseStatus; link: UseLink | undefined }) {
  const fallback = use.state
    ? link
      ? `Verify this domain in ${pageName(use.use, link)} to use it.`
      : 'Not verified yet.'
    : undefined
  const line = [use.detail, fallback].filter(Boolean).join(' · ')
  return (
    <SettingsCard title={USE_TITLE[use.use]} action={<UseStatus state={use.state} />}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{line}</p>
        {link && <PageLink use={use.use} link={link} />}
      </div>
    </SettingsCard>
  )
}

/**
 * The uses, each removed on its own. Email goes an address at a time, the
 * last taking the domain's sending setup with it; the others are removed on
 * the page that owns them. Nothing here removes more than one use.
 */
function UsesCard({
  uses,
  links,
  sending,
  onChanged,
}: {
  uses: DomainUseStatus[]
  links: DomainUseLinks
  sending: ReturnType<typeof useSendingDomain>
  onChanged: () => void
}) {
  const [addressTarget, setAddressTarget] = useState<AddressRemoval | null>(null)
  const [domainTarget, setDomainTarget] = useState<DomainRemoval | null>(null)
  const [error, setError] = useState<string | null>(null)
  const showError = (fallback: string) => (e: unknown) => setError(errorText(e, fallback))
  const { data, domain, addresses } = sending
  const removeButton = (onClick: () => void) => (
    <Button variant="outline" size="sm" onClick={onClick}>
      Remove
    </Button>
  )

  return (
    <SettingsCard title="Uses" flush>
      <SettingsList>
        {uses.flatMap((use) => {
          const title = USE_TITLE[use.use]
          const link = links[use.use]
          if (use.use !== 'email' || !data || !domain) {
            return [
              <SettingsListRow
                key={use.use}
                title={title}
                meta={link ? `Remove it in ${pageName(use.use, link)}` : undefined}
                trailing={link ? <PageLink use={use.use} link={link} /> : undefined}
              />,
            ]
          }
          if (addresses.length === 0) {
            return [
              <SettingsListRow
                key="email"
                title={title}
                meta="No address uses this domain"
                trailing={removeButton(() =>
                  setDomainTarget({ id: domain.id, domain: domain.domain })
                )}
              />,
            ]
          }
          return addresses.map((a) => (
            <SettingsListRow
              key={a.id}
              title={a.address ?? ''}
              meta={title}
              trailing={removeButton(() =>
                setAddressTarget({
                  id: a.id,
                  address: a.address ?? '',
                  // Removing the last address on a domain removes the domain too.
                  alsoDomain: addresses.length === 1 ? domain.domain : null,
                  note: removalNote(
                    a.id,
                    data.senders,
                    data.defaultFrom ?? null,
                    data.addressMode === 'any' ? 'Server default' : 'Quackback address'
                  ),
                })
              )}
            />
          ))
        })}
      </SettingsList>
      {error && <ErrorLine>{error}</ErrorLine>}
      <RemoveAddressDialog
        target={addressTarget}
        onClose={() => setAddressTarget(null)}
        onStart={() => setError(null)}
        onError={showError}
        onRemoved={onChanged}
      />
      <RemoveDomainDialog
        target={domainTarget}
        onClose={() => setDomainTarget(null)}
        onStart={() => setError(null)}
        onError={showError}
        onRemoved={onChanged}
      />
    </SettingsCard>
  )
}

export function DomainView({
  row,
  links,
  visibleUses,
  onChanged,
}: {
  row: DomainRow
  links: DomainUseLinks
  /** The uses whose permission the viewer holds. */
  visibleUses: readonly DomainUse[]
  /** Called after a check or a removal, to read the domain again. */
  onChanged: () => void
}) {
  const sending = useSendingDomain(row.name)
  const uses = row.uses.filter((u) => visibleUses.includes(u.use))
  return (
    <>
      {uses.map((use) =>
        use.use === 'email' ? (
          <EmailCard
            key={use.use}
            use={use}
            domain={sending.domain}
            link={links.email}
            onChanged={onChanged}
          />
        ) : (
          <LinkedUseCard key={use.use} use={use} link={links[use.use]} />
        )
      )}
      <UsesCard uses={uses} links={links} sending={sending} onChanged={onChanged} />
    </>
  )
}
