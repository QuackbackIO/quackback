/**
 * What Quackback AI is told, read from the block registry, the hero, the
 * pages' choices, Theme and the menu, so it is told what the builder has
 * and never a hand-written copy of it. Two parts: the catalogue (each block
 * a page can hold: what it is for, its settings with what they do, the
 * values each takes and what each looks like, how many a page holds and
 * how big it is, with an example), and the context of one request (the page,
 * its blocks in reading order with their places in words and their
 * settings, the block picked in full, the hero, Theme and the menu as they
 * are, and the boards, roadmaps and help topics the workspace has by name).
 */
import { composerInHero } from './main-action'
import {
  blockOf,
  PAGE_BACKGROUND_EXAMPLES,
  PAGE_BACKGROUND_SETTINGS,
  summaryOf,
  SECTION_TYPES,
  type BlockDef,
  type SettingField,
} from './blocks'
import {
  blocksInOrder,
  pageSettings,
  placesOf,
  type AiPlaces,
  type FlatOp,
  type OpScope,
} from './design-ops'
import { heroOf, type HeroBlock } from './hero'
import type { HomeBlock, HomeBlockType } from './home'
import { landingOf, menuParts } from './menu'
import { PAGE_CHOICE_DEFAULTS } from './page-choices'
import {
  BACKGROUND_NAMES,
  BACKGROUND_PAGE_NAMES,
  siteBackground,
  type BackgroundFill,
  type PageBackground,
} from './page-background'
import { DESIGN_OPTIONS } from './options'
import { PAGE_NAMES, type DesignerPage } from './outline'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'
import { ACCENT_LOOKS, headlineMarkup, richMarkdown, type WordsDoc } from './rich-words'
import { headlineOf, headlineWordsOf, type WordedPage } from './headline-words'
import { THEME_FONTS, THEME_KEYS, type ThemeKey } from './theme-keys'
import { overridesNow, partsText } from './override-ops'
import { partOf } from './parts-registry'
import { backgroundPageOf } from './page-background'
import { STYLE_ELEMENTS } from './style-tokens'

const listed = (words: readonly string[], or = 'or') =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} ${or} ${words.at(-1)}` : (words[0] ?? '')

const opText = (ops: readonly FlatOp[]) => JSON.stringify(ops)

/** The settings of a block the AI may set: its AI keys, or every hero setting but the image. */
export function aiSettingsOf(def: BlockDef): SettingField[] {
  if (def.type === 'hero') return def.fields.filter((field) => field.kind !== 'image')
  return def.fields.filter((field) => def.ai.includes(field.key))
}

/** What a setting takes, in a line. */
function takes(field: SettingField, places: AiPlaces): string {
  switch (field.kind) {
    case 'text':
      return `words, up to ${field.max} characters; "" gives the usual one back`
    case 'choice':
      return Object.entries(field.looks)
        .map(([value, looks]) => `${value} (${looks})`)
        .join(', ')
    case 'count':
      return listed(field.options.map(String))
    case 'switch':
      return 'true or false'
    case 'source': {
      const names = placesOf(places, field.source).map((thing) => thing.name)
      const which = names.length ? listed(names) : 'none in this workspace'
      return field.multiple
        ? `a list of names, from ${which}; [] for ${field.any}`
        : `one name, from ${which}; null for ${field.any}`
    }
    case 'words':
      return `rich words as markdown: ${RICH_MARKS}`
    case 'links':
      return '[{"label","url"}], up to six'
    case 'image':
      return 'an uploaded image'
  }
}

/** The marks a headline or page title takes, each with its look. */
export const HEADLINE_MARKS = `one phrase of it set apart as ${listed(
  ACCENT_LOOKS.map((look) => `[words]{${look.markup}} (${look.looks})`)
)}, its colour one of the brand's roles after a colon, [words]{accent:support} (${DESIGN_OPTIONS.colourRole.join(', ')}; left out, the phrase keeps the colour it has); words without a mark set nothing apart`

/** What rich words take, as markdown. */
export const RICH_MARKS = `**bold**, *italic*, [words](https://…) or [words](mailto:…) for a link the person gave, [words]{support} for words in one of the brand's colour roles (${DESIGN_OPTIONS.colourRole.join(', ')}), a line starting "## " or "### " for a heading, {center} or {end} after a paragraph's or heading's words to align it, lines starting "- " or "1. " for a list, a blank line between paragraphs`

