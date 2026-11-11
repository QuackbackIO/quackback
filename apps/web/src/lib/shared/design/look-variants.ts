/**
 * Three looks of one brand, for Compare looks after a brand match: Matched,
 * the design as the match wrote it; Soft, a pale tint of the brand colour in
 * an inset hero with more room, round corners and a lighter headline; and
 * Vivid, the brand colour filling the hero with a bigger, heavier headline,
 * filled vote buttons and small corners.
 *
 * Pure rules, no AI. A look changes only the treatment (TREATMENT_PATHS):
 * the hero's look and shape, corners, density, headline size and weight,
 * card shadow and the vote box. The brand's colours, fonts, logo, words,
 * pages, menu and what post cards show stay as they are, so a look taken
 * over a design edited since keeps those edits (applyLookVariant).
 */
import { apcaContrast, isLight } from './contrast'
import { lchOf, oklabDistance } from './color'
import { designRoles, ownColour, type ColourRole } from './colour-roles'
import { DESIGN_DEFAULTS, fontValue, layoutValue, shapeValue } from './defaults'
import { fontWeights } from './fonts'
import type { PortalDesign } from './schema'

export type LookVariantId = 'matched' | 'soft' | 'vivid'
export interface LookVariant {
  id: LookVariantId
  design: PortalDesign
}

export const LOOK_VARIANT_IDS: readonly LookVariantId[] = ['matched', 'soft', 'vivid']

/**
 * The design fields a look writes, and nothing else. A path whose value is
 * absent in the look is removed from the design the look is taken over.
 */
export const TREATMENT_PATHS = [
  'layout.hero',
  'layout.blend',
  'layout.heroShape',
  'layout.heroArt',
  'layout.heroColour',
  'layout.heroGlow',
  'layout.heroGlowColour',
  'layout.headerOnHero',
  'layout.heroHeight',
  'layout.density',
  'shape.corners',
  'shape.buttons',
  'brand.fonts.scale',
  'tune.headline.size',
  'tune.headline.weight',
  'tune.headline.tracking',
  'tune.button.radius',
  'tune.card.radius',
  'tune.card.shadow',
  'tune.field.radius',
  'style.vote',
  'style.headline.base.size',
  'style.headline.base.weight',
  'style.button.base.radius',
  'style.secondary.base.radius',
  'style.postCard.base.radius',
  'style.input.base.radius',
] as const

/** What absent reads as, for the paths that have a default, so a value set back to it still matches. */
const READS_AS: Partial<Record<(typeof TREATMENT_PATHS)[number], unknown>> = {
  'layout.blend': DESIGN_DEFAULTS.layout.blend,
  'layout.heroShape': DESIGN_DEFAULTS.layout.heroShape,
  'layout.heroArt': DESIGN_DEFAULTS.layout.heroArt,
  'layout.heroColour': DESIGN_DEFAULTS.layout.heroColour,
  'layout.heroGlow': DESIGN_DEFAULTS.layout.heroGlow,
  'layout.headerOnHero': DESIGN_DEFAULTS.layout.headerOnHero,
  'layout.heroHeight': DESIGN_DEFAULTS.layout.heroHeight,
  'shape.buttons': DESIGN_DEFAULTS.shape.buttons,
  'brand.fonts.scale': DESIGN_DEFAULTS.fonts.scale,
}

type Tree = Record<string, unknown>

/** The design's sections that may be left out, so one a look empties goes. */
const OPTIONAL_SECTIONS = new Set(['tune', 'style'])

function read(doc: unknown, path: string): unknown {
  let at: unknown = doc
  for (const key of path.split('.')) {
    if (!at || typeof at !== 'object') return undefined
    at = (at as Tree)[key]
  }
  return at
}

