/**
 * Read-time migrations of a stored design. Designs are JSON in the database
 * and are never rewritten there: every read runs the document through these
 * steps first, in order, so one stored before a change still reads.
 *
 * Each step is pure and idempotent: it never changes the document it is
 * given, hands back that same document when it has nothing to do, and run on
 * its own output it changes nothing more.
 *
 * A step reads one version. A step without `to` tidies a document within its
 * version (a key retired, a look split in two) and runs on that version and
 * any older one. A step with `to` changes the format: it runs only on a
 * document at exactly `version`, and the document comes out at `to`, so the
 * steps before it never see what it made. A future format change is one more
 * step at the end of the list, `{ version: 3, to: 4 }`, with DESIGN_VERSION
 * and the schema's literal moved on with it.
 *
 * Format 3 renamed format 2's hero keys, which still called the hero a
 * "band" (HERO_KEYS below). What visitors' pages and workspace CSS can name,
 * the `--qb-band-*` properties and `data-qb-*band*` attributes, kept the word.
 */
import { withHoverLift } from './hover-lift'
import { withSplitCards } from './split-cards'

type Json = Record<string, unknown>

/** The version the schema reads, and the one every migration ends at. */
export const DESIGN_VERSION = 3

export interface DesignMigration {
  /** What the step does, for tests and for reading the list. */
  name: string
  /** The stored version the step reads. */
  version: number
  /** The version a format change leaves the document at; absent for a tidy within `version`. */
  to?: number
  /** The step itself: pure, and the same document when it has nothing to do. */
  up: (doc: Json) => Json
}

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Whether a step runs on a document stored at this version. */
export function stepApplies(step: DesignMigration, version: unknown): boolean {
  if (step.to !== undefined) return version === step.version
  // A document without a version is older than every step; it still fails the schema after.
  return typeof version !== 'number' || version <= step.version
}

/** Which style properties a tidy takes out, by state and property. */
type Drops = (state: string, prop: string) => boolean

/** A focus ring's colour, gone since focus rings stay neutral grey; its width stays. */
const ringColour: Drops = (_state, prop) => prop === 'ring'

/** An edge colour or a shadow on focus, gone since focus stays neutral: no brand colour, no glow. */
const focusPaint: Drops = (state, prop) =>
  state === 'focus' && (prop === 'borderColor' || prop === 'shadow')

/** Whether a style sheet ({ element: { state: props } }) names a property to drop. */
const sheetHas = (sheet: unknown, drops: Drops): boolean =>
  isRecord(sheet) &&
  Object.values(sheet).some(
    (states) =>
      isRecord(states) &&
      Object.entries(states).some(
        ([state, props]) => isRecord(props) && Object.keys(props).some((p) => drops(state, p))
      )
  )

/** A style sheet without the dropped properties, dropping a state or element left empty; the one given stays. */
function sheetWithout(sheet: Json, drops: Drops): Json | undefined {
  const out: Json = {}
  for (const [element, states] of Object.entries(sheet)) {
    if (!isRecord(states)) {
      out[element] = states
      continue
    }
    const kept: Json = {}
    for (const [state, props] of Object.entries(states)) {
      if (!isRecord(props) || !Object.keys(props).some((p) => drops(state, p))) {
        kept[state] = props
        continue
      }
      const rest = Object.fromEntries(Object.entries(props).filter(([p]) => !drops(state, p)))
      if (Object.keys(rest).length) kept[state] = rest
    }
    if (Object.keys(kept).length) out[element] = kept
  }
  return Object.keys(out).length ? out : undefined
}

/** Replaces each of a record's sheets that names a dropped property, deleting one left empty. */
function stripSheets(holder: Json, keys: readonly string[], drops: Drops): void {
  for (const key of keys) {
    const sheet = holder[key]
    if (!sheetHas(sheet, drops)) continue
    const next = sheetWithout(sheet as Json, drops)
    if (next) holder[key] = next
    else delete holder[key]
  }
}