/** One setting, as the catalogue lists it. */
const settingLine = (field: SettingField, places: AiPlaces) =>
  `  ${field.key} ("${field.label}"): ${field.about}. Takes ${takes(field, places)}.`

/** A Home block type, as the catalogue lists it. */
export function describeBlock(type: HomeBlockType | 'hero', places: AiPlaces): string {
  const def = blockOf(type)!
  const size = def.grid
    ? ` Usually ${def.grid.w} of 12 columns wide, at least ${def.grid.minW}.`
    : ''
  const repeat = def.repeat === 'once' ? ' Home holds one.' : ' Home may hold several.'
  const head =
    type === 'hero'
      ? `hero ("${def.name}"): ${def.purpose}. One look for every page; set it with target "hero".`
      : `${type} ("${def.name}"): ${def.purpose}.${repeat}${size}`
  return [
    head,
    // Not its empty state or its words other than its heading: see `aiUntold`.
    ...aiSettingsOf(def)
      .filter((field) => !field.aiUntold)
      .map((field) => settingLine(field, places)),
    ...def.examples.map((example) => `  e.g. "${example.request}" -> ${opText(example.ops)}`),
  ].join('\n')
}

/** The pages' own settings, set with target the page's name. */
function pagesText(places: AiPlaces): string {
  const pages = ['changelog', 'help', 'roadmap'] as const
  const lines = pages.map((page) => {
    const fields = SECTION_TYPES.filter((type) => type.startsWith(`${page}.`)).flatMap((type) =>
      blockOf(type)!.fields.map((field) => settingLine(field, places))
    )
    const extra =
      page === 'changelog'
        ? ['  subscribe: Where the Subscribe button sits. Takes beside or under.']
        : []
    return [`${page} page (target "${page} page"):`, ...fields, ...extra].join('\n')
  })
  const examples = SECTION_TYPES.flatMap((type) => blockOf(type)!.examples).map(
    (example) => `  e.g. "${example.request}" -> ${opText(example.ops)}`
  )
  return [
    ...lines,
    'feedback page (target "feedback page"):\n  sort: The order the feed opens in. Takes trending, top or new.',
    ...examples,
  ].join('\n')
}

/** What a theme key takes, in a line. */
function themeTakes(key: ThemeKey): string {
  switch (key.values.kind) {
    case 'choice':
      return Object.entries(key.values.looks)
        .map(([value, looks]) => (value === looks ? value : `${value} (${looks})`))
        .join(', ')
    case 'colour':
      return 'a colour such as #0f766e'
    case 'font':
      return 'a font below'
    case 'text':
      return `words, up to ${key.values.max} characters`
    case 'list':
      return `a list of ${listed(key.values.of)}`
  }
}

/** Theme's settings, by name. */
export function themeText(): string {
  return [
    ...Object.entries(THEME_KEYS).map(
      ([name, key]) => `  ${name}: ${key.about}. Takes ${themeTakes(key)}.`
    ),
    `  Fonts: ${THEME_FONTS.join(', ')}.`,
  ].join('\n')
}

/** The page background's kinds and settings, with what each looks like, and examples. */
export function backgroundText(): string {
  const lines = PAGE_BACKGROUND_SETTINGS.map((setting) => {
    const takes = setting.looks
      ? Object.entries(setting.looks)
          .map(([value, looks]) => `${value} (${looks})`)
          .join(', ')
      : setting.takes
    const kinds = setting.key === 'kind' ? '' : ` For ${setting.kinds.join(', ')}.`
    return `  ${setting.key} ("${setting.label}"): ${setting.about}.${kinds} Takes ${takes}.`
  })
  return [
    ...lines,
    '  Text always stays readable: colours are softened and an image is veiled as much as text needs.',
    ...PAGE_BACKGROUND_EXAMPLES.map(
      (example) => `  e.g. "${example.request}" -> ${opText(example.ops)}`
    ),
  ].join('\n')
}

