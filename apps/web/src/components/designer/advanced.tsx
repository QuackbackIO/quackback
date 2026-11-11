import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { designerAdvancedOpened, type PartId } from '@/lib/client/builder-events'

/**
 * The options most people never need, closed until asked for. Each opening is
 * counted by the part it is under. Its contents stay in the page, so quick
 * find can reach a setting inside; what is heavy to draw waits for `open`.
 */
export function Advanced({
  part,
  hint,
  title = 'Advanced',
  remember,
  children,
}: {
  /** The part it is under, to count its openings. */
  part?: PartId
  /** What is inside, such as "Exact sizes, CSS". */
  hint: string
  title?: string
  /** Kept open for the rest of the visit once opened, under this name. */
  remember?: string
  children: (open: boolean) => ReactNode
}) {
  const [open, setOpen] = useState(() => (remember ? rememberedOpen(remember) : false))
  return (
    <details
      className="group rounded-lg border border-border"
      open={open || undefined}
      onToggle={(event) => {
        const now = event.currentTarget.open
        setOpen(now)
        if (remember) keepOpen(remember, now)
        if (now && part) designerAdvancedOpened(part)
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-ui hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{title}</span>
        <span className="ms-auto truncate text-xs text-muted-foreground">{hint}</span>
        <ChevronRightIcon
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-6 border-t border-border p-3">{children(open)}</div>
    </details>
  )
}

const KEY = 'qb-designer-open:'

/** Whether a disclosure was left open earlier in this visit. */
export function rememberedOpen(name: string): boolean {
  try {
    return window.sessionStorage.getItem(KEY + name) === '1'
  } catch {
    return false
  }
}

/** Remembers a disclosure open, or forgets it, for the rest of the visit. */
export function keepOpen(name: string, open: boolean): void {
  try {
    if (open) window.sessionStorage.setItem(KEY + name, '1')
    else window.sessionStorage.removeItem(KEY + name)
  } catch {
    // Not kept: it opens closed next time.
  }
}
