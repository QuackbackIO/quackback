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
    case 'boards':
      return { heading: say(homeMessages.boardsTitle), link: say(homeMessages.ideasAll) }
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
  boards: ['block', 'heading', 'body', 'link'],
}

export const elementsOf = (type: HomeBlockType): readonly BlockStyleElement[] => ELEMENTS[type]

/** The elements each page section a visitor knows as a block draws. */
export const SECTION_ELEMENTS: Record<SectionType, readonly StyleElement[]> = {
  'changelog.entries': ['panel', 'heading', 'body', 'link', 'chip'],
  'help.topics': ['panel', 'heading', 'body'],
  'help.popular': ['panel', 'link'],
  'help.search': ['input'],
  'help.article': ['panel', 'link'],
  'roadmap.board': ['postCard', 'vote', 'badge'],
  'post.vote': ['vote'],
  'post.details': ['panel', 'badge', 'chip'],
  'post.comments': ['panel', 'body'],
  'support.request': ['button'],
}

export {
  LOOK_DEFAULTS,
  LOOK_PROPS,
  lookOutliers,
  matchLook,
  resetLook,
  sharedLook,
  takesLook,
  writeLook,
  type LookProp,
  type LookScope,
} from '@/lib/shared/design/block-look'