/** Writes a value at a path, or removes it and every object left empty above it. */
function write(doc: Tree, path: string, value: unknown): void {
  const keys = path.split('.')
  const chain: Tree[] = [doc]
  for (const key of keys.slice(0, -1)) {
    const parent = chain[chain.length - 1]!
    const next = parent[key]
    if (next && typeof next === 'object') chain.push(next as Tree)
    else if (value === undefined) return
    else {
      parent[key] = {}
      chain.push(parent[key] as Tree)
    }
  }
  const last = keys[keys.length - 1]!
  if (value !== undefined) {
    chain[chain.length - 1]![last] = structuredClone(value)
    return
  }
  delete chain[chain.length - 1]![last]
  // Objects emptied by the removal go too, the optional sections included, never a required one.
  for (let i = chain.length - 1; i >= 1; i--) {
    if (Object.keys(chain[i]!).length) break
    if (i === 1 && !OPTIONAL_SECTIONS.has(keys[0]!)) break
    delete chain[i - 1]![keys[i - 1]!]
  }
}

/** The treatment of a design, each path as it reads (a default filled in). */
export function treatmentOf(design: PortalDesign): Record<string, unknown> {
  return Object.fromEntries(
    TREATMENT_PATHS.map((path) => [path, read(design, path) ?? READS_AS[path]])
  )
}

/**
 * A look taken over a design: its treatment, the design's everything else.
 * Colours, fonts, logo, words, pages, menu and what post cards show stay the
 * design's own, so edits made since the look was offered are kept.
 */
export function applyLookVariant(design: PortalDesign, variant: LookVariant): PortalDesign {
  const next = structuredClone(design)
  for (const path of TREATMENT_PATHS) write(next as Tree, path, read(variant.design, path))
  return next
}

/** The three looks of a design, Matched first (the design itself, unchanged). */
export function lookVariants(design: PortalDesign): LookVariant[] {
  return [
    { id: 'matched', design: structuredClone(design) },
    { id: 'soft', design: soft(design) },
    { id: 'vivid', design: vivid(design) },
  ]
}

/** Which of the three a design currently is, or null when edited away from all of them. */
export function currentVariant(design: PortalDesign, base: PortalDesign): LookVariantId | null {
  const own = JSON.stringify(treatmentOf(design))
  return lookVariants(base).find((v) => JSON.stringify(treatmentOf(v.design)) === own)?.id ?? null
}

/* The rules */

/** A headline's size on a wide screen, in px, by type scale, where no exact size is set. */
const SCALE_PX = { standard: 30, large: 48, display: 76 } as const

/** Corners in px by the corner choice: buttons, fields and panels (components.ts RADII). */
const CORNER_PX = {
  sharp: [0, 0, 0],
  subtle: [4, 4, 6],
  rounded: [999, 8, 12],
  pill: [999, 12, 20],
} as const
const BUTTON_PX = { square: 0, rounded: 8, pill: 999 } as const

/** The headline's size, in px on a wide screen, as a design draws it. */
function headlineSize(doc: PortalDesign): number {
  const styled = read(doc, 'style.headline.base.size')
  if (typeof styled === 'number') return styled
  return doc.tune?.headline?.size ?? SCALE_PX[fontValue(doc.brand.fonts, 'scale')]
}

function headlineWeight(doc: PortalDesign): number {
  const styled = read(doc, 'style.headline.base.weight')
  if (typeof styled === 'number') return styled
  return doc.tune?.headline?.weight ?? doc.brand.fonts.headingWeight
}

/** The weight nearest `wanted` that the headline's face has, so no weight is faked. */
function headlineWeightNear(doc: PortalDesign, wanted: number): number {
  const { display, heading } = doc.brand.fonts
  const offered = fontWeights(display ?? heading).filter((w) => w >= 100 && w <= 900)
  if (!offered.length) return wanted
  return offered.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best))
}

/** Buttons, fields and cards' corners, in px, as a design draws them. */
function radii(doc: PortalDesign): { button: number; field: number; card: number } {
  const [control, field, panel] = CORNER_PX[doc.shape.corners]
  const buttons = shapeValue(doc.shape, 'buttons')
  return {
    button: doc.tune?.button?.radius ?? (buttons === 'match' ? control : BUTTON_PX[buttons]),
    field: doc.tune?.field?.radius ?? field,
    card: doc.tune?.card?.radius ?? panel,
  }
}

