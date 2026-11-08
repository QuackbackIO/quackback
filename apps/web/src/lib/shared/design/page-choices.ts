/**
 * The choices the Changelog, Help Center, Roadmap and post pages offer. Each is
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
  })
  .strict()

export const roadmapChoicesSchema = z
  .object({
    board: z.enum(DESIGN_OPTIONS.roadmapBoard).optional(),
    /** The vote box on the board's cards; absent shows it. */
    votes: z.boolean().optional(),
  })
  .strict()

const shown = z.boolean().optional()
export const postChoicesSchema = z
  .object({
    /** Where its one vote control sits; absent is beside the title. */
    vote: z.enum(DESIGN_OPTIONS.postVote).optional(),
    /** Which details show beside the post; each absent shows. The status always shows. */
    board: shown,
    tags: shown,
    date: shown,
    author: shown,
    /** Where Subscribe sits; absent is in the details. */
    subscribe: z.enum(DESIGN_OPTIONS.postSubscribe).optional(),
    /** The comments' order; absent is newest first. */
    comments: z.enum(DESIGN_OPTIONS.commentOrder).optional(),
  })
  .strict()

type Changelog = Required<z.output<typeof changelogChoicesSchema>>
type Help = Required<z.output<typeof helpChoicesSchema>>
type Roadmap = Required<z.output<typeof roadmapChoicesSchema>>
type Post = Required<z.output<typeof postChoicesSchema>>

/** Each page's choices as the portal draws them. */
export interface PageChoices {
  changelog: Changelog
  help: Help
  roadmap: Roadmap
  post: Post
}

/** Today's pages: what a design without choices draws. */
export const PAGE_CHOICE_DEFAULTS: PageChoices = {
  changelog: { entries: 'timeline', images: 'none', subscribe: 'beside' },
  help: { topics: 'cards', popular: true, search: 'standard' },
  roadmap: { board: 'columns', votes: true },
  post: {
    vote: 'title',
    board: true,
    tags: true,
    date: true,
    author: true,
    subscribe: 'details',
    comments: 'newest',
  },
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
  post: postChoicesSchema,
}

const attributeName = (page: ChoicePage, key: string) => `data-qb-${page}-${key}` as const

/** A design's page choices as attributes, one for each choice it makes. */
export function pageChoiceAttributes(doc: PortalDesign): Record<`data-qb-${string}`, string> {
  const out: Record<`data-qb-${string}`, string> = {}
  for (const page of Object.keys(PAGE_CHOICE_DEFAULTS) as ChoicePage[]) {
    const made = doc.pages[page] as Record<string, string | boolean | undefined> | undefined
    for (const [key, value] of Object.entries(made ?? {})) {
      if (value === undefined) continue
      out[attributeName(page, key)] = typeof value === 'boolean' ? (value ? 'on' : 'off') : value
    }
  }
  return out
}

/** The page choices in force, from the attributes; anything absent or unknown is today's. */
export function readPageChoices(
  attributes: Readonly<Record<string, string>> | undefined
): PageChoices {
  const read = <P extends ChoicePage>(page: P): PageChoices[P] => {
    const defaults = PAGE_CHOICE_DEFAULTS[page] as Record<string, string | boolean>
    const shape = SCHEMAS[page].shape as Record<string, z.ZodOptional<z.ZodType>>
    const out: Record<string, string | boolean> = {}
    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = attributes?.[attributeName(page, key)]
      const value =
        typeof fallback === 'boolean' ? (raw === 'on' ? true : raw === 'off' ? false : raw) : raw
      out[key] = shape[key]!.safeParse(value).success && value !== undefined ? value : fallback
    }
    return out as PageChoices[P]
  }
  return {
    changelog: read('changelog'),
    help: read('help'),
    roadmap: read('roadmap'),
    post: read('post'),
  }
}

/**
 * Where a post draws its one vote control: beside the title at every width,
 * or in the details, which wide screens alone show, so beside the title on
 * narrower ones. Where the control is beside the title, the details show the
 * count alone over the team's voters list, or nothing.
 */
export function postVotePlaces(
  vote: Post['vote'],
  voters: boolean
): { title: 'always' | 'narrow'; details: 'button' | 'count' | 'none' } {
  if (vote === 'details') return { title: 'narrow', details: 'button' }
  return { title: 'always', details: voters ? 'count' : 'none' }
}
