/**
 * Composition and wording when a brand is matched from screenshots, as a
 * careful step of its own: first a voice read (the brand's greetings,
 * catchphrases, formality, humour, punctuation and vocabulary, from every
 * word the finder read, the top of the main screenshot and what the model
 * knows of the named brand), then a set of words from each writing angle,
 * in parallel. A words critic (words-pick.ts) chooses among them.
 */
import { ANSWER_RULES, DESIGNER_BRIEF, type FamilyCaller } from './brand-brief'
import {
  voiceLines,
  voiceSchema,
  WORDS_LIMITS,
  wordsEvidenceFrom,
  wordsEvidenceLines,
  wordsSchema,
  type VoiceAnswer,
  type WordsAnswer,
  type WordsEvidence,
} from './words-evidence'
import { WORDS_EXAMPLES, type WordsExample, type WritingAngle } from './words-examples'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { FinderOutput } from '../extract/finder-schema'
import { languageName } from './design-ai-view'

export {
  HOME_ARRANGEMENTS,
  wordsEvidenceLines,
  wordsSchema,
  type HomeArrangement,
  type VoiceAnswer,
  type WordsAnswer,
  type WordsEvidence,
} from './words-evidence'
export {
  WORDS_EXAMPLES,
  WRITING_ANGLES,
  type WordsExample,
  type WritingAngle,
} from './words-examples'

export const WORDS_VERSION = 'words-v12'

/**
 * What a portal is for, which every line must make plain sense as a welcome to: feedback first,
 * the brand showing it listens, and help second.
 */
export const PORTAL =
  'the place where their customers tell them what to improve or make next and vote on posts, where they show they are listening (what is coming, what changed), and where customers can also get help'

const VOICE_TASK = `You read the brand's voice, so its customer portal (${PORTAL}) can be written in it. The image is the top of their site; the words below are every word read on their screenshots.
name: the company's name as they write it in a sentence, with its own capitals (a logo set in capitals or in lower case is styling: write the name as their sentences do).
signatures: their signature greetings, catchphrases, pet names and phrasings, as they write them. From these words, and, for a company you know, from how it talks to customers everywhere (its apps, emails, shops and signs): a greeting in its home language, a name for its customers or its features, a phrase it is known for. Give the ones you know well even when these screenshots do not show them; leave out any you are unsure of. Not their headline or a sales slogan: those sell, they do not greet.
home_language: a language they use as flavour beside the site's own (a greeting, a word, names of things), as the company is known to, or "none". A site written wholly in a language is not this.
formality, humour, exclamations and emoji: as their words show them; emoji "never" unless they use emoji.
vocabulary: their words for what they do and what customers do with them (not slogans).
avoid: what would sound wrong from them.
known: how well you know this company's own voice beyond these screenshots. Use what you know only where you are sure, and never invent products, claims or offers.`

const voiceExampleBlock = (e: WordsExample) =>
  `Example (${e.brand}):\n${wordsEvidenceLines(e.evidence).join('\n')}\nAnswer: ${JSON.stringify(e.voice)}`

export function voicePrompt(ev: WordsEvidence): string {
  return [
    VOICE_TASK,
    ANSWER_RULES,
    WORDS_EXAMPLES.map(voiceExampleBlock).join('\n\n'),
    `Now this brand:\n${wordsEvidenceLines(ev).join('\n')}`,
  ].join('\n\n')
}

/** The voice read; throws when the call fails. */
export function readVoice(
  ev: WordsEvidence,
  call: FamilyCaller,
  crop: Uint8Array | null
): Promise<VoiceAnswer> {
  return call({
    family: 'voice',
    version: WORDS_VERSION,
    prompt: voicePrompt(ev),
    images: crop ? [{ mime: 'image/png', data: crop }] : [],
    schema: voiceSchema,
    maxTokens: 1500,
  })
}

const ANGLES: Record<WritingAngle, string> = {
  signature:
    'Your angle: their signature. Lead with it where they have one: their greeting or home-language word leading the headline, or the words of their catchphrase inside its question (or the button), the rest plain. Where they have none, their most characteristic words.',
  plain:
    'Your angle: plain and warm, and still theirs. The clearest lines, in their name, vocabulary and punctuation, no wordplay: a customer understands every line at once, and knows whose portal it is.',
  playful:
    'Your angle: playful, as far as they would go. Their humour and punctuation: an idiom that still says what it means, a friendly question, an exclamation mark if they use them, an emoji only if they use emoji, their greeting if they have one.',
}

const limit = (line: keyof typeof WORDS_LIMITS) => `under ${WORDS_LIMITS[line]} characters`

