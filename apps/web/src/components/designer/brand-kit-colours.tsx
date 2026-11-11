/**
 * The brand's colours as variables, Figma style: each a row with its name,
 * its swatch and its value, opening a picker. The few every portal has show
 * first; a second and extra colours are added with "+ Add colour"; the
 * worked-out ones (cards, raised parts, secondary text, borders) wait under
 * More, each Auto until set, then marked with a dot and Reset. Dark mode
 * names the same colours as light.
 */
import { useMemo, useState } from 'react'
import {
  CheckCircleIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
} from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ColourField, toHex } from '@/components/admin/settings/appearance/colour-field'
import { colourPairs, colourRowIssues, type ColourRowIssue } from '@/lib/shared/design/colour-pairs'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { hexOf } from './properties/tokens'
import { cn } from '@/lib/shared/utils'
import { FIND, type FindRow } from './find-rows'
import {
  PropertyMore,
  PropertyRow,
  PropertyRowNote,
  PropertySection,
  ROW_INDENT_MARGIN,
  ROW_LABEL,
  Tip,
} from './properties/properties-panel'
import { COLOUR_NAMES, THEME, WORDS, resetToValue } from './properties/words'
import { Swatch } from './swatch'

type Palette = PortalDesign['brand']['light']
/** Changes the draft as one step, named for its undo where a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void
type DarkRole = 'accent' | 'support' | 'ink' | 'background'
type MoreKey = 'surface' | 'raised' | 'muted' | 'border'

const MORE: ReadonlyArray<{ key: MoreKey; label: string }> = [
  { key: 'surface', label: COLOUR_NAMES.surface },
  { key: 'raised', label: COLOUR_NAMES.raised },
  { key: 'muted', label: COLOUR_NAMES.muted },
  { key: 'border', label: COLOUR_NAMES.border },
]
/** Dark's colours, named as light's are. */
const DARK: ReadonlyArray<{ key: DarkRole; label: string }> = [
  { key: 'background', label: COLOUR_NAMES.page },
  { key: 'ink', label: COLOUR_NAMES.ink },
  { key: 'accent', label: COLOUR_NAMES.accent },
  { key: 'support', label: COLOUR_NAMES.support },
]
/** Each colour row's stable name, which quick find shares. */
const ROW_FIND: Record<'accent' | 'ink' | 'background' | MoreKey, FindRow> = {
  accent: FIND.accent,
  ink: FIND.ink,
  background: FIND.pageColour,
  surface: FIND.surface,
  raised: FIND.raised,
  muted: FIND.muted,
  border: FIND.border,
}
const RESET_TO_AUTO = resetToValue(WORDS.auto.toLowerCase())

/** One extra colour; clearing the first moves the second up. */
/** A colour as its hex, for a swatch. */
const hexOrNone = (colour: string | undefined) => (colour ? toHex(colour) : undefined)

function setExtra(draft: PortalDesign, index: number, value: string | undefined) {
  const next = [...(draft.brand.light.extra ?? [])]
  if (value) next[index] = value
  else next.splice(index, 1)
  const kept = next.filter(Boolean)
  if (kept.length) draft.brand.light.extra = kept
  else delete draft.brand.light.extra
}

/**
 * A colour variable's value: its swatch and hex, or Auto with the colour it
 * is worked out as. Clicking opens the picker and hex field.
 */
