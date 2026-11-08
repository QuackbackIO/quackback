/**
 * An element's Style section: the brand's choices for it as preset tiles,
 * at the element panel's widest scope. A choice is a preset for the rows
 * below it: picking Rounded shows Corners as its 999 px, from brand. Where
 * an exact value takes a choice's place, no tile is filled, and picking one
 * clears that exact value so the choice reaches the element again.
 */
import type { ReactNode } from 'react'
import { closestWeight, uploadedFonts } from '@/components/admin/settings/appearance/fonts-section'
import { setTune, type TuneGroupName } from '@/components/admin/settings/appearance/tune-fields'
import { fontWeights } from '@/lib/shared/design/fonts'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { ScrubNumber } from './properties/scrub-number'
import { FontFaces, FontField } from './properties/token-field'
import { fontTokens } from './properties/tokens'
import { FONT_NAMES, SECTIONS, STYLE_CHOICES, WORDS } from './properties/words'

type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void
type DesignFont = PortalDesign['brand']['fonts']['body']
type Fonts = PortalDesign['brand']['fonts']

/** A brand choice as tiles: its value, how it is written, and the exact values that take its place. */
interface TileChoice {
  label: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  apply: (draft: PortalDesign, value: string) => void
  /** Exact values that, set, decide what this choice would. */
  masks?: ReadonlyArray<readonly [TuneGroupName, string]>
  /** Where else the choice reaches, on hover. */
  reach?: string
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
    value: layout.tint ?? 'neutral',
    options: tiles(STYLE_CHOICES.tint),
    apply: (draft, v) => void (draft.layout.tint = v as typeof layout.tint),
    reach: 'The current menu item and vote boxes',
  }
  const labelCase: TileChoice = {
    label: 'Capitals',
    value: fonts.labelCase ?? 'sentence',
    options: tiles(STYLE_CHOICES.capitals),
    apply: capitals(),
    masks: element === 'button' ? [['button', 'case']] : [],
    reach: 'Menu items and main buttons',
  }
  switch (element) {
    case 'button':
      return [
        {
          label: 'Shape',
          value: shape.buttons ?? 'match',
          options: tiles(STYLE_CHOICES.buttonShape),
          apply: (draft, v) => void (draft.shape.buttons = v as typeof shape.buttons),
          masks: [['button', 'radius']],
        },
        {
          label: 'Fill',
          value: shape.fill === 'ink' ? 'ink' : 'accent',
          options: tiles(STYLE_CHOICES.fill),
          apply: (draft, v) => void (draft.shape.fill = v as typeof shape.fill),
          masks: [
            ['button', 'fill'],
            ['button', 'ink'],
          ],
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
          value: layout.navText ?? 'muted',
          options: tiles(STYLE_CHOICES.menuText),
          apply: (draft, v) => void (draft.layout.navText = v as typeof layout.navText),
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
          apply: (draft, v) => void (draft.layout.cards = v as typeof layout.cards),
          masks: [
            ['card', 'border'],
            ['card', 'shadow'],
          ],
          reach: 'Post cards and panels',
        },
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
          value: layout.status ?? 'colour',
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
          value: fonts.scale ?? 'standard',
          options: tiles(STYLE_CHOICES.scale),
          apply: (draft, v) => void (draft.brand.fonts.scale = v as Fonts['scale']),
          masks: [['headline', 'size']],
        },
        {
          label: 'Spacing',
          value: fonts.tracking ?? 'normal',
          options: tiles(STYLE_CHOICES.spacing),
          apply: (draft, v) => void (draft.brand.fonts.tracking = v as Fonts['tracking']),
          masks: [['headline', 'tracking']],
        },
        {
          label: 'Capitals',
          value: fonts.headlineCase ?? 'sentence',
          options: tiles(STYLE_CHOICES.capitals),
          apply: (draft, v) => void (draft.brand.fonts.headlineCase = v as Fonts['headlineCase']),
        },
        {
          label: 'Colour',
          value: fonts.headlineColour ?? 'ink',
          options: tiles(STYLE_CHOICES.fill),
          apply: (draft, v) =>
            void (draft.brand.fonts.headlineColour = v as Fonts['headlineColour']),
          masks: [['headline', 'colour']],
        },
      ]
    case 'heading':
      return [
        {
          label: 'Weight',
          value: String(fonts.headingWeight),
          options: DESIGN_OPTIONS.headingWeight
            .filter((weight) => fontWeights(fonts.heading).includes(weight))
            .map((weight) => [String(weight), String(weight)] as const),
          apply: (draft, v) =>
            void (draft.brand.fonts.headingWeight = Number(v) as Fonts['headingWeight']),
          masks: [['heading', 'weight']],
          reach: 'Section headings, and headlines without their own weight',
        },
      ]
    default:
      return []
  }
}

