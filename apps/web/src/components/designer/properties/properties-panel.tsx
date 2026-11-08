/**
 * The properties frame every panel shares, Figma style: a breadcrumb whose
 * crumbs pick the parent, a title with an optional ⋯ menu, an
 * optional scope line, titled sections of compact rows, and a footer listing
 * the places set differently, shown only when there are some.
 *
 * A row is 28px: its label on the left (92px), its control on the right.
 * An unset row shows the value it inherits, muted, and says where it comes
 * from on hover; a row set at this scope shows a dot and a Reset that names
 * what it goes back to.
 */
import { useId, useState, type ReactNode } from 'react'
import {
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  InformationCircleIcon,
  MinusIcon,
  PlusIcon,
} from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'
import { keepOpen, rememberedOpen } from '../advanced'
import { WORDS, setDifferentlyIn } from './words'

/** A step of the breadcrumb: the last is where you are; the others pick that parent. */
export interface Crumb {
  label: string
  onSelect?: () => void
}

/** An action in the title's ⋯ menu. */
export interface PanelAction {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Its key, shown after it: "Ctrl+D". */
  keys?: string
}

/** A place set differently, in the footer: "Changelog page: corners 4 px", with Reset. */
export interface OverridePlace {
  key: string
  /** Where it is: "Changelog page", "Call to action · Hero". */
  label: string
  /** What it sets there: "corners 4 px". */
  detail?: string
  onReset: () => void
  /** Goes there. */
  onGo?: () => void
}