/** The catalogue: every block this workspace's Home can hold, the hero, the pages and Theme. */
export function aiCatalogue(input: {
  blockTypes: readonly HomeBlockType[]
  places: AiPlaces
}): string {
  return [
    'Blocks Home can hold:',
    ...input.blockTypes.map((type) => describeBlock(type, input.places)),
    '',
    'The hero, at the top of every page:',
    describeBlock('hero', input.places),
    '',
    'The pages’ own settings:',
    pagesText(input.places),
    '',
    'Theme, the settings for the whole portal (op theme):',
    themeText(),
    '',
    'The page background, behind every page or one page (op background):',
    backgroundText(),
  ].join('\n')
}

/* One request's context */

const widthWords = (w: number) =>
  w === 12
    ? 'full width'
    : w === 6
      ? 'half'
      : w === 4
        ? 'a third'
        : w === 8
          ? 'two thirds'
          : w === 3
            ? 'a quarter'
            : `${w} columns`

/** Where a block sits, in words: its row and its side, and its width. */
function placeText(block: HomeBlock, rows: readonly number[]): string {
  const { x, y, w } = block.grid
  const row = `row ${rows.indexOf(y) + 1}`
  if (w === 12) return `${row}, full width`
  const side = x === 0 ? 'left' : x + w === 12 ? 'right' : 'middle'
  return `${row}, ${side}, ${widthWords(w)} (${w} of 12 columns)`
}

/** Names for the ids a summary reads. */
const namesOf = (places: AiPlaces) => ({
  boards: Object.fromEntries(places.boards.map((thing) => [thing.id, thing.name])),
  roadmaps: Object.fromEntries(places.roadmaps.map((thing) => [thing.id, thing.name])),
})

/** A setting's value now, in a word. */
function valueNow(field: SettingField, value: unknown, places: AiPlaces): string {
  // A setting the block leaves out draws by its usual value.
  if (value === undefined && 'default' in field && field.default !== undefined)
    return String(field.default)
  if (field.kind === 'source') {
    const ids = Array.isArray(value) ? value : value ? [value] : []
    if (!ids.length) return field.any
    return listed(
      ids.map(
        (id) =>
          placesOf(places, field.source).find((thing) => thing.id === id)?.name ?? 'one not listed'
      ),
      'and'
    )
  }
  if (field.kind === 'text') {
    const words = value as Record<string, string> | undefined
    return words && Object.keys(words).length ? JSON.stringify(words) : '(its usual)'
  }
  if (field.kind === 'words') return JSON.stringify(richMarkdown(value as WordsDoc))
  if (field.kind === 'links') return JSON.stringify(value)
  return String(value)
}

/** A block's settings now, each by key. */
function settingsNow(def: BlockDef, block: HomeBlock | HeroBlock, places: AiPlaces): string {
  const values = block as Record<string, unknown>
  return (
    aiSettingsOf(def)
      // A setting the block leaves to its usual value is said only once it sets it.
      .filter(
        (field) =>
          values[field.key] !== undefined ||
          (!field.aiUntold && !('default' in field && field.default !== undefined))
      )
      .map((field) => `${field.key} ${valueNow(field, values[field.key], places)}`)
      .join('; ')
  )
}

const TITLED_PAGES = ['roadmap', 'changelog', 'help', 'support'] as const

/**
 * The portal's words as they are, in the language shown, each with its
 * marks and the marks it takes: headlines and page titles in their markup,
 * the plain words (subtitles, block headings, the composer's), and the rich
 * words (Welcome blocks and the feed's welcome message) as markdown.
 */
