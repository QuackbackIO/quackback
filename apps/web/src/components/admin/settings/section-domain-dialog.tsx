/**
 * Add custom domain: what the domain is used for first, as tiles (Portal on
 * Cloud, then each section in nav order), then only the field that choice needs.
 *
 * - Portal is the primary domain. On Cloud a ready custom domain is made
 *   primary. A self-hosted server's primary domain is its BASE_URL, so it
 *   offers no Portal tile.
 * - A section picks from what the workspace already has: each Verified domain
 *   with the section's name in front (the name editable in place), then on
 *   Cloud each ready custom domain no other section uses, then Another domain
 *   for a hostname typed in full. With no Verified domain yet, it points to
 *   Settings > Domains first. On Cloud a hostname that is not yet a custom
 *   domain is added as one on Save.
 * - After Save the dialog stays open on the DNS record to add, with Verify in
 *   place, until the hostname is verified or the admin is done.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { webAddressOn } from '@/components/admin/settings/add-custom-domain-dialog'
import { cnameRecord, type CheckResult } from '@/components/admin/settings/section-domain-record'
import { DnsRecordTable, type DnsRecordRow } from '@/components/shared/dns-record-table'
import { errorText } from '@/lib/client/error-text'
import { setSectionDomainFn, verifySectionDomainFn } from '@/lib/server/functions/section-domains'
import { mutateCloudCustomDomainFn } from '@/lib/server/functions/cloud-identity'
import {
  usedForLabel,
  type CustomDomainUsedFor,
  type PortalSection,
} from '@/lib/shared/custom-domains'
import {
  normalizeHost,
  notAnsweringNote,
  sectionDomainState,
  sectionOfHost,
  type SectionDomain,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'

/** The name filled in front of a domain for each section. */
const DEFAULT_PREFIX: Record<PortalSection, string> = {
  feedback: 'feedback',
  roadmap: 'roadmap',
  changelog: 'changelog',
  help: 'help',
  support: 'support',
  status: 'status',
}

const NOT_A_NAME = 'Use letters, numbers and hyphens, like help or status.'

/** The choice that reveals the free hostname field. */
const OTHER = 'other'
const ANOTHER_DOMAIN = 'Another domain'
const VERIFIED = 'verified:'
/** Up to this many choices (Another domain included) show as tiles; more, as a select. */
const MAX_TILES = 4

/** What a Verify found, in the words the Custom domains card uses. */
const PENDING_NOTE = 'Not verified yet. DNS changes can take a while to show.'
const VERIFIED_NOTE = 'Verified.'

export interface SectionDomainDialogProps {
  open: boolean
  /** The choice to open on, or null to ask first. */
  initial: CustomDomainUsedFor | null
  cloud: boolean
  /** The sections offered, in nav order. */
  sections: readonly PortalSection[]
  map: SectionDomainMap
  primaryHost: string | null
  /** Cloud: the custom domains that are ready and not the primary domain. */
  readyHostnames: readonly string[]
  /** Cloud: every custom domain's hostname, ready or not; any other is added first. */
  cloudHostnames?: readonly string[]
  /** On a domain's page: the name is typed in front of this domain. */
  suffix?: string
  /** Reads the workspace's Verified domains; without it a section takes a typed hostname. */
  loadVerifiedDomains?: () => Promise<readonly string[]>
  /** Cloud: reads the DNS records a custom domain needs, as the Domain verification card shows them. */
  loadCloudRecords?: (hostname: string) => Promise<DnsRecordRow[]>
  onSaved: () => void
  onClose: () => void
  /** Cloud: make a ready custom domain the primary domain. */
  onMakePrimary?: (hostname: string) => void
  /** Cloud: go to where a new custom domain is added, for Portal. */
  onAddDomain?: () => void
  /** Go to Settings > Domains to add one; given only to a viewer who may add a domain. */
  onAddVerifiedDomain?: () => void
}

