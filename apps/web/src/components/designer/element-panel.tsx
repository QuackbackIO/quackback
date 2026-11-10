/**
 * The properties of an element picked on the canvas, on the shared frame
 * (properties/). A change is shared by default: it starts at every one of
 * the element's kind, and the scope line offers the one-offs (just this one,
 * this block, this page) with what they reach. It opens simple, with its
 * background, text colour and size and corners; the rest is under More,
 * which stays open for the visit once opened. The state shown is one chip,
 * "State: Normal", with the others in its menu. Each property is one row;
 * for every one, a brand choice that sets it is that row's tiles, with
 * Custom for an exact value. Each unset row shows what it has, muted and in
 * whole pixels, and where it comes from; each row set here has a dot and
 * Reset. Where the canvas draws a value other than the row's (a headline is
 * smaller on a phone, a text colour is moved so it reads), a muted second
 * line says what is drawn, with Use this. The places that keep their own
 * values are listed at the foot.
 *
 * Under the scope line, a chip says which screens a change goes to: all
 * screens, or phones. On the Phone canvas the scope block is tinted, a row
 * set for phones has a tinted dot and "Use all-screens value"; on all screens
 * a row whose phones differ has a tinted dot.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'
import {
  pickName,
  pickScope,
  singular,
  type ElementPick,
  type Reach,
} from '@/lib/shared/design/element-pick'
import { partOf } from '@/lib/shared/design/parts-registry'
import {
  SCOPE_NAMES,
  alsoSetAt,
  darkScopes,
  defaultScope,
  effectiveValue,
  readAt,
  readDarkAt,
  resetAt,
  resetPlace,
  scopesFor,
  setsAt,
  widerValue,
  writeAt,
  writeDarkAt,
  type AlsoSet,
  type ElementContext,
  type ScopeName,
  type Screen,
} from '@/lib/shared/design/override-cascade'
import { backgroundPageOf } from '@/lib/shared/design/page-background'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { PAGE_NAMES } from '@/lib/shared/design/names'
import { cssColourHex, inUseNote, type DrawnSize } from '@/lib/shared/design/in-use'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  COLOUR_PROPS,
  PHONE_PROPS,
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  styleAllows,
  type StyleColour,
  type StyleElementInfo,
  type StylePaint,
  type StyleProp,
  type StylePropInfo,
  type StyleState,
} from '@/lib/shared/design/style-tokens'
import { darkDrawnColour } from '@/lib/shared/design/style-css'
import { resolveDesignCached } from '@/lib/shared/design/resolve'
import { brandOf, everywhereValue, homeValuesOf, writeEverywhere } from './element-brand'
import { BASICS, SECTION_PROPS, elementRowFind, elementRowLabel } from './element-rows'
import {
  ElementStyleSection,
  applyChoice,
  rowChoiceOf,
  type FontSlot,
} from './element-style-section'
import { StyleField } from './element-styles'
import { placeDetail, valueText } from './set-differently'
import {
  PropertiesPanel,
  PropertyMore,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
  type OverridePlace,
  type PanelAction,
} from './properties/properties-panel'
import { PHONE_TINT, PHONE_WORDS } from './properties/phone-mode'
import { ScopeLine, type ScopeOption } from './properties/scope-line'
import { ScrubNumber } from './properties/scrub-number'
import { FontField, TokenField } from './properties/token-field'
import { colourTokens, fontTokens, hexOf } from './properties/tokens'
import type { Drawn } from './use-pick-reach'
import { CHOICE_TILES, WORDS, everyOf, fromScope, resetTo } from './properties/words'

type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

export { valueText }

/** The panel's context for a pick: its kind, part, page and block. */
export function contextOf(pick: ElementPick, page: DesignerPage): ElementContext {
  return {
    element: pick.element,
    part: pick.part,
    page: backgroundPageOf(page),
    block: pick.section?.startsWith('block-') ? pick.section.slice('block-'.length) : null,
  }
}

/** Kept per pick, so a new pick starts shared again; mount it with this as its key. */
export const elementPanelKey = (pick: ElementPick) =>
  `${pick.element}|${pick.part ?? ''}|${pick.section ?? ''}`

/** What the canvas draws the picked element with, at the width and in the mode it draws. */
export interface DrawnElement {
  values: Drawn
  size: DrawnSize
  dark: boolean
}

/**
 * A count a scope line shows. A scope that holds the pick reaches one at
 * least, so none is shown rather than a 0 that would be wrong.
 */
