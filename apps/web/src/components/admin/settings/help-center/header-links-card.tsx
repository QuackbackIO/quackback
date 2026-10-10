import { useState } from 'react'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { helpCenterHeaderLinkUrl } from '@/lib/shared/schemas/help-center'
import { useUpdateHelpCenterConfig } from '@/lib/client/mutations/settings'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import type { HelpCenterHeaderLink } from '@/lib/shared/types/settings'

const HEADER_LINKS_MAX = 3

/** Only rows with both a label and a URL are stored; half-typed rows stay local. */
function cleanLinks(links: HelpCenterHeaderLink[]): HelpCenterHeaderLink[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label !== '' && l.url !== '')
}

/** The server's URL rule, so a row is only saved when the server would accept it. */
function urlError(url: string): boolean {
  const v = url.trim()
  return v !== '' && !helpCenterHeaderLinkUrl.safeParse(v).success
}

export function HeaderLinksCard({ links: initialLinks }: { links: HelpCenterHeaderLink[] }) {
  const [links, setLinks] = useState<HelpCenterHeaderLink[]>(initialLinks)
  const { mutate } = useUpdateHelpCenterConfig()
  const [removing, setRemoving] = useState<number | null>(null)
  // Rows whose URL field has been left; an error shows only after that, so a
  // half-typed URL is not flagged while it is being typed.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set())

  // Typing saves debounced; `useDebouncedSave` flushes on unmount so leaving
  // the page mid-edit never drops a link. The whole list is sent at once, so
  // nothing is sent while any row holds a URL the server rejects; the edits
  // stay in the form and go out with the next valid one.
  const { queue, flush } = useDebouncedSave<HelpCenterHeaderLink[]>((next) => {
    if (next.some((l) => urlError(l.url))) return
    mutate({ headerLinks: cleanLinks(next) })
  }, 800)

  function edit(index: number, patch: Partial<HelpCenterHeaderLink>) {
    const next = links.map((l, i) => (i === index ? { ...l, ...patch } : l))
    setLinks(next)
    queue(next)
  }

  function remove(index: number) {
    const next = links.filter((_, i) => i !== index)
    setLinks(next)
    setTouched(new Set())
    queue(next)
    flush()
  }

  function askRemove(index: number) {
    const l = links[index]
    if (l.label.trim() === '' && l.url.trim() === '') remove(index)
    else setRemoving(index)
  }

  function add() {
    setLinks((prev) => (prev.length >= HEADER_LINKS_MAX ? prev : [...prev, { label: '', url: '' }]))
  }

  return (
    <SettingsCard title="Header links" description="Up to 3 links beside the navigation.">
      <div className="space-y-3">
        {links.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No header links yet.</p>
        )}
        {links.map((link, index) => {
          const invalid = touched.has(index) && urlError(link.url)
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  value={link.label}
                  onChange={(e) => edit(index, { label: e.target.value })}
                  onBlur={flush}
                  placeholder="Label"
                  aria-label={`Link ${index + 1} label`}
                  className="max-w-48"
                />
                <Input
                  value={link.url}
                  onChange={(e) => edit(index, { url: e.target.value })}
                  onBlur={() => {
                    setTouched((prev) => new Set(prev).add(index))
                    flush()
                  }}
                  placeholder="https://example.com or /path"
                  aria-label={`Link ${index + 1} URL`}
                  aria-invalid={invalid || undefined}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => askRemove(index)}
                  aria-label={`Remove link ${index + 1}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
              {invalid && (
                <p role="alert" className="text-xs text-destructive">
                  Use a full http(s) address or a path starting with /.
                </p>
              )}
            </div>
          )
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={add}
          disabled={links.length >= HEADER_LINKS_MAX}
        >
          <PlusIcon className="me-2 h-4 w-4" />
          Add link
        </Button>
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete link?"
        description="This link is removed from the help center header."
        confirmLabel="Delete link"
        variant="destructive"
        onConfirm={() => {
          if (removing !== null) remove(removing)
          setRemoving(null)
        }}
      />
    </SettingsCard>
  )
}
