/**
 * The brand match's few-shot examples: drawn only from the fictional goal
 * designs and invented brands, never a brand the matcher is evaluated on
 * (whose portal would then take the example's words and choices), and
 * written in the very words the prompt uses for a real brand's evidence.
 */
import { describe, expect, it } from 'vitest'
import { FINDER_EXAMPLES, finderPrompt } from '../../extract/finder-prompt'
import { ROLES_EXAMPLES, rolesPrompt } from '../../extract/roles-classifier'
import { SOURCE_WORDS, type ColourEvidence, type ColourRoles } from '../../extract/roles'
import { HERO_EXAMPLES, heroEvidenceLines, heroPrompt, type HeroEvidence } from '../hero-family'
import { WORDS_EXAMPLES, wordsEvidenceLines, wordsPrompt } from '../words-family'
import { DESIGNER_BRIEF } from '../brand-brief'
import { CRITIC_EXAMPLES, criticPrompt } from '../brand-critic'
import { REVISE_EXAMPLES, revisePrompt } from '../brand-revise'
import { RIG_BRAND_HASHES, wordHash, wordsHashedIn } from './rig-brands'

/** Their signature colours, which name a brand as plainly as its name. */
const EVALUATED_COLOURS = [
  '#533afd',
  '#0058a3',
  '#ffdb00',
  '#9fe870',
  '#163300',
  '#ff4f40',
  '#112231',
  '#4a154b',
]

/** The goal brands, the development and sealed held-out sites and the excluded one (hashed), and their colours. */
function named(text: string, brands: ReadonlySet<string> = RIG_BRAND_HASHES): string[] {
  const lower = text.toLowerCase()
  return [
    ...wordsHashedIn(lower, brands),
    ...EVALUATED_COLOURS.filter((hex) => lower.includes(hex)),
  ]
}

const HERO_EVIDENCE: HeroEvidence = HERO_EXAMPLES[0]!.evidence
const COLOURS = {
  candidates: [],
  shots: [],
  ink: '#111111',
  page: '#ffffff',
} as unknown as ColourEvidence
const ROLES = { monochrome: false } as unknown as ColourRoles

describe('few-shot examples', () => {
  it('name no brand the matcher is evaluated on, nor its colours', () => {
    const sets = {
      words: WORDS_EXAMPLES,
      hero: HERO_EXAMPLES,
      roles: ROLES_EXAMPLES,
      finder: FINDER_EXAMPLES,
      critic: CRITIC_EXAMPLES,
      revise: REVISE_EXAMPLES,
    }
    for (const [family, examples] of Object.entries(sets))
      expect(named(JSON.stringify(examples)), family).toEqual([])
  })

  it('leave them out of every family’s whole prompt too', () => {
    const prompts = {
      brief: DESIGNER_BRIEF,
      words: wordsPrompt(WORDS_EXAMPLES[0]!.evidence),
      hero: heroPrompt(HERO_EVIDENCE, true),
      roles: rolesPrompt(COLOURS, ROLES, true),
      finder: finderPrompt(1440, 900),
      critic: criticPrompt({ shots: 1, picture: true, drawn: {}, brand: null }),
      revise: revisePrompt({ critic: null, gaps: [], fields: [], palette: [] }),
    }
    for (const [family, prompt] of Object.entries(prompts))
      expect(named(prompt), family).toEqual([])
  })

  it('finds an evaluated brand when one is named, so the check can fail', () => {
    // A stand-in brand hashed as the evaluated ones are, so the check is seen to match a whole word.
    const acme = new Set([wordHash('acme')])
    expect(named('Example (ACME): blue #0058A3', acme)).toEqual(['acme', '#0058a3'])
    expect(named('acmeish, the acmes, preacme', acme)).toEqual([])
    // Every evaluated brand's colour is found on its own, and words that merely contain a brand's name are not brands.
    expect(named('blue #0058A3')).toEqual(['#0058a3'])
    expect(named('likewise, otherwise linearly notional')).toEqual([])
  })

  it('show the hero and words evidence as the prompt shows any brand’s', () => {
    const hero = heroPrompt(HERO_EVIDENCE, true)
    for (const e of HERO_EXAMPLES)
      for (const line of heroEvidenceLines(e.evidence)) expect(hero).toContain(line)
    const words = wordsPrompt(WORDS_EXAMPLES[0]!.evidence)
    for (const e of WORDS_EXAMPLES)
      for (const line of wordsEvidenceLines(e.evidence)) expect(words).toContain(line)
  })

  it('describe each colour candidate in the words the prompt uses for where it was seen', () => {
    const places = new Set(Object.values(SOURCE_WORDS))
    for (const e of ROLES_EXAMPLES)
      for (const line of e.evidence.filter((l) => /^c\d+ /.test(l))) {
        const m = /^c\d+ #[0-9a-f]{6} \((.+); covers \d+\.\d% of the interface\)$/.exec(line)
        expect(m, line).not.toBeNull()
        for (const place of m![1]!.split('; '))
          expect(
            places.has(place) || /^in the logo, \d+% of its ink$/.test(place),
            `${e.brand}: ${place}`
          ).toBe(true)
      }
  })
})