const counted = (n: number | null | undefined) => (n ? n : undefined)

/** A row's tile for its exact field, after the brand's choices. */
const CUSTOM = 'custom'

/** How a scope reads in a source line: "every main button", "this page". */
const scopeWords = (scope: ScopeName, one: string) =>
  scope === 'everywhere' ? everyOf(one) : SCOPE_NAMES[scope].toLowerCase()

export function ElementPanel({
  pick,
  page,
  blockName,
  design,
  update,
  state,
  onState,
  screen,
  onScreen,
  onUp,
  onJump,
  onFonts,
  reach,
  measure,
  drawn = null,
  shared = false,
  initialScope,
  crumbs: ownCrumbs,
}: {
  pick: ElementPick
  page: DesignerPage
  /** The name of the block or section it is in. */
  blockName: string | null
  design: PortalDesign
  update: NamedUpdate
  /** The state shown, which the canvas draws the element in. */
  state: StyleState
  onState: (state: StyleState) => void
  /** All screens, or phones; the canvas shows a phone with it. */
  screen: Screen
  /** Shows the canvas at a screen; absent where the panel has no canvas of its own. */
  onScreen?: (screen: Screen) => void
  /** Picks the block it is in. */
  onUp: () => void
  /** Goes to a place the look is also set. */
  onJump?: (place: AlsoSet) => void
  /** Opens the brand kit's fonts at a slot, from a heading's font row. */
  onFonts?: (slot: FontSlot) => void
  /**
   * How many the canvas shows of its kind, on this page and in its block.
   * Only the page drawn can be counted, so the shared scope's count is this
   * page's, and the line says so.
   */
  reach?: Reach | null
  /** A number the picked element is drawn with, for rows nothing in the cascade or brand sets. */
  measure?: (prop: StyleProp) => number | undefined
  /** What the canvas draws the picked element with now; null until it is read. */
  drawn?: DrawnElement | null
  /** Every one of the kind only, with no one-offs: opened from Styles, away from any one. */
  shared?: boolean
  /** The scope it starts at, where it is opened for one, such as from a block's look. */
  initialScope?: ScopeName
  /** The trail, where it is not the page's and block's: "Styles › Main buttons". */
  crumbs?: readonly Crumb[]
}) {
  const ctx = useMemo(() => contextOf(pick, page), [pick, page])
  const el: StyleElementInfo = STYLE_ELEMENTS[pick.element]
  // What a change reaches, in the pick's own noun. A listed item, such as a post's title, is
  // reached only by its own part, which changes every item where it is listed.
  const reaches = pickScope(pick, design, ctx.page)
  const item = !shared && reaches.item
  const scopes: ScopeName[] = shared ? ['everywhere'] : item ? ['part'] : scopesFor(ctx)
  const startAt: ScopeName = item ? 'part' : defaultScope(ctx)
  const [scope, setScope] = useState<ScopeName>(() =>
    initialScope && scopes.includes(initialScope) ? initialScope : startAt
  )
  /** Rows whose Custom tile is picked, showing their exact field before a value is set. */
  const [customOpen, setCustomOpen] = useState<ReadonlySet<StyleProp>>(new Set())
  const at = scopes.includes(scope) ? scope : startAt
  const name = pickName(pick, design, ctx.page)
  // One of its element kind, which the wider scopes it inherits from are named by.
  const one = singular(pick.element)
  // Under its block in the trail, a part is named alone: "Call to action".
  const crumb = shared ? el.label : (pick.part && partOf(design, pick.part)?.label) || name
  const phone = screen === 'phone'
  const tokens = useMemo(() => colourTokens(design), [design])
  const fonts = useMemo(() => fontTokens(design), [design])
  const atWords = item ? reaches.phrase : SCOPE_NAMES[at].toLowerCase()
  const undoName = (what: string) => `${name}: ${what}, ${atWords}${phone ? ', phones' : ''}`
  const allowed = (prop: StyleProp) =>
    (el.props as readonly StyleProp[]).includes(prop) &&
    styleAllows(pick.element, state, prop) &&
    (!phone || (PHONE_PROPS as readonly string[]).includes(prop))

  // Every one's normal look on all screens is the element's brand layer: its exact value, else its style.
  const widest = at === 'everywhere' && screen === 'all'
  const readHere = (prop: StyleProp, s: StyleState = state) =>
    widest && s === 'base'
      ? everywhereValue(design, pick.element, prop)
      : readAt(design, ctx, at, screen, s, prop)
  const writeHere = (draft: PortalDesign, prop: StyleProp, value: unknown) =>
    widest && state === 'base'
      ? writeEverywhere(draft, pick.element, prop, value)
      : writeAt(draft, ctx, at, screen, state, prop, value)
  const write = (prop: StyleProp, value: unknown) =>
    update(
      (draft) => writeHere(draft, prop, value === '' ? undefined : value),
      undoName(STYLE_PROPS[prop].label.toLowerCase())
    )
  const darkOf = (prop: StyleProp) =>
    !phone && darkScopes(ctx).includes(at) && (COLOUR_PROPS as readonly string[]).includes(prop)
      ? {
          value: readDarkAt(design, ctx, at, state, prop) as string | undefined,
          onChange: (value: string | undefined) =>
            update(
              (draft) => writeDarkAt(draft, ctx, at, state, prop, value),
              undoName(`${STYLE_PROPS[prop].label.toLowerCase()} in dark mode`)
            ),
        }
      : undefined

  /** What a row has while nothing is set here, and where it comes from, in whole pixels. */
  const inherited = (prop: StyleProp): { value: unknown; from: string } | null => {
    const found = inheritedRaw(prop)
    const info: StylePropInfo = STYLE_PROPS[prop]
    return found && typeof found.value === 'number' && info.kind === 'number' && info.unit === 'px'
      ? { ...found, value: Math.round(found.value) }
      : found
  }
  const inheritedRaw = (prop: StyleProp): { value: unknown; from: string } | null => {
    const wider = widerValue(design, ctx, at, screen, state, prop)
    // A listed item takes nothing from wider scopes: none of them reaches it. It has what it is drawn with.
    if (item) {
      if (wider && wider.from === at)
        return {
          value: wider.value,
          from: wider.screen !== screen ? 'From all screens' : `From ${STATE_INFO.base.label}`,
        }
      const measured = measure?.(prop)
      return measured !== undefined ? { value: measured, from: WORDS.fromBrand } : null
    }
    if (wider)
      return {
        value: wider.value,
        from:
          wider.from !== at
            ? fromScope(scopeWords(wider.from, one))
            : wider.screen !== screen
              ? 'From all screens'
              : `From ${STATE_INFO.base.label}`,
      }
    // Every one's exact value, below this scope, state or screen.
    const every =
      widest && state === 'base' ? undefined : everywhereValue(design, pick.element, prop)
    if (every !== undefined)
      return {
        value: every,
        from:
          at !== 'everywhere'
            ? fromScope(scopeWords('everywhere', one))
            : state !== 'base'
              ? `From ${STATE_INFO.base.label}`
              : 'From all screens',
      }
    const brand = brandOf(design, pick.element, prop)
    if (brand !== undefined) return { value: brand, from: WORDS.fromBrand }
    // What the element is drawn with is the brand's only where nothing narrower sets it.
    if (!effectiveValue(design, ctx, screen, state, prop)) {
      const measured = measure?.(prop)
      if (measured !== undefined) return { value: measured, from: WORDS.fromBrand }
    }
    return null
  }

  /** A colour a row stores, a hex or a role's name, as light draws it. */
  const colourHex = (colour: string): string | null => {
    const token = tokens.find((each) => each.id === colour)
    const css = token ? token.light : colour
    return hexOf(css) ?? cssColourHex(css)
  }
  /** The second line, where what the canvas draws is not what the row has. */
  const inUse = (prop: StyleProp, label: string, shown: unknown): ReactNode => {
    if (!drawn) return null
    const kind = STYLE_PROPS[prop].kind
    const colour = kind === 'colour' || kind === 'paint'
    // In dark mode a row's colour is drawn as dark's: its own there, else light's carried over.
    const dark = drawn.dark && colour ? darkOf(prop) : undefined
    if (drawn.dark && colour && !dark) return null
    // What a narrower place sets reaches the element in place of this row's value.
    const reaching = effectiveValue(design, ctx, screen, state, prop)
    if (reaching && reaching.value !== shown) return null
    const note = inUseNote({
      prop,
      stored: shown,
      drawn: drawn.values[prop],
      size: drawn.size,
      colourHex: dark
        ? (stored) => {
            const { light, dark: night } = resolveDesignCached(design)
            const css = darkDrawnColour(
              stored as StyleColour,
              dark.value as StyleColour | undefined,
              design,
              light,
              night
            )
            return css ? (hexOf(css) ?? cssColourHex(css)) : null
          }
        : colourHex,
    })
    if (!note) return null
    // Used in dark mode, the colour drawn is dark mode's own.
    const use = dark ? () => dark.onChange(String(note.value)) : () => write(prop, note.value)
    return (
      <p
        data-in-use={label}
        className="-mt-0.5 flex min-w-0 items-center gap-1.5 ps-[100px] text-[11px] text-muted-foreground"
      >
        <span className="min-w-0 truncate">{note.text}</span>
        <button
          type="button"
          onClick={use}
          className="shrink-0 rounded hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          {WORDS.useThis}
        </button>
      </p>
    )
  }

  const row = (prop: StyleProp): ReactNode => {
    if (!allowed(prop)) return null
    const info: StylePropInfo = STYLE_PROPS[prop]
    const id = `style-${pick.element}-${state}-${prop}`
    const label = elementRowLabel(prop)
    const here = readHere(prop)
    const from = inherited(prop)
    const resetLabel = from
      ? resetTo(valueText(prop, from.value), from.from)
      : `${WORDS.reset} ${label.toLowerCase()}`
    // For every one, a brand choice that sets this property is its row's tiles, with Custom for the exact field.
    const choice = widest && state === 'base' ? rowChoiceOf(design, pick.element, prop) : undefined
    const fieldLabel = choice ? `${WORDS.custom} ${label.toLowerCase()}` : label
    const control = (() => {
      switch (info.kind) {
        case 'paint':
        case 'colour': {
          if (typeof here === 'object' && here)
            return <StyleField id={id} prop={prop} value={here} onChange={(v) => write(prop, v)} />
          return (
            <>
              <TokenField
                id={id}
                label={fieldLabel}
                value={here as string | undefined}
                inherited={typeof from?.value === 'string' ? from.value : undefined}
                tokens={tokens}
                onChange={(v) => write(prop, v)}
                dark={darkOf(prop)}
              />
              {info.kind === 'paint' && (
                <button
                  type="button"
                  onClick={() =>
                    write(prop, {
                      from: (here as Extract<StylePaint, string> | undefined) ?? 'accent',
                      to: 'support',
                      angle: 135,
                    } satisfies StylePaint)
                  }
                  className="min-w-0 truncate rounded text-[11px] text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                >
                  Gradient
                </button>
              )}
            </>
          )
        }
        case 'number':
          return (
            <ScrubNumber
              id={id}
              label={fieldLabel}
              value={typeof here === 'number' ? here : undefined}
              inherited={typeof from?.value === 'number' ? from.value : undefined}
              min={info.min}
              max={info.max}
              step={info.step}
              unit={info.unit || undefined}
              onChange={(v) => write(prop, v)}
            />
          )
        case 'choice': {
          if (prop === 'font')
            return (
              <FontField
                id={id}
                label={fieldLabel}
                value={here === 'display' ? 'headline' : (here as string | undefined)}
                inherited={
                  from?.value === 'display' ? 'headline' : (from?.value as string | undefined)
                }
                slots={fonts}
                onChange={(slot) => write(prop, slot === 'headline' ? 'display' : slot)}
              />
            )
          const tiles = (CHOICE_TILES as Record<string, Record<string, string>>)[prop] ?? info.looks
          return (
            <PropertyTiles
              id={id}
              label={fieldLabel}
              value={here as string | undefined}
              inherited={from?.value as string | undefined}
              options={Object.entries(tiles) as Array<[string, string]>}
              onChange={(v) => write(prop, v)}
            />
          )
        }
      }
    })()
    const second = inUse(prop, label, here ?? from?.value)
    // Phones' own value: on a phone it can go back to all screens'; elsewhere a dot says it is there.
    const phoneRow = {
      phoneSet:
        !phone &&
        (PHONE_PROPS as readonly string[]).includes(prop) &&
        readAt(design, ctx, at, 'phone', state, prop) !== undefined,
      onUseAllScreens: phone ? () => write(prop, undefined) : undefined,
    }
    if (choice) {
      const custom = here !== undefined || customOpen.has(prop)
      return (
        <Fragment key={`${state}-${prop}`}>
          <PropertyRow
            label={label}
            find={elementRowFind(pick.element, prop)}
            set={here !== undefined}
            source={choice.reach ?? from?.from}
            resetLabel={resetLabel}
            onReset={() => write(prop, undefined)}
            {...phoneRow}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <PropertyTiles
                id={`${id}-choice`}
                label={label}
                value={custom ? CUSTOM : choice.value || undefined}
                options={[...choice.options, [CUSTOM, WORDS.custom]]}
                onChange={(value) => {
                  setCustomOpen((open) => {
                    const next = new Set(open)
                    if (value === CUSTOM) next.add(prop)
                    else next.delete(prop)
                    return next
                  })
                  if (value !== CUSTOM)
                    update(
                      (draft) => applyChoice(draft, pick.element, choice, value),
                      undoName(label.toLowerCase())
                    )
                }}
              />
              {custom && <div className="flex min-w-0 items-center gap-1.5">{control}</div>}
            </div>
          </PropertyRow>
          {second}
        </Fragment>
      )
    }
    return (
      <Fragment key={`${state}-${prop}`}>
        <PropertyRow
          label={label}
          find={elementRowFind(pick.element, prop)}
          htmlFor={info.kind === 'number' ? id : undefined}
          set={here !== undefined}
          source={from?.from}
          resetLabel={resetLabel}
          onReset={() => write(prop, undefined)}
          {...phoneRow}
        >
          {control}
        </PropertyRow>
        {second}
      </Fragment>
    )
  }

  // It opens simple: the basics, else what most people change on it; the rest is under More.
  const basicsOf = BASICS.filter(allowed)
  const basics = basicsOf.length ? basicsOf : el.common.filter(allowed)
  const placed = new Set<StyleProp>(SECTION_PROPS.flatMap((s) => s.props))
  const rest = (el.props as readonly StyleProp[]).filter(
    (p) => !placed.has(p) && allowed(p) && !basics.includes(p)
  )
  const groups = [
    ...SECTION_PROPS.map((section) => ({
      title: section.title,
      props: section.props.filter((p) => allowed(p) && !basics.includes(p)),
    })),
    { title: undefined, props: rest },
  ].filter((group) => group.props.length > 0)
  const moreSet = groups.some((group) => group.props.some((p) => readHere(p) !== undefined))

  const kinds = STYLE_ELEMENTS[pick.element].label.toLowerCase()
  const narrower: Array<ScopeOption<ScopeName>> = [
    ...(scopes.includes('part')
      ? [
          {
            id: 'part' as const,
            link: WORDS.justThisOne,
            phrase: WORDS.justThisOne.toLowerCase(),
            detail: name,
          },
        ]
      : []),
    ...(scopes.includes('block')
      ? [
          {
            id: 'block' as const,
            link: WORDS.thisBlock,
            phrase: `this block’s ${kinds}`,
            count: counted(reach?.block),
          },
        ]
      : []),
    ...(scopes.includes('page')
      ? [
          {
            id: 'page' as const,
            link: WORDS.thisPage,
            phrase: `${kinds} on ${PAGE_NAMES[page]}`,
            count: counted(reach?.page),
          },
        ]
      : []),
  ]

  const overrides: OverridePlace[] = alsoSetAt(design, ctx, at).map((place) => ({
    key: `${place.scope}:${place.label}`,
    label: place.label,
    detail: placeDetail(design, pick.element, place),
    onReset: () =>
      update((draft) => resetPlace(draft, pick.element, place), `${place.label}: reset`),
    onGo: onJump ? () => onJump(place) : undefined,
  }))

  const homes = widest ? homeValuesOf(design, pick.element) : []
  const values =
    countAt(design, ctx, at, screen) +
    homes.filter((p) => readAt(design, ctx, at, screen, 'base', p) === undefined).length
  const actions: PanelAction[] = [
    ...(values
      ? [
          {
            label: `Reset ${item ? reaches.phrase : scopeWords(at, one)} (${values} ${values === 1 ? 'value' : 'values'})`,
            onSelect: () =>
              update((draft) => {
                resetAt(draft, ctx, at, screen)
                for (const p of homes) writeEverywhere(draft, pick.element, p, undefined)
              }, undoName('reset')),
          },
        ]
      : []),
  ]

  const statesSet = (s: StyleState) =>
    (el.props as readonly StyleProp[]).some((p) => readHere(p, s) !== undefined)

  return (
    <PropertiesPanel
      data-element-panel=""
      className="pb-24"
      crumbs={
        ownCrumbs ?? [
          { label: PAGE_NAMES[page] },
          ...(blockName ? [{ label: blockName, onSelect: onUp }] : []),
          { label: crumb },
        ]
      }
      title={crumb}
      actions={actions}
      overrides={overrides}
      scope={
        <div
          className={cn('space-y-2', phone && PHONE_TINT.block)}
          data-phone-mode={phone || undefined}
        >
          <ScopeLine
            one={one}
            widest={
              item
                ? { id: 'part', phrase: reaches.phrase, count: counted(reach?.page) }
                : {
                    id: 'everywhere',
                    count: counted(reach?.page),
                    countNote: counted(reach?.page) ? 'on this page' : undefined,
                  }
            }
            narrower={item ? [] : narrower}
            value={at}
            onChange={setScope}
          />
          {(onScreen || el.states.length > 1) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {onScreen && <ScreenChip value={screen} onChange={onScreen} />}
              {el.states.length > 1 && (
                <StateChip states={el.states} value={state} onChange={onState} isSet={statesSet} />
              )}
            </div>
          )}
        </div>
      }
    >
      {at === 'everywhere' && !phone && (
        <ElementStyleSection
          element={pick.element}
          name={name}
          design={design}
          update={update}
          onFonts={onFonts}
        />
      )}
      {basics.length > 0 && <PropertySection>{basics.map(row)}</PropertySection>}
      {groups.length > 0 && (
        <div className="border-b border-border px-4 py-1.5">
          <PropertyMore remember="element-more" initiallyOpen={moreSet}>
            {groups.map((group) => (
              <div key={group.title ?? 'rest'} className="space-y-0.5 pt-1">
                {group.title && <h3 className="pt-1 text-xs font-semibold">{group.title}</h3>}
                {group.props.map(row)}
              </div>
            ))}
          </PropertyMore>
        </div>
      )}
    </PropertiesPanel>
  )
}