/** Sets the headline's size and weight, wherever the design sets them. */
function setHeadline(doc: PortalDesign, size: number, weight: number): void {
  const tune = (doc.tune ??= {})
  tune.headline = { ...tune.headline, size, weight }
  // An element look over the tune draws instead, so it moves with it.
  if (typeof read(doc, 'style.headline.base.size') === 'number')
    write(doc as Tree, 'style.headline.base.size', size)
  if (typeof read(doc, 'style.headline.base.weight') === 'number')
    write(doc as Tree, 'style.headline.base.weight', weight)
}

/** Sets the corners, wherever the design sets them. */
function setCorners(doc: PortalDesign, button: number, field: number, card: number): void {
  const tune = (doc.tune ??= {})
  tune.button = { ...tune.button, radius: button }
  tune.field = { ...tune.field, radius: field }
  tune.card = { ...tune.card, radius: Math.min(card, 48) }
  const styled: Array<[string, number]> = [
    ['style.button.base.radius', button],
    ['style.secondary.base.radius', button],
    ['style.postCard.base.radius', card],
    ['style.input.base.radius', field],
  ]
  for (const [path, value] of styled)
    if (typeof read(doc, path) === 'number') write(doc as Tree, path, value)
}

/** A role's colour in light mode. */
function roleColour(doc: PortalDesign, role: ColourRole): string {
  return role === 'accent' ? doc.brand.light.accent : (ownColour(doc, 'light', role) ?? '')
}

/** The colour role a design's hero is drawn in, where it is drawn in one. */
function heroRole(doc: PortalDesign): ColourRole {
  const hero = doc.layout.hero
  if (hero === 'support') return 'support'
  if (hero === 'brand' || hero === 'tint' || hero === 'fade') {
    const role = layoutValue(doc.layout, 'heroColour')
    return designRoles(doc).includes(role) ? role : 'accent'
  }
  return 'accent'
}

/** How clearly the better of black and white text reads on a colour, by APCA (0 to about 108). */
const bestInk = (fill: string) =>
  Math.max(Math.abs(apcaContrast('#ffffff', fill)), Math.abs(apcaContrast('#000000', fill)))

/** A colour this grey has no hue to tint with. */
const GREY = 0.03
/** The tightest a headline set heavier than the brand's is tracked, in em. */
const LOOSEST_HEAVY = -0.015
/** Text on a band reads clearly from here (APCA Lc), comfortably above the AA ratio. */
const CLEAR = 60

/** Writes the hero's look: its kind, shape and colour, with no art or glow. */
function setHero(
  doc: PortalDesign,
  hero: 'tint' | 'brand' | 'support',
  shape: 'full' | 'inset',
  role: ColourRole
): void {
  const layout = doc.layout as Tree
  layout.hero = hero
  delete layout.blend
  if (shape === 'full') delete layout.heroShape
  else layout.heroShape = shape
  if (role === 'accent' || hero === 'support') delete layout.heroColour
  else layout.heroColour = role
  delete layout.heroArt
  delete layout.heroGlow
  delete layout.heroGlowColour
}

/**
 * Soft: a pale tint of the hero's colour (else the brand colour) behind the
 * hero, as a rounded panel inset in the page; more room; round corners and
 * pill buttons; a lighter, slightly smaller headline; quiet vote boxes in the
 * raised grey; cards on a soft shadow. A grey brand colour tints with the
 * brand's first coloured role instead, so the tint still shows.
 */