export function SectionDomainDialog(props: SectionDomainDialogProps) {
  // Opened from a row's Change: that row already has a domain.
  const changing =
    props.initial === 'portal' || (props.initial !== null && !!props.map[props.initial])
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{changing ? 'Change custom domain' : 'Add custom domain'}</DialogTitle>
        </DialogHeader>
        {props.open && <SectionDomainForm key={props.initial ?? ''} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

/** One hostname a section can pick: a Verified domain (its name editable), or a whole hostname. */
export interface DomainOption {
  value: string
  /** The Verified domain the name goes in front of; absent for a whole hostname. */
  domain?: string
  /** The hostname as offered, with the section's own name in front of a Verified domain. */
  hostname: string
}

/**
 * What a section is offered: each Verified domain with the section's name in
 * front, then each ready custom domain, never a hostname another section or
 * the primary domain already has. A Verified domain that is itself a
 * section's hostname is a use, not a domain to build on, so it is left out.
 */
export function domainOptions({
  section,
  map,
  primaryHost,
  verifiedDomains,
  readyHostnames,
}: {
  section: PortalSection
  map: SectionDomainMap
  primaryHost: string | null
  verifiedDomains: readonly string[]
  readyHostnames: readonly string[]
}): DomainOption[] {
  const takenElsewhere = (hostname: string) => {
    const owner = sectionOfHost(hostname, map)
    return (owner !== null && owner !== section) || hostname === primaryHost
  }
  const names = [...new Set(verifiedDomains.map((name) => normalizeHost(name)))]
  const verified = names.flatMap((domain): DomainOption[] => {
    if (!domain || sectionOfHost(domain, map) !== null) return []
    const hostname = `${DEFAULT_PREFIX[section]}.${domain}`
    return takenElsewhere(hostname) ? [] : [{ value: `${VERIFIED}${domain}`, domain, hostname }]
  })
  const offered = new Set(verified.map((option) => option.hostname))
  const ready = readyHostnames
    .filter((hostname) => !takenElsewhere(hostname) && !offered.has(hostname))
    .map((hostname) => ({ value: hostname, hostname }))
  return [...verified, ...ready]
}

/** The option a section's current hostname is, and the name in front of it. */
function currentChoice(
  current: string | undefined,
  options: readonly DomainOption[]
): { value: string; prefix?: string } | null {
  if (!current) return null
  for (const option of options) {
    if (option.domain && current.endsWith(`.${option.domain}`)) {
      return { value: option.value, prefix: current.slice(0, -option.domain.length - 1) }
    }
    if (!option.domain && option.hostname === current) return { value: option.value }
  }
  return { value: OTHER }
}

/** The hostname a section's free field starts with. */
function startValue(
  section: PortalSection,
  map: SectionDomainMap,
  suffix: string | undefined
): string {
  const current = map[section]?.hostname
  if (!suffix) return current ?? ''
  if (current?.endsWith(`.${suffix}`)) return current.slice(0, -suffix.length - 1)
  return DEFAULT_PREFIX[section]
}

/**
 * The workspace's Verified domains: undefined while they load, null when they
 * cannot be read (or are not asked for), so the free field shows as before.
 */
function useVerifiedDomains(
  load: (() => Promise<readonly string[]>) | undefined
): readonly string[] | null | undefined {
  const [domains, setDomains] = useState<readonly string[] | null | undefined>(
    load ? undefined : null
  )
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(
      (names) => live && setDomains(names),
      () => live && setDomains(null)
    )
    return () => {
      live = false
    }
  }, [load])
  return domains
}

/** The DNS step: the hostname saved, its records and what the last Verify found. */
interface DnsStep {
  section: PortalSection
  hostname: string
  entry: SectionDomain
  check?: CheckResult
  /** Cloud: the records the control plane asks for. */
  cloudRecords?: DnsRecordRow[]
  outcome?: string
}

/** A Cloud hostname's records, or none when they cannot be read: the card below still has them. */
async function readRecords(
  load: ((hostname: string) => Promise<DnsRecordRow[]>) | undefined,
  hostname: string
): Promise<DnsRecordRow[]> {
  if (!load) return []
  return load(hostname).catch(() => [])
}

function outcomeOf(entry: SectionDomain): string {
  const state = sectionDomainState(entry)
  if (state === 'verified') return VERIFIED_NOTE
  if (state === 'not-answering') return notAnsweringNote(entry) ?? PENDING_NOTE
  return PENDING_NOTE
}

