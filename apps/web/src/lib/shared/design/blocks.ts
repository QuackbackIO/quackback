/**
 * The block registry: each block a visitor would recognise declares, once,
 * what the builder needs of it. Its name and one-line purpose, its job in the
 * Add sheet, its settings in order, a one-line summary of them, how many a
 * page holds, which pages it goes on, and which settings the AI may change.
 * The right panel, the Add sheet, the list of blocks and the AI read it.
 *
 * Settings map to fields the design document has, and every change is checked
 * against the schema. Looks (card, tint, alignment) are not settings here:
 * they belong to Theme. The hero, at the top of each page, is the one block
 * whose look is its own: it is never added or removed, and its settings
 * reach every page.
 */
import type { z } from 'zod'
import type { FlatOp } from './design-ops'
import type { HomeBlock, HomeBlockType } from './home'
import { CUSTOM_LOOK, HERO_AI_PATHS, heroSchema, type HeroBlock } from './hero'
import { BAND_LOOKS } from './curated'
import { BLOCK_SIZES } from './options'
import type { BackgroundKind } from './page-background'
import type { DesignerPage } from './outline'
import {
  PAGE_CHOICE_DEFAULTS,
  changelogChoicesSchema,
  helpChoicesSchema,
  roadmapChoicesSchema,
  type PageChoices,
} from './page-choices'
import { homeBlockSchema, type PortalDesign } from './schema'

/** What a block is for, as the Add sheet groups them, in its order. */
export const BLOCK_JOBS = {
  answers: 'Help people find answers',
  hear: 'Hear from customers',
  progress: 'Show progress',
  own: 'Your own',
} as const
export type BlockJob = keyof typeof BLOCK_JOBS

/** The sections of the portal's own pages a visitor would know as blocks of their own. */
export const SECTION_TYPES = [
  'changelog.entries',
  'help.topics',
  'help.popular',
  'help.search',
  'roadmap.board',
] as const
export type SectionType = (typeof SECTION_TYPES)[number]
export type BlockType = HomeBlockType | SectionType | 'hero'

type ChoicePage = keyof PageChoices
const SECTION_KEYS = {
  'changelog.entries': ['entries', 'images'],
  'help.topics': ['topics'],
  'help.popular': ['popular'],
  'help.search': ['search'],
  'roadmap.board': ['board', 'votes'],
} as const satisfies Record<SectionType, readonly string[]>

/** A page section as a block: its type and its choices, today's where the design makes none. */
export type SectionBlock =
  | ({ type: 'changelog.entries' } & Pick<PageChoices['changelog'], 'entries' | 'images'>)
  | ({ type: 'help.topics' } & Pick<PageChoices['help'], 'topics'>)
  | ({ type: 'help.popular' } & Pick<PageChoices['help'], 'popular'>)
  | ({ type: 'help.search' } & Pick<PageChoices['help'], 'search'>)
  | ({ type: 'roadmap.board' } & Pick<PageChoices['roadmap'], 'board' | 'votes'>)
export type AnyBlock = HomeBlock | SectionBlock | HeroBlock

type Option<T> = readonly [value: T, name: string]

/** What every setting says of itself, for the panel's tooltips and for Quackback AI. */
interface Described {
  /** What the setting does, in a plain sentence. */
  about: string
  /**
   * Shown in the panel only while another setting is one value: `key`'s
   * value, or `otherwise` while the block leaves it out, is `is`.
   */
  when?: { key: string; is: string; otherwise: string }
  /** Words edited where they sit on the page, never in the panel; Quackback AI may still set them. */
  inPlace?: boolean
  /** A group of switches' shared name, shown over the first of them. */
  group?: string
  /**
   * A setting Quackback AI is not told of in its catalogue, nor shown until
   * the block sets it: a block's empty state and its words other than its
   * heading. Listed, they led the AI to write colour marks into headings.
   */
  aiUntold?: boolean
}

/** One setting, as its panel draws it. `key` is the block's own field in the design. */
export type SettingField = Described &
  /** Words in the visitor's language; empty is the block's usual words. */
  (
    | {
        kind: 'text'
        key: string
        label: string
        max: number
        /** What an empty field reads as, in English; the block's name when absent. */
        placeholder?: string
      }
    /**
     * A few named choices side by side; `looks` says what each value looks
     * like on the page, by value.
     */
    | {
        kind: 'choice'
        key: string
        label: string
        options: ReadonlyArray<Option<string>>
        looks: Readonly<Record<string, string>>
        /** The value a block that leaves it out draws by. */
        default?: string
      }
    /** How many, side by side. */
    | {
        kind: 'count'
        key: string
        label: string
        options: readonly number[]
        /** The value a block that leaves it out draws by. */
        default?: number
        /** A count's own name in its tile, such as None for 0. */
        names?: Readonly<Record<number, string>>
      }
    | {
        kind: 'switch'
        key: string
        label: string
        /** Whether a block that leaves it out shows it. */
        default?: boolean
      }
    /**
     * Something the workspace has, picked from a list: one roadmap, or up to
     * `max` help topics. `any` names leaving it to the portal (null, or none picked).
     */
    | {
        kind: 'source'
        key: string
        label: string
        source: 'roadmaps' | 'categories' | 'boards' | 'columns'
        multiple: boolean
        any: string
        max?: number
      }
    /** Its own words, written in the builder's rich text editor. */
    | { kind: 'words'; key: string; label: string }
    /** A list of named web addresses. */
    | { kind: 'links'; key: string; label: string }
    /** An uploaded image, with what it shows for those who cannot see it. */
    | { kind: 'image'; key: string; label: string }
  )

/** A request a person might make of a block, and the operations that make it. */
export interface BlockExample {
  request: string
  ops: readonly FlatOp[]
}

export interface BlockDef {
  type: BlockType
  name: string
  /** One line: what it is for. */
  purpose: string
  /** Its group in the Add sheet; null for a block that is never added. */
  job: BlockJob | null
  /** A note under its purpose, such as where its settings reach. */
  note?: string
  /** Its settings, in the order its panel shows them. */
  fields: readonly SettingField[]
  /** Whether a page holds one of it, or several. */
  repeat: 'once' | 'many'
  /** The pages it can go on. */
  pages: readonly DesignerPage[]
  /**
   * The settings Quackback AI may change: the block's own keys, or for the
   * hero, the design fields its settings store. A Home block's place and
   * size are not settings: the AI moves and resizes blocks by operations.
   * Boards, roadmaps and help topics are chosen by name and resolved to ids.
   */
  ai: readonly string[]
  /** Requests a person might make of it, each with the operations that make it. */
  examples: readonly BlockExample[]
  /** Whether it is added from the Add sheet; a page's own sections are always there. */
  addable: boolean
  /**
   * A Home block's size on the twelve-column grid, in columns and rows: the
   * size a new one takes and the least it can be made. Absent for a page's sections.
   */
  grid?: { w: number; h: number; minW: number; minH: number }
}

