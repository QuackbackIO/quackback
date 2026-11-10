/**
 * The Home blocks as the portal needs them, and nothing more: each block's
 * type, its size on Home's twelve-column grid, the page it needs, what a new
 * one holds, and the counts it offers. The list of block types, their sizes
 * and the pages they need are derived from here (options.ts, home.ts), and the
 * design's schema and the block registry read their counts from here.
 *
 * Visitors load this, so a block's view module holds plain values only: no
 * zod, no panel rows, no AI examples. Those are in its `.schema.ts` and
 * `.def.ts` modules (see index.ts).
 */
import type { PortalPageGates } from '../paths'
import { boards } from './boards'
import { composer } from './composer'
import { contact } from './contact'
import { helpSearch } from './help-search'
import { helpTopics } from './help-topics'
import { ideas } from './ideas'
import { links } from './links'
import { roadmap } from './roadmap'
import { status } from './status'
import { updates } from './updates'
import { welcome } from './welcome'

/** What a Home block's view module declares. */
export interface HomeBlockView {
  type: string
  /** The columns and rows a new one takes, of twelve columns. */
  size: readonly [w: number, h: number]
  /** The least it can be made. */
  min: readonly [w: number, h: number]
  /** The page whose data it shows; while that page is off, it is not drawn. Null needs none. */
  page: keyof PortalPageGates | null
  /** What a new one holds besides its type, id and place. */
  made: Readonly<Record<string, unknown>>
  /** The counts each of its count settings offers, by setting. */
  counts?: Readonly<Record<string, readonly number[]>>
}

/** Every Home block, in the order the design's options list them. */
export const HOME_BLOCK_VIEWS = [
  welcome,
  composer,
  ideas,
  roadmap,
  updates,
  helpSearch,
  helpTopics,
  status,
  contact,
  links,
  boards,
] as const

type TypesOf<T extends readonly HomeBlockView[]> = { readonly [K in keyof T]: T[K]['type'] }

/** The Home block types, in the same order. */
export const HOME_BLOCK_TYPES = HOME_BLOCK_VIEWS.map((view) => view.type) as unknown as TypesOf<
  typeof HOME_BLOCK_VIEWS
>
