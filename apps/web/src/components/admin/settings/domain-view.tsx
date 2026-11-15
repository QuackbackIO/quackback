/**
 * One domain's page body: its ownership, then its three uses (Email sending,
 * Web addresses, Sign-in), each set up from its row until it is on, then shown
 * with where it stands and removed on its own. Email's records and
 * addresses follow, checked and removed with the pieces Settings → Email uses.
 * The domain itself is removed only once no use holds it. A viewer sees only
 * the uses whose permission they hold.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  HELP_CENTER_SETTINGS,
  type DomainUse,
  type DomainUseLinks,
  type UseLink,
} from '@/lib/shared/domains-permissions'
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
import { updateHelpCenterDomainFn } from '@/lib/server/functions/help-center-domain'
import { mutateCloudCustomDomainFn } from '@/lib/server/functions/cloud-identity'
import {
  USE_COPY,
  customDomainLine,
  type DomainRow,
  type DomainUseStatus,
} from './domains-overview'
import { AddCustomDomainDialog, type AddCustomDomainTarget } from './add-custom-domain-dialog'

/** The name of the page a use is set up on, as its link reads. */
function pageName(use: DomainUse, link: UseLink): string {
  if (use === 'email') return 'Email settings'
  if (use === 'signIn') return 'Sign-in settings'
  return link.to === HELP_CENTER_SETTINGS ? 'Help center settings' : 'Custom domains'
}

/** What a use is for, on a row where it is not on yet. */
function useDescription(use: DomainUse, link: UseLink | undefined): string {
  // Off Cloud the only web address an install takes is its help center's.
  if (use === 'customDomain' && link?.to === HELP_CENTER_SETTINGS) {
    return 'Use this domain for your help center.'
  }
  return USE_COPY[use].description
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

/** Removing a sign-in domain or the help center's address, from its row. */
type OtherRemoval = { use: 'signIn'; id: string } | { use: 'customDomain'; hostname: string }

const OTHER_REMOVAL_TITLE: Record<OtherRemoval['use'], (name: string) => string> = {
  signIn: (name) => `Stop using ${name} for sign-in?`,
  customDomain: (hostname) => `Stop serving the help center on ${hostname}?`,
}

const OTHER_REMOVAL_NOTE: Record<OtherRemoval['use'], string> = {
  signIn: 'People at this domain no longer sign in with SSO.',
  customDomain: 'The help center stays on its default address.',
}

/**
 * The three uses, each a row: Set up until it is on, then where it stands and
 * a Remove of its own. Set up runs here, for a viewer who may set that use up:
 * email opens Add address on this domain; a custom domain is named on the domain
 * (help.acme.com) and added as a Cloud web address, or becomes the help
 * center's address (confirmed first when that moves the help center off
 * another one); sign-in goes to the one identity
 * provider, or to Sign-in settings to pick one (the providers are read on the
 * click, not with the page). Email with addresses on it is
 * removed an address at a time, in the list below.
 */
function UsesCard({
  name,
  uses,
  visibleUses,
  links,
  helpCenterDomain,
  sending,
  onChanged,
}: {
  name: string
  uses: DomainUseStatus[]
  visibleUses: readonly DomainUse[]
  links: DomainUseLinks
  helpCenterDomain: string | null
  sending: ReturnType<typeof useSendingDomain>
  onChanged: () => void
}) {
  const [domainTarget, setDomainTarget] = useState<DomainRemoval | null>(null)
  const [other, setOther] = useState<OtherRemoval | null>(null)
  const [addressDialog, setAddressDialog] = useState<SendingAddressDialogTarget | null>(null)
  const [webDialog, setWebDialog] = useState<AddCustomDomainTarget | null>(null)
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const { busy, error, setError, run } = useDomainAction(onChanged)
  const { data, domain, addresses } = sending
  const helpCenter = links.customDomain?.to === HELP_CENTER_SETTINGS
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const removeOther = (target: OtherRemoval) =>
    run(
      () =>
        target.use === 'signIn'
          ? removeVerifiedDomainFn({ data: { id: target.id } })
          : updateHelpCenterDomainFn({ data: { domain: null } }),
      "Couldn't remove it."
    )

  const setHelpCenterAddress = (hostname: string) =>
    run(
      () => updateHelpCenterDomainFn({ data: { domain: hostname } }),
      "Couldn't set the help center's address."
    )

  /** The hostname typed in Add custom domain: a Cloud custom domain, or the help center's. */
  const addWebAddress = (hostname: string) => {
    setWebDialog(null)
    if (!helpCenter) {
      void run(
        () => mutateCloudCustomDomainFn({ data: { action: 'add', hostname } }),
        "Couldn't add the custom domain."
      )
    } else if (helpCenterDomain && helpCenterDomain !== hostname) {
      setMoveTo(hostname)
    } else {
      void setHelpCenterAddress(hostname)
    }
  }

  const setUp: Record<DomainUse, () => void> = {
    email: () => setAddressDialog({ kind: 'add', domain: name }),
    customDomain: () => setWebDialog({ prefix: helpCenter ? 'help' : 'feedback' }),
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
      return id ? removeButton(() => setOther({ use: 'signIn', id })) : null
    }
    // Only the help center's own address is cleared from here; Cloud's are on their card.
    if (!helpCenter) return null
    const hostname =
      status.addresses?.find((a) => a.usedFor === 'help')?.hostname ?? helpCenterDomain ?? name
    return removeButton(() => setOther({ use: 'customDomain', hostname }))
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
                meta={useDescription(use, link)}
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
                  {use === 'customDomain' && link && !helpCenter && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setWebDialog({ prefix: '' })}
                    >
                      Add custom domain
                    </Button>
                  )}
                  {use !== 'email' && link && (
                    <LinkButton link={link}>{pageName(use, link)}</LinkButton>
                  )}
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
        title={
          other
            ? OTHER_REMOVAL_TITLE[other.use](other.use === 'customDomain' ? other.hostname : name)
            : ''
        }
        description={other ? OTHER_REMOVAL_NOTE[other.use] : undefined}
        confirmLabel="Remove"
        variant="destructive"
        isPending={busy}
        onConfirm={() => {
          if (other) void removeOther(other)
          setOther(null)
        }}
      />
      <AddCustomDomainDialog
        target={webDialog}
        domain={name}
        usedFor={helpCenter ? 'help' : 'portal'}
        busy={busy}
        onAdd={addWebAddress}
        onClose={() => setWebDialog(null)}
      />
      <ConfirmDialog
        open={moveTo !== null}
        onOpenChange={(open) => !open && setMoveTo(null)}
        title={`Move the help center to ${moveTo}?`}
        description={`${helpCenterDomain} will stop serving the help center.`}
        confirmLabel="Move help center"
        isPending={busy}
        onConfirm={() => {
          const target = moveTo
          setMoveTo(null)
          if (target) void setHelpCenterAddress(target)
        }}
      />
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
  helpCenterDomain = null,
  visibleUses,
  canManage,
  onChanged,
  onRemoved,
}: {
  row: DomainRow
  /** The domain itself; null when it could not be read. */
  domain: DomainDetail | null
  links: DomainUseLinks
  /** The help center's own domain off Cloud, when one is set. */
  helpCenterDomain?: string | null
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
          helpCenterDomain={helpCenterDomain}
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