/** An override's looks, each one element's states. */
const OVERRIDE_LAYERS = ['style', 'styleDark', 'phone'] as const
/** A design's own sheets, and a Home block look's. */
const SITE_SHEETS = ['style', 'styleDark', 'stylePhone'] as const
const BLOCK_SHEETS = ['style', 'phone'] as const

/**
 * A design without the dropped style properties, in its site, block and
 * override looks. A copy where one is found; the document given otherwise.
 */
function withoutStyleProps(doc: Json, drops: Drops): Json {
  const has =
    SITE_SHEETS.some((key) => sheetHas(doc[key], drops)) ||
    (Array.isArray(doc.overrides) &&
      doc.overrides.some(
        (o) => isRecord(o) && OVERRIDE_LAYERS.some((layer) => sheetHas({ one: o[layer] }, drops))
      )) ||
    (isRecord(doc.pages) &&
      isRecord(doc.pages.home) &&
      Array.isArray(doc.pages.home.blocks) &&
      doc.pages.home.blocks.some(
        (b) =>
          isRecord(b) &&
          isRecord(b.look) &&
          BLOCK_SHEETS.some((key) => sheetHas((b.look as Json)[key], drops))
      ))
  if (!has) return doc
  const out = structuredClone(doc)
  stripSheets(out, SITE_SHEETS, drops)
  if (Array.isArray(out.overrides)) {
    for (const o of out.overrides) {
      if (!isRecord(o)) continue
      for (const layer of OVERRIDE_LAYERS) {
        // An override's look is one element's states: as a sheet of one.
        if (!sheetHas({ one: o[layer] }, drops)) continue
        const states = sheetWithout({ one: o[layer] }, drops)?.one
        if (states) o[layer] = states
        else delete o[layer]
      }
    }
    // An override left with no look at all goes with it.
    out.overrides = out.overrides.filter(
      (o) => !isRecord(o) || OVERRIDE_LAYERS.some((layer) => o[layer] !== undefined)
    )
    if (!(out.overrides as unknown[]).length) delete out.overrides
  }
  const blocks = isRecord(out.pages) && isRecord(out.pages.home) ? out.pages.home.blocks : null
  if (Array.isArray(blocks))
    for (const b of blocks) {
      if (!isRecord(b) || !isRecord(b.look)) continue
      stripSheets(b.look, BLOCK_SHEETS, drops)
      if (!Object.keys(b.look).length) delete b.look
    }
  return out
}

const withoutRingColours = (doc: Json) => withoutStyleProps(doc, ringColour)
const withNeutralFocus = (doc: Json) => withoutStyleProps(doc, focusPaint)

/** Keys a design once had: the words for posts and boards, now fixed, and footer links. */
const RETIRED_KEYS = ['vocabulary', 'footer']

function withoutRetiredTopKeys(doc: Json): Json {
  if (!RETIRED_KEYS.some((key) => Object.hasOwn(doc, key))) return doc
  const out = { ...doc }
  for (const key of RETIRED_KEYS) delete out[key]
  return out
}

/** The logo's name styles, gone since the logo became an icon and a title. */
const RETIRED_LOGO_KEYS = ['nameColour', 'nameCase', 'nameAccent']

function withoutLogoNameStyles(doc: Json): Json {
  const brand = doc.brand
  const logo = isRecord(brand) ? brand.logo : undefined
  if (!isRecord(logo) || !RETIRED_LOGO_KEYS.some((key) => Object.hasOwn(logo, key))) return doc
  const kept = { ...logo }
  for (const key of RETIRED_LOGO_KEYS) delete kept[key]
  return { ...doc, brand: { ...(brand as Json), logo: kept } }
}

/**
 * Format 2's hero keys and their names in format 3, by the object that holds
 * them: the one place the two names meet. Old documents, merge patches and
 * paths written with the old names are read through it.
 */
