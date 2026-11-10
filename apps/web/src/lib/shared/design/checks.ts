/**
 * Checks beyond colour, read from the design: text set too small, a hero
 * image without a description, link labels that do not say where they go,
 * Home blocks headed alike, buttons set too small, and a page background
 * softened so text reads on it. Each names the part that fixes it.
 */
import type { Selection } from './outline'
import { BACKGROUND_PAGE_NAMES, hasPageBackground } from './page-background'
import { resolveDesign } from './resolve'
import type { PortalDesign } from './schema'

export interface DesignCheck {
  id: string
  /** What is wrong, in a line. */
  text: string
  /** The part whose settings fix it. */
  part: Selection
}

/** The smallest text a design sets, in px. */
export const SMALLEST_TEXT = 12
/** The smallest a button may be, in px. */
export const SMALLEST_TARGET = 24

/** Labels that say nothing of where a link goes. */
const VAGUE = new Set([
  'click',
  'click here',
  'here',
  'link',
  'this link',
  'more',
  'read more',
  'learn more',
  'details',
  'this',
  'go',
])

const isVague = (label: string) =>
  VAGUE.has(
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  )

const SIZED: Array<['headline' | 'heading' | 'label', string, Selection]> = [
  // Sizes are looks, set in the styles.
  ['headline', 'The headline', 'site:styles'],
  ['heading', 'Section headings', 'site:styles'],
  ['label', 'Menu and button text', 'site:styles'],
]

/** Every check the design fails, in the order the page shows them. */
export function designChecks(design: PortalDesign): DesignCheck[] {
  const checks: DesignCheck[] = []
  for (const [field, name, part] of SIZED) {
    const size = design.tune?.[field]?.size
    if (size !== undefined && size < SMALLEST_TEXT)
      checks.push({
        id: `small-${field}`,
        text: `${name} is set at ${size}px. Use ${SMALLEST_TEXT}px or more.`,
        part,
      })
  }
  const image = design.brand.bandImage
  if (image && !image.decorative && !image.alt?.trim())
    checks.push({
      id: 'hero-image',
      text: 'The hero image has no description. Describe it, or mark it as decoration.',
      part: 'hero',
    })
  for (const item of design.nav.items)
    if (item.type === 'link' && isVague(item.label))
      checks.push({
        id: `menu-${item.id}`,
        text: `The menu link “${item.label}” does not say where it goes.`,
        part: 'header',
      })
  const seen = new Map<string, string>()
  design.pages.home.blocks.forEach((block, index) => {
    const key: Selection = `block-${block.id ?? index}`
    if (block.type === 'links')
      for (const link of block.links)
        if (isVague(link.label))
          checks.push({
            id: `link-${key}-${link.url}`,
            text: `The link “${link.label}” does not say where it goes.`,
            part: key,
          })
    const heading = block.heading?.en?.trim().toLowerCase()
    if (!heading) return
    if (seen.has(heading))
      checks.push({
        id: `heading-${key}`,
        text: `Two blocks are headed “${block.heading!.en!.trim()}”. Give each its own heading.`,
        part: key,
      })
    else seen.set(heading, key)
  })
  checks.push(...backgroundChecks(design))
  return checks
}

/**
 * A page background whose colour or image was held back so text reads on
 * it: said once per page, so the person knows why it is paler than chosen.
 */
function backgroundChecks(design: PortalDesign): DesignCheck[] {
  if (!hasPageBackground(design)) return []
  const { backgrounds } = resolveDesign(design)
  const softened = new Set<string>()
  for (const mode of [backgrounds.light, backgrounds.dark]) {
    if (!mode) continue
    // An image's layer says how much it shows where it is set; colours are said here.
    const held = (drawn: (typeof mode.pages)[keyof typeof mode.pages]) =>
      !!drawn?.softened && drawn.kind !== 'image'
    if (held(mode.site)) softened.add('site')
    for (const [page, drawn] of Object.entries(mode.pages)) if (held(drawn)) softened.add(page)
  }
  return [...softened].map((where) => ({
    id: `page-background-${where}`,
    text: `${
      where === 'site'
        ? 'The page background'
        : `The ${BACKGROUND_PAGE_NAMES[where as keyof typeof BACKGROUND_PAGE_NAMES]} page’s background`
    } is softened so text reads on it. Choose a lighter colour to show it as chosen.`,
    part: 'site:styles' as const,
  }))
}
