/**
 * Add custom domain: what the domain is used for first, as tiles (Portal,
 * then each section in nav order), then only the field that choice needs.
 *
 * - Portal is the primary domain. On Cloud a ready custom domain is made
 *   primary; a self-hosted server's primary domain is its BASE_URL.
 * - A section takes a hostname of its own. On Cloud it must be a ready custom
 *   domain no other section uses (or the viewer is sent to add one); on a
 *   self-hosted server any name is typed, then verified once DNS points here.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { errorText } from '@/lib/client/error-text'
import { setSectionDomainFn } from '@/lib/server/functions/section-domains'
import {
  usedForLabel,
  type CustomDomainUsedFor,
  type PortalSection,
} from '@/lib/shared/custom-domains'
import { sectionOfHost, type SectionDomainMap } from '@/lib/shared/section-domains'

/** The name filled in front of a domain for each section, on a domain's page. */
const DEFAULT_PREFIX: Record<PortalSection, string> = {
  feedback: 'feedback',
  roadmap: 'roadmap',
  changelog: 'changelog',
  help: 'help',
  support: 'support',
  status: 'status',
}

const NOT_A_NAME = 'Use letters, numbers and hyphens, like help or status.'

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
  /** On a domain's page: the name is typed in front of this domain. */
  suffix?: string
  onSaved: () => void
  onClose: () => void
  /** Cloud: make a ready custom domain the primary domain. */
  onMakePrimary?: (hostname: string) => void
  /** Cloud: go to where a new custom domain is added. */
  onAddDomain?: () => void
}

export function SectionDomainDialog(props: SectionDomainDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add custom domain</DialogTitle>
        </DialogHeader>
        {props.open && <SectionDomainForm key={props.initial ?? ''} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

/** The hostname a section's field starts with. */
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

function SectionDomainForm({
  initial,
  cloud,
  sections,
  map,
  primaryHost,
  readyHostnames,
  suffix,
  onSaved,
  onClose,
  onMakePrimary,
  onAddDomain,
}: SectionDomainDialogProps) {
  const [usedFor, setUsedFor] = useState<CustomDomainUsedFor | null>(initial)
  const [typed, setTyped] = useState(() =>
    initial && initial !== 'portal' ? startValue(initial, map, suffix) : ''
  )
  const [picked, setPicked] = useState<string>(() =>
    initial && initial !== 'portal' ? (map[initial]?.hostname ?? '') : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const choose = (next: CustomDomainUsedFor) => {
    setUsedFor(next)
    setError(null)
    setTyped(next === 'portal' ? '' : startValue(next, map, suffix))
    setPicked(next === 'portal' ? '' : (map[next]?.hostname ?? ''))
  }

  // A ready custom domain is offered to a section when no other section has it,
  // and to Portal when no section has it.
  const choices =
    cloud && usedFor
      ? readyHostnames.filter((hostname) => {
          const owner = sectionOfHost(hostname, map)
          return owner === null || (usedFor !== 'portal' && owner === usedFor)
        })
      : []

  const typedHostname = (): string | null => {
    if (suffix) return webAddressOn(typed, suffix)
    const value = typed.trim().toLowerCase()
    return value || null
  }

  const canSave = usedFor === 'portal' ? cloud && !!picked : cloud ? !!picked : !!typed.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!usedFor || !canSave) return
    if (usedFor === 'portal') {
      onMakePrimary?.(picked)
      onClose()
      return
    }
    const hostname = cloud ? picked : typedHostname()
    if (!hostname) {
      setError(NOT_A_NAME)
      return
    }
    setError(null)
    setSaving(true)
    try {
      const result = await setSectionDomainFn({ data: { section: usedFor, hostname } })
      if (!result.ok) {
        // A refusal comes back as a value whose words are written for this dialog.
        const { message: refusal } = result
        setError(refusal)
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err, "Couldn't save the custom domain."))
    } finally {
      setSaving(false)
    }
  }

  const tiles = [
    { value: 'portal' as const, title: usedForLabel('portal'), description: primaryHost ?? '' },
    ...sections.map((section) => ({
      value: section,
      title: usedForLabel(section),
      description: map[section]?.hostname ?? 'Primary domain',
    })),
  ]

  const showsSave = usedFor !== null && (usedFor !== 'portal' || cloud)

  return (
    <form onSubmit={submit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Used for</p>
          <div data-slot="used-for-tiles">
            <VisibilityTiles
              name="used-for"
              value={usedFor ?? ''}
              onChange={(next) => choose(next as CustomDomainUsedFor)}
              options={tiles}
              disabled={saving}
              className="grid-cols-2 sm:grid-cols-3"
            />
          </div>
        </div>

        {usedFor === 'portal' && !cloud && (
          <p className="text-[13px] text-muted-foreground">
            The primary domain is {primaryHost ?? 'set on the server'}. Change it with BASE_URL on
            the server.
          </p>
        )}

        {usedFor && cloud && (
          <div className="space-y-2">
            {choices.length > 0 ? (
              <>
                <p className="text-sm font-medium">Domain</p>
                <VisibilityTiles
                  name="hostname"
                  value={picked}
                  onChange={setPicked}
                  options={choices.map((hostname) => ({ value: hostname, title: hostname }))}
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

        {usedFor && usedFor !== 'portal' && !cloud && (
          <div className="space-y-2">
            <Label htmlFor="section-domain-hostname">Domain</Label>
            {suffix ? (
              <div className="flex h-9 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
                <Input
                  id="section-domain-hostname"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value)
                    setError(null)
                  }}
                  className="h-full min-w-0 border-0 focus-visible:ring-0"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={saving}
                />
                <span className="shrink-0 pe-3 text-sm text-muted-foreground">.{suffix}</span>
              </div>
            ) : (
              <Input
                id="section-domain-hostname"
                value={typed}
                placeholder={`${DEFAULT_PREFIX[usedFor]}.acme.com`}
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
        )}

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
        {showsSave && (
          <Button type="submit" disabled={saving || !canSave}>
            Save
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}
