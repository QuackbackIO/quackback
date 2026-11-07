import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { XMarkIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LookDrawing } from '@/components/admin/settings/appearance/preset-gallery'
import type { Update } from '@/components/admin/settings/appearance/section-controls'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import {
  deletePortalDesignSavedFn,
  savePortalDesignFn,
} from '@/lib/server/functions/portal-design-saved'
import { lookOf, SAVED_LOOKS_MAX, withLook, type DesignLook } from '@/lib/shared/design/looks'
import { DESIGN_PRESETS, replaceDesign } from '@/lib/shared/design/presets'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { designerLookChosen } from '@/lib/client/builder-events'
import { previewOnCanvas } from './look-preview'
import { THEME } from './properties/words'

/** A value as text with its keys in order, so two equal looks read the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Whether a design already has a look: choosing it would change nothing. */
export function hasLook(design: PortalDesign, look: DesignLook): boolean {
  return canonical(lookOf(withLook(design, look))) === canonical(lookOf(design))
}

/** The name of the look a design has, its own saved ones first; null when it is its own. */
export function currentLookName(
  design: PortalDesign,
  saved: ReadonlyArray<{ name: string; look: DesignLook }> = []
): string | null {
  for (const each of saved) if (hasLook(design, each.look)) return each.name
  for (const preset of DESIGN_PRESETS) if (hasLook(design, preset.look)) return preset.label
  return null
}

/** The saved looks, for the Look row's name. */
export function useSavedLooks() {
  return useQuery(portalDesignQueries.saved()).data?.looks ?? []
}

/**
 * Looks to start from: the workspace's own, then the presets. Pointing at one
 * or focusing it shows it on the canvas; only choosing it changes the draft.
 * "Save this look" keeps the draft's look to apply again later.
 */
export function LookPicker({ design, update }: { design: PortalDesign; update: Update }) {
  const saved = useQuery(portalDesignQueries.saved())
  const queryClient = useQueryClient()
  const looks = saved.data?.looks ?? []
  // Leaving the picker shows the draft again.
  useEffect(() => () => previewOnCanvas(null), [])
  const choose = (source: 'saved' | 'preset') => (look: DesignLook) => {
    previewOnCanvas(null)
    designerLookChosen(source)
    update((draft) => replaceDesign(draft, withLook(draft, look)))
  }
  const remove = async (id: (typeof looks)[number]['id']) => {
    await deletePortalDesignSavedFn({ data: { id } })
    await queryClient.invalidateQueries({ queryKey: portalDesignQueries.saved().queryKey })
  }
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-2" aria-label={THEME.looks}>
        {looks.map((each) => (
          <Tile
            key={each.id}
            name={each.name}
            look={each.look}
            design={design}
            onChoose={choose('saved')}
            action={
              <button
                type="button"
                aria-label={`Delete ${each.name}`}
                onClick={() => void remove(each.id)}
                className="absolute end-1 top-1 rounded bg-background/90 p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <XMarkIcon className="size-3.5" aria-hidden="true" />
              </button>
            }
          />
        ))}
        {DESIGN_PRESETS.map((preset) => (
          <Tile
            key={preset.id}
            name={preset.label}
            hint={preset.description}
            look={preset.look}
            design={design}
            onChoose={choose('preset')}
          />
        ))}
      </ul>
      <SaveLook design={design} full={looks.length >= SAVED_LOOKS_MAX} />
    </div>
  )
}

function Tile({
  name,
  hint,
  look,
  design,
  onChoose,
  action,
}: {
  name: string
  hint?: string
  look: DesignLook
  design: PortalDesign
  onChoose: (look: DesignLook) => void
  action?: ReactNode
}) {
  const current = hasLook(design, look)
  const show = () => previewOnCanvas(withLook(design, look))
  const hide = () => previewOnCanvas(null)
  return (
    <li className="relative">
      <button
        type="button"
        title={hint}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-current={current || undefined}
        onClick={() => onChoose(look)}
        className={cn(
          'flex w-full flex-col gap-1 rounded-md border p-1.5 text-start hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          current ? 'border-foreground' : 'border-border'
        )}
      >
        <LookDrawing look={look} />
        <span className="truncate text-xs font-medium">{name}</span>
      </button>
      {action}
    </li>
  )
}

/** Keeps the draft's look, under a name, beside the presets. */
function SaveLook({ design, full }: { design: PortalDesign; full: boolean }) {
  const queryClient = useQueryClient()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (full)
    return (
      <p className="text-xs text-muted-foreground">
        {SAVED_LOOKS_MAX} looks kept. Delete one to save another.
      </p>
    )
  if (!naming)
    return (
      <Button variant="outline" size="sm" onClick={() => setNaming(true)}>
        Save this look
      </Button>
    )
  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const result = await savePortalDesignFn({
      data: { kind: 'look', name: name.trim(), design },
    }).catch(() => ({ ok: false as const, message: 'Not saved. Try again.' }))
    setSaving(false)
    if (!result.ok) return setRefusal(result.message)
    setNaming(false)
    setName('')
    setRefusal(null)
    await queryClient.invalidateQueries({ queryKey: portalDesignQueries.saved().queryKey })
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label htmlFor="designer-look-name" className="text-[13px] font-medium">
        Name this look
      </label>
      <div className="flex gap-1.5">
        <Input
          id="designer-look-name"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>
          Cancel
        </Button>
      </div>
      {refusal && (
        <p role="alert" className="text-xs text-destructive">
          {refusal}
        </p>
      )}
    </form>
  )
}