/** The names a summary can use for what a block points at, by id. */
export interface SummaryNames {
  roadmaps?: Readonly<Record<string, string>>
  boards?: Readonly<Record<string, string>>
}

const heading: SettingField = {
  kind: 'text',
  key: 'heading',
  label: 'Heading',
  max: 60,
  about: 'The title over the block, in place of its usual one; empty gives the usual one back',
}
const SORTS: ReadonlyArray<Option<string>> = [
  ['trending', 'Trending'],
  ['top', 'Most votes'],
  ['new', 'Newest'],
]
/** What each curated hero look looks like. */
const BAND_LOOK_LOOKS: Record<string, string> = {
  plain: 'no colour behind the headline, the calmest',
  tint: 'a pale wash of the brand colour, calm',
  fade: 'the brand colour fading into the page, calm',
  brand: 'a solid block of the brand colour, bold',
  'brand-waves': 'the brand colour with soft waves, bold and playful',
  inset: 'a rounded panel of the brand colour within the page',
  second: 'the second brand colour',
  blend: 'the brand and second colours run together, the boldest',
}

const SORT_LOOKS = {
  trending: 'posts gaining votes lately first',
  top: 'the posts with the most votes of all time first',
  new: 'the most recent posts first',
}

/** A block's way on, in its own words, edited where it sits. */
const linkField: SettingField = {
  kind: 'text',
  key: 'link',
  label: 'Link',
  max: 40,
  inPlace: true,
  aiUntold: true,
  about: 'The words of its link on, such as "See all posts", in place of its usual ones',
}

/** What a block of the workspace's data does with nothing to show, and its message then. */
function emptyFields(usually: 'hide' | 'message', message: string): SettingField[] {
  return [
    {
      kind: 'choice',
      key: 'whenEmpty',
      label: 'When there’s nothing',
      options: [
        ['hide', 'Hide the block'],
        ['message', 'Show a message'],
      ],
      looks: {
        hide: 'the block is left out until there is something to show',
        message: 'the block stays and says its message',
      },
      default: usually,
      aiUntold: true,
      about: `What it does with nothing to show; usually ${usually === 'hide' ? 'hide' : 'message'}`,
    },
    {
      kind: 'text',
      key: 'emptyText',
      label: 'Message',
      max: 80,
      placeholder: message,
      when: { key: 'whenEmpty', is: 'message', otherwise: usually },
      aiUntold: true,
      about: `What it says with nothing to show, in place of "${message}"`,
    },
  ]
}

type HomeDef = Omit<BlockDef, 'type' | 'pages' | 'addable' | 'fields'> & {
  /** Its settings after its heading. */
  own: readonly SettingField[]
}

