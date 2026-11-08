/**
 * The choices the Changelog, Help Center, Roadmap and Support pages offer. Each is
 * optional: a design without one draws the page as it always was. The portal
 * reads them as `data-qb-*` attributes, set only for a choice the design
 * makes, so the preview carries a draft's with the rest of its structure.
 */
import { z } from 'zod'
import { DESIGN_OPTIONS } from './options'
import type { PortalDesign } from './schema'

export const changelogChoicesSchema = z
  .object({
    entries: z.enum(DESIGN_OPTIONS.changelogEntries).optional(),
    images: z.enum(DESIGN_OPTIONS.entryImage).optional(),
    /** Where the Subscribe button sits beside the title. */
    subscribe: z.enum(DESIGN_OPTIONS.titleAction).optional(),
  })
  .strict()

export const helpChoicesSchema = z
  .object({
    topics: z.enum(DESIGN_OPTIONS.helpTopics).optional(),
    /** Popular articles under the topics; absent shows them. */
    popular: z.boolean().optional(),
    search: z.enum(DESIGN_OPTIONS.searchSize).optional(),
    /** "Was this helpful?" at the end of an article; absent shows it. */
    helpful: z.boolean().optional(),
    /** How many related articles an article ends with; absent is 4. */
    related: z.union([z.literal(0), z.literal(2), z.literal(4)]).optional(),
    /** A Contact support link at the end of an article; absent leaves it off. */
    contact: z.boolean().optional(),
  })
  .strict()

export const roadmapChoicesSchema = z
  .object({
    board: z.enum(DESIGN_OPTIONS.roadmapBoard).optional(),
    /** The vote box on the board's cards; absent shows it. */
    votes: z.boolean().optional(),
  })
  .strict()

export const supportChoicesSchema = z
  .object({
    /** Help articles suggested while a new request is written; absent suggests them. */
    suggest: z.boolean().optional(),
  })
  .strict()

type Changelog = Required<z.output<typeof changelogChoicesSchema>>
type Help = Required<z.output<typeof helpChoicesSchema>>
type Roadmap = Required<z.output<typeof roadmapChoicesSchema>>
type Support = Required<z.output<typeof supportChoicesSchema>>

/** Each page's choices as the portal draws them. */
export interface PageChoices {
  changelog: Changelog
  help: Help
  roadmap: Roadmap
  support: Support
}

/** Today's pages: what a design without choices draws. */
export const PAGE_CHOICE_DEFAULTS: PageChoices = {
  changelog: { entries: 'timeline', images: 'none', subscribe: 'beside' },
  help: {
    topics: 'cards',
    popular: true,
    search: 'standard',
    helpful: true,
    related: 4,
    contact: false,
  },
  roadmap: { board: 'columns', votes: true },
  support: { suggest: true },
}

type ChoicePage = keyof PageChoices

/** Every choice's field in the design document. */
export const PAGE_CHOICE_FIELDS = (Object.keys(PAGE_CHOICE_DEFAULTS) as ChoicePage[]).flatMap(
  (page) => Object.keys(PAGE_CHOICE_DEFAULTS[page]).map((key) => `pages.${page}.${key}`)
)

const SCHEMAS = {
  changelog: changelogChoicesSchema,
  help: helpChoicesSchema,
  roadmap: roadmapChoicesSchema,
  support: supportChoicesSchema,
}

const attributeName = (page: ChoicePage, key: string) => `data-qb-${page}-${key}` as const

/**
 * A design's page choices as attributes, one for each choice it makes. What
 * a page keeps beside its choices, such as its own words, is no attribute.
 */
export function pageChoiceAttributes(doc: PortalDesign): Record<`data-qb-${string}`, string> {
  const out: Record<`data-qb-${string}`, string> = {}
  for (const page of Object.keys(PAGE_CHOICE_DEFAULTS) as ChoicePage[]) {
    const made = doc.pages[page] as Record<string, unknown> | undefined
    for (const key of Object.keys(PAGE_CHOICE_DEFAULTS[page])) {
      const value = made?.[key]
      if (typeof value === 'boolean') out[attributeName(page, key)] = value ? 'on' : 'off'
      else if (typeof value === 'string' || typeof value === 'number')
        out[attributeName(page, key)] = String(value)
    }
  }
  return out
}

/** The page choices in force, from the attributes; anything absent or unknown is today's. */
export function readPageChoices(
  attributes: Readonly<Record<string, string>> | undefined
): PageChoices {
  const read = <P extends ChoicePage>(page: P): PageChoices[P] => {
    const defaults = PAGE_CHOICE_DEFAULTS[page] as Record<string, string | boolean | number>
    const shape = SCHEMAS[page].shape as Record<string, z.ZodOptional<z.ZodType>>
    const out: Record<string, string | boolean | number> = {}
    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = attributes?.[attributeName(page, key)]
      const value =
        typeof fallback === 'boolean'
          ? raw === 'on'
            ? true
            : raw === 'off'
              ? false
              : raw
          : typeof fallback === 'number' && raw !== undefined
            ? Number(raw)
            : raw
      out[key] = shape[key]!.safeParse(value).success && value !== undefined ? value : fallback
    }
    return out as PageChoices[P]
  }
  return {
    changelog: read('changelog'),
    help: read('help'),
    roadmap: read('roadmap'),
    support: read('support'),
  }
}