function wordsNow(design: PortalDesign, locale: string): string[] {
  const titleOf = (page: WordedPage) => {
    const words = headlineWordsOf(design, page, locale)
    return words.title ? JSON.stringify(headlineMarkup(words)) : null
  }
  const titles = [
    ...(['home', 'feedback'] as const).map((page) => `${page} ${titleOf(page) ?? '(its usual)'}`),
    ...TITLED_PAGES.flatMap((page) => {
      const title = titleOf(page)
      return title ? [`${page} ${title}`] : []
    }),
  ]
  const plain: string[] = []
  for (const page of ['home', 'feedback', ...TITLED_PAGES] as const) {
    const subtitle = headlineOf(design, page)?.subtitle[locale]
    if (subtitle) plain.push(`${page} subtitle ${JSON.stringify(subtitle)}`)
  }
  const copy = design.pages.feedback.copy as Record<string, Record<string, string> | undefined>
  for (const [key, word] of [
    ['prompt', 'prompt'],
    ['submit', 'submit'],
    ['emptyTitle', 'empty'],
  ] as const) {
    const words = copy?.[key]?.[locale]
    if (words) plain.push(`feedback ${word} ${JSON.stringify(words)}`)
  }
  const rich: string[] = []
  for (const block of blocksInOrder(design)) {
    const heading = block.heading?.[locale]
    if (heading) plain.push(`${block.id} heading ${JSON.stringify(heading)}`)
    if (block.type === 'welcome')
      rich.push(`${block.id} ${JSON.stringify(richMarkdown(block.body as WordsDoc))}`)
  }
  const welcome = design.pages.feedback.welcome
  rich.push(
    `feedback welcome (${welcome.show ? 'shown' : 'hidden'}) ${JSON.stringify(richMarkdown(welcome.body as WordsDoc))}`
  )
  return [
    `Headlines now, with their marks (a headline or page title takes ${HEADLINE_MARKS}): ${titles.join('; ')}.`,
    `Plain words now (no marks): ${plain.length ? plain.join('; ') : 'none of their own'}.`,
    `Rich words now (${RICH_MARKS}): ${rich.join('; ')}.`,
  ]
}

const read = (doc: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      doc
    )

/** Theme's settings now, as their names read. */
function themeNow(design: PortalDesign): string {
  return Object.entries(THEME_KEYS)
    .flatMap(([name, key]) => {
      const value = read(design, key.path)
      if (value === undefined || value === null) return []
      const shown =
        typeof value === 'object' && 'id' in (value as object)
          ? (value as { id: string }).id
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
      return [`${name} ${shown}`]
    })
    .join('; ')
}