const HOME: Record<HomeBlockType, HomeDef> = {
  welcome: {
    name: 'Welcome',
    purpose: 'A few words of your own',
    job: 'own',
    own: [
      {
        kind: 'words',
        key: 'body',
        label: 'Words',
        about:
          'The block’s own words, rich: bold, italics, links and lists. Write all of them, keeping the words it has unless asked to change them',
      },
    ],
    repeat: 'many',
    ai: ['heading', 'body'],
    examples: [
      {
        request: 'Change the welcome to: Hi! Tell us how we can help',
        ops: [{ op: 'set', target: 'welcome', key: 'body', value: 'Hi! Tell us how we can help' }],
      },
      {
        request:
          'With the welcome saying "Hi! Tell us how we can help.", bold the second sentence and link our docs at https://docs.example.com',
        ops: [
          {
            op: 'set',
            target: 'welcome',
            key: 'body',
            value: 'Hi! **Tell us how we can help.** Read [our docs](https://docs.example.com).',
          },
        ],
      },
    ],
  },
  composer: {
    name: 'Write a post',
    purpose: 'A box visitors post from',
    job: 'hear',
    own: [],
    repeat: 'once',
    ai: ['heading'],
    examples: [
      {
        request: 'Put the post box at the top',
        ops: [{ op: 'move', target: 'composer', value: 'top' }],
      },
    ],
  },
  ideas: {
    name: 'Top posts',
    purpose: 'The posts visitors vote for most',
    job: 'hear',
    own: [
      {
        kind: 'choice',
        key: 'sort',
        label: 'Show',
        options: SORTS,
        looks: SORT_LOOKS,
        about: 'Which posts come first',
      },
      {
        kind: 'source',
        key: 'boardIds',
        label: 'From',
        source: 'boards',
        multiple: true,
        any: 'All boards',
        max: 10,
        about: 'The boards its posts come from, by name; none is every public board',
      },
      {
        kind: 'count',
        key: 'count',
        label: 'How many',
        options: [3, 5, 10],
        about: 'How many posts it lists',
      },
      {
        kind: 'switch',
        key: 'showVotes',
        label: 'Votes',
        group: 'Each post shows',
        default: true,
        about: 'Whether each post shows its vote box',
      },
      {
        kind: 'switch',
        key: 'showStatus',
        label: 'Status',
        group: 'Each post shows',
        default: true,
        about: 'Whether each post shows its status',
      },
      {
        kind: 'switch',
        key: 'showComments',
        label: 'Comments',
        group: 'Each post shows',
        default: false,
        about: 'Whether each post shows how many comments it has',
      },
      ...emptyFields('message', 'No posts yet. Be the first.'),
      linkField,
    ],
    repeat: 'many',
    ai: [
      'heading',
      'sort',
      'count',
      'boardIds',
      'showVotes',
      'showStatus',
      'showComments',
      'whenEmpty',
      'emptyText',
      'link',
    ],
    examples: [
      {
        request: 'List the 5 most voted posts from the Billing board',
        ops: [
          { op: 'set', target: 'ideas', key: 'sort', value: 'top' },
          { op: 'set', target: 'ideas', key: 'count', value: '5' },
          { op: 'set', target: 'ideas', key: 'boardIds', value: '["Billing"]' },
        ],
      },
      {
        request: 'Show comment counts on the posts, without the vote boxes',
        ops: [
          { op: 'set', target: 'ideas', key: 'showComments', value: 'true' },
          { op: 'set', target: 'ideas', key: 'showVotes', value: 'false' },
        ],
      },
    ],
  },
  roadmap: {
    name: 'Roadmap',
    purpose: 'What is planned, in progress and done',
    job: 'progress',
    own: [
      {
        kind: 'source',
        key: 'roadmapId',
        label: 'Roadmap',
        source: 'roadmaps',
        multiple: false,
        any: 'First public roadmap',
        about: 'The roadmap it shows, by name; none is the first public roadmap',
      },
      {
        kind: 'source',
        key: 'statusIds',
        label: 'Columns',
        source: 'columns',
        multiple: true,
        any: 'Every column',
        max: 12,
        about:
          'The roadmap columns it shows, by name, in the roadmap’s order; none is every column',
      },
      {
        kind: 'count',
        key: 'perColumn',
        label: 'Posts per column',
        options: [2, 3, 5],
        default: 2,
        about: 'How many posts each column lists',
      },
      {
        kind: 'switch',
        key: 'showVotes',
        label: 'Show votes',
        default: false,
        about: 'Whether each post shows its votes',
      },
      ...emptyFields('hide', 'Nothing on the roadmap yet.'),
      linkField,
    ],
    repeat: 'many',
    ai: [
      'heading',
      'roadmapId',
      'statusIds',
      'perColumn',
      'showVotes',
      'whenEmpty',
      'emptyText',
      'link',
    ],
    examples: [
      {
        request: 'Point the roadmap block at our Public roadmap',
        ops: [{ op: 'set', target: 'roadmap', key: 'roadmapId', value: 'Public roadmap' }],
      },
      {
        request: 'Only show the Planned and In progress columns, 3 posts each',
        ops: [
          { op: 'set', target: 'roadmap', key: 'statusIds', value: '["Planned","In progress"]' },
          { op: 'set', target: 'roadmap', key: 'perColumn', value: '3' },
        ],
      },
    ],
  },
  updates: {
    name: 'Latest updates',
    purpose: 'Your latest changelog entries',
    job: 'progress',
    own: [
      {
        kind: 'count',
        key: 'count',
        label: 'How many',
        options: [2, 3, 4],
        about: 'How many changelog entries it lists',
      },
      {
        kind: 'switch',
        key: 'showDate',
        label: 'Date',
        group: 'Each update shows',
        default: true,
        about: 'Whether each entry shows its date',
      },
      {
        kind: 'switch',
        key: 'showSummary',
        label: 'Summary',
        group: 'Each update shows',
        default: false,
        about: 'Whether each entry shows the start of its words, in two lines',
      },
      ...emptyFields('hide', 'No updates yet.'),
      linkField,
    ],
    repeat: 'once',
    ai: ['heading', 'count', 'showDate', 'showSummary', 'whenEmpty', 'emptyText', 'link'],
    examples: [
      {
        request: 'Show just 2 updates',
        ops: [{ op: 'set', target: 'updates', key: 'count', value: '2' }],
      },
    ],
  },
  help_search: {
    name: 'Help search',
    purpose: 'Search your help center',
    job: 'answers',
    own: [
      {
        kind: 'count',
        key: 'popular',
        label: 'Popular articles',
        options: [0, 3, 5],
        names: { 0: 'None' },
        default: 5,
        about: 'How many popular articles it lists under the search; 0 lists none',
      },
      linkField,
    ],
    repeat: 'once',
    ai: ['heading', 'popular', 'link'],
    examples: [
      {
        request: 'Put help search under the welcome',
        ops: [{ op: 'move', target: 'help_search', value: 'below:welcome' }],
      },
    ],
  },
  help_topics: {
    name: 'Help topics',
    purpose: 'Your help center’s topics',
    job: 'answers',
    own: [
      {
        kind: 'source',
        key: 'categoryIds',
        label: 'Topics',
        source: 'categories',
        multiple: true,
        any: 'The first topics',
        max: 8,
        about: 'The help topics it shows, by name, in order; none is the first topics',
      },
      {
        kind: 'choice',
        key: 'layout',
        label: 'Layout',
        options: [
          ['cards', 'Cards'],
          ['list', 'List'],
        ],
        looks: { cards: 'a card for each topic', list: 'a row for each topic on one card' },
        default: 'cards',
        about: 'How its topics are laid out',
      },
      {
        kind: 'switch',
        key: 'showCounts',
        label: 'Article counts',
        default: true,
        about: 'Whether each topic shows how many articles it has',
      },
      {
        kind: 'count',
        key: 'topArticles',
        label: 'Top articles',
        options: [0, 2, 3],
        names: { 0: 'None' },
        default: 0,
        about: 'How many of each topic’s articles it lists under the topic; 0 lists none',
      },
      ...emptyFields('hide', 'No help topics yet.'),
      linkField,
    ],
    repeat: 'once',
    ai: [
      'heading',
      'categoryIds',
      'layout',
      'showCounts',
      'topArticles',
      'whenEmpty',
      'emptyText',
      'link',
    ],
    examples: [
      {
        request: 'Show every help topic again',
        ops: [{ op: 'set', target: 'help_topics', key: 'categoryIds', value: '[]' }],
      },
    ],
  },
  status: {
    name: 'Status',
    purpose: 'Whether everything is working',
    job: 'answers',
    own: [
      {
        kind: 'switch',
        key: 'showIncidents',
        label: 'Show incidents',
        default: true,
        about: 'Whether it lists the incidents under way',
      },
      ...emptyFields('hide', 'No status to show yet.'),
      linkField,
    ],
    repeat: 'once',
    ai: ['heading', 'showIncidents', 'whenEmpty', 'emptyText', 'link'],
    examples: [
      {
        request: 'Put status next to the post box',
        ops: [{ op: 'move', target: 'status', value: 'beside:composer' }],
      },
    ],
  },
  contact: {
    name: 'Contact',
    purpose: 'A way to reach your team',
    job: 'hear',
    own: [
      {
        kind: 'text',
        key: 'text',
        label: 'Words',
        max: 160,
        inPlace: true,
        aiUntold: true,
        about:
          'Its line of words under the heading, in place of "Ask a question or tell us about a problem, and we will get back to you."',
      },
      {
        ...linkField,
        aiUntold: true,
        about: 'The words of its button, in place of "Start a conversation"',
      },
    ],
    repeat: 'once',
    ai: ['heading', 'text', 'link'],
    examples: [
      {
        request: 'Move contact to the bottom',
        ops: [{ op: 'move', target: 'contact', value: 'bottom' }],
      },
    ],
  },
  links: {
    name: 'Links',
    purpose: 'Links to your other places',
    job: 'own',
    own: [
      {
        kind: 'links',
        key: 'links',
        label: 'Links',
        about:
          'Up to six links, each {"label","url"}; only addresses the person gave, never made up',
      },
    ],
    repeat: 'many',
    ai: ['heading', 'links'],
    examples: [
      {
        request: 'Add a link to our docs at https://docs.example.com at the bottom',
        ops: [
          {
            op: 'add',
            key: 'links',
            target: 'bottom',
            value: '{"links":[{"label":"Docs","url":"https://docs.example.com"}]}',
          },
        ],
      },
    ],
  },
}

