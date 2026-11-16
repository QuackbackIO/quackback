/**
 * One domain's page body: its ownership, then its three uses (Email sending,
 * Custom domains, Sign-in), each set up from its row until it is on, then shown
 * with where it stands and removed on its own. Email's records and
 * addresses follow, checked and removed with the pieces Settings → Email uses.
 * The domain itself is removed only once no use holds it. A viewer sees only
 * the uses whose permission they hold.
 */
import { lazy, Suspense, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { DomainUse, DomainUseLinks, UseLink } from '@/lib/shared/domains-permissions'
import { DOMAIN_USE_ORDER } from '@/lib/shared/domain-uses'
import { verifiedThroughLabel } from '@/lib/shared/domain-proof'
import { DomainSetupPanel } from '@/components/admin/channels/domain-setup-panel'
import { errorText } from '@/lib/client/error-text'
import { domainPhase } from '@/components/admin/channels/sending-domain-view'
import {
  SendingAddressDialog,
  type SendingAddressDialogTarget,
} from '@/components/admin/channels/sending-address-dialog'
import { oldestFirst, useEmailConfigView } from '@/components/admin/channels/email-config-view'
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
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DnsRecordTable } from '@/components/shared/dns-record-table'
import { StateBadge } from '@/components/shared/state-badge'
import { Button } from '@/components/ui/button'
import { useRestartSendingDomainChecks } from '@/lib/client/mutations/channel-accounts'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import {
  addDomainFn,
  checkDomainOwnershipFn,
  removeDomainFn,
  type DomainDetail,
  type DomainOwnershipResult,
} from '@/lib/server/functions/domains'
import { addProviderDomainFn, removeVerifiedDomainFn } from '@/lib/server/functions/sso'
import { mutateCloudCustomDomainFn } from '@/lib/server/functions/cloud-identity'
import type { SectionDomainsView } from '@/lib/server/functions/section-domains'
import type { PortalSection } from '@/lib/shared/custom-domains'
import {
  USE_COPY,
  customDomainLine,
  type DomainRow,
  type DomainUseStatus,
} from './domains-overview'
import { AddCustomDomainDialog, type AddCustomDomainTarget } from './add-custom-domain-dialog'

// Loaded when it opens: most visits never add a custom domain here.
const SectionDomainDialog = lazy(() =>
  import('./section-domain-dialog').then((m) => ({ default: m.SectionDomainDialog }))
)

/** The name of the page a use is set up on, as its link reads. */
function pageName(use: DomainUse): string {
  if (use === 'email') return 'Email settings'
  if (use === 'signIn') return 'Sign-in settings'
  return 'Custom domains'
}

