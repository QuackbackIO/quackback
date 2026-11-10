/**
 * What a block's settings are made of, shared by the block registry
 * (index.ts) and each block's own module (<block>.def.ts): a setting's
 * kinds, the settings many blocks share, and what a Home block's module
 * declares for the builder and Quackback AI. Builder and AI only: the portal
 * never loads it.
 */
import type { FlatOp } from '../design-ops'
import type { HomeBlock, HomeBlockType } from '../home'

/** What a block is for, as the Add sheet groups them, in its order. */
export const BLOCK_JOBS = {
  answers: 'Help people find answers',
  hear: 'Hear from customers',
  progress: 'Show progress',
  own: 'Your own',
} as const
export type BlockJob = keyof typeof BLOCK_JOBS

export type Option<T> = readonly [value: T, name: string]

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
        source: 'roadmaps' | 'categories' | 'boards' | 'columns' | 'statuses'
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

/** The names a summary can use for what a block points at, by id. */
export interface SummaryNames {
  roadmaps?: Readonly<Record<string, string>>
  boards?: Readonly<Record<string, string>>
}

/** What a Home block's module declares for the builder and Quackback AI (see index.ts). */
export interface HomeBlockDef<T extends HomeBlockType = HomeBlockType> {
  name: string
  /** One line: what it is for. */
  purpose: string
  /** Its group in the Add sheet. */
  job: BlockJob
  /** A note under its purpose, such as where its settings reach. */
  note?: string
  /** Its settings after its heading, in the order its panel shows them. */
  own: readonly SettingField[]
  /** Whether Home holds one of it, or several. */
  repeat: 'once' | 'many'
  /** The settings Quackback AI may change, by key. */
  ai: readonly string[]
  /** Requests a person might make of it, each with the operations that make it. */
  examples: readonly BlockExample[]
  /** Other words a person or the AI may call it by. */
  aliases: readonly string[]
  /** Its settings in a few words, for its one-line summary; none says nothing more. */
  summary?: (block: Extract<HomeBlock, { type: T }>, names: SummaryNames) => string[]
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The title over a block, in place of its usual one; every Home block has it first. */
export const heading: SettingField = {
  kind: 'text',
  key: 'heading',
  label: 'Heading',
  max: 60,
  about: 'The title over the block, in place of its usual one; empty gives the usual one back',
}

/** A block's way on, in its own words, edited where it sits. */
export const linkField: SettingField = {
  kind: 'text',
  key: 'link',
  label: 'Link',
  max: 40,
  inPlace: true,
  aiUntold: true,
  about: 'The words of its link on, such as "See all posts", in place of its usual ones',
}

/** What a block of the workspace's data does with nothing to show, and its message then. */
export function emptyFields(usually: 'hide' | 'message', message: string): SettingField[] {
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