/** The jobs' order, then each job's blocks in the order the Add sheet lists them. */
const ADD_ORDER: readonly HomeBlockType[] = [
  'help_search',
  'help_topics',
  'status',
  'composer',
  'ideas',
  'contact',
  'roadmap',
  'updates',
  'welcome',
  'links',
]

const SECTIONS: Record<SectionType, Omit<BlockDef, 'type' | 'pages' | 'addable' | 'repeat'>> = {
  'changelog.entries': {
    name: 'Entries',
    purpose: 'How each changelog entry shows',
    job: 'progress',
    fields: [
      {
        kind: 'choice',
        key: 'entries',
        label: 'Entries',
        options: [
          ['timeline', 'Timeline'],
          ['cards', 'Cards'],
          ['compact', 'Compact'],
        ],
        looks: {
          timeline: 'dates in a column beside each entry',
          cards: 'each entry in a card of its own',
          compact: 'titles with a line of each, close together',
        },
        about: 'How the changelog lays out its entries',
      },
      {
        kind: 'choice',
        key: 'images',
        label: 'Images',
        options: [
          ['none', 'None'],
          ['wide', 'Wide'],
          ['thumbnail', 'Thumbnail'],
        ],
        looks: {
          none: 'entries without their featured image',
          wide: 'the featured image across the entry',
          thumbnail: 'a small featured image beside the entry',
        },
        about: 'How an entry’s featured image shows',
      },
    ],
    ai: ['entries', 'images'],
    examples: [
      {
        request: 'Show compact changelog entries with small images',
        ops: [
          { op: 'set', target: 'changelog page', key: 'entries', value: 'compact' },
          { op: 'set', target: 'changelog page', key: 'images', value: 'thumbnail' },
        ],
      },
    ],
  },
  'help.topics': {
    name: 'Topics',
    purpose: 'How the help center’s topics show',
    job: 'answers',
    fields: [
      {
        kind: 'choice',
        key: 'topics',
        label: 'Topics',
        options: [
          ['cards', 'Cards'],
          ['list', 'List'],
        ],
        looks: { cards: 'a grid of cards, one per topic', list: 'a plain list of topics' },
        about: 'How the help center’s home lays out its topics',
      },
    ],
    ai: ['topics'],
    examples: [
      {
        request: 'List the help topics instead of cards',
        ops: [{ op: 'set', target: 'help page', key: 'topics', value: 'list' }],
      },
    ],
  },
  'help.popular': {
    name: 'Popular articles',
    purpose: 'The articles people read most',
    job: 'answers',
    fields: [
      {
        kind: 'switch',
        key: 'popular',
        label: 'Show popular articles',
        about: 'Whether the most read articles show under the topics',
      },
    ],
    ai: ['popular'],
    examples: [
      {
        request: 'Bring back popular articles on the help center',
        ops: [{ op: 'set', target: 'help page', key: 'popular', value: 'true' }],
      },
    ],
  },
  'help.search': {
    name: 'Search',
    purpose: 'The help center’s search box',
    job: 'answers',
    fields: [
      {
        kind: 'choice',
        key: 'search',
        label: 'Size',
        options: [
          ['standard', 'Standard'],
          ['large', 'Large'],
        ],
        looks: {
          standard: 'a search box of the usual size under the title',
          large: 'a big search box that leads the page',
        },
        about: 'How large the help center’s search box is',
      },
    ],
    ai: ['search'],
    examples: [
      {
        request: 'Give the help center’s search box its usual size',
        ops: [{ op: 'set', target: 'help page', key: 'search', value: 'standard' }],
      },
    ],
  },
  'roadmap.board': {
    name: 'Board',
    purpose: 'How the roadmap’s posts are laid out',
    job: 'progress',
    fields: [
      {
        kind: 'choice',
        key: 'board',
        label: 'Board',
        options: [
          ['columns', 'Columns'],
          ['list', 'List'],
        ],
        looks: {
          columns: 'a column per status, side by side',
          list: 'one list grouped by status',
        },
        about: 'How the roadmap page lays out its posts',
      },
      {
        kind: 'switch',
        key: 'votes',
        label: 'Votes on cards',
        about: 'Whether each roadmap card shows its vote box',
      },
    ],
    ai: ['board', 'votes'],
    examples: [
      {
        request: 'Lay the roadmap out in columns, with votes on its cards',
        ops: [
          { op: 'set', target: 'roadmap page', key: 'board', value: 'columns' },
          { op: 'set', target: 'roadmap page', key: 'votes', value: 'true' },
        ],
      },
    ],
  },
}

