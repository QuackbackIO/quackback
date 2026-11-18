/**
 * The Custom domains card on Settings > Portal, Custom domains: the primary domain (Portal)
 * first, naming the sections it also serves, then one row per section with a
 * domain of its own, in nav order. Each section row is verified, changed and
 * removed from its menu; Add custom domain asks what the domain is used for
 * first. A self-hosted primary domain is BASE_URL, so its row is fixed.
 *
 * On a self-hosted server a hostname not yet verified shows the CNAME it needs.
 * On Cloud the records belong to the custom domain itself, on the Domain
 * verification card below.
 */
import { Fragment, lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  RowActions,
  SettingsList,
  SettingsListRow,
} from '@/components/admin/settings/settings-list'
import type { CheckResult } from '@/components/admin/settings/section-domain-record'
import type { DnsRecordRow } from '@/components/shared/dns-record-table'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { errorText } from '@/lib/client/error-text'
import { CUSTOM_DOMAINS_ANCHOR } from '@/lib/shared/section-domains'
import {
  usedForLabel,
  type CustomDomainUsedFor,
  type PortalSection,
} from '@/lib/shared/custom-domains'
import { PORTAL_SECTIONS, type SectionDomainMap } from '@/lib/shared/section-domains'
import {
  notAnsweringNote,
  sectionDomainState,
  type SectionDomainState,
} from '@/lib/shared/section-domains'
import type { PortalNavConfig } from '@/lib/shared/types/settings'
import {
  setSectionDomainFn,
  verifySectionDomainFn,
  type SectionDomainsView,
} from '@/lib/server/functions/section-domains'

// Loaded when it opens, so the page ships only the list.
const SectionDomainDialog = lazy(() =>
  import('@/components/admin/settings/section-domain-dialog').then((m) => ({
    default: m.SectionDomainDialog,
  }))
)

// Each is loaded only when shown: a removal being confirmed, a record still awaited.
const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({ default: m.ConfirmDialog }))
)
const SectionDomainRecord = lazy(() => import('@/components/admin/settings/section-domain-record'))

export const CUSTOM_DOMAINS_TITLE = 'Custom domains'

/**
 * The sections the card rows, in the portal nav's order: each one that is on,
 * and one that is off but keeps its hostname (it still has to be removable).
 */
export function listedSections({
  nav,
  sectionEnabled,
  map,
}: {
  nav: PortalNavConfig | null | undefined
  sectionEnabled: Record<PortalSection, boolean>
  map: SectionDomainMap
}): PortalSection[] {
  // The saved order first, then any section it does not name, as the nav editor seeds it.
  const saved = (nav?.items ?? []).flatMap((item) => (item.type === 'link' ? [] : [item.type]))
  const order = [...new Set([...saved, ...PORTAL_SECTIONS])]
  return order.filter((section) => sectionEnabled[section] || map[section])
}

/** Holds a row's place where it has no menu, so every domain lines up. */
const MENU_SPACE = <span aria-hidden="true" className="size-7 shrink-0" />

const STATE_BADGE = {
  verified: null,
  pending: 'pending',
  'not-answering': 'attention',
} as const satisfies Record<SectionDomainState, BadgeState | null>

