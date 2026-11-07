/**
 * The words markup as text written elsewhere than the AI's operations reads
 * it: a brand match's headlines and subtitles. A headline written with a
 * phrase marked keeps the phrase as its accent; markup it cannot keep, and
 * any on plain words, is left as the words alone.
 */
import { readHeadlineMarkup, unmarked, type HeadlineWords } from './rich-words'

/** Words with any phrase marks taken off, on one line. */
export const plainWords = unmarked

/** A headline from its markup, or its words alone where the markup cannot be kept. */
export function headlineWordsFrom(text: string): HeadlineWords {
  const read = readHeadlineMarkup(text)
  return read.ok ? read.words : { title: plainWords(text), accent: null }
}
