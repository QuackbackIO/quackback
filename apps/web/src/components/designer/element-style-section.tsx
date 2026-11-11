/**
 * An element's brand choices, at the element panel's widest scope. A choice
 * that sets one property (Shape sets Corners, Scale sets Size) is that
 * property's row: its tiles and a Custom tile for an exact value, drawn by
 * the panel, so one property has one control. The choices that are not one
 * property's (a menu's look, a card's density) are the Style section's tiles.
 * Picking a choice clears the exact values that would take its place.
 */
import type { ReactNode } from 'react'
import { setTune } from '@/components/admin/settings/appearance/tune-fields'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement, StyleProp } from '@/lib/shared/design/style-tokens'
import { everywhereValue, writeEverywhere } from './element-brand'
import { elementStyleFind } from './element-rows'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { ScrubNumber } from './properties/scrub-number'
import { SummaryRow } from './properties/summary-row'
import { faceName } from './properties/tokens'
import { SECTIONS, STYLE_CHOICES, WORDS } from './properties/words'
import { fontValue, layoutValue, shapeValue } from '@/lib/shared/design/defaults'

type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void
type Fonts = PortalDesign['brand']['fonts']

/** A brand choice as tiles: its value, how it is written, and the exact values that take its place. */
export interface TileChoice {
  label: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  apply: (draft: PortalDesign, value: string) => void
  /** The property it sets, whose row it is part of; none for a choice of the Style section. */
  prop?: StyleProp
  /** Properties whose exact values, set for every one, decide what this choice would. */
  masks?: readonly StyleProp[]
  /** Where else the choice reaches, on hover. */
  reach?: string
  /**
   * The value of the property's own control each option is, where every
   * option is one: then the row is that control, as on every other element,
   * and picking one of these values picks the choice.
   */
  same?: Readonly<Record<string, string>>
}

/** The Capitals choices as the Capitals control's values. */
const CAPITALS_SAME = { sentence: 'none', upper: 'upper' } as const
/** The fill choices as colour roles. */
const FILL_SAME = { accent: 'accent', ink: 'ink' } as const

/** The choice whose option a value of the property's own control is, if one is. */
export function sameOption(choice: TileChoice | undefined, value: unknown): string | undefined {
  if (!choice?.same) return undefined
  return Object.entries(choice.same).find(([, to]) => to === value)?.[0]
}

const tiles = <T extends Record<string, string>>(names: T) =>
  Object.entries(names) as Array<[string, string]>

const capitals = (): TileChoice['apply'] => (draft, v) =>
  void (draft.brand.fonts.labelCase = v as Fonts['labelCase'])

