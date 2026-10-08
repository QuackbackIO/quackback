const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u
const JOINS_PREVIOUS = /^[\p{M}‍️\u{1F3FB}-\u{1F3FF}]$/u

/** Code-point approximation of grapheme clusters for runtimes without Intl.Segmenter. */
function splitCodePoints(text: string): string[] {
  const out: string[] = []
  let joined = false
  for (const cp of Array.from(text)) {
    const last = out.length - 1
    if (last >= 0 && (joined || JOINS_PREVIOUS.test(cp))) {
      out[last] += cp
      joined = cp === '‍'
    } else if (last >= 0 && REGIONAL_INDICATOR.test(cp) && out[last]!.length === 2) {
      const prev = Array.from(out[last]!)
      if (prev.length === 1 && REGIONAL_INDICATOR.test(prev[0]!)) out[last] += cp
      else out.push(cp)
    } else {
      out.push(cp)
    }
  }
  return out
}

function graphemes(text: string): string[] {
  if (!segmenter) return splitCodePoints(text)
  return Array.from(segmenter.segment(text), (s) => s.segment)
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