function SectionDomainForm({
  initial,
  cloud,
  sections,
  map,
  primaryHost,
  readyHostnames,
  cloudHostnames = [],
  suffix,
  loadVerifiedDomains,
  loadCloudRecords,
  onSaved,
  onClose,
  onMakePrimary,
  onAddDomain,
  onAddVerifiedDomain,
}: SectionDomainDialogProps) {
  const [usedFor, setUsedFor] = useState<CustomDomainUsedFor | null>(initial)
  const [typed, setTyped] = useState(() =>
    initial && initial !== 'portal' ? startValue(initial, map, suffix) : ''
  )
  // Null until the admin picks: the start follows the options once they load.
  const [choice, setChoice] = useState<string | null>(null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const [picked, setPicked] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dns, setDns] = useState<DnsStep | null>(null)
  // A domain's page names the domain itself, so it asks for no other.
  const verifiedDomains = useVerifiedDomains(suffix ? undefined : loadVerifiedDomains)

  const choose = (next: CustomDomainUsedFor) => {
    setUsedFor(next)
    setError(null)
    setTyped(next === 'portal' ? '' : startValue(next, map, suffix))
    setChoice(null)
    setPrefix(null)
    setPicked('')
  }

  // Portal: a ready custom domain no section has.
  const portalChoices =
    cloud && usedFor === 'portal'
      ? readyHostnames.filter((hostname) => sectionOfHost(hostname, map) === null)
      : []

  const section = usedFor && usedFor !== 'portal' ? usedFor : null
  const loading = !!section && !suffix && verifiedDomains === undefined
  const options =
    section && !suffix
      ? domainOptions({
          section,
          map,
          primaryHost,
          verifiedDomains: verifiedDomains ?? [],
          readyHostnames: cloud ? readyHostnames : [],
        })
      : []
  // No Verified domain to build on: send a viewer who may add one there first.
  const emptyState =
    !!section && options.length === 0 && Array.isArray(verifiedDomains) && !!onAddVerifiedDomain
  const startChoice = (() => {
    if (!section || suffix) return OTHER
    const current = currentChoice(map[section]?.hostname, options)
    if (current) return current.value
    if (options.length === 0) return emptyState ? '' : OTHER
    const verifiedOnly = options.filter((option) => option.domain)
    return verifiedOnly.length === 1 ? verifiedOnly[0].value : ''
  })()
  const chosen = choice ?? startChoice
  const chosenOption = options.find((option) => option.value === chosen)
  const startPrefix =
    (section && currentChoice(map[section]?.hostname, options)?.prefix) ??
    (section ? DEFAULT_PREFIX[section] : '')
  const prefixValue = prefix ?? startPrefix

  /** The hostname an option names, with the typed name in front once it is picked. */
  const hostnameOf = (option: DomainOption) => {
    if (!option.domain || option.value !== chosen) return option.hostname
    const name = prefixValue.trim().toLowerCase()
    return name ? `${name}.${option.domain}` : option.domain
  }

  const freeHostname = (): string | null => {
    if (suffix) return webAddressOn(typed, suffix)
    const value = typed.trim().toLowerCase()
    return value || null
  }

  const sectionHostname = (): string | null => {
    if (chosen === OTHER) return freeHostname()
    if (!chosenOption) return null
    if (chosenOption.domain) return webAddressOn(prefixValue, chosenOption.domain)
    return chosenOption.hostname
  }

  const canSave =
    usedFor === 'portal'
      ? !!picked
      : !loading && (chosen === OTHER ? !!typed.trim() : !!chosenOption)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!usedFor || !canSave) return
    if (usedFor === 'portal') {
      onMakePrimary?.(picked)
      onClose()
      return
    }
    const hostname = sectionHostname()
    if (!hostname) {
      setError(NOT_A_NAME)
      return
    }
    setError(null)
    setSaving(true)
    try {
      // Cloud: a hostname the control plane does not route yet is added as a custom domain first.
      const known = [...readyHostnames, ...cloudHostnames].includes(hostname)
      if (cloud && !known) {
        await mutateCloudCustomDomainFn({ data: { action: 'add', hostname } })
      }
      const result = await setSectionDomainFn({ data: { section: usedFor, hostname } })
      if (!result.ok) {
        // A refusal comes back as a value whose words are written for this dialog.
        const { message: refusal } = result
        setError(refusal)
        return
      }
      onSaved()
      const entry = result.sectionDomains[usedFor]
      if (!entry || entry.verifiedAt) {
        onClose()
        return
      }
      setDns({
        section: usedFor,
        hostname,
        entry,
        cloudRecords: cloud ? await readRecords(loadCloudRecords, hostname) : undefined,
      })
    } catch (err) {
      setError(errorText(err, "Couldn't save the custom domain."))
    } finally {
      setSaving(false)
    }
  }

  if (dns) {
    return (
      <PointDns
        step={dns}
        cloud={cloud}
        primaryHost={primaryHost}
        loadCloudRecords={loadCloudRecords}
        onStep={setDns}
        onChecked={onSaved}
        onDone={onClose}
      />
    )
  }

  const tiles = [
    ...(cloud
      ? [
          {
            value: 'portal' as const,
            title: usedForLabel('portal'),
            description: primaryHost ?? '',
          },
        ]
      : []),
    ...sections.map((value) => ({
      value,
      title: usedForLabel(value),
      description: map[value]?.hostname ?? primaryHost ?? '',
    })),
  ]

  const choiceItems = [
    ...options.map((option) => ({ value: option.value, title: hostnameOf(option) })),
    { value: OTHER, title: ANOTHER_DOMAIN },
  ]
  const asSelect = choiceItems.length > MAX_TILES
  const showChoices = !!section && !suffix && options.length > 0

  const pickChoice = (next: string) => {
    setChoice(next)
    setPrefix(null)
    setError(null)
  }

  const freeField = (labelled: boolean) =>
    section && (
      <div className="space-y-2">
        {labelled && <Label htmlFor="section-domain-hostname">Domain</Label>}
        {suffix ? (
          <PrefixField
            id="section-domain-hostname"
            value={typed}
            domain={suffix}
            label={labelled ? undefined : 'Domain'}
            disabled={saving}
            onChange={(value) => {
              setTyped(value)
              setError(null)
            }}
          />
        ) : (
          <Input
            id="section-domain-hostname"
            aria-label={labelled ? undefined : asSelect ? 'Hostname' : 'Domain'}
            value={typed}
            placeholder={`${DEFAULT_PREFIX[section]}.example.com`}
            onChange={(e) => {
              setTyped(e.target.value)
              setError(null)
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={saving}
          />
        )}
      </div>
    )

  return (
    <form onSubmit={submit}>
      <div className="min-w-0 space-y-4 py-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Used for</p>
          <div data-slot="used-for-tiles">
            <VisibilityTiles
              name="used-for"
              value={usedFor ?? ''}
              onChange={(next) => choose(next as CustomDomainUsedFor)}
              options={tiles}
              disabled={saving}
              // Two across at most, so a tile has room for the hostname it names.
              className="grid-cols-1 sm:grid-cols-2"
            />
          </div>
        </div>

        {usedFor === 'portal' && (
          <div className="space-y-2">
            {portalChoices.length > 0 ? (
              <>
                <p className="text-sm font-medium">Domain</p>
                <VisibilityTiles
                  name="hostname"
                  value={picked}
                  onChange={setPicked}
                  options={portalChoices.map((hostname) => ({ value: hostname, title: hostname }))}
                  disabled={saving}
                />
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">No custom domain is ready yet.</p>
            )}
            {onAddDomain && (
              <button
                type="button"
                className={`${INLINE_LINK} text-[13px]`}
                onClick={() => {
                  onClose()
                  onAddDomain()
                }}
              >
                Add a new domain
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-2" aria-busy="true">
            <p className="text-sm font-medium">Domain</p>
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        )}

        {!loading && showChoices && (
          <div className="space-y-2">
            <p id="section-domain-choices" className="text-sm font-medium">
              Domain
            </p>
            {asSelect ? (
              <Select value={chosen || null} onValueChange={(next) => pickChoice(String(next))}>
                <SelectTrigger aria-label="Domain" className="w-full" disabled={saving}>
                  <SelectValue placeholder="Choose a domain" />
                </SelectTrigger>
                <SelectContent>
                  {choiceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div data-slot="domain-choices">
                <VisibilityTiles
                  name="domain"
                  value={chosen}
                  onChange={pickChoice}
                  options={choiceItems}
                  disabled={saving}
                />
              </div>
            )}
            {chosenOption?.domain && (
              <PrefixField
                id="section-domain-prefix"
                value={prefixValue}
                domain={chosenOption.domain}
                label={asSelect ? `Name in front of ${chosenOption.domain}` : 'Domain'}
                disabled={saving}
                onChange={(value) => {
                  setPrefix(value)
                  setError(null)
                }}
              />
            )}
            {chosen === OTHER && freeField(false)}
          </div>
        )}

        {!loading && emptyState && chosen !== OTHER && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Domain</p>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed px-3.5 py-3">
              <p className="text-[13px] text-muted-foreground">Add and verify your domain first.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onClose()
                  onAddVerifiedDomain?.()
                }}
              >
                Add domain
              </Button>
            </div>
            <button
              type="button"
              className={`${INLINE_LINK} text-[13px]`}
              onClick={() => pickChoice(OTHER)}
            >
              {ANOTHER_DOMAIN}
            </button>
          </div>
        )}

        {!loading && section && !showChoices && chosen === OTHER && freeField(true)}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        {usedFor && (
          <Button type="submit" disabled={saving || !canSave}>
            Save
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

/** A name typed in front of a fixed domain, as one field. */
function PrefixField({
  id,
  value,
  domain,
  label,
  disabled,
  onChange,
}: {
  id: string
  value: string
  domain: string
  /** The field's accessible name when no visible label names it. */
  label?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex h-9 min-w-0 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
      <Input
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 border-0 focus-visible:ring-0"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={disabled}
      />
      <span className="max-w-[60%] shrink-0 truncate pe-3 text-sm text-muted-foreground">
        .{domain}
      </span>
    </div>
  )
}

/**
 * After Save: the record to add for the hostname, Verify to check it now and
 * Done. Closing early is fine; the card's row keeps its Verify.
 */
function PointDns({
  step,
  cloud,
  primaryHost,
  loadCloudRecords,
  onStep,
  onChecked,
  onDone,
}: {
  step: DnsStep
  cloud: boolean
  primaryHost: string | null
  loadCloudRecords?: (hostname: string) => Promise<DnsRecordRow[]>
  onStep: (step: DnsStep) => void
  onChecked: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const records = cloud
    ? (step.cloudRecords ?? [])
    : primaryHost
      ? [cnameRecord(step.entry, primaryHost, step.check)]
      : []

  const verify = async () => {
    setError(null)
    setBusy(true)
    try {
      // Cloud: ask the control plane to look again first, as the Domain verification card does.
      if (cloud) {
        await mutateCloudCustomDomainFn({ data: { action: 'refresh', hostname: step.hostname } })
      }
      const result = await verifySectionDomainFn({ data: { section: step.section } })
      if (!result.ok) {
        const { message: refusal } = result
        setError(refusal)
        return
      }
      const entry = result.sectionDomains[step.section] ?? step.entry
      onStep({
        ...step,
        entry,
        check: result.status ?? undefined,
        cloudRecords: cloud ? await readRecords(loadCloudRecords, step.hostname) : undefined,
        outcome: outcomeOf(entry),
      })
      onChecked()
    } catch (err) {
      setError(errorText(err, "Couldn't verify the custom domain."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="min-w-0 space-y-3 py-4">
        <p className="text-sm">
          {records.length > 1
            ? 'Add these records at your DNS host, then verify.'
            : 'Add this record at your DNS host, then verify.'}
        </p>
        {records.length > 0 && <DnsRecordTable records={records} />}
        {step.outcome && (
          <p role="status" className="text-[13px] text-muted-foreground">
            {step.outcome}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => void verify()} disabled={busy}>
          Verify
        </Button>
        <Button type="button" onClick={onDone} disabled={busy}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}