/** The hero's settings, in the order its panel shows them. */
const HERO: BlockDef = {
  type: 'hero',
  name: 'Hero',
  purpose: 'The top of each page, with its headline',
  note: 'On every page',
  job: null,
  fields: [
    {
      kind: 'choice',
      key: 'look',
      label: 'Look',
      options: BAND_LOOKS.map((look) => [look.id, look.label] as const),
      looks: BAND_LOOK_LOOKS,
      about:
        'A curated look for the hero; it sets the fill, art and shape together. Calmest first: plain, tint, fade',
    },
    {
      kind: 'image',
      key: 'image',
      label: 'Image',
      about: 'An uploaded picture; only a person uploads one, in the hero’s panel',
    },
    {
      kind: 'choice',
      key: 'imagePlace',
      label: 'Image sits',
      options: [
        ['side', 'Beside'],
        ['edge', 'Along the bottom'],
        ['cover', 'Behind the words'],
        ['pattern', 'Tiled'],
      ],
      looks: {
        side: 'the image beside the words',
        edge: 'the image along the hero’s bottom edge',
        cover: 'the image fills the hero behind the words',
        pattern: 'the image tiled as a pattern',
      },
      about: 'Where an uploaded hero image sits',
    },
    {
      kind: 'choice',
      key: 'imagePhone',
      label: 'On phones',
      options: [
        ['show', 'Show'],
        ['hide', 'Leave off'],
      ],
      looks: { show: 'the image shows on phones too', hide: 'phones show the hero without it' },
      about: 'Whether phones show the hero image',
    },
    {
      kind: 'choice',
      key: 'art',
      label: 'Art',
      options: [
        ['none', 'None'],
        ['dots', 'Dots'],
        ['grid', 'Grid'],
        ['lines', 'Lines'],
        ['waves', 'Waves'],
        ['hills', 'Hills'],
        ['petals', 'Petals'],
        ['confetti', 'Confetti'],
      ],
      looks: {
        none: 'no art, the calmest',
        dots: 'a quiet dot pattern',
        grid: 'faint grid lines',
        lines: 'thin diagonal lines',
        waves: 'soft waves along the bottom',
        hills: 'rolling hills along the bottom',
        petals: 'scattered petal shapes',
        confetti: 'bright confetti, the busiest',
      },
      about: 'Quiet art in the brand’s colours, for a coloured hero without an image',
    },
    {
      kind: 'choice',
      key: 'glow',
      label: 'Glow',
      options: [
        ['none', 'None'],
        ['bottom', 'From the foot'],
        ['top', 'Along the top'],
        ['corner', 'In a corner'],
      ],
      looks: {
        none: 'the colour alone',
        bottom: 'a soft light rising from the hero’s foot',
        top: 'a soft light along the hero’s top',
        corner: 'a soft light in the hero’s top corner',
      },
      about: 'A soft glow of light on a Brand colour or Second colour hero',
    },
    {
      kind: 'choice',
      key: 'blend',
      label: 'Blend',
      options: [
        ['linear', 'Line'],
        ['mesh', 'Mesh'],
        ['ribbon', 'Ribbon'],
      ],
      looks: {
        linear: 'the two colours run into each other in a line',
        mesh: 'a soft mesh of the colours beside the words',
        ribbon: 'a diagonal ribbon of the colours sweeping past the words',
      },
      about: 'How a Blend hero runs its colours together',
    },
    {
      kind: 'choice',
      key: 'fadeFrom',
      label: 'Fade from',
      options: [
        ['top', 'The top'],
        ['bottom', 'The foot'],
      ],
      looks: { top: 'colour at the top fading down', bottom: 'colour at the foot fading up' },
      about: 'Where a Fade hero’s colour starts',
    },
    {
      kind: 'choice',
      key: 'colour',
      label: 'Colour',
      options: [
        ['accent', 'Brand colour'],
        ['support', 'Second colour'],
        ['extra1', 'Extra colour 1'],
        ['extra2', 'Extra colour 2'],
      ],
      looks: {
        accent: 'the brand colour',
        support: 'the second brand colour',
        extra1: 'the first extra brand colour',
        extra2: 'the second extra brand colour',
      },
      about: 'The colour a Brand, Tint or Fade hero is drawn in, or a Blend runs into',
    },
    {
      kind: 'choice',
      key: 'height',
      label: 'Height',
      options: [
        ['compact', 'Short'],
        ['roomy', 'Roomy'],
        ['tall', 'Tall'],
      ],
      looks: {
        compact: 'little room above and below the words',
        roomy: 'the usual room',
        tall: 'a lot of room, the boldest',
      },
      about: 'How much room the hero gives its words, top and bottom',
    },
    {
      kind: 'choice',
      key: 'align',
      label: 'Alignment',
      options: [
        ['left', 'Left'],
        ['centre', 'Centre'],
      ],
      looks: { left: 'words to the left', centre: 'words centred' },
      about: 'Where the hero’s words sit',
    },
    {
      kind: 'choice',
      key: 'shape',
      label: 'Shape',
      options: [
        ['full', 'Full width'],
        ['inset', 'Inset'],
        ['panel', 'Words on a panel'],
        ['split', 'Split with the image'],
      ],
      looks: {
        full: 'across the whole page',
        inset: 'a rounded panel within the page',
        panel: 'the words on a block of the second colour',
        split: 'a rounded panel, words on one half and the image on the other',
      },
      about: 'The hero’s shape on the page',
    },
    {
      kind: 'switch',
      key: 'headerBlend',
      label: 'Header blends into the hero',
      about: 'Whether the header takes the hero’s colour, as one piece with it',
    },
    {
      kind: 'choice',
      key: 'titles',
      label: 'Other pages’ titles',
      options: [
        ['plain', 'Plain'],
        ['band', 'In the hero'],
      ],
      looks: {
        plain: 'the other pages’ titles plain on the page',
        band: 'the other pages’ titles in a hero, as Home’s is',
      },
      about: 'Whether the roadmap, changelog, help and support pages put their titles in a hero',
    },
    {
      kind: 'choice',
      key: 'mainAction',
      label: 'Main action',
      options: [
        ['composer', 'Composer'],
        ['search', 'Search'],
        ['button', 'Button'],
        ['none', 'None'],
      ],
      looks: {
        composer: 'the post box in the hero under the headline',
        search:
          'the help centre’s search box in the hero, with Ask AI where it is on; the post box goes on Home’s grid',
        button:
          'one call to action in the hero, opening the post box or going to the roadmap; the post box goes on Home’s grid',
        none: 'the headline and subtitle alone; the post box is a block on Home’s grid',
      },
      about:
        'What sits under Home’s headline: the post box, the help search, one button, or nothing. Search needs the help centre on',
    },
    {
      kind: 'choice',
      key: 'composerWidth',
      label: 'Composer width',
      options: [
        ['narrow', 'Narrow'],
        ['medium', 'Medium'],
        ['wide', 'Wide'],
        ['full', 'Full'],
      ],
      looks: {
        narrow: 'a short post box, about half a desktop hero’s words',
        medium: 'a post box of middling width',
        wide: 'a wide post box, the usual width beside an image or under centred words',
        full: 'the post box across the hero’s words, the usual width otherwise',
      },
      about:
        'How wide Home’s post box is in the hero, from narrow to the words’ full width; phones always give it the full width. Only with the composer in the hero',
    },
    {
      kind: 'choice',
      key: 'buttonTo',
      label: 'Goes to',
      options: [
        ['composer', 'Composer'],
        ['roadmap', 'Roadmap'],
        ['help', 'Help'],
        ['support', 'Support'],
      ],
      looks: {
        composer: 'the button opens the post box in the hero',
        roadmap: 'the button goes to the roadmap',
        help: 'the button goes to the help center',
        support: 'the button goes to support, to start a request',
      },
      about:
        'Where Home’s call to action goes: it opens the post box in place, or goes to the roadmap, the help center or support, each only while that page is on. Only with Button as the main action',
    },
    {
      kind: 'switch',
      key: 'secondButton',
      label: 'Second button',
      about:
        'A quiet second button beside the call to action: to the roadmap beside the post box, else to the post box. Only with Button as the main action',
    },
    {
      kind: 'choice',
      key: 'action',
      label: 'Call to action colour',
      options: [
        ['buttons', 'As the buttons'],
        ['accent', 'Brand colour'],
        ['support', 'Second colour'],
      ],
      looks: {
        buttons: 'as the other buttons are',
        accent: 'the brand colour, while the other buttons are in the text colour',
        support: 'the second brand colour',
      },
      about: 'The colour of the hero’s main button',
    },
  ],
  repeat: 'once',
  pages: ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support'],
  ai: HERO_AI_PATHS,
  addable: false,
  examples: [
    {
      request: 'Make the hero louder',
      ops: [{ op: 'set', target: 'hero', key: 'look', value: 'brand' }],
    },
    {
      request: 'Give the hero more room and a dotted pattern',
      ops: [
        { op: 'set', target: 'hero', key: 'height', value: 'tall' },
        { op: 'set', target: 'hero', key: 'art', value: 'dots' },
      ],
    },
    {
      request: 'Just the headline up top, no post box there',
      ops: [{ op: 'set', target: 'hero', key: 'mainAction', value: 'none' }],
    },
  ],
}