/** How many values an element sets at a scope and screen, across its states. */
function countAt(design: PortalDesign, ctx: ElementContext, at: ScopeName, screen: Screen) {
  if (!setsAt(design, ctx, at, screen)) return 0
  const el = STYLE_ELEMENTS[ctx.element]
  let n = 0
  for (const s of el.states)
    for (const p of el.props) if (readAt(design, ctx, at, screen, s, p) !== undefined) n++
  return n
}

/**
 * Which screens a change goes to, always in view under the scope line: all
 * screens, or phones, which shows the canvas as a phone. Phone is tinted.
 */
function ScreenChip({ value, onChange }: { value: Screen; onChange: (screen: Screen) => void }) {
  const options: Array<[Screen, string]> = [
    ['all', PHONE_WORDS.allScreens],
    ['phone', PHONE_WORDS.phone],
  ]
  return (
    <div
      role="radiogroup"
      aria-label={PHONE_WORDS.editing}
      data-screen-chip=""
      className="inline-flex h-6 items-center rounded-md border border-border p-0.5"
    >
      {options.map(([screen, label]) => {
        const on = value === screen
        return (
          <button
            key={screen}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(screen)}
            className={cn(
              'h-full rounded px-1.5 text-[11px] focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              on
                ? screen === 'phone'
                  ? PHONE_TINT.chip
                  : 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The state shown, as one quiet chip, "State: Normal", with a menu of the
 * element's states; a dot marks each that holds values, and the chip has one
 * when a state other than the one shown does.
 */
function StateChip({
  states,
  value,
  onChange,
  isSet,
}: {
  states: readonly StyleState[]
  value: StyleState
  onChange: (state: StyleState) => void
  isSet: (state: StyleState) => boolean
}) {
  const others = states.some((s) => s !== value && isSet(s))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-state-chip=""
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          {WORDS.state}: <span className="text-foreground">{STATE_INFO[value].label}</span>
          {others && (
            <>
              <span
                aria-hidden="true"
                className="size-1 shrink-0 rounded-full bg-muted-foreground"
              />
              <span className="sr-only">, other states set</span>
            </>
          )}
          <ChevronDownIcon className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as StyleState)}
        >
          {states.map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="text-[13px]">
              {STATE_INFO[s].label}
              {isSet(s) && (
                <>
                  <span
                    aria-hidden="true"
                    data-state-dot=""
                    className="ms-auto size-1.5 shrink-0 rounded-full bg-muted-foreground"
                  />
                  <span className="sr-only">, set</span>
                </>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
