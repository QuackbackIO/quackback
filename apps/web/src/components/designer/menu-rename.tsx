import { useEffect, useRef } from 'react'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import { MENU_COPY, MENU_NAME_MAX } from '@/lib/shared/design/menu-actions'
import { WORDS } from './properties/words'

const KEY = 'rounded border border-border bg-background px-1.5 text-2xs leading-4'

/**
 * Renames a menu item where it sits: a field laid exactly over its words, in
 * their size and weight, with the name selected. Enter or leaving the field
 * keeps what is typed; Escape keeps the old name. An empty name gives a page
 * back its own, which the caller decides.
 */
export function MenuRename({
  box,
  font,
  scale,
  name,
  onSave,
  onCancel,
}: {
  /** The item's box on the layer. */
  box: Rect
  /** How the item's words are set in the frame, before the canvas's scale. */
  font: { size: number; weight: string; family: string } | null
  scale: number
  name: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const field = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  const finish = (keep: boolean) => {
    if (done.current) return
    done.current = true
    if (keep) onSave(field.current?.value ?? name)
    else onCancel()
  }
  return (
    <div
      className="pointer-events-auto absolute"
      style={{ left: box.left, top: box.top, width: Math.max(box.width, 60) }}
    >
      <input
        ref={field}
        aria-label={WORDS.name}
        defaultValue={name}
        maxLength={MENU_NAME_MAX}
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
        className="block w-full rounded-md border-0 bg-background px-1.5 text-foreground shadow-[0_0_0_2px_var(--color-foreground)] outline-none"
        style={{
          height: box.height,
          fontSize: `${(font?.size ?? 14) * scale}px`,
          fontWeight: font?.weight,
          fontFamily: font?.family,
        }}
      />
      <p
        aria-hidden="true"
        className="absolute start-0 top-full mt-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm"
      >
        <kbd className={KEY}>Enter</kbd>
        <span>{MENU_COPY.renameKeys.save}</span>
        <kbd className={`${KEY} ms-1.5`}>Esc</kbd>
        <span>{MENU_COPY.renameKeys.cancel}</span>
      </p>
    </div>
  )
}