function LinkButton({ link, children }: { link: UseLink; children: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={link.to} search={link.search} hash={link.hash}>
        {children}
      </Link>
    </Button>
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
  const view = useEmailConfigView()
  const { data, domains } = view
  const domain = domains.find((d) => d.domain.toLowerCase() === name) ?? null
  const addresses = domain
    ? oldestFirst(view.addresses.filter((a) => domainOf(a, domains)?.id === domain.id))
    : []
  return { view, data, domain, addresses }
}

/**
 * A change made from the page: busy while it runs, its error shown in place,
 * and the page read again afterwards unless the action returns `false`.
 */
function useDomainAction(onChanged: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null)
    setBusy(true)
    try {
      if ((await action()) !== false) onChanged()
    } catch (err) {
      setError(errorText(err, fallback))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

const CHECK_FAILED: Record<Extract<DomainOwnershipResult, { ok: false }>['reason'], string> = {
  'no-record': "We couldn't find the record yet.",
  mismatch: 'The record has a different value. Replace it with the value above.',
  'lookup-failed': "Couldn't look up the record. Try again in a moment.",
}

/** Whether the workspace controls the domain, and the one record that proves it. */
function OwnershipCard({
  domain,
  canManage,
  onChanged,
  onRemoved,
}: {
  domain: DomainDetail
  canManage: boolean
  onChanged: () => void
  onRemoved: () => void
}) {
  const { busy, error, setError, run } = useDomainAction(onChanged)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const verified = domain.status === 'verified' || domain.provenBy !== null

  const check = () =>
    run(async () => {
      const result = await checkDomainOwnershipFn({ data: { name: domain.name } })
      if (result.ok) return
      setError(CHECK_FAILED[result.reason])
      return false
    }, "Couldn't check the record.")

  const addRecord = () =>
    run(() => addDomainFn({ data: { name: domain.name } }), "Couldn't add the record.")

  const remove = () =>
    run(async () => {
      await removeDomainFn({ data: { name: domain.name } })
      onRemoved()
      return false
    }, "Couldn't remove the domain.")

  return (
    <SettingsCard
      title="Domain verification"
      action={verified ? null : <StateBadge state="pending" />}
      flush
    >
      <div className="space-y-3 px-4 py-3 sm:px-6">
        {domain.provenBy ? (
          <p className="text-[13px] text-muted-foreground">
            {verifiedThroughLabel(domain.provenBy)}
          </p>
        ) : domain.record ? (
          <DnsRecordTable
            records={[
              {
                label: 'Verification',
                type: 'TXT',
                name: domain.record.host,
                value: domain.record.value,
                state: verified ? 'found' : 'waiting',
              },
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">Not verified yet.</p>
        )}
        {canManage && (!verified || (domain.added && !domain.inUse)) && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!verified &&
              (domain.record ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={check}>
                  Check now
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={addRecord}>
                  Verify domain
                </Button>
              ))}
            {domain.added && !domain.inUse && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove domain
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${domain.name}?`}
        description="Its verification record can be deleted afterwards."
        confirmLabel="Remove domain"
        variant="destructive"
        isPending={busy}
        onConfirm={() => {
          setConfirmRemove(false)
          void remove()
        }}
      />
    </SettingsCard>
  )
}

/** Removing a sign-in domain, from its row. Custom domains are removed on the Custom domains card. */
interface SignInRemoval {
  id: string
}

/** Where the domain's custom domains are set: Cloud adds them, a self-hosted server maps a section. */
export interface CustomDomainSetup {
  cloud: boolean
  /** The section map and primary domain; null when they could not be read. */
  sectionDomains: SectionDomainsView | null
  /** The sections offered, in nav order. */
  sections: readonly PortalSection[]
}

/**
 * The three uses, each a row: Set up until it is on, then where it stands and
 * a Remove of its own. Set up runs here, for a viewer who may set that use up:
 * email opens Add address on this domain; a custom domain is named on the domain
 * (help.acme.com) and, on Cloud, added as a custom domain for the portal, or,
 * self-hosted, given to the section chosen; sign-in goes to the one identity
 * provider, or to Sign-in settings to pick one (the providers are read on the
 * click, not with the page). Email with addresses on it is removed an address
 * at a time, in the list below; a custom domain on the Custom domains card.
 */
function UsesCard({
  name,
  uses,
  visibleUses,
  links,
  setup,
  sending,
  onChanged,
}: {
  name: string
  uses: DomainUseStatus[]
  visibleUses: readonly DomainUse[]
  links: DomainUseLinks
  setup: CustomDomainSetup
  sending: ReturnType<typeof useSendingDomain>
  onChanged: () => void
}) {
  const [domainTarget, setDomainTarget] = useState<DomainRemoval | null>(null)
  const [other, setOther] = useState<SignInRemoval | null>(null)
  const [addressDialog, setAddressDialog] = useState<SendingAddressDialogTarget | null>(null)
  const [webDialog, setWebDialog] = useState<AddCustomDomainTarget | null>(null)
  const [sectionDialog, setSectionDialog] = useState(false)
  const { busy, error, setError, run } = useDomainAction(onChanged)
  const { data, domain, addresses } = sending
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const removeSignIn = (target: SignInRemoval) =>
    run(() => removeVerifiedDomainFn({ data: { id: target.id } }), "Couldn't remove it.")

  /** The hostname typed in Add custom domain on Cloud: a custom domain for the portal. */
  const addWebAddress = (hostname: string) => {
    setWebDialog(null)
    void run(
      () => mutateCloudCustomDomainFn({ data: { action: 'add', hostname } }),
      "Couldn't add the custom domain."
    )
  }

  const addCustomDomain = (prefix: string) =>
    setup.cloud ? setWebDialog({ prefix }) : setSectionDialog(true)

  const setUp: Record<DomainUse, () => void> = {
    email: () => setAddressDialog({ kind: 'add', domain: name }),
    customDomain: () => addCustomDomain('feedback'),
    signIn: () =>
      void run(async () => {
        const providers = await queryClient.fetchQuery(settingsQueries.identityProviders())
        const only = providers.length === 1 ? providers[0] : undefined
        if (only) return addProviderDomainFn({ data: { providerId: only.id, name } })
        // With no identity provider or a choice of them, Sign-in settings picks one.
        const link = links.signIn!
        await navigate({ to: link.to, search: link.search, hash: link.hash })
        return false
      }, "Couldn't add the domain to sign-in."),
  }

  /** Set up for a use that is not on, when the viewer may set it up. */
  const setUpControl = (use: DomainUse) =>
    links[use] ? (
      <Button variant="outline" size="sm" disabled={busy} onClick={setUp[use]}>
        Set up
      </Button>
    ) : undefined

  const removeButton = (onClick: () => void) => (
    <Button variant="outline" size="sm" disabled={busy} onClick={onClick}>
      Remove
    </Button>
  )

  /** The way to remove a use that is on, when the viewer can remove it here. */
  const removal = (status: DomainUseStatus) => {
    if (status.use === 'email') {
      // With addresses on it, email goes an address at a time below.
      if (!data || !domain || addresses.length > 0) return null
      return removeButton(() => setDomainTarget({ id: domain.id, domain: domain.domain }))
    }
    if (status.use === 'signIn') {
      const id = status.id
      return id ? removeButton(() => setOther({ id })) : null
    }
    // Custom domains are removed on the Custom domains card, one section at a time.
    return null
  }

  const meta = (status: DomainUseStatus) => {
    if (status.use === 'email' && data && domain && addresses.length === 0) {
      return 'No address uses this domain'
    }
    if (status.addresses?.length) {
      return status.addresses.map((a) => (
        <span key={a.hostname} className="block">
          {customDomainLine(a, '')}
        </span>
      ))
    }
    return status.detail
  }

  return (
    <SettingsCard title="Used for" flush>
      <SettingsList>
        {DOMAIN_USE_ORDER.filter((use) => visibleUses.includes(use)).map((use) => {
          const link = links[use]
          const status = uses.find((u) => u.use === use)
          if (!status) {
            return (
              <SettingsListRow
                key={use}
                title={USE_COPY[use].title}
                meta={USE_COPY[use].description}
                wrapMeta
                trailing={setUpControl(use)}
              />
            )
          }
          return (
            <SettingsListRow
              key={use}
              title={USE_COPY[use].title}
              meta={meta(status)}
              wrapMeta
              stackTrailing
              badges={status.state ? <StateBadge state={status.state} /> : undefined}
              trailing={
                <>
                  {use === 'customDomain' && link && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => addCustomDomain('')}
                    >
                      Add custom domain
                    </Button>
                  )}
                  {use !== 'email' && link && <LinkButton link={link}>{pageName(use)}</LinkButton>}
                  {removal(status)}
                </>
              }
            />
          )
        })}
      </SettingsList>
      {error && <ErrorLine>{error}</ErrorLine>}
      <SendingAddressDialog
        target={addressDialog}
        workspaceName={sending.view.workspaceName}
        domains={data?.domains}
        setsUpDomains={sending.view.addressMode === 'verified-domains'}
        ownDomains={sending.view.ownDomains}
        onAdded={onChanged}
        onClose={() => setAddressDialog(null)}
      />
      <RemoveDomainDialog
        target={domainTarget}
        onClose={() => setDomainTarget(null)}
        onStart={() => setError(null)}
        onError={(fallback) => (e) => setError(errorText(e, fallback))}
        onRemoved={onChanged}
      />
      <ConfirmDialog
        open={other !== null}
        onOpenChange={(open) => !open && setOther(null)}
        title={`Stop using ${name} for sign-in?`}
        description="People at this domain no longer sign in with SSO."
        confirmLabel="Remove"
        variant="destructive"
        isPending={busy}
        onConfirm={() => {
          if (other) void removeSignIn(other)
          setOther(null)
        }}
      />
      <AddCustomDomainDialog
        target={webDialog}
        domain={name}
        usedFor="portal"
        busy={busy}
        onAdd={addWebAddress}
        onClose={() => setWebDialog(null)}
      />
      {!setup.cloud && sectionDialog && (
        <Suspense fallback={null}>
          <SectionDomainDialog
            open
            initial={null}
            cloud={false}
            sections={setup.sections}
            map={setup.sectionDomains?.sectionDomains ?? {}}
            primaryHost={setup.sectionDomains?.primaryHost ?? null}
            readyHostnames={[]}
            suffix={name}
            onSaved={onChanged}
            onClose={() => setSectionDialog(false)}
          />
        </Suspense>
      )}
    </SettingsCard>
  )
}

/** The records email sends with, checked again from here. */
function EmailRecordsCard({
  domain,
  onChanged,
}: {
  domain: SendingDomainDTO
  onChanged: () => void
}) {
  const restart = useRestartSendingDomainChecks()
  const [error, setError] = useState<string | null>(null)
  const phase = domainPhase(domain)
  return (
    <SettingsCard title="Email records" flush>
      <DomainSetupPanel
        hideName
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
      {error && <ErrorLine>{error}</ErrorLine>}
    </SettingsCard>
  )
}

/** The addresses sending from the domain, each removed on its own; the last takes email with it. */
function SendingAddressesCard({
  sending,
  onChanged,
}: {
  sending: ReturnType<typeof useSendingDomain>
  onChanged: () => void
}) {
  const [target, setTarget] = useState<AddressRemoval | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data, domain, addresses } = sending
  if (!data || !domain || addresses.length === 0) return null
  return (
    <SettingsCard title="Sending addresses" flush>
      <SettingsList>
        {addresses.map((a) => (
          <SettingsListRow
            key={a.id}
            title={a.address ?? ''}
            trailing={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTarget({
                    id: a.id,
                    address: a.address ?? '',
                    // Removing the last address on a domain removes the domain too.
                    alsoDomain: addresses.length === 1 ? domain.domain : null,
                    note: removalNote(
                      a.id,
                      sending.view.senders,
                      sending.view.platformFrom,
                      sending.view.platformName
                    ),
                  })
                }
              >
                Remove
              </Button>
            }
          />
        ))}
      </SettingsList>
      {error && <ErrorLine>{error}</ErrorLine>}
      <RemoveAddressDialog
        target={target}
        onClose={() => setTarget(null)}
        onStart={() => setError(null)}
        onError={(fallback) => (e) => setError(errorText(e, fallback))}
        onRemoved={onChanged}
      />
    </SettingsCard>
  )
}

export function DomainView({
  row,
  domain,
  links,
  setup,
  visibleUses,
  canManage,
  onChanged,
  onRemoved,
}: {
  row: DomainRow
  /** The domain itself; null when it could not be read. */
  domain: DomainDetail | null
  links: DomainUseLinks
  setup: CustomDomainSetup
  /** The uses whose permission the viewer holds. */
  visibleUses: readonly DomainUse[]
  /** Whether the viewer adds, checks and removes domains (settings.manage). */
  canManage: boolean
  /** Called after a check or a removal, to read the domain again. */
  onChanged: () => void
  /** Called once the domain itself is removed. */
  onRemoved: () => void
}) {
  const sending = useSendingDomain(row.name)
  const uses = row.uses.filter((u) => visibleUses.includes(u.use))
  const emailOn = uses.some((u) => u.use === 'email')
  return (
    <>
      {domain && (
        <OwnershipCard
          domain={domain}
          canManage={canManage}
          onChanged={onChanged}
          onRemoved={onRemoved}
        />
      )}
      {visibleUses.length > 0 && (
        <UsesCard
          name={row.name}
          uses={uses}
          visibleUses={visibleUses}
          links={links}
          setup={setup}
          sending={sending}
          onChanged={onChanged}
        />
      )}
      {emailOn && sending.domain && (
        <EmailRecordsCard domain={sending.domain} onChanged={onChanged} />
      )}
      {emailOn && <SendingAddressesCard sending={sending} onChanged={onChanged} />}
    </>
  )
}
