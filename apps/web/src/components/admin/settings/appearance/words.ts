import type { PortalDesign } from '@/lib/shared/design/schema'
import { PORTAL_WORD_PLURALS } from '@/lib/shared/design/view'

export type PostWord = PortalDesign['vocabulary']['post']
export type BoardWord = PortalDesign['vocabulary']['board']

/** Each word as Appearance names it, with the sentence its tile shows. */
export const POST_WORDS: Record<PostWord, { label: string; sample: string }> = {
  idea: { label: 'Idea', sample: "What's your idea?" },
  post: { label: 'Post', sample: "What's on your mind?" },
  feature_request: { label: 'Feature request', sample: 'What should we build?' },
  suggestion: { label: 'Suggestion', sample: "What's your suggestion?" },
}

export const BOARD_WORDS: Record<BoardWord, { label: string; sample: string }> = {
  board: { label: 'Board', sample: 'All boards' },
  category: { label: 'Category', sample: 'All categories' },
}

/** Each word's English noun, singular and plural. */
const NOUNS: Record<PostWord | BoardWord, [string, string]> = {
  idea: ['idea', PORTAL_WORD_PLURALS.idea],
  post: ['post', PORTAL_WORD_PLURALS.post],
  feature_request: ['feature request', PORTAL_WORD_PLURALS.feature_request],
  suggestion: ['suggestion', PORTAL_WORD_PLURALS.suggestion],
  board: ['board', PORTAL_WORD_PLURALS.board],
  category: ['category', PORTAL_WORD_PLURALS.category],
}

/** The plural noun for a word, as menu labels and block names use it. */
export const pluralOf = (word: PostWord | BoardWord) => NOUNS[word][1]

/** Text with a word's noun replaced by another's, keeping its capitals and fixing a or an before it. */
function reword(text: string, from: PostWord | BoardWord, to: PostWord | BoardWord): string {
  const [fromOne, fromMany] = NOUNS[from]
  const [toOne, toMany] = NOUNS[to]
  const capital = (word: string, like: string) =>
    like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word
  return text.replace(
    new RegExp(`\\b(?:(an?)\\s+)?(${fromMany}|${fromOne})\\b`, 'gi'),
    (_found, article: string | undefined, noun: string) => {
      const many = noun.toLowerCase() === fromMany
      const next = capital(many ? toMany : toOne, noun)
      if (!article) return next
      const an = /^[aeiou]/i.test(next) ? 'an' : 'a'
      return `${capital(an, article)} ${next}`
    }
  )
}

/** A place in the draft that still names the old word, with its text either way. */
export interface WordUse {
  where: string
  before: string
  after: string
  apply: (draft: PortalDesign) => void
}

/**
 * The menu labels and headlines that still name `from`, with each one's text
 * in `to`. Their own text stays theirs until the person accepts.
 */
export function oldWordUses(
  design: PortalDesign,
  from: PostWord | BoardWord,
  to: PostWord | BoardWord
): WordUse[] {
  if (from === to) return []
  const uses: WordUse[] = []
  const check = (
    where: string,
    text: string | undefined,
    apply: (next: string) => (draft: PortalDesign) => void
  ) => {
    if (!text) return
    const after = reword(text, from, to)
    if (after !== text) uses.push({ where, before: text, after, apply: apply(after) })
  }
  design.nav.items.forEach((item, index) =>
    check('Menu', item.label, (next) => (draft) => void (draft.nav.items[index]!.label = next))
  )
  for (const page of ['feedback', 'home'] as const) {
    const headline = design.pages[page].headline
    for (const field of ['title', 'subtitle'] as const) {
      for (const [locale, text] of Object.entries(headline?.[field] ?? {})) {
        if (locale !== 'en') continue
        check(page === 'home' ? 'Home headline' : 'Headline', text, (next) => (draft) => {
          const target = draft.pages[page].headline
          if (target) target[field][locale] = next
        })
      }
    }
  }
  return uses
}
