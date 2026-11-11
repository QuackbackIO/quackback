import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { partsInUse } from '@/lib/shared/design/curated'
import type { DesignElement } from '@/lib/shared/design/elements'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { STYLE_ELEMENTS, type StyleElement } from '@/lib/shared/design/style-tokens'
import { PropertySection } from './properties/properties-panel'
import { STYLE_CHOICES, THEME } from './properties/words'
import { fontValue, layoutValue, shapeValue } from '@/lib/shared/design/defaults'

/** The element kinds each part used on every page is drawn as (style-tokens.ts). */
export const PART_STYLES: Record<DesignElement, readonly StyleElement[]> = {
  button: ['button'],
  card: ['postCard', 'panel'],
  vote: ['vote'],
  status: ['badge', 'chip'],
  menu: ['navItem'],
  field: ['input'],
  link: ['link'],
  secondary: ['secondary', 'ghost'],
  headline: ['headline'],
  subtitle: ['subtitle'],
  heading: ['heading'],
  body: ['body'],
  logo: [],
}

/**
 * The elements in the order Elements lists them: the ones most changed
 * first, then the rest of the parts', then the page's own regions.
 */
const ORDER: readonly StyleElement[] = [
  'button',
  'link',
  'navItem',
  'tab',
  'postCard',
  'panel',
  'vote',
  'chip',
  'headline',
  'heading',
  'input',
  'secondary',
  'ghost',
  'badge',
  'subtitle',
  'body',
  'block',
  'header',
  'footer',
  'divider',
  'image',
]

/** Every element some part is drawn as; the rest are the page's own regions, always listed. */
const PART_OF = new Set<StyleElement>(Object.values(PART_STYLES).flat())

/** Elements drawn only where a module is on: post cards, tabs and filters with Feedback or the roadmap. */
const GATED: Partial<Record<StyleElement, (gates: PortalPageGates) => boolean>> = {
  postCard: (gates) => gates.feedback || gates.roadmap,
  tab: (gates) => gates.feedback || gates.roadmap,
}

/** What an element's brand choices are, in a word or two; null where it has none. */
export function elementValue(element: StyleElement, design: PortalDesign): string | null {
  const fonts = design.brand.fonts
  switch (element) {
    case 'button':
      return `${STYLE_CHOICES.fill[design.shape.fill === 'ink' ? 'ink' : 'accent']} · ${
        STYLE_CHOICES.buttonShape[shapeValue(design.shape, 'buttons')]
      }`
    case 'postCard':
      return STYLE_CHOICES.cards[design.layout.cards]
    case 'vote':
      return design.brand.light.support
        ? STYLE_CHOICES.tint[layoutValue(design.layout, 'tint')]
        : null
    case 'badge':
    case 'chip':
      return STYLE_CHOICES.status[layoutValue(design.layout, 'status')]
    case 'navItem':
      return STYLE_CHOICES.menu[design.layout.nav]
    case 'headline':
      return `${STYLE_CHOICES.scale[fontValue(fonts, 'scale')]} · ${
        STYLE_CHOICES.fill[fontValue(fonts, 'headlineColour')]
      }`
    case 'heading':
      return String(fonts.headingWeight)
    case 'secondary': {
      const look = design.tune?.secondary?.style
      return look ? STYLE_CHOICES.secondary[look] : null
    }
    default:
      return null
  }
}

/** How many values every one of an element kind has set, across its states. */
const setCount = (design: PortalDesign, element: StyleElement) =>
  Object.values(design.style?.[element] ?? {}).reduce(
    (n, props) => n + Object.keys(props ?? {}).length,
    0
  )

/**
 * What Theme's Elements lists: each element the pages that are on draw, then
 * the page's regions. The logo is not one: it is picked on the page, in the header.
 */
export function stylesElements(gates: PortalPageGates): StyleElement[] {
  const parts = partsInUse(gates)
  const drawn = new Set<StyleElement>(parts.flatMap((p) => PART_STYLES[p]))
  return ORDER.filter(
    (element) => (drawn.has(element) || !PART_OF.has(element)) && (GATED[element]?.(gates) ?? true)
  )
}

/** An element's name, as its row and its panel's breadcrumb say it. */
export const elementName = (element: StyleElement) => STYLE_ELEMENTS[element].label

/**
 * Theme's Elements, always in view: every element the portal draws, each
 * with its brand choices in a word and how many values are set on it. One
 * opens the same element panel a pick on the canvas does, for every one of
 * its kind.
 */
export function ThemeElements({
  design,
  gates,
  onOpen,
}: {
  design: PortalDesign
  gates: PortalPageGates
  onOpen: (element: StyleElement) => void
}) {
  return (
    <PropertySection title={THEME.sections.elements}>
      <ul className="-mx-1.5">
        {stylesElements(gates).map((element) => {
          const value = elementValue(element, design)
          const set = setCount(design, element)
          return (
            <li key={element}>
              <button
                type="button"
                onClick={() => onOpen(element)}
                className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-ring"
              >
                <span className="shrink-0">{elementName(element)}</span>
                <span className="ms-auto flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
                  {set > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        data-set-dot=""
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                      />
                      {set} set
                    </>
                  )}
                  {set > 0 && value && <span aria-hidden="true">·</span>}
                  {value}
                </span>
                <ChevronRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </PropertySection>
  )
}
