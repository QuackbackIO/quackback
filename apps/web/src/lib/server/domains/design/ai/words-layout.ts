/**
 * Home's arrangement, decided apart from the words: three readings of the
 * site, one from each writing angle, in the words-v9 writers' own context
 * (frozen here), and the arrangement they all agree on, else the usual one.
 * The words step's later rules (feedback first in every line) are no reason
 * to move Home about, so they never reach this call.
 */
import { z } from 'zod'
import { ANSWER_RULES, DESIGNER_BRIEF, type FamilyCaller } from './brand-brief'
import {
  HOME_ARRANGEMENTS,
  voiceLines,
  wordsEvidenceLines,
  type HomeArrangement,
  type VoiceAnswer,
  type WordsEvidence,
} from './words-evidence'
import type { WritingAngle } from './words-examples'

/**
 * The words-v9 writers' prompt, frozen, as each of them chose Home's arrangement in it. Never
 * edit it: a test holds it to v9's text byte for byte, and a change would move Home about.
 */
export const LAYOUT_CONTEXT_V9 = {
  intro: `You decide Home’s arrangement and the portal’s words only.`,
  options: `Choose:
home_layout: portal (asking first, then contact, ideas beside updates, the roadmap and help), feedback_first (asking and the top ideas lead), help_first (help search and topics lead, for a brand whose site is mostly support), roadmap_first (what is coming leads, for a brand that ships in public).
Write in their voice: short, inviting and unmistakably theirs, never naming another company, never inventing products, claims or offers.
Two ways to fail, equally bad. Generic: a line any company could put on its portal ("We value your feedback", "Tell us what to build next", "Help us improve") says nothing of them. Odd: a pun or twisted slogan that says something untrue or strange once read literally. Every line must make plain sense as a welcome to a place where customers suggest ideas, vote, see what is coming and get help and sound like them: their name, their signature (a greeting, a catchphrase, a word in their home language), their vocabulary and punctuation, borrowed where they fit that meaning. For a bakery whose site says "Rise and shine": not "Your ideas make us all rise" (odd), not "Help us improve our products" (generic), but "Rise and shine! What should we bake next?". Echo their own words and rhythm where they make sense as a welcome ("Build with us" from a site that says "Build with ..."), but never reuse their headline or slogan with words tacked on, nor put their button's words in a headline; never sell (prices, offers, claims about the product): customers come to the portal to be heard. No dates, numbers or deadlines, and no promises or claims about how they work ("we put you first", "shaped by our customers"). A metaphor must hold when read literally.
Greet the customer, never the brand: "Hej! What should we make next?", not "Hello, Acme team".
home_headline is the signature moment: it carries something only they would say (their greeting, their name, a signature word, their phrasing), in a line that still reads plainly.
Write their name exactly as they write it, with its capitals.
A greeting or word in their home language is flavour inside the language you write in, not a switch: it stands alone with its own punctuation ("Hej!", "Ciao!"), never mixed into a sentence, and the rest stays in that language. Write in the case their sentences use, never all capitals (the portal sets capitals itself where the brand uses them). No dashes between clauses.
home_headline (under 60 characters) and home_subtitle (under 120 characters): Home's welcome. feedback_headline (under 60 characters) and feedback_subtitle (under 120 characters): the feedback page's. prompt (under 32 characters): the box where people ask; it must fit a phone's input whole, so a few words or a short question, never a list of three, and it names something customers would ask them for, in their words ("A bean or a blend"), never only "a feature or a fix". submit (under 24 characters): its button, in their voice too: a verb of theirs or their word for the people who read it ("Send to the roasters", "Post it", "Send it over"), not just their name after "Send to", which any company could write with its own, and never a bare "Submit".`,
  angles: {
    signature: `Your angle: their signature. Lead with it where they have one: their greeting, catchphrase or home-language word in the headline (or the button), the rest plain. Where they have none, their most characteristic words.`,
    plain: `Your angle: plain and warm, and still theirs. The clearest lines, in their name, vocabulary and punctuation, no wordplay: a customer understands every line at once, and knows whose portal it is.`,
    playful: `Your angle: playful, as far as they would go. Their humour and punctuation: an idiom that still says what it means, a friendly question, an exclamation mark if they use them, an emoji only if they use emoji, their greeting if they have one.`,
  },
} as const satisfies { intro: string; options: string; angles: Record<WritingAngle, string> }

/** The frozen context's own version, so the arrangement's answers keep their cache keys. */
export const LAYOUT_VERSION = 'layout-v9-frozen-1'

export const layoutSchema = z.object({
  evidence: z.string().describe('one short sentence on what their site leads with'),
  home_layout: z.enum(HOME_ARRANGEMENTS),
})
export type LayoutAnswer = z.infer<typeof layoutSchema>

/** One angle's reading of Home's arrangement, in the frozen v9 context. */
export function layoutPrompt(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  angle: WritingAngle
): string {
  const brand = [...wordsEvidenceLines(ev), ...(voice ? voiceLines(voice) : [])]
  return [
    DESIGNER_BRIEF,
    LAYOUT_CONTEXT_V9.intro,
    LAYOUT_CONTEXT_V9.options,
    LAYOUT_CONTEXT_V9.angles[angle],
    ANSWER_RULES,
    `Now this brand:\n${brand.join('\n')}`,
  ].join('\n\n')
}

/** One angle's arrangement; throws when the call fails. */
export function chooseLayout(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  angle: WritingAngle,
  call: FamilyCaller
): Promise<LayoutAnswer> {
  return call({
    family: 'layout',
    version: LAYOUT_VERSION,
    prompt: layoutPrompt(ev, voice, angle),
    images: [],
    schema: layoutSchema,
    maxTokens: 600,
  })
}

/**
 * v9's rule: the arrangement every reading chose, when at least two answered, else the usual
 * one. Home is never moved on a split.
 */
export function agreedLayoutOf(answers: ReadonlyArray<LayoutAnswer | null>): HomeArrangement {
  const [first, ...rest] = answers.filter((a): a is LayoutAnswer => !!a).map((a) => a.home_layout)
  return rest.length && rest.every((layout) => layout === first) ? first! : 'portal'
}
