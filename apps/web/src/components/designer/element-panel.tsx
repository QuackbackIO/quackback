/**
 * The properties of an element picked on the canvas, on the shared frame
 * (properties/). A change is shared by default: it starts at every one of
 * the element's kind, and the scope line offers the one-offs (just this one,
 * this block, this page) with what they reach. Its states are always shown,
 * with a dot on each that holds values. Rows are grouped as Fill, Text and
 * Shape; Edge and Shadow (and Lift, Focus ring in their states) are added
 * with "+"; the rest are under More. Each unset row shows what it has,
 * muted, and where it comes from; each row set here has a dot and Reset.
 * The places that keep their own values are listed at the foot.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { pickName, singular, type ElementPick, type Reach } from '@/lib/shared/design/element-pick'
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
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  COLOUR_PROPS,
  PHONE_PROPS,
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  styleAllows,
  type StyleElementInfo,
  type StylePaint,
  type StyleProp,
  type StylePropInfo,
  type StyleState,
} from '@/lib/shared/design/style-tokens'
import { cn } from '@/lib/shared/utils'
import { brandOf, everywhereValue, homeValuesOf, writeEverywhere } from './element-brand'
import { ElementStyleSection } from './element-style-section'
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
import { ScopeLine, type ScopeOption } from './properties/scope-line'
import { ScrubNumber } from './properties/scrub-number'
import { FontField, TokenField } from './properties/token-field'
import { colourTokens, fontTokens } from './properties/tokens'
import { CHOICE_TILES, SECTIONS, WORDS, everyOf, fromScope, resetTo } from './properties/words'

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

/** The panel's sections, in order: each one's props, and whether it is added with "+". */
const SECTION_PROPS: ReadonlyArray<{
  title: string
  props: readonly StyleProp[]
  optional: boolean
}> = [
  { title: SECTIONS.fill, props: ['background'], optional: false },
  { title: SECTIONS.text, props: ['color', 'size', 'weight'], optional: false },
  { title: SECTIONS.shape, props: ['radius', 'height', 'paddingX', 'paddingY'], optional: false },
  { title: SECTIONS.edge, props: ['borderColor', 'borderWidth', 'borderStyle'], optional: true },
  { title: SECTIONS.shadow, props: ['shadow'], optional: true },
  { title: SECTIONS.lift, props: ['lift'], optional: true },
  { title: SECTIONS.focusRing, props: ['ringWidth'], optional: true },
]

/** A row's label within its section: Edge's "Edge colour" is its Colour. */
const ROW_LABELS: Partial<Record<StyleProp, string>> = {
  color: 'Colour',
  borderColor: 'Colour',
  borderWidth: 'Width',
  borderStyle: 'Style',
  ringWidth: 'Width',
  lift: 'Rise',
}