const pageOfSection = (type: SectionType) => type.split('.')[0] as ChoicePage
const isSectionType = (type: string): type is SectionType =>
  (SECTION_TYPES as readonly string[]).includes(type)

const REGISTRY = new Map<string, BlockDef>([
  ...(Object.keys(HOME) as HomeBlockType[]).map((type): [string, BlockDef] => {
    const { own, ...def } = HOME[type]
    return [
      type,
      {
        ...def,
        type,
        fields: [heading, ...own],
        pages: ['home'],
        addable: true,
        grid: {
          w: BLOCK_SIZES[type].size[0],
          h: BLOCK_SIZES[type].size[1],
          minW: BLOCK_SIZES[type].min[0],
          minH: BLOCK_SIZES[type].min[1],
        },
      },
    ]
  }),
  ...SECTION_TYPES.map((type): [string, BlockDef] => [
    type,
    { ...SECTIONS[type], type, repeat: 'once', pages: [pageOfSection(type)], addable: false },
  ]),
  ['hero', HERO],
])

/** A block type's entry, or null for a type the registry does not have. */
export function blockOf(type: string): BlockDef | null {
  return REGISTRY.get(type) ?? null
}

/** The blocks the Add sheet offers, grouped by their job, in the jobs' order. */
export function blocksByJob(): Array<{ job: BlockJob; name: string; blocks: BlockDef[] }> {
  return (Object.keys(BLOCK_JOBS) as BlockJob[]).map((job) => ({
    job,
    name: BLOCK_JOBS[job],
    blocks: ADD_ORDER.map((type) => REGISTRY.get(type)!).filter((def) => def.job === job),
  }))
}

/** The settings Quackback AI may change on a block of this type; none for an unknown one. */
export function aiKeysOf(type: string): readonly string[] {
  return blockOf(type)?.ai ?? []
}

/* Summaries */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const nameOf = (options: ReadonlyArray<Option<string>>, value: string) =>
  options.find(([option]) => option === value)?.[1] ?? value

/** The first words of a rich text document, as one line. */
function firstWords(node: unknown, max = 36): string {
  const parts: string[] = []
  const walk = (at: unknown) => {
    if (!at || typeof at !== 'object') return
    const { text, content } = at as { text?: unknown; content?: unknown }
    if (typeof text === 'string') parts.push(text)
    if (Array.isArray(content)) for (const child of content) walk(child)
  }
  walk(node)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const at = cut.lastIndexOf(' ')
  return `${text.slice(0, at > 0 ? at : max).trimEnd()}…`
}

/** The boards Top posts draws from, by name, or how many when a name is not known. */
function boardWords(ids: readonly string[] | undefined, names: SummaryNames): string {
  if (!ids?.length) return 'all boards'
  const known = ids.map((id) => names.boards?.[id])
  return known.every((name) => name) ? known.join(', ') : plural(ids.length, 'board', 'boards')
}

function homeSummary(block: HomeBlock, names: SummaryNames): string[] {
  switch (block.type) {
    case 'welcome': {
      const words = firstWords(block.body)
      return words ? [`“${words}”`] : ['No words yet']
    }
    case 'ideas':
      return [
        nameOf(SORTS, block.sort),
        plural(block.count, 'post', 'posts'),
        boardWords(block.boardIds, names),
      ]
    case 'updates':
      return [plural(block.count, 'latest entry', 'latest entries')]
    case 'roadmap':
      return [
        block.roadmapId === null
          ? 'First public roadmap'
          : (names.roadmaps?.[block.roadmapId] ?? 'A chosen roadmap'),
      ]
    case 'help_topics':
      return [
        block.categoryIds.length
          ? plural(block.categoryIds.length, 'topic', 'topics')
          : 'First topics',
      ]
    case 'links':
      return [plural(block.links.length, 'link', 'links')]
    default:
      return []
  }
}

function heroSummary(block: HeroBlock): string[] {
  const look =
    block.look === CUSTOM_LOOK
      ? 'Custom look'
      : (BAND_LOOKS.find((each) => each.id === block.look)?.label ?? block.look)
  return [look, ...(block.image ? ['with an image'] : [])]
}