export function ColourValue({
  id,
  name,
  value,
  auto,
  onChange,
  startOpen = false,
  onClosed,
}: {
  id: string
  name: string
  value: string | undefined
  /** What it is while unset; with it, clearing the hex goes back to Auto. */
  auto?: string
  onChange: (value: string | undefined) => void
  /** Opens at once, for a colour being added. */
  startOpen?: boolean
  onClosed?: () => void
}) {
  const [open, setOpen] = useState(startOpen)
  const shown = value ?? (auto || undefined)
  // A colour as people read it: its hex, never the way it is stored, such as "oklch(…)".
  const label = value ? (hexOf(value) ?? value) : undefined
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onClosed?.()
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${name}: ${label ?? (auto !== undefined ? WORDS.auto : WORDS.none)}`}
          data-colour-state={value ? 'set' : 'auto'}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-xs hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <Swatch colour={hexOrNone(shown)} />
          <span
            className={cn(
              'ms-auto text-muted-foreground',
              value && 'font-mono text-2xs uppercase'
            )}
          >
            {label ?? (auto !== undefined ? WORDS.auto : WORDS.none)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" aria-label={name}>
        <ColourField
          id={`${id}-hex`}
          label={name}
          value={value}
          placeholder={auto}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The brand's colours by the job each does, the dark values worked out from
 * them (or set by hand). The logo's own colours are offered beside the brand
 * colour; they are set in the logo's panel.
 */
export function BrandKitColours({ design, update }: { design: PortalDesign; update: Update }) {
  const { light } = design.brand
  const extra = light.extra ?? []
  const [adding, setAdding] = useState(false)
  // A part's own exact colour that no lightness of reads is not drawn, so it is no pair to fix here.
  const failing = useMemo(
    () => colourPairs(design).filter((pair) => !pair.passes && !pair.unused).length,
    [design]
  )
  const issues = useMemo(() => colourRowIssues(design), [design])
  const worked = useMemo(() => resolveDesign({ ...design, mode: 'light' }).light, [design])
  const autoOf: Record<MoreKey, string | undefined> = {
    surface: worked?.card,
    raised: worked?.muted,
    muted: worked?.mutedForeground,
    border: worked?.border,
  }
  const set = (key: keyof Palette, value: string | undefined, label?: string) =>
    update((draft) => {
      const palette = draft.brand.light as Record<string, unknown>
      if (value) palette[key] = value
      else if (key !== 'accent' && key !== 'ink' && key !== 'background') delete palette[key]
    }, label)
  // What "+ Add colour" adds next: the second colour, then up to two extras.
  const next = !light.support ? 'support' : extra.length < 2 ? 'extra' : null
  const nextName =
    next === 'support'
      ? COLOUR_NAMES.support
      : extra.length
        ? COLOUR_NAMES.extra2
        : COLOUR_NAMES.extra1
  const added = [
    ...(light.support
      ? [
          {
            id: 'kit-support',
            name: COLOUR_NAMES.support,
            value: light.support,
            write: (v: string | undefined) => set('support', v),
          },
        ]
      : []),
    ...extra.map((value, index) => ({
      id: `kit-extra-${index + 1}`,
      name: index === 0 ? COLOUR_NAMES.extra1 : COLOUR_NAMES.extra2,
      value,
      write: (v: string | undefined) => update((draft) => setExtra(draft, index, v)),
    })),
  ]
  const row = (key: 'accent' | 'ink' | 'background', name: string) => (
    <PropertyRow label={name} find={ROW_FIND[key].id} htmlFor={`kit-${key}`}>
      <ColourValue
        id={`kit-${key}`}
        name={name}
        value={light[key]}
        onChange={(v) => v && set(key, v)}
      />
    </PropertyRow>
  )
  const moreRow = ({ key, label }: { key: MoreKey; label: string }) => (
    <div key={key}>
      <PropertyRow
        label={label}
        find={ROW_FIND[key].id}
        htmlFor={`kit-${key}`}
        set={light[key] !== undefined}
        source={THEME.automatic}
        resetLabel={RESET_TO_AUTO}
        onReset={() => set(key, undefined)}
      >
        <ColourValue
          id={`kit-${key}`}
          name={label}
          value={light[key]}
          auto={autoOf[key] ?? light.background}
          onChange={(v) => set(key, v)}
        />
      </PropertyRow>
      {key === 'muted' && (
        <RowIssue name={label} issue={issues.muted} onFix={(fix) => set('muted', fix)} />
      )}
    </div>
  )
  const status = failing === 0 ? THEME.readable : THEME.hardToRead(failing)
  return (
    <PropertySection
      title={THEME.sections.colours}
      aside={
        <span className="flex items-center gap-1 text-2xs text-muted-foreground" title={status}>
          {failing === 0 ? (
            <CheckCircleIcon className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <ExclamationTriangleIcon className="size-3.5 text-warning" aria-hidden="true" />
          )}
          <span className={failing === 0 ? 'sr-only' : undefined}>{status}</span>
        </span>
      }
    >
      {row('accent', COLOUR_NAMES.accent)}
      <FromLogo
        colours={design.brand.logoColours ?? []}
        accent={light.accent}
        onPick={(colour) => set('accent', colour, THEME.brandFromLogo)}
      />
      {row('ink', COLOUR_NAMES.ink)}
      <RowIssue name={COLOUR_NAMES.ink} issue={issues.ink} onFix={(fix) => set('ink', fix)} />
      {row('background', COLOUR_NAMES.page)}
      {added.map(({ id, name, value, write }) => (
        <PropertyRow key={id} label={name} find={id} htmlFor={id}>
          <ColourValue id={id} name={name} value={value} onChange={(v) => v && write(v)} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            aria-label={`Remove ${name.toLowerCase()}`}
            onClick={() => write(undefined)}
          >
            <MinusIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </PropertyRow>
      ))}
      {/* Secondary text leaves More while it is hard to read. */}
      {issues.muted && moreRow(MORE[2]!)}
      {adding && next && (
        <PropertyRow label={nextName} htmlFor="kit-adding">
          <ColourValue
            id="kit-adding"
            name={nextName}
            value={undefined}
            startOpen
            onClosed={() => setAdding(false)}
            onChange={(v) => {
              if (!v) return
              setAdding(false)
              if (next === 'support') set('support', v)
              else update((draft) => setExtra(draft, extra.length, v))
            }}
          />
        </PropertyRow>
      )}
      {next && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-7 items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {THEME.addColour}
        </button>
      )}
      <PropertyMore>
        {MORE.filter(({ key }) => !(key === 'muted' && issues.muted)).map(moreRow)}
      </PropertyMore>
      {design.mode !== 'light' && <DarkValues design={design} update={update} />}
    </PropertySection>
  )
}

/**
 * The logo's own colours under the brand colour, each a swatch that makes
 * it the brand colour in one step. Quiet: nothing until the logo has colours,
 * and never the colour already in use.
 */
function FromLogo({
  colours,
  accent,
  onPick,
}: {
  colours: readonly string[]
  accent: string
  onPick: (colour: string) => void
}) {
  const offered = colours.filter((colour) => colour.toLowerCase() !== accent.toLowerCase())
  if (!offered.length) return null
  return (
    <div role="group" aria-label={THEME.fromLogo} className="flex min-h-7 items-center gap-2">
      {/* In the rows' label column, on one line; the swatches wrap beside it. */}
      <span className={cn(ROW_LABEL, 'shrink-0 text-xs whitespace-nowrap text-muted-foreground')}>
        {THEME.fromLogo}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {offered.map((colour) => (
          <Tip key={colour} text={THEME.useAsBrand(colour)}>
            <button
              type="button"
              aria-label={THEME.useAsBrand(colour)}
              onClick={() => onPick(colour)}
              className="grid size-6 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
            >
              <Swatch colour={hexOrNone(colour)} className="size-4" />
            </button>
          </Tip>
        ))}
      </span>
    </div>
  )
}

/** On a colour row that is hard to read: on what, and the nearest colour that reads, in one click. */
function RowIssue({
  name,
  issue,
  onFix,
}: {
  /** The row's name, such as Text. */
  name: string
  issue: ColourRowIssue | undefined
  onFix: (colour: string) => void
}) {
  if (!issue) return null
  return (
    <PropertyRowNote className="flex min-h-7 items-center gap-1.5">
      <ExclamationTriangleIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="me-auto">{THEME.hardOn(issue.on.join(', '))}</span>
      {issue.fix && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          aria-label={`${THEME.fix} ${name}`}
          onClick={() => onFix(issue.fix!)}
        >
          <Swatch colour={hexOrNone(issue.fix)} className="size-3" />
          {THEME.fix}
        </Button>
      )}
    </PropertyRowNote>
  )
}

/**
 * Dark's colours, made from light's automatically, or set by hand: a row
 * with the three that matter most, opening to the same names as light.
 */
function DarkValues({ design, update }: { design: PortalDesign; update: Update }) {
  const own = design.brand.dark ?? {}
  const custom = Object.keys(own).length > 0
  const worked = useMemo(() => resolveDesign({ ...design, mode: 'auto' }).dark, [design])
  const auto: Partial<Record<DarkRole, string>> = {
    background: worked?.background,
    ink: worked?.foreground,
    accent: worked?.primary,
    support: design.brand.light.support,
  }
  const write = (key: DarkRole, value: string | undefined) =>
    update((draft) => {
      const dark = { ...draft.brand.dark }
      if (value) dark[key] = value
      else delete dark[key]
      if (Object.keys(dark).length) draft.brand.dark = dark
      else delete draft.brand.dark
    })
  return (
    <details className="group/dark" data-dark-values="" data-find={FIND.darkMode.id}>
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className={cn(ROW_LABEL, 'shrink-0 text-xs leading-tight text-muted-foreground')}>
          {THEME.darkMode}
        </span>
        <span role="img" aria-label="Dark colours" className="flex gap-1">
          {(['background', 'ink', 'accent'] as const).map((key) => (
            <Swatch key={key} colour={hexOrNone(own[key] ?? auto[key])} />
          ))}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {custom ? THEME.custom : WORDS.auto}
        </span>
        <ChevronRightIcon
          className="size-3.5 text-muted-foreground transition-transform group-open/dark:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-0.5 pt-0.5">
        {DARK.filter(({ key }) => key !== 'support' || design.brand.light.support).map(
          ({ key, label }) => (
            <PropertyRow
              key={key}
              label={label}
              htmlFor={`kit-dark-${key}`}
              set={own[key] !== undefined}
              resetLabel={RESET_TO_AUTO}
              onReset={() => write(key, undefined)}
            >
              <ColourValue
                id={`kit-dark-${key}`}
                name={`${THEME.darkMode}: ${label}`}
                value={own[key]}
                auto={auto[key] ?? ''}
                onChange={(value) => write(key, value)}
              />
            </PropertyRow>
          )
        )}
        {custom && (
          <button
            type="button"
            onClick={() => update((draft) => void delete draft.brand.dark)}
            className={cn(
              'inline-flex min-h-6 items-center rounded text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              ROW_INDENT_MARGIN
            )}
          >
            {THEME.resetAllToAuto}
          </button>
        )}
      </div>
    </details>
  )
}
