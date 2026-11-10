/**
 * The properties frame every panel shares, Figma style: a breadcrumb whose
 * crumbs pick the parent, a title with an optional ⋯ menu, an
 * optional scope line, titled sections of compact rows, and a footer listing
 * the places set differently, shown only when there are some.
 *
 * A row is 28px: its label on the left (ROW_LABEL), its control in the
 * middle, and a slot on the right (ROW_END) that every row keeps, so the
 * controls of set and unset rows end at one edge.
 * An unset row shows the value it inherits, muted, and says where it comes
 * from on hover; a row set at this scope shows a dot and a Reset that names
 * what it goes back to.
 */
import { Fragment, useId, useState, type ReactElement, type ReactNode } from 'react'
import {
  ArrowUturnLeftIcon,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { onRadioKeys, radioTabIndex } from '@/components/admin/settings/appearance/radio-keys'
import { cn } from '@/lib/shared/utils'
import { keepOpen, rememberedOpen } from '../advanced'
import { RefusalText, useRowRefusal } from './change-refusal'
import { PHONE_TINT, PHONE_WORDS } from './phone-mode'
import { WORDS, setDifferentlyIn } from './words'

/** The label column of a property row. A label wraps between words, never inside one. */
export const ROW_LABEL = 'w-[96px]'
/** Lines up under a row's control: the label column plus the row's gap. */
export const ROW_INDENT = 'ps-[104px]'
/** ROW_INDENT as a margin, for an inline control. */
export const ROW_INDENT_MARGIN = 'ms-[104px]'
/** The slot at a row's end for its set dot and Reset; kept on every row. */
const ROW_END = 'w-6'

/** The one picked style for a single-choice tile, drawn or text. */
export const PICKED_TILE =
  'border-foreground font-medium ring-1 ring-foreground forced-colors:outline forced-colors:outline-2'

/** A note under a row's control, lined up with it. */
export function PropertyRowNote({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <p id={id} className={cn(ROW_INDENT, 'text-[11px] text-muted-foreground', className)}>
      {children}
    </p>
  )
}

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
          <h2 className="min-w-0 truncate rounded-sm text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground">
            {title}
          </h2>
          {about && <Help text={about} />}
          <span className="flex-1" />
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
 * hovering the value says where it comes from. On the Phone canvas a value
 * set for phones has a tinted dot and, in place of Reset, "Use all-screens
 * value"; on every screen, a row whose phones differ has a tinted dot too.
 * A change from its control
 * that the draft refused says why in a line under it (change-refusal.tsx).
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
  phoneSet = false,
  onUseAllScreens,
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
  /** Phones have a value of their own, though this row is not phones'. */
  phoneSet?: boolean
  /** On the Phone canvas, for a row set for phones: lets its value go, back to all screens'. */
  onUseAllScreens?: () => void
  children: ReactNode
}) {
  const refusal = useRowRefusal(useId())
  const phoneHere = set && !!onUseAllScreens
  return (
    <Fragment>
      <div
        className="flex min-h-7 items-center gap-2"
        data-property-row=""
        data-find={find}
        data-set={set || undefined}
        {...refusal.handlers}
      >
        <span className={cn('flex shrink-0 items-center gap-0.5', ROW_LABEL)}>
          {/* A label longer than the column wraps between words, never inside one. */}
          <label htmlFor={htmlFor} className="text-xs leading-tight text-muted-foreground">
            {label}
          </label>
          {help && <Help text={help} />}
          {!help && !set && source && <Help text={source} />}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
        <span
          data-row-end=""
          className={cn('flex shrink-0 items-center justify-end gap-0.5', ROW_END)}
        >
          {!set && phoneSet && (
            <span className="flex items-center" title={PHONE_WORDS.setForPhones}>
              <span
                aria-hidden="true"
                data-phone-dot=""
                className={cn('size-1.5 shrink-0 rounded-full', PHONE_TINT.dot)}
              />
              <span className="sr-only">{PHONE_WORDS.setForPhones}</span>
            </span>
          )}
          {set &&
            (onReset && !phoneHere ? (
              <ResetButton
                label={resetLabel ?? `${WORDS.reset} ${label.toLowerCase()}`}
                onReset={onReset}
              />
            ) : (
              <SetDot phone={phoneHere} />
            ))}
        </span>
      </div>
      {phoneHere && (
        <PropertyRowNote className="-mt-0.5">
          <button
            type="button"
            onClick={onUseAllScreens}
            className="rounded text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
          >
            {PHONE_WORDS.useAllScreens}
          </button>
        </PropertyRowNote>
      )}
      {refusal.message && (
        <RefusalText
          message={refusal.message}
          className={cn(ROW_INDENT, 'text-xs text-destructive')}
        />
      )}
    </Fragment>
  )
}

