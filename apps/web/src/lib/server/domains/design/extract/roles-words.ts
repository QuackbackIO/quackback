/**
 * Colour candidates in words: where each was seen, for replies and the
 * classifier's prompt.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { SOURCE_WORDS, type Candidate } from './roles-evidence'

export const describeCandidate = (c: Candidate) => {
  const places = [
    ...new Set(
      c.sightings.map((s) =>
        s.source === 'logo' && s.share < 0.95
          ? `${SOURCE_WORDS.logo}, ${Math.round(s.share * 100)}% of its ink`
          : SOURCE_WORDS[s.source]
      )
    ),
  ]
  return `${c.hex} (${places.join('; ')}; covers ${(c.coverage * 100).toFixed(1)}% of the interface)`
}

/** The places a candidate was seen, in words. */
export function placesOf(c: Candidate): string {
  return [...new Set(c.sightings.map((s) => SOURCE_WORDS[s.source]))].join(', ')
}
