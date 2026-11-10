/**
 * The real brands the rig measures (its goal brands and its development and
 * sealed held-out sites), which no few-shot example may name: a portal would
 * take the example's words and choices for its own. Held as hashes of their
 * lower-case names, so the repo names none of them.
 */
import { createHash } from 'node:crypto'

/** SHA-256 of a word, lower-cased, cut to 16 hex digits. */
export const wordHash = (word: string) =>
  createHash('sha256').update(word.toLowerCase()).digest('hex').slice(0, 16)

/** The eighteen real brands the matcher is evaluated on. */
export const RIG_BRAND_HASHES: ReadonlySet<string> = new Set([
  '2bed2032ed3d8300',
  '877c3aec832cd410',
  '31f61ed3e6e210c5',
  'efc68bdfc744cb70',
  'c88af1b793063696',
  '0e79172671f59f0f',
  'ab7d0a36ecbe10c2',
  '4de4a07ad031569c',
  '75170593d559f227',
  'be6a999624b589e8',
  '5b79d0d574eedd09',
  'c0b0109d9439de57',
  '7f2fe580edb35154',
  'd56d16d88324bdc4',
  'a5c1835f2f1f4d4d',
  '8a72266588ef612e',
  '2b78da3dc866654e',
  '9d3508a8484ee252',
])

/** The whole words of a text whose hashes are in the set, lower-cased, in order, once each. */
export function wordsHashedIn(text: string, hashes: ReadonlySet<string>): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.filter((word) => hashes.has(wordHash(word))))]
}
