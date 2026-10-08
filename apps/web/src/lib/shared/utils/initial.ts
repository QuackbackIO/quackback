const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** Grapheme clusters, or whole code points where the runtime has no Intl.Segmenter. */
function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

const WORD_OR_EMOJI = /^(?:[\p{L}\p{N}]|\p{Extended_Pictographic}|\p{Regional_Indicator})/u

/**
 * The first character a person would call the initial of a name, for avatar tiles.
 *
 * Returns a whole grapheme, so an emoji, a flag or a letter with a combining mark never
 * splits in half. Leading punctuation is skipped ("!!Acme" gives "A"); a name with no
 * letter, number or emoji gives its first visible character, and an empty one gives ''.
 * Letters are uppercased.
 */
export function nameInitial(name: string | null | undefined): string {
  if (!name) return ''
  const parts = graphemes(name).filter((g) => g.trim() !== '')
  const pick = parts.find((g) => WORD_OR_EMOJI.test(g)) ?? parts[0]
  return pick ? pick.toUpperCase() : ''
}