/** How a scope reads in a source line: "every main button", "this page". */
const scopeWords = (scope: ScopeName, one: string) =>
  scope === 'everywhere'
    ? everyOf(one)
    : scope === 'page'
      ? 'this page'
      : scope === 'block'
        ? 'this block'
        : 'just this one'

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
  reach,
  measure,
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
  /**
   * How many the canvas shows of its kind, on this page and in its block.
   * Only the page drawn can be counted, so the shared scope's count is this
   * page's, and the line says so.
   */
  reach?: Reach | null
  /** A number the picked element is drawn with, for rows nothing in the cascade or brand sets. */
  measure?: (prop: StyleProp) => number | undefined
  /** Every one of the kind only, with no one-offs: opened from Styles, away from any one. */
  shared?: boolean
  /** The scope it starts at, where it is opened for one, such as from a block's look. */
  initialScope?: ScopeName
  /** The trail, where it is not the page's and block's: "Styles › Main buttons". */
  crumbs?: readonly Crumb[]
}) {
  const ctx = useMemo(() => contextOf(pick, page), [pick, page])
  const el: StyleElementInfo = STYLE_ELEMENTS[pick.element]
  const scopes = shared ? (['everywhere'] as ScopeName[]) : scopesFor(ctx)
  const [scope, setScope] = useState<ScopeName>(() =>
    initialScope && scopes.includes(initialScope) ? initialScope : defaultScope(ctx)
  )
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const at = scopes.includes(scope) ? scope : defaultScope(ctx)
  const name = pickName(pick, design, ctx.page)
  const one = singular(pick.element)
  // Under its block in the trail, a part is named alone: "Call to action".
  const crumb = shared ? el.label : (pick.part && partOf(design, pick.part)?.label) || name
  const phone = screen === 'phone'
  const tokens = useMemo(() => colourTokens(design), [design])
  const fonts = useMemo(() => fontTokens(design), [design])
  const undoName = (what: string) =>
    `${name}: ${what}, ${SCOPE_NAMES[at].toLowerCase()}${phone ? ', phones' : ''}`
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

  /** What a row has while nothing is set here, and where it comes from. */
  const inherited = (prop: StyleProp): { value: unknown; from: string } | null => {
    const wider = widerValue(design, ctx, at, screen, state, prop)
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
    const every = widest && state === 'base' ? undefined : everywhereValue(design, pick.element, prop)
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

  const row = (prop: StyleProp): ReactNode => {
    if (!allowed(prop)) return null
    const info: StylePropInfo = STYLE_PROPS[prop]
    const id = `style-${pick.element}-${state}-${prop}`
    const label = ROW_LABELS[prop] ?? info.label
    const here = readHere(prop)
    const from = inherited(prop)
    const resetLabel = from
      ? resetTo(valueText(prop, from.value), from.from)
      : `${WORDS.reset} ${label.toLowerCase()}`
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
                label={label}
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
              label={label}
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
                label={label}
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
              label={label}
              value={here as string | undefined}
              inherited={from?.value as string | undefined}
              options={Object.entries(tiles) as Array<[string, string]>}
              onChange={(v) => write(prop, v)}
            />
          )
        }
      }
    })()
    return (
      <PropertyRow
        key={`${state}-${prop}`}
        label={label}
        htmlFor={info.kind === 'number' ? id : undefined}
        set={here !== undefined}
        source={from?.from}
        resetLabel={resetLabel}
        onReset={() => write(prop, undefined)}
      >
        {control}
      </PropertyRow>
    )
  }

  const placed = new Set<StyleProp>(SECTION_PROPS.flatMap((s) => s.props))
  const rest = (el.props as readonly StyleProp[]).filter((p) => !placed.has(p) && allowed(p))
  // A rarer property most people change on this element sits in Text, not under More.
  const restCommon = rest.filter((p) => el.common.includes(p))
  const restMore = rest.filter((p) => !el.common.includes(p))
  const hasValue = (prop: StyleProp) =>
    readHere(prop) !== undefined ||
    effectiveValue(design, ctx, screen, state, prop) !== null ||
    everywhereValue(design, pick.element, prop) !== undefined

  const sections = SECTION_PROPS.map((section) => {
    const props = section.props.filter(allowed)
    const extra = section.title === SECTIONS.text ? restCommon : []
    if (!props.length && !extra.length) return null
    const optional = section.optional && !props.some((p) => el.common.includes(p))
    const shown = !optional || added.has(section.title) || props.some(hasValue)
    return (
      <PropertySection
        key={section.title}
        title={section.title}
        onAdd={optional ? () => setAdded(new Set([...added, section.title])) : undefined}
        added={shown}
        onRemove={
          optional
            ? () => {
                setAdded(new Set([...added].filter((t) => t !== section.title)))
                if (props.some((p) => readHere(p) !== undefined))
                  update((draft) => {
                    for (const p of props) writeHere(draft, p, undefined)
                  }, undoName(section.title.toLowerCase()))
              }
            : undefined
        }
      >
        {props.map(row)}
        {extra.map(row)}
      </PropertySection>
    )
  })

  const kinds = STYLE_ELEMENTS[pick.element].label.toLowerCase()
  const narrower: Array<ScopeOption<ScopeName>> = [
    ...(scopes.includes('part')
      ? [{ id: 'part' as const, link: WORDS.justThisOne, phrase: 'just this one', detail: name }]
      : []),
    ...(scopes.includes('block')
      ? [
          {
            id: 'block' as const,
            link: WORDS.thisBlock,
            phrase: `this block’s ${kinds}`,
            count: reach?.block ?? undefined,
          },
        ]
      : []),
    ...(scopes.includes('page')
      ? [
          {
            id: 'page' as const,
            link: WORDS.thisPage,
            phrase: `${kinds} on ${PAGE_NAMES[page]}`,
            count: reach?.page,
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
            label: `Reset ${scopeWords(at, one)} (${values} ${values === 1 ? 'value' : 'values'})`,
            onSelect: () =>
              update((draft) => {
                resetAt(draft, ctx, at, screen)
                for (const p of homes) writeEverywhere(draft, pick.element, p, undefined)
              }, undoName('reset')),
          },
        ]
      : []),
    ...(onScreen
      ? [
          phone
            ? { label: 'All screens', onSelect: () => onScreen('all') }
            : { label: 'Phone values', onSelect: () => onScreen('phone') },
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
      kind="Element"
      actions={actions}
      overrides={overrides}
      scope={
        <div className="space-y-2">
          <ScopeLine
            one={one}
            widest={{
              id: 'everywhere',
              count: reach?.page,
              countNote: reach ? 'on this page' : undefined,
            }}
            narrower={narrower}
            value={at}
            onChange={setScope}
          />
          {phone && onScreen && (
            <p className="text-xs text-muted-foreground">
              Phone values ·{' '}
              <button
                type="button"
                onClick={() => onScreen('all')}
                className="rounded underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
              >
                All screens
              </button>
            </p>
          )}
          {el.states.length > 1 && (
            <div
              role="radiogroup"
              aria-label="State"
              className="flex gap-0.5 rounded-lg bg-muted p-0.5"
            >
              {el.states.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={state === s}
                  onClick={() => onState(s)}
                  className={cn(
                    'flex h-6 min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-md px-1 text-[11px] focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
                    state === s
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {STATE_INFO[s].label}
                  {statesSet(s) && (
                    <>
                      <span
                        aria-hidden="true"
                        data-state-dot=""
                        className="size-1 shrink-0 rounded-full bg-primary"
                      />
                      <span className="sr-only">, set</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      {at === 'everywhere' && !phone && (
        <ElementStyleSection element={pick.element} name={name} design={design} update={update} />
      )}
      {sections}
      {restMore.length > 0 && (
        <div className="border-b border-border px-4 py-1.5">
          <PropertyMore>{restMore.map(row)}</PropertyMore>
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
