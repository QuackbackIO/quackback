/**
 * The portal is a feedback board: visitors write posts, never "ideas". The
 * words model is told so, and this is the check behind the telling: English
 * words it still writes with "idea" or "ideas" are set as post or posts.
 * Other languages are left as written.
 */
import { WORD_LINES, type WordsAnswer } from './words-evidence'

/** The word as it was written, in the same case: idea, Idea or IDEA. */
const likeIt = (written: string, word: string) =>
  written === written.toUpperCase() && written.length > 1
    ? word.toUpperCase()
    : written[0] === written[0]!.toUpperCase()
      ? word[0]!.toUpperCase() + word.slice(1)
      : word

const IDEA = /\b(an\s+)?(idea)(s?)\b/giu

/** "Got an idea", "Have an idea", "Any ideas": asking for one, which reads best as feedback. */
const ASKING = /\b(got|have|had|any)(\s+)(?:an?\s+)?(?:(?:good|great|bright|big)\s+)?ideas?\b/giu

/** "A feature, a fix or an idea?": the last of a list of kinds, which reads best as anything else. */
const OR_IDEA = /\b(or)(\s+)(?:an?\s+)?idea\b/giu

/** "Post ideas", "a post idea": the word post already says it, so it reads as posts. */
const POST_IDEA = /\b(post)\s+(idea)(s?)\b/giu

/** "Post an idea", "Post your ideas": post as a verb, which reads best as writing or sharing posts. */
const POST_AN_IDEA = /\b(post)\s+an?\s+idea\b/giu
const POST_YOUR_IDEAS = /\b(post)(\s+your\s+)(?=ideas?\b)/giu

/** "Good idea?", "Great ideas?": praise asked as a question, which reads best as asking for feedback. */
const GOOD_IDEA = /(?<=^|[.!?]\s+)(?:good|great|bright|big)\s+ideas?\?/giu

/** Whether the words are English: no language read, or an English one. */
export const isEnglish = (language?: string | null) => !language || /^en(-|_|$)/i.test(language)

/**
 * English words with "idea" and "ideas" written as "post" and "posts" ("an
 * idea" as "a post"), and asking for one ("Got an idea?") as "Got feedback?".
 */
export function postsWording(text: string, language?: string | null): string {
  if (!isEnglish(language)) return text
  const asked = text
    .replace(GOOD_IDEA, (whole: string) => likeIt(whole, 'have feedback?'))
    .replace(POST_AN_IDEA, (_whole, post: string) => `${likeIt(post, 'write')} a post`)
    .replace(
      POST_YOUR_IDEAS,
      (_whole, post: string, gap: string) => `${likeIt(post, 'share')}${gap}`
    )
    .replace(
      POST_IDEA,
      (_whole, post: string, _idea: string, plural: string) => likeIt(post, 'post') + plural
    )
    .replace(ASKING, (_whole, verb: string, gap: string) => `${verb}${gap}feedback`)
    .replace(OR_IDEA, (_whole, or: string, gap: string) => `${or}${gap}something else`)
  return asked.replace(
    IDEA,
    (_whole, article: string | undefined, idea: string, plural: string) => {
      const post = likeIt(idea, 'post') + plural
      if (!article) return post
      const a = article.trimEnd()
      return `${likeIt(a, 'a')}${article.slice(a.length)}${post}`
    }
  )
}

/** The words with every line visitors read set as posts, for English. */
export function postsInWords(words: WordsAnswer, language?: string | null): WordsAnswer {
  if (!isEnglish(language)) return words
  const out = { ...words }
  for (const field of WORD_LINES) out[field] = postsWording(words[field], language)
  return out
}

/** The visitor-facing words of a starting look: English from the model, so set as posts. */
const LOOK_LINES = [
  'headline',
  'subtitle',
  'prompt',
  'submit',
  'homeHeadline',
  'homeSubtitle',
  'accentPhrase',
] as const

/** A starting look with its words set as posts, the way a words answer's are. */
export function postsInLook<
  T extends Record<(typeof LOOK_LINES)[number], string> & { pageWords: string[] },
>(look: T): T {
  const out = { ...look, pageWords: look.pageWords.map((words) => postsWording(words)) }
  for (const field of LOOK_LINES) out[field] = postsWording(look[field]) as T[typeof field]
  return out
}