/** The brand choices an element has, in the order its Style section shows them. */
export function choicesOf(design: PortalDesign, element: StyleElement): TileChoice[] {
  const fonts = design.brand.fonts
  const { layout, shape } = design
  const second = !!design.brand.light.support
  const tint: TileChoice = {
    label: 'Current',
    value: layoutValue(layout, 'tint'),
    options: tiles(STYLE_CHOICES.tint),
    apply: (draft, v) => void (draft.layout.tint = v as typeof layout.tint),
    reach: 'The current menu item and vote boxes',
  }
  const labelCase: TileChoice = {
    label: 'Capitals',
    value: fontValue(fonts, 'labelCase'),
    options: tiles(STYLE_CHOICES.capitals),
    apply: capitals(),
    prop: 'case',
    masks: ['case'],
    same: CAPITALS_SAME,
    reach: 'Menu items and main buttons',
  }
  switch (element) {
    case 'button':
      return [
        {
          label: 'Shape',
          value: shapeValue(shape, 'buttons'),
          options: tiles(STYLE_CHOICES.buttonShape),
          apply: (draft, v) => void (draft.shape.buttons = v as typeof shape.buttons),
          prop: 'radius',
          masks: ['radius'],
        },
        {
          label: 'Fill',
          value: shape.fill === 'ink' ? 'ink' : 'accent',
          options: tiles(STYLE_CHOICES.fill),
          apply: (draft, v) => void (draft.shape.fill = v as typeof shape.fill),
          prop: 'background',
          masks: ['background', 'color'],
        },
        labelCase,
      ]
    case 'navItem':
      return [
        {
          label: 'Menu',
          value: layout.nav,
          options: tiles(STYLE_CHOICES.menu),
          apply: (draft, v) => void (draft.layout.nav = v as typeof layout.nav),
        },
        {
          label: 'Text',
          value: layoutValue(layout, 'navText'),
          options: tiles(STYLE_CHOICES.menuText),
          apply: (draft, v) => void (draft.layout.navText = v as typeof layout.navText),
          prop: 'color',
          masks: ['color'],
        },
        labelCase,
        ...(second ? [tint] : []),
      ]
    case 'vote':
      return second ? [tint] : []
    case 'postCard':
      return [
        {
          label: 'Look',
          value: layout.cards,
          options: tiles(STYLE_CHOICES.cards),
          apply: (draft, v) => {
            draft.layout.cards = v as typeof layout.cards
            // The card exact values post cards and panels share would take the look's place.
            setTune(draft, 'card', 'border', undefined)
            setTune(draft, 'card', 'shadow', undefined)
          },
          masks: ['borderWidth', 'shadow'],
          reach: 'Post cards and panels',
        },
        ...(layout.cards === 'raised'
          ? [
              {
                label: 'Shadow',
                value:
                  design.tune?.card?.shadow && design.tune.card.shadow !== 'none'
                    ? design.tune.card.shadow
                    : 'lifted',
                options: tiles(STYLE_CHOICES.shadow),
                apply: (draft: PortalDesign, v: string) =>
                  setTune(draft, 'card', 'shadow', v as 'soft'),
                prop: 'shadow' as const,
                masks: ['shadow'] as const,
                reach: 'Post cards and panels',
              },
            ]
          : []),
        {
          label: 'Density',
          value: layout.density,
          options: tiles(STYLE_CHOICES.density),
          apply: (draft, v) => void (draft.layout.density = v as typeof layout.density),
        },
      ]
    case 'badge':
    case 'chip':
      return [
        {
          label: 'Status',
          value: layoutValue(layout, 'status'),
          options: tiles(STYLE_CHOICES.status).filter(
            ([status]) => status !== 'brand' || (design.brand.logoColours?.length ?? 0) > 1
          ),
          apply: (draft, v) => void (draft.layout.status = v as typeof layout.status),
          reach: 'Status markers and tags',
        },
      ]
    case 'secondary':
      return [
        {
          label: 'Look',
          value: design.tune?.secondary?.style ?? '',
          options: tiles(STYLE_CHOICES.secondary),
          apply: (draft, v) => setTune(draft, 'secondary', 'style', v),
        },
      ]
    case 'headline':
      return [
        {
          label: 'Scale',
          value: fontValue(fonts, 'scale'),
          options: tiles(STYLE_CHOICES.scale),
          apply: (draft, v) => void (draft.brand.fonts.scale = v as Fonts['scale']),
          // Text size is a number on every text element; the scale is a Style choice.
          masks: ['size'],
        },
        {
          label: 'Spacing',
          value: fontValue(fonts, 'tracking'),
          options: tiles(STYLE_CHOICES.spacing),
          apply: (draft, v) => void (draft.brand.fonts.tracking = v as Fonts['tracking']),
          masks: ['tracking'],
        },
        {
          label: 'Capitals',
          value: fontValue(fonts, 'headlineCase'),
          options: tiles(STYLE_CHOICES.capitals),
          apply: (draft, v) => void (draft.brand.fonts.headlineCase = v as Fonts['headlineCase']),
          prop: 'case',
          masks: ['case'],
          same: CAPITALS_SAME,
        },
        {
          label: 'Colour',
          value: fontValue(fonts, 'headlineColour'),
          options: tiles(STYLE_CHOICES.fill),
          apply: (draft, v) =>
            void (draft.brand.fonts.headlineColour = v as Fonts['headlineColour']),
          prop: 'color',
          masks: ['color'],
          same: FILL_SAME,
        },
      ]
    default:
      return []
  }
}

/** The choice that is a property's row for an element, if one is. */
export function rowChoiceOf(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): TileChoice | undefined {
  return choicesOf(design, element).find((choice) => choice.prop === prop)
}

/** The choice's properties whose exact values, set for every one, take its place. */
export const maskedBy = (design: PortalDesign, element: StyleElement, choice: TileChoice) =>
  (choice.masks ?? []).filter((prop) => everywhereValue(design, element, prop) !== undefined)