function sectionSummary(block: SectionBlock): string[] {
  const def = SECTIONS[block.type]
  return def.fields.map((field) => {
    const value = (block as Record<string, unknown>)[field.key]
    if (field.kind === 'switch') {
      const shown = value === true
      return field.key === 'votes'
        ? `votes ${shown ? 'shown' : 'hidden'}`
        : shown
          ? 'Shown'
          : 'Hidden'
    }
    if (field.kind !== 'choice') return String(value)
    if (field.key === 'images') return value === 'none' ? 'no images' : `${String(value)} images`
    if (field.key === 'search') return `${nameOf(field.options, String(value))} size`
    return nameOf(field.options, String(value))
  })
}

/** A block's settings in one line, such as "Trending · 3 posts · all boards". */
export function summaryOf(block: AnyBlock, names: SummaryNames = {}): string {
  const parts =
    block.type === 'hero'
      ? heroSummary(block)
      : isSectionType(block.type)
        ? sectionSummary(block as SectionBlock)
        : homeSummary(block as HomeBlock, names)
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/* Changes */

export type SettingResult<B extends AnyBlock = AnyBlock> =
  { ok: true; block: B } | { ok: false; refusal: string }

const SECTION_SCHEMAS = {
  changelog: changelogChoicesSchema,
  help: helpChoicesSchema,
  roadmap: roadmapChoicesSchema,
} as const

const listed = (values: readonly unknown[]) => {
  const words = values.map(String)
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0]
}

/** Whether a value is one the field offers, before the schema has its say. */
function offered(field: SettingField, value: unknown): string | null {
  if (field.kind === 'choice' && !field.options.some(([option]) => option === value))
    return `${field.label} can be ${listed(field.options.map(([, name]) => name))}`
  if (field.kind === 'count' && !field.options.includes(value as number))
    return `${field.label} can be ${listed(field.options)}`
  if (field.kind === 'switch' && typeof value !== 'boolean') return `${field.label} is on or off`
  if (field.kind === 'text' && typeof value !== 'string') return `${field.label} takes words`
  return null
}

/**
 * The block with one setting changed, checked against the design's schema,
 * or a refusal saying why not. Words go in `locale`; empty words clear that
 * language, and with none left the block reads its usual heading again.
 * The block given is never changed.
 */
export function applySetting<B extends AnyBlock>(
  block: B,
  key: string,
  value: unknown,
  locale = 'en'
): SettingResult<B> {
  const def = blockOf(block.type)
  if (!def) return { ok: false, refusal: `There is no ${block.type} block` }
  const field = def.fields.find((candidate) => candidate.key === key)
  if (!field) return { ok: false, refusal: `${def.name} has no setting called ${key}` }
  const refused = offered(field, value)
  if (refused) return { ok: false, refusal: refused }

  let next: Record<string, unknown>
  if (field.kind === 'text' && !isSectionType(block.type) && block.type !== 'hero') {
    // Words by language: emptied in every language, the block takes its usual ones again.
    const { [key]: current, ...rest } = block as Record<string, unknown>
    const words: Record<string, string> = { ...(current as Record<string, string> | undefined) }
    if (value) words[locale] = value as string
    else delete words[locale]
    next = Object.keys(words).length ? { ...rest, [key]: words } : rest
  } else next = { ...block, [key]: value }

  const parsed =
    block.type === 'hero'
      ? heroSchema.safeParse(next)
      : isSectionType(block.type)
        ? checkSection(block.type, next)
        : homeBlockSchema.safeParse(next)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, refusal: `${field.label}: ${issue?.message ?? 'not allowed'}` }
  }
  return { ok: true, block: next as B }
}

function checkSection(type: SectionType, next: Record<string, unknown>) {
  const { type: _type, ...choices } = next
  const schema = SECTION_SCHEMAS[pageOfSection(type)] as z.ZodObject
  return schema.strict().safeParse(choices)
}

/** A page section as a block, with today's choices where the design makes none. */
export function sectionOf<S extends SectionType>(
  design: PortalDesign,
  type: S
): Extract<SectionBlock, { type: S }> {
  const page = pageOfSection(type)
  const made = { ...PAGE_CHOICE_DEFAULTS[page], ...design.pages[page] } as Record<string, unknown>
  return Object.fromEntries([
    ['type', type],
    ...SECTION_KEYS[type].map((key) => [key, made[key]]),
  ]) as Extract<SectionBlock, { type: S }>
}

/**
 * Writes a page section's choices into the design. Today's look is no choice
 * at all, so a choice back at it is left out, and a page with none left out.
 */
export function writeSection(design: PortalDesign, block: SectionBlock): void {
  const page = pageOfSection(block.type)
  const made = { ...design.pages[page] } as Record<string, unknown>
  const defaults = PAGE_CHOICE_DEFAULTS[page] as Record<string, unknown>
  for (const key of SECTION_KEYS[block.type]) {
    const value = (block as Record<string, unknown>)[key]
    if (value === defaults[key]) delete made[key]
    else made[key] = value
  }
  const pages = design.pages as Record<string, unknown>
  if (Object.keys(made).length) pages[page] = made
  else delete pages[page]
}

/* The page background: not a block, but described the same way */

/** A page background's setting: the kinds it belongs to, its choices and what each looks like. */
export interface BackgroundSetting {
  key: string
  label: string
  about: string
  /** The kinds that have it. */
  kinds: readonly BackgroundKind[]
  /** Named choices with their labels and looks; absent for a colour, a list of colours or a number. */
  options?: ReadonlyArray<Option<string>>
  looks?: Readonly<Record<string, string>>
  /** What it takes, where it is no named choice. */
  takes?: string
}

const COLOUR_TAKES =
  'a brand colour by its role (accent, support, extra1, extra2), page for the page’s own colour, or an exact colour such as #fdf6e3'

/**
 * The page background's kinds and settings, in the order Theme shows them,
 * each with what it looks like. Quackback AI is told them from here, and
 * Theme's tiles take their labels from here.
 */
