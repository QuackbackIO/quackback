/**
 * What a Home block's panel reads and writes, apart from how it draws it:
 * the words the page draws when the block has none of its own, the widths it
 * can take, the elements it draws, and its look (background, colour and
 * alignment), which is shared by every Home block unless one is set apart.
 *
 * A Home block's look has no site-wide value of its own: the shared value is
 * what the other blocks hold, and a shared change writes every block that
 * takes a look.
 */
import { homeMessages } from '@/components/public/home/home-messages'
import type { HomeBlock, HomeBlockType } from '@/lib/shared/design/home'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { SectionType } from '@/lib/shared/design/blocks'
import type { BlockStyleElement, StyleElement } from '@/lib/shared/design/style-tokens'

/** The words a block draws while it has none of its own, in English; null where it draws none. */
export interface UsualWords {
  heading: string | null
  link: string | null
}

const say = (message: { defaultMessage: string }) => message.defaultMessage

/**
 * The heading and way on the page draws for a block that sets none, as the
 * portal's own messages say them: Top posts follows its sort, and a roadmap
 * is named for the roadmap it shows.
 */
export function usualWords(block: HomeBlock, names: { roadmap?: string } = {}): UsualWords {
  switch (block.type) {
    case 'ideas':
      return {
        heading: say(
          block.sort === 'trending'
            ? homeMessages.ideasTitleTrending
            : block.sort === 'new'
              ? homeMessages.ideasTitleNew
              : homeMessages.ideasTitle
        ),
        link: say(homeMessages.ideasAll),
      }
    case 'roadmap':
      return {
        heading: names.roadmap ?? say(homeMessages.roadmapTitle),
        link: say(homeMessages.roadmapAll),
      }
    case 'updates':
      return { heading: say(homeMessages.updatesTitle), link: say(homeMessages.updatesAll) }
    case 'help_search':
      return { heading: say(homeMessages.helpSearchTitle), link: say(homeMessages.helpAll) }
    case 'help_topics':
      return { heading: say(homeMessages.helpTopicsTitle), link: say(homeMessages.helpAll) }
    case 'status':
      return { heading: say(homeMessages.statusTitle), link: say(homeMessages.statusAll) }
    case 'contact':
      return { heading: say(homeMessages.contactTitle), link: say(homeMessages.contactStart) }
    case 'links':
      return { heading: block.title ?? say(homeMessages.linksTitle), link: null }
    case 'welcome':
    case 'composer':
      return { heading: null, link: null }
  }
}

/** What Contact says under its heading while it has no words of its own. */
export const CONTACT_USUAL = say(homeMessages.contactBody)

/** A third, a half, two thirds and the whole width, in Home's twelve columns. */
const WIDTHS = [
  [4, '⅓'],
  [6, '½'],
  [8, '⅔'],
  [12, 'Full'],
] as const

/** The width tiles a block can take: none narrower than its least width. */
export function widthTiles(minW: number): Array<readonly [string, string]> {
  return WIDTHS.filter(([w]) => w >= minW).map(([w, name]) => [String(w), name] as const)
}

/** The elements each Home block draws, so its Look offers only those. */
const ELEMENTS: Record<HomeBlockType, readonly BlockStyleElement[]> = {
  welcome: ['block', 'heading', 'body', 'link'],
  composer: ['input', 'button'],
  ideas: ['block', 'heading', 'postCard', 'vote', 'badge', 'body', 'link'],
  roadmap: ['block', 'heading', 'postCard', 'vote', 'link'],
  updates: ['block', 'heading', 'panel', 'body', 'link'],
  help_search: ['block', 'heading', 'input', 'link'],
  help_topics: ['block', 'heading', 'panel', 'body', 'link'],
  status: ['block', 'heading', 'badge', 'link'],
  contact: ['block', 'heading', 'body', 'link'],
  links: ['block', 'heading', 'link'],
}

export const elementsOf = (type: HomeBlockType): readonly BlockStyleElement[] => ELEMENTS[type]