/** Picks a choice in a draft, clearing the exact values that would take its place. */
export function applyChoice(
  draft: PortalDesign,
  element: StyleElement,
  choice: TileChoice,
  value: string
): void {
  choice.apply(draft, value)
  for (const prop of choice.masks ?? []) writeEverywhere(draft, element, prop, undefined)
}

/** Which brand font an element's font row shows, and opens in the brand kit. */
export type FontSlot = 'heading' | 'headline'

/**
 * A brand font as an element's font row: a summary of the brand's font for
 * it, which opens the brand kit's fonts at that slot, their one writer.
 */
function BrandFontRow({
  slot,
  design,
  onFonts,
}: {
  slot: FontSlot
  design: PortalDesign
  onFonts: (slot: FontSlot) => void
}) {
  const fonts = design.brand.fonts
  const face = slot === 'headline' ? (fonts.display ?? fonts.heading) : fonts.heading
  return (
    <SummaryRow
      label="Font"
      value={faceName(face)}
      find={elementStyleFind(slot, 'Font')}
      onOpen={() => onFonts(slot)}
    />
  )
}

/** A post card title's exact rows, as its Style section draws them. */
export const CARD_TITLE_ROWS = [
  { key: 'titleSize', label: 'Title size', min: 12, max: 28, step: 1, unit: 'px' },
  { key: 'titleWeight', label: 'Title weight', min: 100, max: 900, step: 100, unit: undefined },
] as const

/** A post card title's exact size and weight: the tune is their only home. */
function CardTitleRows({ design, update }: { design: PortalDesign; update: NamedUpdate }) {
  const card = design.tune?.card
  return CARD_TITLE_ROWS.map((row) => {
    const value = card?.[row.key]
    const id = `element-card-${row.key}`
    return (
      <PropertyRow
        key={row.key}
        label={row.label}
        find={elementStyleFind('postCard', row.label)}
        htmlFor={id}
        set={value !== undefined}
        resetLabel={`${WORDS.reset} ${row.label.toLowerCase()}`}
        onReset={() =>
          update(
            (draft) => setTune(draft, 'card', row.key, undefined),
            `Cards: ${row.label.toLowerCase()}, everywhere`
          )
        }
      >
        <ScrubNumber
          id={id}
          label={row.label}
          value={value}
          min={row.min}
          max={row.max}
          step={row.step}
          unit={row.unit}
          onChange={(next) =>
            update(
              (draft) => setTune(draft, 'card', row.key, next),
              `Cards: ${row.label.toLowerCase()}, everywhere`
            )
          }
        />
      </PropertyRow>
    )
  })
}

/** The Style section of an element's panel; nothing for an element with no brand choices. */
export function ElementStyleSection({
  element,
  name,
  design,
  update,
  onFonts,
}: {
  element: StyleElement
  /** The element as an undo step names it. */
  name: string
  design: PortalDesign
  update: NamedUpdate
  /** Opens the brand kit's fonts at a slot; without it, a heading's font row is not shown. */
  onFonts?: (slot: FontSlot) => void
}) {
  // A choice that is one property's sits in that property's row.
  const choices = choicesOf(design, element).filter((choice) => !choice.prop)
  const rows: ReactNode[] = []
  if ((element === 'headline' || element === 'heading') && onFonts)
    rows.push(<BrandFontRow key="font" slot={element} design={design} onFonts={onFonts} />)
  for (const choice of choices) {
    const masked = maskedBy(design, element, choice)
    const id = `element-style-${element}-${choice.label.toLowerCase()}`
    rows.push(
      <PropertyRow
        key={choice.label}
        label={choice.label}
        find={elementStyleFind(element, choice.label)}
        source={choice.reach}
      >
        <PropertyTiles
          id={id}
          label={choice.label}
          value={masked.length || !choice.value ? undefined : choice.value}
          options={choice.options}
          onChange={(value) =>
            update(
              (draft) => applyChoice(draft, element, choice, value),
              `${name}: ${choice.label.toLowerCase()}, everywhere`
            )
          }
        />
      </PropertyRow>
    )
  }
  if (element === 'postCard')
    rows.push(<CardTitleRows key="title" design={design} update={update} />)
  if (!rows.length) return null
  return <PropertySection title={SECTIONS.style}>{rows}</PropertySection>
}
