import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { addMenuLink, isMenuLinkUrl } from '@/lib/shared/design/menu'
import { addLinkStep } from '@/lib/shared/design/menu-actions'
import { WORDS } from './properties/words'

/** A change to the draft, named for undo. */
export type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** Adds a link to the end of the menu: its name and an http(s) address. */
export function MenuLinkForm({
  update,
  onDone,
}: {
  update: NamedUpdate
  /** Called with the new link's id, or null when cancelled. */
  onDone: (added: string | null) => void
}) {
  const id = useId()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [tried, setTried] = useState(false)
  const badName = !label.trim()
  const badUrl = !isMenuLinkUrl(url)
  const add = () => {
    setTried(true)
    if (badName || badUrl) return
    let added: string | null = null
    const { label: named } = addLinkStep({ label, url })
    update((draft) => void (added = addMenuLink(draft, { label, url })), named)
    onDone(added)
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      aria-label="Add a link to the menu"
      // Its own messages say what is missing, in place of the browser's.
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onDone(null)
      }}
    >
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="text-[13px] font-medium">
          {WORDS.name}
        </label>
        <Input
          id={`${id}-name`}
          autoFocus
          maxLength={40}
          value={label}
          aria-invalid={tried && badName}
          aria-describedby={tried && badName ? `${id}-name-error` : undefined}
          onChange={(event) => setLabel(event.target.value)}
        />
        {tried && badName && (
          <p id={`${id}-name-error`} className="text-xs text-destructive">
            {WORDS.linkNeedsName}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-url`} className="text-[13px] font-medium">
          {WORDS.address}
        </label>
        <Input
          id={`${id}-url`}
          type="url"
          placeholder="https://"
          maxLength={2048}
          value={url}
          aria-invalid={tried && badUrl}
          aria-describedby={tried && badUrl ? `${id}-url-error` : undefined}
          onChange={(event) => setUrl(event.target.value)}
        />
        {tried && badUrl && (
          <p id={`${id}-url-error`} className="text-xs text-destructive">
            Use a full address starting with https://
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
