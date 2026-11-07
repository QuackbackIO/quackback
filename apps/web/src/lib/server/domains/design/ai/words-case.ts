/**
 * The case a brand sets its words in, carried into the portal's style. The
 * writers write a brand that sets every word in lower case so; the style
 * carries it to the parts the words do not reach.
 */
import { plainWords } from '@/lib/shared/design/words-markup'
import type { BrandChange } from './brand-decide'
import type { WordsAnswer } from './words-family'

/** The parts a brand that writes in lower case sets so: headlines, headings, the menu and buttons. */
const LOWER_CASE_PARTS = ['headline', 'heading', 'navItem', 'button', 'secondary'] as const

/** Whether every headline written has letters and no capital: words a brand sets in lower case. */
export function inLowerCase(words: Pick<WordsAnswer, 'home_headline' | 'feedback_headline'>) {
  const lines = [words.home_headline, words.feedback_headline].map((l) => plainWords(l).trim())
  return lines.every((l) => /\p{L}/u.test(l) && l === l.toLocaleLowerCase())
}

/**
 * Lower case as the style's, not only the words': the writers write a brand
 * that sets its words in lower case so, which leaves its menu, buttons and
 * section headings in the portal's capitals. The case lives in the style, so
 * the words keep their punctuation and every other line follows.
 */
export function lowerCaseChanges(words: WordsAnswer): BrandChange[] {
  if (!inLowerCase(words)) return []
  const why = 'their headlines are written in lower case, so the type is set in it'
  return LOWER_CASE_PARTS.map((part) => ({ path: `style.${part}.base.case`, value: 'lower', why }))
}
