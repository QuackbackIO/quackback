/**
 * The Custom domains card on Settings > Domains: where people reach the
 * portal, one row for the portal (the primary domain) and one per section in
 * nav order. A section without a hostname of its own is served on the primary
 * domain. Each row is verified, changed and removed from its menu; Add custom
 * domain asks what the domain is used for first.
 *
 * On a self-hosted server a hostname not yet verified shows the CNAME it needs.
 * On Cloud the records belong to the custom domain itself, on the card below.
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
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { errorText } from '@/lib/client/error-text'
import { cn } from '@/lib/shared/utils'
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
  canAdd,
  onChanged,
  onMakePrimary,
  onAddDomain,
}: {
  view: SectionDomainsView
  /** The sections to row, in nav order (`listedSections`). */
  sections: readonly PortalSection[]
  sectionEnabled: Record<PortalSection, boolean>
  cloud: boolean
  /** Cloud: the custom domains that are ready and not the primary domain. */
  readyHostnames: readonly string[]
  /** False on Cloud without the custom domain entitlement. */
  canAdd: boolean
  onChanged: () => void
  onMakePrimary?: (hostname: string) => void
  onAddDomain?: () => void
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

  return (
    <SettingsCard
      id={CUSTOM_DOMAINS_ANCHOR}
      title={CUSTOM_DOMAINS_TITLE}
      action={
        canAdd ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ initial: null })}>
            Add custom domain
          </Button>
        ) : undefined
      }
      flush
    >
      <SettingsList>
        <SettingsListRow
          title={usedForLabel('portal')}
          meta="Primary domain"
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
        {sections.map((section) => {
          const entry = map[section]
          const label = usedForLabel(section)
          const state = entry ? sectionDomainState(entry) : null
          const badge = state ? STATE_BADGE[state] : null
          const off = !sectionEnabled[section]
          const showsRecord = !cloud && !!entry && state !== 'verified' && !!primary
          // A domain that needs a check has Verify on its row too; a verified one has it in the menu.
          const needsVerify = state === 'pending' || state === 'not-answering'
          // The second line: only a state that needs action speaks, and it says the next step.
          // Modules are turned on in Settings > General; named, not linked, as the page's JS budget is tight.
          const note = !entry
            ? undefined
            : state === 'not-answering'
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
                // A row with its own domain carries its menu in the trailing
                // controls, so on a phone they move under the text together.
                stackTrailing={!!entry}
                trailing={
                  <>
                    <span
                      className={cn(
                        'min-w-0 truncate',
                        entry ? 'text-foreground max-sm:flex-1' : 'text-muted-foreground'
                      )}
                    >
                      {entry?.hostname ?? primary}
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
                    {/* A section on the primary domain is quiet: Add custom domain sets it. */}
                    {entry ? (
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
                    ) : (
                      MENU_SPACE
                    )}
                  </>
                }
              />
              {showsRecord && entry && (
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
              removing && removingEntry
                ? `Stop using ${removingEntry.hostname} for ${usedForLabel(removing)}?`
                : ''
            }
            description={
              removing ? `${usedForLabel(removing)} goes back to the primary domain.` : undefined
            }
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