export function PropertiesPanel({
  crumbs,
  title,
  icon,
  about,
  actions,
  scope,
  overrides = [],
  children,
  className,
  ...rest
}: {
  crumbs: readonly Crumb[]
  title: string
  /** A small picture of what it is, before the title. */
  icon?: ReactNode
  /** What it is for, said on hovering the title. */
  about?: string
  /** The ⋯ menu; none shows no menu. */
  actions?: readonly PanelAction[]
  /** The scope line, under the title. */
  scope?: ReactNode
  /** The places set differently; the footer shows only when there are some. */
  overrides?: readonly OverridePlace[]
  children: ReactNode
  className?: string
} & { [data: `data-${string}`]: string | undefined }) {
  return (
    <div className={cn('flex min-h-full flex-col text-[13px]', className)} {...rest}>
      <header className="space-y-1.5 border-b border-border px-4 pt-3 pb-3">
        {crumbs.length > 0 && (
          <nav aria-label="Where it is" className="text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1">
              {crumbs.map((crumb, i) => {
                const last = i === crumbs.length - 1
                return (
                  <li key={`${i}:${crumb.label}`} className="flex items-center gap-1">
                    {i > 0 && <ChevronRightIcon className="size-3" aria-hidden="true" />}
                    {last ? (
                      <span aria-current="location" className="text-foreground">
                        {crumb.label}
                      </span>
                    ) : crumb.onSelect ? (
                      <button
                        type="button"
                        onClick={crumb.onSelect}
                        className="rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={about}>
            {title}
          </h2>
          {actions && actions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${title}: more actions`}>
                  <EllipsisHorizontalIcon className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {actions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    disabled={action.disabled}
                    className="text-[13px]"
                    onClick={action.onSelect}
                  >
                    {action.label}
                    {action.keys && (
                      <span className="ms-auto text-[11px] text-muted-foreground">
                        {action.keys}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {scope}
      </header>
      <div className="flex-1">{children}</div>
      {overrides.length > 0 && (
        <footer
          aria-label={WORDS.setDifferently}
          className="space-y-1 border-t border-border px-4 py-3 text-xs"
        >
          <p className="font-semibold">{setDifferentlyIn(overrides.length)}</p>
          <ul className="space-y-0.5">
            {overrides.map((place) => (
              <li key={place.key} className="flex min-h-6 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {place.onGo ? (
                    <button
                      type="button"
                      onClick={place.onGo}
                      className="rounded text-start hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                    >
                      {place.label}
                    </button>
                  ) : (
                    place.label
                  )}
                  {place.detail && <span className="text-muted-foreground">: {place.detail}</span>}
                </span>
                <ResetButton label={`${WORDS.reset} ${place.label}`} onReset={place.onReset} />
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  )
}

/**
 * A titled group of rows. An optional section shows only its title and "+"
 * until added; once added, "−" removes it. `more` holds the rarely used rows,
 * under a closed More.
 */
export function PropertySection({
  title,
  help,
  onAdd,
  onRemove,
  added = true,
  more,
  aside,
  children,
}: {
  title?: string
  /** Quiet status beside the title, such as a readability mark. */
  aside?: ReactNode
  /** Advice about the whole section, on hovering its ⓘ. */
  help?: string
  /** Adds an optional section; with it, the section shows only its title and "+" until `added`. */
  onAdd?: () => void
  /** Removes an added section, clearing what it set. */
  onRemove?: () => void
  added?: boolean
  /** Rows under a closed More. */
  more?: ReactNode
  children?: ReactNode
}) {
  const id = useId()
  const shown = !onAdd || added
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className="border-b border-border px-4 py-2.5"
    >
      {title && (
        <div className="flex min-h-6 items-center gap-2">
          <h3 id={id} className="text-xs font-semibold">
            {title}
          </h3>
          {help && <Help text={help} />}
          <span className="flex-1" />
          {aside}
          {onAdd && !added && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={`Add ${title.toLowerCase()}`}
              onClick={onAdd}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          {onRemove && added && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={`Remove ${title.toLowerCase()}`}
              onClick={onRemove}
            >
              <MinusIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {shown && children && <div className="mt-1 space-y-0.5">{children}</div>}
      {shown && more && <PropertyMore>{more}</PropertyMore>}
    </section>
  )
}

/**
 * Rows most people never need, closed until asked for; they stay in the page,
 * so find reaches them. Remembered, it stays open for the visit once opened;
 * it starts open where it holds something set.
 */
export function PropertyMore({
  remember,
  initiallyOpen = false,
  children,
}: {
  /** Kept open for the rest of the visit once opened, under this name. */
  remember?: string
  initiallyOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(
    () => initiallyOpen || (remember ? rememberedOpen(remember) : false)
  )
  return (
    <details
      className="group mt-1"
      open={open || undefined}
      onToggle={(event) => {
        const now = event.currentTarget.open
        setOpen(now)
        if (remember) keepOpen(remember, now)
      }}
    >
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {WORDS.more}
      </summary>
      <div className="space-y-0.5 pt-0.5">{children}</div>
    </details>
  )
}

/**
 * One property: its label on the left, its control on the right. A value
 * set here shows a dot and Reset, whose tooltip names what it goes back to;
 * hovering the value says where it comes from.
 */
export function PropertyRow({
  label,
  find,
  htmlFor,
  set = false,
  source,
  help,
  resetLabel,
  onReset,
  children,
}: {
  label: string
  /** Its stable name, which quick find's index shares to lead to it (find-rows.ts). */
  find?: string
  /** Advice about the row, on hovering the ⓘ after its label. */
  help?: string
  /** The control's id, so the label names it. */
  htmlFor?: string
  /** Whether the value is set at this scope: a dot, and Reset. */
  set?: boolean
  /** Where the value comes from, on hover: "From brand", "From every main button". */
  source?: string
  /** What Reset goes back to: "Reset to 8 px from brand". */
  resetLabel?: string
  onReset?: () => void
  children: ReactNode
}) {
  return (
    <div
      className="flex min-h-7 items-center gap-2"
      data-property-row=""
      data-find={find}
      data-set={set || undefined}
    >
      <span className="flex w-[92px] shrink-0 items-center gap-0.5">
        <label htmlFor={htmlFor} className="min-w-0 truncate text-xs text-muted-foreground">
          {label}
        </label>
        {help && <Help text={help} />}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5" title={set ? undefined : source}>
        {children}
      </div>
      {set && (
        <span className="flex shrink-0 items-center justify-end gap-1.5">
          <span
            aria-hidden="true"
            data-set-dot=""
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
          <span className="sr-only">Set here.</span>
          {onReset && (
            <ResetButton
              label={resetLabel ?? `${WORDS.reset} ${label.toLowerCase()}`}
              onReset={onReset}
            />
          )}
        </span>
      )}
    </div>
  )
}

/** Advice kept out of the way: an ⓘ that says it on hover, and to a screen reader. */
export function Help({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} title={text} className="shrink-0 text-muted-foreground/70">
      <InformationCircleIcon className="size-3" aria-hidden="true" />
    </span>
  )
}

function ResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onReset}
      className="rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
    >
      {WORDS.reset}
    </button>
  )
}

/**
 * A row of a few short choices as tiles, the picked one filled; none filled
 * when the value is inherited, which shows muted. A radio group. A label is
 * never cut off: tiles that do not fit side by side wrap to another row.
 * More than four go three to a row.
 */
export function PropertyTiles<T extends string>({
  label,
  value,
  inherited,
  options,
  onChange,
  id,
}: {
  label: string
  value: T | undefined
  /** The value it has from wider up, drawn muted while none is set here. */
  inherited?: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
  id?: string
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      data-tiles=""
      className="flex min-w-0 flex-1 flex-wrap gap-0.5"
    >
      {options.map(([option, name]) => {
        const on = value === option
        const from = value === undefined && inherited === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option)}
            className={cn(
              // Never narrower than its label: a tile that does not fit goes to the next row.
              'h-6 grow rounded-md border px-1.5 text-[11px] whitespace-nowrap focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              options.length > 4 ? 'basis-[30%]' : 'basis-0',
              on
                ? 'border-foreground bg-foreground text-background'
                : from
                  ? 'border-dashed border-muted-foreground/60 text-muted-foreground'
                  : 'border-border text-foreground hover:bg-muted'
            )}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

/** A choice drawn: its picture, with its name under it. */
export type DrawnOption<T extends string> = readonly [value: T, name: string, drawing: ReactNode]

/**
 * A few choices as small drawn tiles, three or four to a row, the picked one
 * outlined; its name wraps under the drawing rather than being cut off. A
 * radio group, as PropertyTiles is.
 */
export function PropertyDrawnTiles<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 4,
  id,
}: {
  label: string
  value: T | undefined
  options: ReadonlyArray<DrawnOption<T>>
  onChange: (value: T) => void
  columns?: 3 | 4
  id?: string
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1 py-0.5', columns === 3 ? 'grid-cols-3' : 'grid-cols-4')}
    >
      {options.map(([option, name, drawing]) => {
        const on = value === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name}
            onClick={() => onChange(option)}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-md border p-1 text-center focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              on ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:bg-muted'
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-full items-center justify-center overflow-hidden rounded-sm border border-border/60 bg-background"
            >
              {drawing}
            </span>
            <span className="text-[11px] leading-tight break-words">{name}</span>
          </button>
        )
      })}
    </div>
  )
}