/**
 * Advice kept out of the way: an ⓘ that says it on hover and on focus, and
 * to a screen reader as the ⓘ's name.
 */
export function Help({ text }: { text: string }) {
  return (
    <Tip text={text}>
      <button
        type="button"
        aria-label={text}
        data-help=""
        className="-my-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <InformationCircleIcon className="size-3" aria-hidden="true" />
      </button>
    </Tip>
  )
}

/** A tip on a control that takes focus, shown on hover and on focus; none without text. */
export function Tip({ text, children }: { text?: string | null; children: ReactElement }) {
  if (!text) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

/** The dot of a row set here, pink for a value phones have of their own. */
function SetDot({ phone, className }: { phone: boolean; className?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-set-dot=""
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          phone ? PHONE_TINT.dot : 'bg-primary',
          className
        )}
      />
      <span className="sr-only">{phone ? PHONE_WORDS.setForPhones : 'Set here.'}</span>
    </>
  )
}

/** Reset, an icon with the set dot on its corner, in the row's end slot. */
function ResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Tip text={label}>
      <button
        type="button"
        aria-label={label}
        data-reset=""
        onClick={onReset}
        className="relative -my-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <ArrowUturnLeftIcon className="size-3.5" aria-hidden="true" />
        <SetDot phone={false} className="absolute top-0.5 right-0.5" />
      </button>
    </Tip>
  )
}

/** About how wide a tile's label is drawn, per character, at 11px. */
const TILE_CHAR_PX = 5.6
/** A tile's padding and border. */
const TILE_PAD_PX = 12
/** The room a row's control has in the panel, past the label and the end slot. */
const TILE_ROW_PX = 176

/**
 * How the tiles of a row lie, so none is left alone on a row: 0 when they
 * all fit side by side, sized to their names; else how many go to a row of
 * an even grid, two or three. A name that does not fit its tile wraps
 * between words.
 */
export function tileColumns(names: ReadonlyArray<string>): number {
  const width = (name: string) => name.length * TILE_CHAR_PX + TILE_PAD_PX
  const n = names.length
  if (names.reduce((sum, name) => sum + width(name), 0) <= TILE_ROW_PX) return 0
  if (n === 3) return 3
  const longest = Math.max(...names.map(width))
  if (n % 3 === 0 && 3 * longest <= TILE_ROW_PX) return 3
  if (n % 2 === 0) return 2
  return 3 * longest <= TILE_ROW_PX ? 3 : 2
}

const GRID_COLUMNS: Record<number, string> = {
  2: 'grid grid-cols-2',
  3: 'grid grid-cols-3',
}

/**
 * A row of a few short choices as tiles, the picked one outlined; none
 * outlined when the value is inherited, which shows dashed. A radio group.
 * The tiles make an even grid of equal widths (see tileColumns).
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
  // One Tab stop: the picked tile, else the one it has from wider up, else the first.
  const stop = Math.max(
    0,
    options.findIndex(([option]) => option === (value ?? inherited))
  )
  const columns = tileColumns(options.map(([, name]) => name))
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      data-tiles=""
      data-columns={columns}
      onKeyDown={onRadioKeys}
      className={cn('min-w-0 flex-1 gap-0.5', GRID_COLUMNS[columns] ?? 'flex')}
    >
      {options.map(([option, name], index) => {
        const on = value === option
        const from = value === undefined && inherited === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => onChange(option)}
            className={cn(
              'min-h-6 min-w-0 rounded-md border px-1 py-0.5 text-[11px] leading-tight focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              on
                ? PICKED_TILE
                : from
                  ? 'border-dashed border-muted-foreground/60 text-muted-foreground'
                  : 'border-border text-foreground hover:bg-muted',
              // Side by side, each is as wide as its name and they share what is left.
              columns === 0 && 'flex-auto whitespace-nowrap'
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
  const none = !options.some(([option]) => option === value)
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onRadioKeys}
      className={cn('grid gap-1 py-0.5', columns === 3 ? 'grid-cols-3' : 'grid-cols-4')}
    >
      {options.map(([option, name, drawing], index) => {
        const on = value === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(on, none, index)}
            aria-label={name}
            onClick={() => onChange(option)}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-md border p-1 text-center focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              on ? PICKED_TILE : 'border-border hover:bg-muted'
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