const OPTIONS = `Choose:
home_layout: portal (asking first, then contact, top posts beside updates, the roadmap and help), feedback_first (asking and the top posts lead), help_first (help search and topics lead, for a brand whose site is mostly support), roadmap_first (what is coming leads, for a brand that ships in public). Choose it from their site alone: the words below invite feedback first on every arrangement, so that is no reason to choose feedback_first.
Write in their voice: short, inviting and unmistakably theirs, never naming another company, never inventing products, claims or offers.
Home's headline and subtitle invite their customers to tell them what to improve or make next, about their product or service, in their voice; the subtitle may add getting help with it. Visitors write posts on a feedback board: say post, posts or feedback, never "idea" or "ideas". Never offer the product or service itself, as if the portal were their shop or app: for a courier whose site asks "What can we help you send today?", not "Hello, what can we help you send?" nor "Where would you like it to go?", but "Got feedback on your deliveries?" ("get help with your parcels" is fine; "what can we help you send" is not). A headline that is their slogan or a line about the product invites nothing; borrow their slogan's words inside the invitation instead (from a cycling shop whose site says "Ride further": "What would help you ride further?"), never their slogan or catchphrase with an invitation fitted round it ("Ride further, and tell us where next", "Ride further with your feedback", "Ride further. What should we build next?"); a slogan whose words make no plain sense in a question stays out ("Where should we wander next?" from a travel site that says "Wander freely" is odd: ask about what they do instead). A greeting of theirs may stand alone as the headline when the subtitle invites.
Two ways to fail, equally bad. Generic: a line with nothing of them in it, which any company could put on its portal word for word ("We value your feedback", "Tell us what to build next"); inviting feedback is the point, so say it in their words, not stock ones. Odd: a pun or twisted slogan that says something untrue or strange once read literally. Every line must make plain sense as a welcome to ${PORTAL} and sound like them: their name, their signature (a greeting, a catchphrase, a word in their home language), their vocabulary and punctuation, borrowed where they fit that meaning. For a bakery whose site says "Rise and shine": not "Your posts make us all rise" (odd), not "Help us improve our products" (generic), but "Rise and shine! What should we bake next?". Echo their own words and rhythm where they make sense as a welcome ("Build with us" from a site that says "Build with ..."), but never reuse their headline or slogan with words tacked on, nor put their button's words in a headline; never sell (prices, offers, claims about the product): customers come to the portal to be heard. No dates, numbers or deadlines, and no promises or claims about how they work ("we put you first", "shaped by our customers"). A metaphor must hold when read literally.
Greet the customer, never the brand: "Hej! What should we make next?", not "Hello, Acme team".
home_headline is the signature moment: it carries something only they would say (their greeting, their name, a signature word, their phrasing), in a line that still reads plainly as an invitation to post feedback, or as their greeting.
Write their name exactly as they write it, with its capitals.
A greeting or word in their home language is flavour inside the language you write in, not a switch: it stands alone with its own punctuation ("Hej!", "Ciao!"), never mixed into a sentence, and the rest stays in that language. Write in the case their sentences use, never all capitals (the portal sets capitals itself where the brand uses them). No dashes between clauses.
home_headline (${limit('home_headline')}) and home_subtitle (${limit('home_subtitle')}): Home's welcome. feedback_headline (${limit('feedback_headline')}) and feedback_subtitle (${limit('feedback_subtitle')}): the feedback page's. prompt (${limit('prompt')}): the box where people ask; it must fit a phone's input whole, so a few words or a short question, never a list of three, and it names something customers would ask them for, in their words ("A bean or a blend"), never only "a feature or a fix". submit (${limit('submit')}): its button, which sends the customer's post on, in their voice. It names the company's own people only by a word for them that their words above use (for a coffee roaster whose pages say "Meet the roasters": "Send to the roasters"); their words for their customers or their product name no one at the company. Where their words hold no such word, it names no one: a sending verb (send, post, share, pitch, suggest), theirs where they have one, or a verb of theirs that plainly means sending ("Post it", "Share it", "Pop it in the post"). Never "the team" (nor "the Acme team"), which any company could write, nor a word for their people they never use ("the builders"); never to their customers ("Send to the drivers" for a ride company), never an idiom that sends nothing ("Put it to work", "Take it on the road"), not just their name after "Send to" (nor "the" before their name), and never a bare "Submit".`

const exampleBlock = (e: WordsExample, angle: WritingAngle) =>
  `Example (${e.brand}):\n${[...wordsEvidenceLines(e.evidence), ...voiceLines(e.voice)].join('\n')}\nAnswer: ${JSON.stringify(e.answers[angle])}`

export function wordsPrompt(
  ev: WordsEvidence,
  voice: VoiceAnswer | null = null,
  angle: WritingAngle = 'plain'
): string {
  const brand = [...wordsEvidenceLines(ev), ...(voice ? voiceLines(voice) : [])]
  return [
    DESIGNER_BRIEF,
    'You decide Home’s arrangement and the portal’s words only.',
    OPTIONS,
    ANGLES[angle],
    ANSWER_RULES,
    WORDS_EXAMPLES.map((e) => exampleBlock(e, angle)).join('\n\n'),
    `Now this brand:\n${brand.join('\n')}`,
  ].join('\n\n')
}

/** One writer's set of words, from its angle; throws when the call fails. */
export function writeCandidate(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  angle: WritingAngle,
  call: FamilyCaller
): Promise<WordsAnswer> {
  return call({
    family: 'words',
    version: WORDS_VERSION,
    prompt: wordsPrompt(ev, voice, angle),
    images: [],
    schema: wordsSchema,
    // Haiku's reasoning counts towards the limit; a low one cuts the answer mid-JSON.
    maxTokens: 2000,
  })
}

/** The portal's pages, as the words family is told them. */
export function pagesOf(gates: PortalPageGates): string[] {
  return (Object.keys(gates) as Array<keyof PortalPageGates>).filter((page) => gates[page])
}

/** The words evidence for a match: every screenshot's words as read, the main one first. */
export function wordsEvidenceOf(
  input: { name: string | null; allows: { gates: PortalPageGates }; locale?: string },
  shots: ReadonlyArray<{ found: { output: FinderOutput } }>
): WordsEvidence {
  const [main, ...others] = shots.map((shot) => shot.found.output)
  return wordsEvidenceFrom({
    name: input.name,
    main: main!,
    others,
    pages: pagesOf(input.allows.gates),
    language: input.locale && input.locale !== 'en' ? languageName(input.locale) : null,
  })
}