function soft(base: PortalDesign): PortalDesign {
  const doc = structuredClone(base)
  let role = heroRole(base)
  if (lchOf(roleColour(base, role)).c < GREY) {
    const coloured = designRoles(base).find((r) => lchOf(roleColour(base, r)).c >= GREY * 2)
    if (coloured) role = coloured
  }
  setHero(doc, 'tint', 'inset', role)
  delete doc.layout.headerOnHero
  doc.layout.density = 'spacious'
  doc.shape.corners = 'pill'
  doc.shape.buttons = 'pill'
  const own = radii(base)
  setCorners(doc, 999, 16, Math.min(Math.max(own.card, 20), 24))
  const size = headlineSize(base)
  setHeadline(
    doc,
    Math.max(28, Math.round(size * 0.88)),
    headlineWeightNear(base, Math.max(300, headlineWeight(base) - 200))
  )
  if (base.layout.cards !== 'list')
    (doc.tune ??= {}).card = { ...doc.tune.card, shadow: 'floating' }
  const style = (doc.style ??= {})
  style.vote = {
    base: { background: 'raised', borderWidth: 0, radius: 12 },
    current: { background: 'accent', color: 'on-accent' },
  }
  return doc
}

/**
 * Vivid: the hero filled with the brand colour (or the hero's own colour, or
 * the second colour where the brand colour reads poorly under text and the
 * second reads clearly), full width; the header on it where its text is
 * light, as a flat fill (no glow or art); a bigger, heavier headline, a
 * little looser where the brand sets it tight; small corners; flat cards; vote boxes
 * filled with the brand colour. Where Matched already fills the hero, Vivid
 * goes further so the three stay apart: the header always on the hero, a
 * taller hero and a bigger headline still.
 */
function vivid(base: PortalDesign): PortalDesign {
  const doc = structuredClone(base)
  const filled = base.layout.hero === 'brand' || base.layout.hero === 'support'
  const already = filled && layoutValue(base.layout, 'heroShape') === 'full'
  let role = filled ? heroRole(base) : 'accent'
  if (!filled && bestInk(roleColour(base, role)) < CLEAR) {
    const clearer = designRoles(base).find(
      (r) => r !== role && bestInk(roleColour(base, r)) >= CLEAR + 15
    )
    if (clearer) role = clearer
  }
  // A flat fill: a glow or art lightens part of it, where large words would lose their contrast.
  setHero(doc, base.layout.hero === 'support' ? 'support' : 'brand', 'full', role)
  const fill = roleColour(base, role)
  const photo = !!base.brand.heroImage
  if (already || (!isLight(fill) && !photo)) doc.layout.headerOnHero = true
  else if (!photo) delete doc.layout.headerOnHero
  if (already) doc.layout.heroHeight = 'tall'
  if (base.layout.density === 'spacious') doc.layout.density = 'comfortable'
  const own = radii(base)
  const button = Math.min(own.button, 4)
  const field = Math.min(own.field, 4)
  const card = Math.min(own.card, 4)
  doc.shape.corners = button + field + card === 0 ? 'sharp' : 'subtle'
  delete doc.shape.buttons
  setCorners(doc, button, field, card)
  const size = headlineSize(base)
  const grow = already ? 1.3 : 1.18
  const weight = headlineWeightNear(base, Math.min(800, Math.max(headlineWeight(base) + 200, 700)))
  setHeadline(doc, Math.max(size, Math.min(Math.round(size * grow), 96)), weight)
  // Heavier letters set as tight touch; they get a little more room.
  const tracking = base.tune?.headline?.tracking
  if (tracking !== undefined && tracking < LOOSEST_HEAVY && weight > headlineWeight(base))
    doc.tune!.headline!.tracking = LOOSEST_HEAVY
  ;(doc.tune ??= {}).card = { ...doc.tune.card, shadow: 'none' }
  // The cast vote turns to the text colour; where that is the brand colour too, an edge marks it.
  const inkIsBrand = oklabDistance(base.brand.light.accent, base.brand.light.ink) < 0.12
  const style = (doc.style ??= {})
  style.vote = {
    base: { background: 'accent', color: 'on-accent', borderWidth: 0, radius: card },
    current: inkIsBrand
      ? { background: 'page', color: 'accent-text', borderColor: 'accent', borderWidth: 2 }
      : { background: 'ink', color: 'page' },
  }
  return doc
}
