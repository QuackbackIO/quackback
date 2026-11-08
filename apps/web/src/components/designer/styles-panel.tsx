import { useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { CssFields, type CssWarning } from '@/components/admin/settings/appearance/css-section'
import { LogoControls, LogoHeight } from '@/components/admin/settings/appearance/logo-controls'
import { HoverControls } from '@/components/admin/settings/appearance/motion-controls'
import { partsInUse } from '@/lib/shared/design/curated'
import { ELEMENT_NAMES, type DesignElement } from '@/lib/shared/design/elements'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  STYLE_ELEMENTS,
  type StyleElement,
  type StyleState,
} from '@/lib/shared/design/style-tokens'
import { Advanced } from './advanced'
import { ElementPanel } from './element-panel'
import { PropertiesPanel } from './properties/properties-panel'
import { STYLE_CHOICES } from './properties/words'
import { Segmented } from './segmented'

type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

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

/** Elements drawn only where a module is on: post cards with Feedback or the roadmap. */
const GATED: Partial<Record<StyleElement, (gates: PortalPageGates) => boolean>> = {
  postCard: (gates) => gates.feedback || gates.roadmap,
}

/** What an element's brand choices are, in a word or two; null where it has none. */
export function elementValue(element: StyleElement, design: PortalDesign): string | null {
  const fonts = design.brand.fonts
  switch (element) {
    case 'button':
      return `${STYLE_CHOICES.fill[design.shape.fill === 'ink' ? 'ink' : 'accent']} · ${
        STYLE_CHOICES.buttonShape[design.shape.buttons ?? 'match']
      }`
    case 'postCard':
      return STYLE_CHOICES.cards[design.layout.cards]
    case 'vote':
      return design.brand.light.support ? STYLE_CHOICES.tint[design.layout.tint ?? 'neutral'] : null
    case 'badge':
    case 'chip':
      return STYLE_CHOICES.status[design.layout.status ?? 'colour']
    case 'navItem':
      return STYLE_CHOICES.menu[design.layout.nav]
    case 'headline':
      return `${STYLE_CHOICES.scale[fonts.scale ?? 'standard']} · ${
        STYLE_CHOICES.fill[fonts.headlineColour ?? 'ink']
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

/** What Styles lists: each element the pages that are on draw, the page's regions, then the logo. */
export function stylesElements(gates: PortalPageGates): Array<StyleElement | 'logo'> {
  const parts = partsInUse(gates)
  const drawn = new Set<StyleElement>(parts.flatMap((p) => PART_STYLES[p]))
  const listed = ORDER.filter(
    (element) => (drawn.has(element) || !PART_OF.has(element)) && (GATED[element]?.(gates) ?? true)
  )
  return [...listed, ...(parts.includes('logo') ? (['logo'] as const) : [])]
}

/**
 * Styles: how the portal uses the brand kit (its looks are Theme's own):
 * every element the portal draws, each with its brand choices in a word;
 * one opens the same element panel a pick on the canvas does, for every one
 * of its kind. The page's width sits below; motion, the logo's size and
 * custom CSS wait under Advanced.
 */
export function StylesPanel({
  design,
  update,
  gates,
  logoUrl = null,
  cssWarnings = [],
}: {
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
  logoUrl?: string | null
  cssWarnings?: readonly CssWarning[]
}) {
  // An element's panel opens in place, with a way back to the styles.
  const [open, setOpen] = useState<StyleElement | 'logo' | null>(null)
  const [state, setState] = useState<StyleState>('base')
  const back = () => {
    setOpen(null)
    setState('base')
  }
  if (open === 'logo')
    return (
      <PropertiesPanel
        crumbs={[{ label: 'Styles', onSelect: back }, { label: ELEMENT_NAMES.logo }]}
        title={ELEMENT_NAMES.logo}
        kind="Element"
      >
        <div className="space-y-4 px-4 py-3">
          <LogoControls design={design} update={update} logoUrl={logoUrl} />
        </div>
      </PropertiesPanel>
    )
  if (open)
    return (
      <ElementPanel
        key={open}
        pick={{ element: open, part: null, section: null, index: 0 }}
        page="home"
        blockName={null}
        design={design}
        update={update}
        state={state}
        onState={setState}
        screen="all"
        onUp={back}
        shared
        crumbs={[{ label: 'Styles', onSelect: back }, { label: STYLE_ELEMENTS[open].label }]}
      />
    )
  return (
    <div className="space-y-7">
      <section className="space-y-3" aria-labelledby="styles-elements">
        <h3 id="styles-elements" className="text-[13px] font-medium">
          Elements
        </h3>
        <ul className="space-y-0.5">
          {stylesElements(gates).map((element) => {
            const name = element === 'logo' ? ELEMENT_NAMES.logo : STYLE_ELEMENTS[element].label
            const value = element === 'logo' ? null : elementValue(element, design)
            const set = element === 'logo' ? 0 : setCount(design, element)
            return (
              <li key={element}>
                <button
                  type="button"
                  onClick={() => setOpen(element)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="shrink-0 font-medium">{name}</span>
                  <span className="ms-auto flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
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
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <Segmented
        label="Page width"
        value={design.layout.width}
        options={[
          ['narrow', 'Narrow'],
          ['default', 'Default'],
          ['wide', 'Wide'],
        ]}
        onChange={(width) => update((draft) => void (draft.layout.width = width))}
      />

      <Advanced part="site:styles" hint="Motion, logo size, CSS">
        {(shown) => (
          <>
            <HoverControls design={design} update={update} />
            {design.brand.logo.display !== 'name' && (
              <section className="space-y-3">
                <h3 className="text-[13px] font-medium">Logo size</h3>
                <LogoHeight design={design} update={update} />
              </section>
            )}
            <section className="space-y-3">
              <h3 className="text-[13px] font-medium">Custom CSS</h3>
              {shown && <CssFields design={design} update={update} warnings={cssWarnings} />}
            </section>
          </>
        )}
      </Advanced>
    </div>
  )
}
