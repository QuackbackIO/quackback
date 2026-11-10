/**
 * How far a change reaches, shared by default: "Changing **every main
 * button** (3 on this page)", with the narrower scopes as links and their
 * counts ("Just this one · This block (2) · This page (3)"). Narrowed, it
 * reads "Changing **just this one**: Call to action · Hero", with a way back
 * to every one.
 *
 * Counts are only what the code can count: the canvas draws one page at a
 * time, so the widest scope's count is the page's, and it says so ("on this
 * page"). A scope with no count shows none. A number is never made up.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'
import { backToEvery, everyOf } from './words'

/** A scope a change can be made at. */
export interface ScopeOption<T extends string = string> {
  id: T
  /** The link to it: "Just this one", "This page". */
  link: string
  /** What the line says while it is picked: "just this one", "main buttons on this page". */
  phrase: string
  /** What follows the phrase, such as the part's name: "Call to action · Hero". */
  detail?: string
  /** How many it reaches, where that can be counted. */
  count?: number
  /** What the count covers, where it is not the whole scope: "on this page". */
  countNote?: string
}

const counted = (o: { count?: number; countNote?: string }) =>
  o.count === undefined ? '' : ` (${o.count}${o.countNote ? ` ${o.countNote}` : ''})`

export function ScopeLine<T extends string>({
  one,
  widest,
  narrower,
  value,
  onChange,
  extra,
  className,
}: {
  /** One of the kind, as a crumb names it: "Main button". */
  one: string
  /**
   * The shared scope: every one of the kind. Its phrase is "every {one}"
   * unless it says otherwise, such as "the heading font" for a brand font.
   */
  widest: Omit<ScopeOption<T>, 'phrase' | 'link'> & { phrase?: string }
  /** More on the second line, such as a link to where the value lives. */
  extra?: ReactNode
  /** The one-offs, widest last, each a link. */
  narrower: ReadonlyArray<ScopeOption<T> & { disabled?: string }>
  value: T
  onChange: (scope: T) => void
  className?: string
}) {
  const picked = narrower.find((o) => o.id === value)
  const link =
    'rounded text-foreground underline underline-offset-2 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none disabled:no-underline disabled:opacity-50'
  return (
    <div
      className={cn('space-y-0.5 text-xs leading-relaxed text-muted-foreground', className)}
      data-scope-line=""
    >
      <p aria-live="polite">
        Changing{' '}
        <b className="font-semibold text-foreground">
          {picked ? picked.phrase : (widest.phrase ?? everyOf(one))}
        </b>
        {(picked ?? widest).detail ? `: ${(picked ?? widest).detail}` : ''}
        {counted(picked ?? widest)}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5">
        {picked ? (
          <button type="button" className={link} onClick={() => onChange(widest.id)}>
            {backToEvery(one)}
          </button>
        ) : (
          narrower.map((o, i) => (
            <span key={o.id} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">·</span>}
              <button
                type="button"
                className={link}
                disabled={!!o.disabled}
                title={o.disabled}
                onClick={() => onChange(o.id)}
              >
                {o.link}
                {counted({ count: o.count })}
              </button>
            </span>
          ))
        )}
        {extra}
      </p>
    </div>
  )
}