export const PAGE_BACKGROUND_SETTINGS: readonly BackgroundSetting[] = [
  {
    key: 'kind',
    label: 'Page background',
    about: 'What sits behind every page, or behind one page with its own',
    kinds: ['solid', 'tint', 'gradient', 'image', 'pattern'],
    options: [
      ['solid', 'Page colour'],
      ['tint', 'Soft colour'],
      ['gradient', 'Gradient'],
      ['image', 'Image'],
      ['pattern', 'Pattern'],
    ],
    looks: {
      solid: 'the plain page colour, as every portal starts',
      tint: 'a soft wash of one colour over the whole page, such as a cream or pale blue page',
      gradient: 'two or three colours running softly into each other, subtle unless made stronger',
      image:
        'an uploaded picture behind the page, under a layer of the page colour that keeps text readable; only a person uploads one',
      pattern: 'a quiet repeating motif, such as dots or a grid, in a brand colour',
    },
  },
  {
    key: 'colour',
    label: 'Colour',
    about:
      'The colour of a soft colour page or a pattern. An exact colour is drawn as given in light mode; a brand colour as a pale wash of it',
    kinds: ['tint', 'pattern'],
    takes: COLOUR_TAKES,
  },
  {
    key: 'stops',
    label: 'Colours',
    about: 'A gradient’s colours, two or three, first to last',
    kinds: ['gradient'],
    takes: `a list of two or three, each ${COLOUR_TAKES}`,
  },
  {
    key: 'shape',
    label: 'Shape',
    about: 'A gradient in a line, or a glow out from a point',
    kinds: ['gradient'],
    options: [
      ['linear', 'Line'],
      ['radial', 'Glow'],
    ],
    looks: {
      linear: 'the colours run across the page in a line',
      radial: 'a soft glow of the first colour fading out into the last',
    },
  },
  {
    key: 'direction',
    label: 'Direction',
    about: 'Which way a line gradient runs, from its first colour to its last',
    kinds: ['gradient'],
    options: [
      ['down', 'Down'],
      ['up', 'Up'],
      ['right', 'Right'],
      ['left', 'Left'],
      ['diagonal', 'Diagonal'],
    ],
    looks: {
      down: 'the first colour at the top, drifting into the last down the page',
      up: 'the first colour at the foot, drifting into the last up the page',
      right: 'from the left edge to the right',
      left: 'from the right edge to the left',
      diagonal: 'from the top left corner to the bottom right',
    },
  },
  {
    key: 'centre',
    label: 'Glow from',
    about: 'Where a glow starts',
    kinds: ['gradient'],
    options: [
      ['top', 'Top'],
      ['middle', 'Middle'],
      ['corner', 'Corner'],
    ],
    looks: {
      top: 'a glow along the top centre, behind the header and hero',
      middle: 'a glow in the middle of the first screen',
      corner: 'a glow from the top left corner',
    },
  },
  {
    key: 'strength',
    label: 'Strength',
    about: 'How strongly a soft colour, gradient or pattern shows; text always stays readable',
    kinds: ['tint', 'gradient', 'pattern'],
    options: [
      ['faint', 'Faint'],
      ['soft', 'Soft'],
      ['strong', 'Strong'],
    ],
    looks: {
      faint: 'barely there, the calmest',
      soft: 'clearly coloured but quiet',
      strong: 'the most colour a readable page takes',
    },
  },
  {
    key: 'pattern',
    label: 'Pattern',
    about: 'A pattern’s motif',
    kinds: ['pattern'],
    options: [
      ['dots', 'Dots'],
      ['grid', 'Grid'],
      ['lines', 'Lines'],
      ['cross', 'Crosses'],
    ],
    looks: {
      dots: 'small dots in rows',
      grid: 'fine grid lines, like graph paper',
      lines: 'thin diagonal lines',
      cross: 'small plus signs',
    },
  },
  {
    key: 'scale',
    label: 'Size',
    about: 'How large a pattern’s motif is drawn',
    kinds: ['pattern'],
    options: [
      ['small', 'Small'],
      ['medium', 'Medium'],
      ['large', 'Large'],
    ],
    looks: {
      small: 'a fine, close pattern',
      medium: 'the usual size',
      large: 'a large, open pattern',
    },
  },
  {
    key: 'strength',
    label: 'Image strength',
    about:
      'How much of an image shows through the layer over it, in percent; the layer stays as strong as text needs',
    kinds: ['image'],
    takes: 'a number from 0 to 100',
  },
  {
    key: 'fit',
    label: 'Fit',
    about: 'How an image fills the page',
    kinds: ['image'],
    options: [
      ['cover', 'Cover'],
      ['contain', 'Whole'],
      ['tile', 'Tile'],
    ],
    looks: {
      cover: 'the image covers the page, cropped to fit',
      contain: 'the whole image shows, on the page colour',
      tile: 'the image repeats like wallpaper',
    },
  },
  {
    key: 'position',
    label: 'Keep in view',
    about: 'Which part of an image stays in view',
    kinds: ['image'],
    options: [
      ['top', 'Top'],
      ['centre', 'Centre'],
      ['bottom', 'Bottom'],
    ],
    looks: { top: 'its top', centre: 'its centre', bottom: 'its foot' },
  },
  {
    key: 'scroll',
    label: 'On scroll',
    about: 'Whether an image scrolls with the page or stays still behind it (larger screens only)',
    kinds: ['image'],
    options: [
      ['scroll', 'Scrolls'],
      ['fixed', 'Stays still'],
    ],
    looks: {
      scroll: 'the image scrolls with the page',
      fixed: 'the image stays still as the page scrolls over it, on larger screens',
    },
  },
]

/** Requests a person might make of the page background, and the operations that make them. */
export const PAGE_BACKGROUND_EXAMPLES: readonly BlockExample[] = [
  {
    request: 'Make the page a soft cream',
    ops: [{ op: 'background', target: 'site', key: 'tint', value: '{"colour":"#fbf6ec"}' }],
  },
  {
    request: 'Give the page a subtle gradient from our brand colour',
    ops: [
      {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["accent","page"],"direction":"down"}',
      },
    ],
  },
  {
    request: 'A faint dot pattern on the roadmap page only',
    ops: [
      {
        op: 'background',
        target: 'roadmap',
        key: 'pattern',
        value: '{"pattern":"dots","strength":"faint"}',
      },
    ],
  },
  {
    request: 'Make the changelog look like every other page again',
    ops: [{ op: 'background', target: 'changelog', key: 'reset', value: '' }],
  },
  {
    request: 'A plain white page',
    ops: [{ op: 'background', target: 'site', key: 'solid', value: '' }],
  },
]