/** A background's settings, in a few words. */
function fillWords(fill: BackgroundFill): string {
  const { kind, ...settings } = fill as BackgroundFill & Record<string, unknown>
  const shown = Object.entries(settings)
    .filter(([key]) => key !== 'dark')
    .map(([key, value]) =>
      key === 'image'
        ? 'an uploaded image'
        : `${key} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    )
  return `${BACKGROUND_NAMES[kind].toLowerCase()} (${kind})${shown.length ? `: ${shown.join(', ')}` : ''}`
}

/** The page backgrounds now: every page's, dark's own where it has one, and each page's own. */
export function backgroundNow(design: PortalDesign): string {
  const words = (bg: PageBackground) =>
    `${fillWords(bg)}${bg.dark ? `; in dark ${fillWords(bg.dark)}` : ''}`
  const pages = Object.entries(design.layout.pageBackgrounds ?? {}).map(
    ([page, bg]) =>
      `${BACKGROUND_PAGE_NAMES[page as keyof typeof BACKGROUND_PAGE_NAMES]} has its own: ${words(bg as PageBackground)}`
  )
  return [`every page ${words(siteBackground(design))}`, ...pages].join('; ')
}

/** Every leaf under an object, as path=value, such as style.button.hover.background="#1e1b4b". */
function leaves(value: unknown, at: string): string[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object') return [`${at}=${JSON.stringify(value)}`]
  if ('from' in (value as object)) return [`${at}=${JSON.stringify(value)}`]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, `${at}.${k}`)
  )
}

/** The element styles set now, for the AI to change rather than set over. */
function stylesNow(design: PortalDesign): string {
  const set = [...leaves(design.style, 'style'), ...leaves(design.styleDark, 'styleDark')]
  return set.length ? set.join(', ') : 'none'
}

/**
 * An element picked on the canvas, said so "this", "this one" and "just
 * this" reach it: a part by its id, else every one of its kind on the page.
 */
function pickedElement(
  design: PortalDesign,
  picked: OpScope | undefined,
  page: DesignerPage | undefined
): string | null {
  const pick = picked?.element
  if (!pick) return null
  const el = STYLE_ELEMENTS[pick.element]
  const part = pick.part ? partOf(design, pick.part) : null
  const shown = backgroundPageOf(page)
  if (part)
    return `The person picked one element on the page: ${part.label} in ${part.group} (part ${part.id}, a ${pick.element}). "This", "this one", "just this" and "it" mean it alone: op override, target part:${part.id}, unless they say this page or everywhere.`
  return `The person picked one of the ${el.label.toLowerCase()} (${pick.element}) ${shown ? `on the ${shown} page` : 'on the page'}, one of many alike. "This" and "these" mean them on this page: op override, target page:${shown ?? 'home'}, key ${pick.element}.<state>.<property>, unless they say everywhere.`
}

/** The context of one request: what exists, as it is now, in reading order. */
export function designContext(
  design: PortalDesign,
  input: {
    gates: PortalPageGates
    places: AiPlaces
    page?: DesignerPage
    picked?: OpScope
    /** The language shown, which words are read in; English when not given. */
    locale?: string
    /**
     * Whether to list the parts, for a request about one of a kind or with an element
     * picked; otherwise left out, so a request about every one of an element names none.
     */
    parts?: boolean
  }
): string {
  const { places } = input
  const names = namesOf(places)
  const blocks = blocksInOrder(design)
  const rows = [...new Set(blocks.map((block) => block.grid.y))].sort((a, b) => a - b)
  const landing = landingOf(design, input.gates)
  const home = design.nav.home.on
    ? `Home is on${landing === 'home' ? ', and visitors land on it' : ''}.`
    : `Home is off; visitors land on ${PAGE_NAMES[landing]}.`
  const blockLines = blocks.length
    ? blocks.map((block) => {
        const summary = summaryOf(block, names)
        const own = leaves(block.look?.style, 'style')
        // The composer in the hero takes no place on the grid, and the hero sizes it.
        const place =
          block.type === 'composer' && composerInHero(design.pages.home)
            ? "in the hero under the headline, its width the hero's composerWidth"
            : placeText(block, rows)
        return `- ${block.id} ${block.type} ("${blockOf(block.type)!.name}"), ${place}${summary ? `: ${summary}` : ''}${own.length ? `; its own look ${own.join(', ')}` : ''}`
      })
    : ['- (none)']
  const pickedBlock = input.picked?.blockId
    ? blocks.find((block) => block.id === input.picked!.blockId)
    : undefined
  const picked = pickedBlock
    ? `The person picked ${blockOf(pickedBlock.type)!.name} (${pickedBlock.id}); "this" and "it" mean it. Its settings now: ${settingsNow(blockOf(pickedBlock.type)!, pickedBlock, places)}.`
    : null
  const element = pickedElement(design, input.picked, input.page)
  const hero = heroOf(design)
  const choices = (['changelog', 'help', 'roadmap'] as const)
    .map((page) => {
      const made = { ...PAGE_CHOICE_DEFAULTS[page], ...design.pages[page] } as Record<
        string,
        unknown
      >
      return `${page} page: ${pageSettings(page)
        .map((key) => `${key} ${String(made[key])}`)
        .join(', ')}`
    })
    .concat(`feedback page: sort ${design.pages.feedback.defaultSort}`)
  const menu = menuParts(design, input.gates).map(
    (part) =>
      `${part.id} "${part.label}"${part.lands ? ' (visitors land here)' : ''}${part.shown ? '' : ' (hidden)'}`
  )
  const listOf = (things: AiPlaces[keyof AiPlaces]) =>
    things?.length ? things.map((thing) => thing.name).join(', ') : 'none'
  return [
    input.page ? `The page shown: ${PAGE_NAMES[input.page]}.` : null,
    home,
    'Home’s blocks, top to bottom and left to right:',
    ...blockLines,
    picked,
    element,
    `Hero now: ${settingsNow(blockOf('hero')!, hero, places)}.`,
    ...wordsNow(design, input.locale ?? 'en'),
    `Pages now: ${choices.join('; ')}.`,
    `Theme now: ${themeNow(design)}.`,
    `Page background now: ${backgroundNow(design)}.`,
    `Element styles now: ${stylesNow(design)}.`,
    `Overrides and phones' own values now: ${overridesNow(design)}.`,
    input.parts
      ? `Parts, each one of its kind, for an override's part:<id>: ${partsText(design)}.`
      : null,
    `Menu, in order: ${menu.join('; ')}.`,
    `The workspace’s boards: ${listOf(places.boards)}. Roadmaps: ${listOf(places.roadmaps)}. Help topics: ${listOf(places.categories)}.${places.columns?.length ? ` Roadmap columns: ${listOf(places.columns)}.` : ''}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