export function SectionDomainsCard({
  view,
  sections,
  sectionEnabled,
  cloud,
  readyHostnames,
  cloudHostnames,
  cloudDomainsUnavailable,
  loadVerifiedDomains,
  loadCloudRecords,
  canAdd,
  onChanged,
  onMakePrimary,
  onAddDomain,
  onAddVerifiedDomain,
  refreshCloudDomain,
}: {
  view: SectionDomainsView
  /** The sections to row, in nav order (`listedSections`). */
  sections: readonly PortalSection[]
  sectionEnabled: Record<PortalSection, boolean>
  cloud: boolean
  /** Cloud: the custom domains that are ready and not the primary domain. */
  readyHostnames: readonly string[]
  /** Cloud: every custom domain's hostname, ready or not. */
  cloudHostnames?: readonly string[]
  /** Cloud: the custom domains could not be read, so the two lists above are not known. */
  cloudDomainsUnavailable?: boolean
  /** Reads the Verified domains Add custom domain offers. */
  loadVerifiedDomains?: () => Promise<readonly string[]>
  /** Cloud: reads the DNS records a custom domain needs. */
  loadCloudRecords?: (hostname: string) => Promise<DnsRecordRow[]>
  /** False on Cloud without the custom domain entitlement. */
  canAdd: boolean
  onChanged: () => void
  onMakePrimary?: (hostname: string) => void
  onAddDomain?: () => void
  /** Go to Settings > Domains to add one; only for a viewer who may. */
  onAddVerifiedDomain?: (section: PortalSection) => void
  /** Cloud: asks the control plane to look at a custom domain again, before Verify reads it. */
  refreshCloudDomain?: (hostname: string) => Promise<unknown>
}) {
  const map = view.sectionDomains
  const primary = view.primaryHost ?? ''
  const [dialog, setDialog] = useState<{ initial: CustomDomainUsedFor | null } | null>(null)
  const [removing, setRemoving] = useState<PortalSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<Partial<Record<PortalSection, CheckResult>>>({})

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null)
    setBusy(true)
    try {
      // A refusal comes back as a value whose words are written for this page.
      const { ok, message: refusal } = await action()
      if (!ok) setError(refusal ?? "Couldn't update the custom domain.")
      else onChanged()
    } catch (err) {
      setError(errorText(err, "Couldn't update the custom domain."))
    } finally {
      setBusy(false)
    }
  }

  const verify = (section: PortalSection) =>
    run(async () => {
      // Cloud: the control plane looks again first, as the dialog's Verify does.
      const hostname = map[section]?.hostname
      if (cloud && hostname && refreshCloudDomain) await refreshCloudDomain(hostname)
      const result = await verifySectionDomainFn({ data: { section } })
      if (result.ok && result.status) {
        const status = result.status
        setChecks((prev) => ({ ...prev, [section]: status }))
      }
      return result
    })

  const remove = (section: PortalSection) =>
    run(() => setSectionDomainFn({ data: { section, hostname: null } }))

  const removingEntry = removing ? map[removing] : undefined
  const own = sections.filter((section) => map[section])
  const alsoServes = sections
    .filter((section) => !map[section] && sectionEnabled[section])
    .map(usedForLabel)
    .join(', ')
  const add = canAdd ? (
    <Button size="sm" variant="outline" onClick={() => setDialog({ initial: null })}>
      Add custom domain
    </Button>
  ) : undefined

  return (
    <SettingsCard
      id={CUSTOM_DOMAINS_ANCHOR}
      title={CUSTOM_DOMAINS_TITLE}
      // With no section domain yet, the empty state below holds Add custom domain.
      action={own.length ? add : undefined}
      flush
    >
      <SettingsList>
        <SettingsListRow
          title={usedForLabel('portal')}
          meta={alsoServes ? `Primary domain · Also serves ${alsoServes}` : 'Primary domain'}
          wrapMeta
          trailing={
            <>
              <span className="truncate text-foreground">{primary}</span>
              {cloud && canAdd ? (
                <RowActions
                  label={usedForLabel('portal')}
                  items={[{ label: 'Change', onSelect: () => setDialog({ initial: 'portal' }) }]}
                />
              ) : (
                MENU_SPACE
              )}
            </>
          }
        />
        {own.map((section) => {
          const entry = map[section]!
          const label = usedForLabel(section)
          const state = sectionDomainState(entry)
          const badge = STATE_BADGE[state]
          const off = !sectionEnabled[section]
          const showsRecord = !cloud && state !== 'verified' && !!primary
          // A domain that needs a check has Verify on its row too; a verified one has it in the menu.
          const needsVerify = state === 'pending' || state === 'not-answering'
          // The second line: only a state that needs action speaks, and it says the next step.
          // Modules are turned on in Settings > General; named, not linked, as the page's JS budget is tight.
          const note =
            state === 'not-answering'
              ? notAnsweringNote(entry)
              : state === 'pending' && checks[section]?.verified === false
                ? 'Not verified yet. DNS changes can take a while to show.'
                : off
                  ? `Turn ${label} on in Settings > General to use this domain.`
                  : undefined
          return (
            <Fragment key={section}>
              <SettingsListRow
                title={label}
                meta={note ?? undefined}
                wrapMeta
                badges={
                  badge || off ? (
                    <>
                      {badge && <StateBadge state={badge} />}
                      {off && <StateBadge state="off" />}
                    </>
                  ) : undefined
                }
                // The row carries its menu in the trailing controls, so on a
                // phone they move under the text together.
                stackTrailing
                trailing={
                  <>
                    <span className="min-w-0 truncate text-foreground max-sm:flex-1">
                      {entry.hostname}
                    </span>
                    {needsVerify && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void verify(section)}
                        disabled={busy}
                      >
                        Verify
                      </Button>
                    )}
                    <RowActions
                      label={label}
                      items={[
                        { label: 'Verify', onSelect: () => void verify(section), disabled: busy },
                        ...(canAdd
                          ? [{ label: 'Change', onSelect: () => setDialog({ initial: section }) }]
                          : []),
                        {
                          label: 'Remove',
                          onSelect: () => setRemoving(section),
                          destructive: true,
                          disabled: busy,
                        },
                      ]}
                    />
                  </>
                }
              />
              {showsRecord && (
                <div data-slot="section-domain-records" className="px-4 pb-3 sm:px-6">
                  <Suspense fallback={null}>
                    <SectionDomainRecord entry={entry} target={primary} check={checks[section]} />
                  </Suspense>
                </div>
              )}
            </Fragment>
          )
        })}
      </SettingsList>
      {own.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 px-4 py-3 sm:px-6">
          <p className="text-[13px] text-muted-foreground">No section has its own domain yet.</p>
          {add}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="border-t border-border/50 px-4 py-3 text-sm text-destructive sm:px-6"
        >
          {error}
        </p>
      )}
      {dialog && (
        <Suspense fallback={null}>
          <SectionDomainDialog
            open
            initial={dialog?.initial ?? null}
            cloud={cloud}
            sections={sections}
            map={map}
            primaryHost={view.primaryHost}
            readyHostnames={readyHostnames}
            cloudHostnames={cloudHostnames}
            cloudDomainsUnavailable={cloudDomainsUnavailable}
            loadVerifiedDomains={loadVerifiedDomains}
            loadCloudRecords={loadCloudRecords}
            onAddVerifiedDomain={onAddVerifiedDomain}
            onSaved={() => {
              // A changed hostname has not been checked yet: forget what the last Verify found.
              setChecks({})
              onChanged()
            }}
            onClose={() => setDialog(null)}
            onMakePrimary={onMakePrimary}
            onAddDomain={onAddDomain}
          />
        </Suspense>
      )}
      {removing && (
        <Suspense fallback={null}>
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setRemoving(null)}
            title={
              removingEntry
                ? `Stop using ${removingEntry.hostname} for ${usedForLabel(removing)}?`
                : ''
            }
            description={`${usedForLabel(removing)} goes back to the primary domain.`}
            confirmLabel="Remove"
            variant="destructive"
            isPending={busy}
            onConfirm={() => {
              const section = removing
              setRemoving(null)
              if (section) void remove(section)
            }}
          />
        </Suspense>
      )}
    </SettingsCard>
  )
}