/** The elements each page section a visitor knows as a block draws. */
export const SECTION_ELEMENTS: Record<SectionType, readonly StyleElement[]> = {
  'changelog.entries': ['panel', 'heading', 'body', 'link', 'chip'],
  'help.topics': ['panel', 'heading', 'body'],
  'help.popular': ['panel', 'link'],
  'help.search': ['input'],
  'roadmap.board': ['postCard', 'vote', 'badge'],
  'post.vote': ['vote'],
  'post.details': ['panel', 'badge', 'chip'],
  'post.comments': ['panel', 'body'],
}

/** A block's own look fields, other than its element looks. */
export type LookProp = 'tone' | 'align' | 'colour'
export const LOOK_PROPS: readonly LookProp[] = ['tone', 'align', 'colour']
type LookValue<P extends LookProp> = NonNullable<NonNullable<HomeBlock['look']>[P]>

/** What a block draws with while its look leaves a field out. */
export const LOOK_DEFAULTS: { [P in LookProp]: LookValue<P> } = {
  tone: 'card',
  align: 'start',
  colour: 'accent',
}

/** Where a look change goes: every Home block, or just this one. */
export type LookScope = 'every' | 'one'

/** Whether a block takes a look: the composer is a card of its own. */
export const takesLook = (block: HomeBlock) => block.type !== 'composer'

const lookBlocks = (design: PortalDesign) => design.pages.home.blocks.filter(takesLook)

function setField(block: HomeBlock, prop: LookProp, value: string | undefined) {
  const look = { ...block.look } as Record<string, unknown>
  if (value === undefined) delete look[prop]
  else look[prop] = value
  if (Object.keys(look).length) block.look = look as HomeBlock['look']
  else delete block.look
}

/** Writes a look field on this block, or on every Home block that takes a look; undefined clears it. */
export function writeLook(
  draft: PortalDesign,
  scope: LookScope,
  id: string,
  prop: LookProp,
  value: string | undefined
): void {
  const targets =
    scope === 'every' ? lookBlocks(draft) : draft.pages.home.blocks.filter((b) => b.id === id)
  for (const block of targets) setField(block, prop, value)
}

/**
 * The value most of the other Home blocks hold, which a block set apart goes
 * back to; undefined when most hold none, or there are no others.
 */
export function sharedLook(design: PortalDesign, id: string, prop: LookProp): string | undefined {
  const tally = new Map<string | undefined, number>()
  for (const block of lookBlocks(design)) {
    if (block.id === id) continue
    const value = block.look?.[prop]
    tally.set(value, (tally.get(value) ?? 0) + 1)
  }
  let best: string | undefined
  let most = 0
  for (const [value, n] of tally)
    if (n > most) {
      best = value
      most = n
    }
  return best
}

/**
 * Resets a look field: just this one goes back to the shared value, and
 * every Home block back to its usual one.
 */
export function resetLook(draft: PortalDesign, scope: LookScope, id: string, prop: LookProp) {
  writeLook(draft, scope, id, prop, scope === 'one' ? sharedLook(draft, id, prop) : undefined)
}

const drawn = (block: HomeBlock, prop: LookProp) => block.look?.[prop] ?? LOOK_DEFAULTS[prop]

/** The other Home blocks whose look differs from this one's, with the fields that differ. */
export function lookOutliers(
  design: PortalDesign,
  id: string
): Array<{ id: string; props: LookProp[] }> {
  const self = design.pages.home.blocks.find((b) => b.id === id)
  if (!self) return []
  return lookBlocks(design).flatMap((block) => {
    if (block.id === id || !block.id) return []
    const props = LOOK_PROPS.filter((prop) => drawn(block, prop) !== drawn(self, prop))
    return props.length ? [{ id: block.id, props }] : []
  })
}

/** Gives another block this block's look fields, keeping its element looks. */
export function matchLook(draft: PortalDesign, targetId: string, fromId: string): void {
  const from = draft.pages.home.blocks.find((b) => b.id === fromId)
  const target = draft.pages.home.blocks.find((b) => b.id === targetId)
  if (!from || !target) return
  for (const prop of LOOK_PROPS) setField(target, prop, from.look?.[prop])
}
