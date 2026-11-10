import { useEffect, useId, useState } from 'react'
import { TrashIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { isMenuLinkUrl, linkOf, menuPartOf, removeMenuLink } from '@/lib/shared/design/menu'
import type { Selection } from '@/lib/shared/design/outline'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { NamedUpdate } from './menu-link-form'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  type Crumb,
} from './properties/properties-panel'
import { WORDS } from './properties/words'

/** A text field that writes as it is typed, and takes a new value made elsewhere, such as an undo. */
function useField(stored: string) {
  const [value, setValue] = useState(stored)
  // Typing keeps its spaces; a value that differs from it in more came from elsewhere.
  useEffect(() => setValue((typed) => (typed.trim() === stored ? typed : stored)), [stored])
  return [value, setValue] as const
}

type MenuLink = NonNullable<ReturnType<typeof linkOf>>

/**
 * A menu link's settings, as Edit link leads to them, under the header in
 * the breadcrumb: its address and whether it opens a new tab. Its name is
 * renamed where the menu draws it. Every change goes to the draft.
 */
export function MenuPartSettings({
  selection,
  crumbs,
  design,
  update,
  onRename,
  onRemoved,
}: {
  selection: Selection
  crumbs: readonly Crumb[]
  design: PortalDesign
  update: NamedUpdate
  /** Renames the link where the menu draws it. */
  onRename: () => void
  /** The link is gone: the panel goes up to the header. */
  onRemoved: () => void
}) {
  const fieldId = useId()
  const id = menuPartOf(selection)
  const link = id ? linkOf(design, id) : undefined
  const [url, setUrl] = useField(link?.url ?? '')
  if (!id || !link) return null
  const bad = !isMenuLinkUrl(url)
  const change = (edit: (each: MenuLink) => void) =>
    update((draft) => {
      const each = linkOf(draft, id)
      if (each) edit(each)
    }, 'Menu link')
  const remove = () => {
    update((draft) => removeMenuLink(draft, id), `Remove the ${link.label} link`)
    onRemoved()
  }
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={link.label}
      kind={WORDS.link}
      actions={[
        { label: WORDS.rename, onSelect: onRename },
        { label: WORDS.removeLink, onSelect: remove },
      ]}
      className="pb-24"
      data-link-panel=""
    >
      <PropertySection title={WORDS.link}>
        <PropertyRow label={WORDS.address} htmlFor={fieldId}>
          <Input
            id={fieldId}
            type="url"
            value={url}
            placeholder="https://"
            maxLength={2048}
            aria-invalid={bad}
            aria-describedby={bad ? `${fieldId}-error` : undefined}
            className="h-7 min-w-0 flex-1 text-xs"
            onChange={(event) => {
              const next = event.target.value
              setUrl(next)
              if (isMenuLinkUrl(next)) change((each) => void (each.url = next.trim()))
            }}
          />
        </PropertyRow>
        {bad && (
          <p id={`${fieldId}-error`} className="ps-[100px] text-xs text-destructive">
            Use a full address starting with https://
          </p>
        )}
        <PropertyRow label={WORDS.newTab} htmlFor={`${fieldId}-tab`}>
          <Switch
            id={`${fieldId}-tab`}
            checked={link.newTab}
            onCheckedChange={(newTab) => change((each) => void (each.newTab = newTab))}
          />
        </PropertyRow>
      </PropertySection>
      <div className="flex justify-end px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={remove}
        >
          <TrashIcon className="size-3.5" aria-hidden="true" />
          {WORDS.removeLink}
        </Button>
      </div>
    </PropertiesPanel>
  )
}