export const HERO_KEYS = {
  layout: {
    band: 'hero',
    bandAlign: 'heroAlign',
    bandShape: 'heroShape',
    bandHeight: 'heroHeight',
    bandColour: 'heroColour',
    bandGlow: 'heroGlow',
    bandGlowColour: 'heroGlowColour',
    bandArt: 'heroArt',
    headerOnBand: 'headerOnHero',
  },
  brand: { bandImage: 'heroImage' },
} as const satisfies Record<string, Record<string, string>>

type Holder = keyof typeof HERO_KEYS

/**
 * An object with its old hero keys under their new names, in their places,
 * or the same object when it has none. A new name already there wins over
 * the old one, which goes.
 */
function renamedKeys(holder: Json, names: Readonly<Record<string, string>>): Json {
  if (!Object.keys(names).some((old) => Object.hasOwn(holder, old))) return holder
  const out: Json = {}
  for (const [key, value] of Object.entries(holder)) {
    const renamed = Object.hasOwn(names, key) ? names[key]! : undefined
    if (renamed === undefined) out[key] = value
    else if (!Object.hasOwn(holder, renamed)) out[renamed] = value
  }
  return out
}

/**
 * A design, or a merge patch onto one, with format 2's hero keys under
 * format 3's names: the same document when it has none.
 */
export function withHeroKeys(doc: Json): Json {
  let out = doc
  for (const holder of Object.keys(HERO_KEYS) as Holder[]) {
    const held = doc[holder]
    if (!isRecord(held)) continue
    const renamed = renamedKeys(held, HERO_KEYS[holder])
    if (renamed !== held) out = { ...out, [holder]: renamed }
  }
  return out
}

/** A dotted path into a design with an old hero key under its new name; any other path as it is. */
export function withHeroPath(path: string): string {
  const [holder, key, ...rest] = path.split('.')
  const names: Readonly<Record<string, string>> | undefined =
    holder && Object.hasOwn(HERO_KEYS, holder) ? HERO_KEYS[holder as Holder] : undefined
  if (!names || !key || !Object.hasOwn(names, key)) return path
  return [holder, names[key], ...rest].join('.')
}

/** A dotted path with a new hero key under its format 2 name; any other path as it is. */
export function heroPathAsBefore(path: string): string {
  const [holder, key, ...rest] = path.split('.')
  if (!holder || !key || !Object.hasOwn(HERO_KEYS, holder)) return path
  const old = Object.entries(HERO_KEYS[holder as Holder]).find(([, now]) => now === key)?.[0]
  return old ? [holder, old, ...rest].join('.') : path
}

/** Every step, in the order they run. */
export const DESIGN_MIGRATIONS: readonly DesignMigration[] = [
  // One "card" look split into post cards and panels (split-cards.ts).
  { name: 'split-cards', version: 2, up: withSplitCards },
  // Lift, once its own motion, written as post cards' and buttons' Hover values (hover-lift.ts).
  { name: 'hover-lift', version: 2, up: withHoverLift },
  { name: 'drop-ring-colours', version: 2, up: withoutRingColours },
  { name: 'drop-retired-keys', version: 2, up: withoutRetiredTopKeys },
  { name: 'drop-logo-name-styles', version: 2, up: withoutLogoNameStyles },
  // Format 3: the hero's keys named for the hero, no longer the band (HERO_KEYS).
  { name: 'hero-keys', version: 2, to: 3, up: withHeroKeys },
  // Focus stays neutral: an edge colour or a shadow (glow is the brand's) set on focus is dropped.
  { name: 'neutral-focus', version: 3, up: withNeutralFocus },
]

/**
 * A stored, sent or written design document as this build reads it: every
 * step that applies, run once each in order. What is not a document comes
 * back as it is, and so does a document no step changes.
 */
export function migrateDesign(
  given: unknown,
  steps: readonly DesignMigration[] = DESIGN_MIGRATIONS
): unknown {
  if (!isRecord(given)) return given
  let doc = given
  for (const step of steps) {
    if (!stepApplies(step, doc.version)) continue
    const next = step.up(doc)
    doc = step.to !== undefined ? { ...next, version: step.to } : next
  }
  return doc
}