const tuned = (design: PortalDesign, [group, key]: readonly [TuneGroupName, string]) =>
  (design.tune?.[group] as Record<string, unknown> | undefined)?.[key] !== undefined

/**
 * A brand font as an element's font row: a chip linked to the brand's slot.
 * There is no font for one element alone, so the row changes the brand's
 * own, and its hover says what that reaches.
 */
function BrandFontRow({
  slot,
  design,
  update,
}: {
  slot: 'heading' | 'headline'
  design: PortalDesign
  update: NamedUpdate
}) {
  const fonts = design.brand.fonts
  const own = slot === 'headline' ? fonts.display : fonts.heading
  const linked = slot === 'headline' && !fonts.display ? 'heading' : slot
  const reach =
    slot === 'headline'
      ? 'Every headline'
      : fonts.display
        ? 'Every section heading'
        : 'Every section heading and every headline'
  const change = (font: DesignFont | undefined) =>
    update((draft) => {
      if (slot === 'headline') {
        if (font) draft.brand.fonts.display = font
        else delete draft.brand.fonts.display
        return
      }
      if (!font) return
      draft.brand.fonts.heading = font
      draft.brand.fonts.headingWeight = closestWeight(font, draft.brand.fonts.headingWeight)
    }, `${FONT_NAMES[slot]}, ${WORDS.theme.toLowerCase()}`)
  return (
    <PropertyRow label="Font" htmlFor={`element-${slot}-font`} source={reach}>
      <FontField
        id={`element-${slot}-font`}
        label="Font"
        value={linked}
        slots={fontTokens(design)}
        editor={(close) => (
          <FontFaces
            label={FONT_NAMES[slot]}
            value={own}
            uploaded={uploadedFonts(fonts)}
            same={slot === 'headline' ? 'Same as the heading font' : undefined}
            onChange={(font) => {
              change(font)
              close()
            }}
          />
        )}
      />
    </PropertyRow>
  )
}

/** A post card title's exact size and weight: the tune is their only home. */
function CardTitleRows({ design, update }: { design: PortalDesign; update: NamedUpdate }) {
  const card = design.tune?.card
  const rows = [
    { key: 'titleSize', label: 'Title size', min: 12, max: 28, step: 1, unit: 'px' },
    { key: 'titleWeight', label: 'Title weight', min: 100, max: 900, step: 100, unit: undefined },
  ] as const
  return rows.map((row) => {
    const value = card?.[row.key]
    const id = `element-card-${row.key}`
    return (
      <PropertyRow
        key={row.key}
        label={row.label}
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
}: {
  element: StyleElement
  /** The element as an undo step names it. */
  name: string
  design: PortalDesign
  update: NamedUpdate
}) {
  const choices = choicesOf(design, element)
  const rows: ReactNode[] = []
  if (element === 'headline' || element === 'heading')
    rows.push(<BrandFontRow key="font" slot={element} design={design} update={update} />)
  for (const choice of choices) {
    const masked = (choice.masks ?? []).filter((m) => tuned(design, m))
    const id = `element-style-${element}-${choice.label.toLowerCase()}`
    rows.push(
      <PropertyRow
        key={choice.label}
        label={choice.label}
        source={masked.length ? WORDS.setExactly : choice.reach}
      >
        <PropertyTiles
          id={id}
          label={choice.label}
          value={masked.length || !choice.value ? undefined : choice.value}
          options={choice.options}
          onChange={(value) =>
            update((draft) => {
              choice.apply(draft, value)
              for (const [group, key] of masked) setTune(draft, group, key, undefined)
            }, `${name}: ${choice.label.toLowerCase()}, everywhere`)
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
