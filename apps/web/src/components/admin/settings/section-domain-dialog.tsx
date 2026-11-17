/**
 * Add custom domain: what the domain is used for first, as tiles (Portal on
 * Cloud, then each section in nav order), then only the field that choice
 * needs. Change custom domain names what it is used for and starts at Domain.
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
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  DnsRecordTable,
  FULL_NAMES_NOTE,
  type DnsRecordRow,
} from '@/components/shared/dns-record-table'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
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
  PORTAL_SECTIONS,
  sectionDomainState,
  sectionOfHost,
  type SectionDomain,
  type SectionDomainMap,
  type SectionDomainState,
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
const NO_RECORD = "Couldn't load the DNS record. It's also shown on the Custom domains card."

/** A hostname's state as a badge: the card's badges, and Verified once it is. */
const STATE_BADGE: Record<SectionDomainState, BadgeState> = {
  verified: 'verified',
  pending: 'pending',
  'not-answering': 'attention',
}

const USED_FOR_HEADING = 'section-domain-used-for'
const DOMAIN_HEADING = 'section-domain-domain'
const ERROR_ID = 'section-domain-error'

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
  onAddVerifiedDomain?: (section: PortalSection) => void
}

export function SectionDomainDialog(props: SectionDomainDialogProps) {
  // Opened from a row's Change: that row already has a domain.
  const changing =
    props.initial === 'portal' || (props.initial !== null && !!props.map[props.initial])
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      {/* The body scrolls between a fixed title and fixed actions, so Save is always in reach. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{changing ? 'Change custom domain' : 'Add custom domain'}</DialogTitle>
        </DialogHeader>
        {props.open && (
          <SectionDomainForm key={props.initial ?? ''} {...props} changing={changing} />
        )}
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

/** The zone a hostname sits in, as far as a name can say: everything after its first label. */
function zoneOfHost(hostname: string): string | null {
  const dot = hostname.indexOf('.')
  const zone = dot > 0 ? hostname.slice(dot + 1) : ''
  return zone.includes('.') ? zone : null
}

/** The other sections' hostnames. */
function siblingHosts(section: PortalSection, map: SectionDomainMap): string[] {
  return PORTAL_SECTIONS.flatMap((other) =>
    other !== section && map[other] ? [map[other].hostname] : []
  )
}

/** The Verified domain to start on: the one the other sections already use, else the first. */
function preferredVerified(
  section: PortalSection,
  map: SectionDomainMap,
  options: readonly DomainOption[]
): DomainOption | undefined {
  const verified = options.filter((option) => option.domain)
  const siblings = siblingHosts(section, map)
  return (
    verified.find((option) => siblings.some((host) => host.endsWith(`.${option.domain}`))) ??
    verified[0]
  )
}

/** A hostname on the zone a sibling section already uses, when it is free. */
function siblingSuggestion(
  section: PortalSection,
  map: SectionDomainMap,
  primaryHost: string | null
): string {
  for (const host of siblingHosts(section, map)) {
    const zone = zoneOfHost(host)
    if (!zone) continue
    const hostname = `${DEFAULT_PREFIX[section]}.${zone}`
    if (sectionOfHost(hostname, map) === null && hostname !== primaryHost) return hostname
  }
  return ''
}

/** The hostname a section's free field starts with. */
function startValue(
  section: PortalSection,
  map: SectionDomainMap,
  primaryHost: string | null,
  suffix: string | undefined
): string {
  const current = map[section]?.hostname
  if (suffix) {
    if (current?.endsWith(`.${suffix}`)) return current.slice(0, -suffix.length - 1)
    return DEFAULT_PREFIX[section]
  }
  return current ?? siblingSuggestion(section, map, primaryHost)
}

/** The longest of the zones a hostname sits under, or null. */
function zoneFor(hostname: string, zones: readonly string[]): string | null {
  const under = zones.filter((zone) => hostname === zone || hostname.endsWith(`.${zone}`))
  return under.sort((a, b) => b.length - a.length)[0] ?? null
}

/** Record names relative to the zone, as most DNS hosts take them (`@` for the zone itself). */
function relativeTo(records: DnsRecordRow[], zone: string | null): DnsRecordRow[] {
  if (!zone) return records
  return records.map((record) => {
    if (record.name === zone) return { ...record, name: '@' }
    if (record.name.endsWith(`.${zone}`)) {
      return { ...record, name: record.name.slice(0, -zone.length - 1) }
    }
    return record
  })
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
  /** The zone the records are named in, or null to name them in full. */
  zone: string | null
  check?: CheckResult
  /** Cloud: the records the control plane asks for; null when they could not be read. */
  cloudRecords?: DnsRecordRow[] | null
  /** What the last Verify found; empty while none has, or one is running. */
  outcome: string
}

/** A Cloud hostname's records, or null when they cannot be read. */
async function readRecords(
  load: ((hostname: string) => Promise<DnsRecordRow[]>) | undefined,
  hostname: string
): Promise<DnsRecordRow[] | null> {
  if (!load) return null
  return load(hostname).catch(() => null)
}

function outcomeOf(entry: SectionDomain): string {
  const state = sectionDomainState(entry)
  if (state === 'verified') return VERIFIED_NOTE
  if (state === 'not-answering') return notAnsweringNote(entry) ?? PENDING_NOTE
  return PENDING_NOTE
}

/** The error under a field, which the field points at. */
function FieldError({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
      {text}
    </p>
  )
}

function SectionDomainForm({
  initial,
  changing,
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
}: SectionDomainDialogProps & { changing: boolean }) {
  const [usedFor, setUsedFor] = useState<CustomDomainUsedFor | null>(initial)
  const [typed, setTyped] = useState(() =>
    initial && initial !== 'portal' ? startValue(initial, map, primaryHost, suffix) : ''
  )
  // Null until the admin picks: the start follows the options once they load.
  const [choice, setChoice] = useState<string | null>(null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const [picked, setPicked] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dns, setDns] = useState<DnsStep | null>(null)
  // Cloud: hostnames this dialog has added as custom domains, so a retry never adds one twice.
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set())
  // A domain's page names the domain itself, so it asks for no other.
  const verifiedDomains = useVerifiedDomains(suffix ? undefined : loadVerifiedDomains)

  const choose = (next: CustomDomainUsedFor) => {
    setUsedFor(next)
    setError(null)
    setTyped(next === 'portal' ? '' : startValue(next, map, primaryHost, suffix))
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
  const readySet = new Set(cloud ? readyHostnames : [])
  // No Verified domain to build on: send a viewer who may add one there first.
  const emptyState =
    !!section && options.length === 0 && Array.isArray(verifiedDomains) && !!onAddVerifiedDomain
  const current = section ? currentChoice(map[section]?.hostname, options) : null
  const startChoice = (() => {
    if (!section || suffix) return OTHER
    if (current) return current.value
    if (options.length === 0) return emptyState ? '' : OTHER
    return preferredVerified(section, map, options)?.value ?? ''
  })()
  const chosen = choice ?? startChoice
  const chosenOption = options.find((option) => option.value === chosen)
  const startPrefix = current?.prefix ?? (section ? DEFAULT_PREFIX[section] : '')
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
    // In front of a Verified domain a name is needed; the bare domain is under Another domain.
    if (chosenOption.domain) {
      return prefixValue.trim() ? webAddressOn(prefixValue, chosenOption.domain) : null
    }
    return chosenOption.hostname
  }

  // Change: a verified hostname saved as it is would change nothing.
  const currentEntry = section ? map[section] : undefined
  const unchanged =
    changing &&
    !!currentEntry &&
    sectionDomainState(currentEntry) === 'verified' &&
    sectionHostname() === currentEntry.hostname

  const canSave =
    usedFor === 'portal'
      ? !!picked
      : !loading && !unchanged && (chosen === OTHER ? !!typed.trim() : !!chosenOption)

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
    const addedButUnused = `${hostname} was added but isn't used for ${usedForLabel(usedFor)} yet. Try again.`
    let wasAdded = added.has(hostname)
    try {
      // Cloud: a hostname the control plane does not route yet is added as a custom domain first.
      const known = wasAdded || [...readyHostnames, ...cloudHostnames].includes(hostname)
      if (cloud && !known) {
        try {
          await mutateCloudCustomDomainFn({ data: { action: 'add', hostname } })
        } catch (err) {
          setError(errorText(err, "Couldn't add the custom domain."))
          return
        }
        wasAdded = true
        setAdded((prev) => new Set(prev).add(hostname))
        // The cards behind show the new custom domain now, whatever the section step does.
        onSaved()
      }
      let result: Awaited<ReturnType<typeof setSectionDomainFn>>
      try {
        result = await setSectionDomainFn({ data: { section: usedFor, hostname } })
      } catch (err) {
        setError(wasAdded ? addedButUnused : errorText(err, "Couldn't save the custom domain."))
        return
      }
      if (!result.ok) {
        // A refusal comes back as a value whose words are written for this dialog.
        const { message: refusal } = result
        setError(wasAdded ? addedButUnused : refusal)
        return
      }
      onSaved()
      const entry = result.sectionDomains[usedFor]
      if (!entry || entry.verifiedAt) {
        onClose()
        return
      }
      const zone = suffix ?? zoneFor(hostname, verifiedDomains ?? [])
      setDns({
        section: usedFor,
        hostname,
        entry,
        zone,
        cloudRecords: cloud ? await readRecords(loadCloudRecords, hostname) : undefined,
        outcome: '',
      })
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
      ? [{ value: 'portal' as const, title: usedForLabel('portal'), description: 'Primary domain' }]
      : []),
    ...sections.map((value) => ({
      value,
      title: usedForLabel(value),
      description: map[value]?.hostname,
      // Its row's Change edits a domain a section has already.
      disabled: !!map[value],
    })),
  ]

  const choiceItems = [
    ...options.map((option) => ({
      value: option.value,
      title: hostnameOf(option),
      description: readySet.has(option.hostname) && !option.domain ? 'Ready' : undefined,
    })),
    { value: OTHER, title: ANOTHER_DOMAIN },
  ]
  const asSelect = choiceItems.length > MAX_TILES
  const single = options.length === 1 && !!options[0].domain
  const showChoices = !!section && !suffix && options.length > 0

  const pickChoice = (next: string) => {
    setChoice(next)
    setPrefix(null)
    setError(null)
  }

  const invalid = (describedBy?: string) => ({
    'aria-invalid': error ? true : undefined,
    'aria-describedby':
      [describedBy, error ? ERROR_ID : null].filter(Boolean).join(' ') || undefined,
  })

  const prefixField = (domain: string) => (
    <div className="space-y-2">
      <PrefixField
        id="section-domain-prefix"
        value={prefixValue}
        domain={domain}
        disabled={saving}
        invalid={invalid}
        onChange={(value) => {
          setPrefix(value)
          setError(null)
        }}
      />
      <FieldError text={error} />
    </div>
  )

  /** The free field. Named Domain where nothing else is; Hostname under a list named Domain. */
  const freeField = (named: 'Domain' | 'Hostname' | 'labelled') =>
    section && (
      <div className="space-y-2">
        {suffix ? (
          <PrefixField
            id="section-domain-hostname"
            value={typed}
            domain={suffix}
            disabled={saving}
            invalid={invalid}
            onChange={(value) => {
              setTyped(value)
              setError(null)
            }}
          />
        ) : (
          <Input
            id="section-domain-hostname"
            aria-label={named === 'labelled' ? undefined : named}
            aria-labelledby={named === 'labelled' ? DOMAIN_HEADING : undefined}
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
            {...invalid()}
          />
        )}
        <FieldError text={error} />
      </div>
    )

  const textLink = (label: string, onClick: () => void) => (
    <button type="button" className={`${INLINE_LINK} text-[13px]`} onClick={onClick}>
      {label}
    </button>
  )

  const heading = (
    <p id={DOMAIN_HEADING} className="text-sm font-medium">
      Domain
    </p>
  )

  let domainBlock: ReactNode = null
  if (section && loading) {
    domainBlock = (
      <div className="space-y-2" aria-busy="true">
        {heading}
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    )
  } else if (section && suffix) {
    domainBlock = (
      <div className="space-y-2">
        {heading}
        {freeField('labelled')}
      </div>
    )
  } else if (section && single) {
    // One Verified domain and nothing else to pick: its name field alone.
    const only = options[0]
    domainBlock = (
      <div className="space-y-2">
        {heading}
        {chosen === OTHER ? (
          <>
            {freeField('labelled')}
            {textLink(`Use ${only.domain}`, () => pickChoice(only.value))}
          </>
        ) : (
          <>
            {prefixField(only.domain ?? '')}
            {textLink(ANOTHER_DOMAIN, () => pickChoice(OTHER))}
          </>
        )}
      </div>
    )
  } else if (section && showChoices) {
    const fieldFor = (value: string) => {
      if (value !== chosen) return null
      if (chosenOption?.domain && value === chosenOption.value) {
        return <div className="ps-10">{prefixField(chosenOption.domain)}</div>
      }
      if (value === OTHER) return <div className="ps-10">{freeField('Hostname')}</div>
      return null
    }
    domainBlock = (
      <div className="space-y-2">
        {heading}
        {asSelect ? (
          <>
            <Select value={chosen || null} onValueChange={(next) => pickChoice(String(next))}>
              <SelectTrigger aria-labelledby={DOMAIN_HEADING} className="w-full" disabled={saving}>
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
            {chosenOption?.domain && prefixField(chosenOption.domain)}
            {chosen === OTHER && freeField('Hostname')}
          </>
        ) : (
          <div data-slot="domain-choices">
            <VisibilityTiles
              name="domain"
              value={chosen}
              onChange={pickChoice}
              options={choiceItems}
              disabled={saving}
              aria-labelledby={DOMAIN_HEADING}
              renderAfter={fieldFor}
            />
          </div>
        )}
        {/* A refusal for a ready custom domain, which has no field of its own. */}
        {chosenOption && !chosenOption.domain && <FieldError text={error} />}
      </div>
    )
  } else if (section && emptyState && chosen !== OTHER) {
    domainBlock = (
      <div className="space-y-2">
        {heading}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed px-3.5 py-3">
          <p className="text-[13px] text-muted-foreground">No Verified domains yet.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onClose()
              onAddVerifiedDomain?.(section)
            }}
          >
            Add domain
          </Button>
        </div>
        {textLink('Type a domain', () => pickChoice(OTHER))}
      </div>
    )
  } else if (section) {
    domainBlock = (
      <div className="space-y-2">
        {heading}
        {freeField('labelled')}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        data-slot="section-domain-body"
        className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1"
      >
        {changing && initial ? (
          <div
            data-slot="used-for-detail"
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="text-muted-foreground">Used for</span>
            <span className="font-medium">{usedForLabel(initial)}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <p id={USED_FOR_HEADING} className="text-sm font-medium">
              Used for
            </p>
            <div data-slot="used-for-tiles">
              <VisibilityTiles
                name="used-for"
                value={usedFor ?? ''}
                onChange={(next) => choose(next as CustomDomainUsedFor)}
                options={tiles}
                disabled={saving}
                aria-labelledby={USED_FOR_HEADING}
                className="grid-cols-2"
              />
            </div>
          </div>
        )}

        {usedFor === 'portal' && (
          <div className="space-y-2">
            {portalChoices.length > 0 ? (
              <>
                {heading}
                <VisibilityTiles
                  name="hostname"
                  value={picked}
                  onChange={setPicked}
                  options={portalChoices.map((hostname) => ({ value: hostname, title: hostname }))}
                  disabled={saving}
                  aria-labelledby={DOMAIN_HEADING}
                />
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">No custom domains ready yet.</p>
            )}
            {onAddDomain &&
              textLink('Add domain', () => {
                onClose()
                onAddDomain()
              })}
          </div>
        )}

        {domainBlock}
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
  disabled,
  invalid,
  onChange,
}: {
  id: string
  value: string
  domain: string
  disabled: boolean
  /** The field's invalid state, pointing at the suffix it names and any error under it. */
  invalid: (describedBy?: string) => Record<string, unknown>
  onChange: (value: string) => void
}) {
  const suffixId = `${id}-suffix`
  return (
    <div className="flex h-9 min-w-0 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
      <Input
        id={id}
        aria-label={`Name in front of ${domain}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 border-0 focus-visible:ring-0"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={disabled}
        {...invalid(suffixId)}
      />
      <span
        id={suffixId}
        className="max-w-[60%] shrink-0 truncate pe-3 text-sm text-muted-foreground"
      >
        .{domain}
      </span>
    </div>
  )
}

/**
 * After Save: the hostname and its state, the record to add, Verify to check
 * it now and Done. Closing early is fine; the card's row keeps its Verify.
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
  const verifyRef = useRef<HTMLButtonElement>(null)
  const state = sectionDomainState(step.entry)
  const verified = state === 'verified'
  const records = relativeTo(
    cloud
      ? (step.cloudRecords ?? [])
      : primaryHost
        ? [cnameRecord(step.entry, primaryHost, step.check)]
        : [],
    step.zone
  )
  const where = step.zone ? `where you manage DNS for ${step.zone}` : 'at your DNS host'

  // The next thing to do is Verify, once the record is in.
  useEffect(() => {
    verifyRef.current?.focus()
  }, [])

  const verify = async () => {
    setError(null)
    setBusy(true)
    onStep({ ...step, outcome: '' })
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
      const cloudRecords = cloud
        ? ((await readRecords(loadCloudRecords, step.hostname)) ?? step.cloudRecords)
        : undefined
      onStep({
        ...step,
        entry,
        check: result.status ?? undefined,
        cloudRecords,
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        data-slot="section-domain-body"
        className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-1"
      >
        <div
          data-slot="point-dns-hostname"
          className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium"
        >
          <span className="min-w-0 break-all">{step.hostname}</span>
          <StateBadge state={STATE_BADGE[state]} />
        </div>
        {records.length > 0 ? (
          <>
            <p className="text-sm">
              {records.length > 1
                ? `Add these records ${where}, then select Verify.`
                : `Add this record ${where}, then select Verify.`}
            </p>
            <DnsRecordTable records={records} hideLabels={records.length === 1} />
            {!step.zone && <p className="text-xs text-muted-foreground">{FULL_NAMES_NOTE}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{NO_RECORD}</p>
        )}
        <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">
          {step.outcome}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {/* On a phone the footer stacks in reverse, so the last button here is the top one. */}
      <DialogFooter>
        <Button
          type="button"
          variant={verified ? 'default' : 'outline'}
          onClick={onDone}
          disabled={busy}
        >
          Done
        </Button>
        {!verified && (
          <Button
            ref={verifyRef}
            type="button"
            onClick={() => void verify()}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
