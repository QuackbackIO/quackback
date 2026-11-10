/**
 * What the portal's words are written from and held to, with no model call:
 * the site's words as the finder read them on every screenshot, the voice
 * read from them, the answer's shape, and the lints a set of words must pass
 * (lengths, the site's sales lines copied, a dash, capitals, emoji where the
 * brand uses none).
 */
import { z } from 'zod'
import { plainWords } from '@/lib/shared/design/words-markup'
import type { FinderOutput } from '../extract/finder-schema'
import { STRANGER_BUTTON, sentToStrangers } from './words-button'

export { BUTTON_RULE, unclearButton } from './words-button'

/** Home arrangements, by what they lead with. */
export const HOME_ARRANGEMENTS = [
  'portal',
  'feedback_first',
  'help_first',
  'roadmap_first',
] as const
export type HomeArrangement = (typeof HOME_ARRANGEMENTS)[number]

/** The lines written, and the longest each may be (in characters, marks taken off). */
export const WORDS_LIMITS = {
  home_headline: 60,
  home_subtitle: 120,
  feedback_headline: 60,
  feedback_subtitle: 120,
  // The composer's prompt fits a phone's input (about 34 characters) whole.
  prompt: 32,
  submit: 24,
} as const
export type WordLine = keyof typeof WORDS_LIMITS
export const WORD_LINES = Object.keys(WORDS_LIMITS) as WordLine[]

export const wordsSchema = z.object({
  evidence: z
    .string()
    .describe('one short sentence (under 25 words) on the brand’s voice, from the words it uses'),
  home_layout: z.enum(HOME_ARRANGEMENTS),
  home_headline: z.string(),
  home_subtitle: z.string(),
  feedback_headline: z.string(),
  feedback_subtitle: z.string(),
  prompt: z.string(),
  submit: z.string(),
})
export type WordsAnswer = z.infer<typeof wordsSchema>

export const voiceSchema = z.object({
  evidence: z
    .string()
    .describe('one or two short sentences: what their words, and what you know of them, show'),
  name: z
    .string()
    .describe(
      'the company’s name as they write it in their sentences (its capitals and spacing), not as the logo styles it'
    ),
  known: z
    .enum(['well', 'a_little', 'not'])
    .describe('how well you know this company’s own voice beyond these screenshots'),
  signatures: z
    .array(z.string())
    .describe(
      'up to four greetings, catchphrases or signature words they really use, as they write them; [] when none'
    ),
  home_language: z
    .string()
    .describe('a language they use as flavour (a greeting, a word) beside their own, or "none"'),
  formality: z.enum(['formal', 'neutral', 'casual']),
  humour: z.enum(['none', 'dry', 'warm', 'playful']),
  exclamations: z.enum(['never', 'sometimes', 'often']),
  emoji: z.enum(['never', 'sometimes']),
  vocabulary: z
    .array(z.string())
    .describe('up to eight of their words for what they do and what customers do with them'),
  avoid: z.array(z.string()).describe('up to four things that would sound wrong from them'),
})
export type VoiceAnswer = z.infer<typeof voiceSchema>

export interface WordsEvidence {
  name: string | null
  /** The site's own words on the main screenshot, as the finder read them. */
  headline: string
  subtitle: string
  button: string
  /** Every other word the finder read, on any screenshot: logos, headings, buttons. */
  seen: string[]
  /** The pages the portal has. */
  pages: string[]
  /** The language to write in, by name, when not English. */
  language: string | null
}

type Read = Pick<
  FinderOutput,
  'headline_text' | 'subtitle_text' | 'logo_text' | 'primary_button_text' | 'section_heading_text'
>

const key = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** The words evidence from what the finder read on each screenshot, the main one first. */
export function wordsEvidenceFrom(input: {
  name: string | null
  main: Read
  others: Read[]
  pages: string[]
  language: string | null
}): WordsEvidence {
  const { main } = input
  const taken = new Set(
    [main.headline_text, main.subtitle_text, main.primary_button_text].map(key).filter(Boolean)
  )
  const seen: string[] = []
  for (const read of [main, ...input.others])
    for (const text of [
      read.logo_text,
      read.headline_text,
      read.subtitle_text,
      read.section_heading_text,
      read.primary_button_text,
    ]) {
      const k = key(text)
      if (!k || taken.has(k)) continue
      taken.add(k)
      seen.push(text.replace(/\s+/g, ' ').trim())
    }
  return {
    name: input.name,
    headline: main.headline_text.trim(),
    subtitle: main.subtitle_text.trim(),
    button: main.primary_button_text.trim(),
    seen,
    pages: input.pages,
    language: input.language,
  }
}

export function wordsEvidenceLines(ev: WordsEvidence): string[] {
  const said = (what: string, words: string) =>
    words.trim() ? `Their ${what}: "${words.trim()}".` : `Their ${what}: none read.`
  return [
    ev.name ? `The company: ${ev.name}.` : '',
    said('headline', ev.headline),
    said('subtitle', ev.subtitle),
    said('main button', ev.button),
    ev.seen.length ? `Other words on their pages: ${ev.seen.map((w) => `"${w}"`).join('; ')}.` : '',
    `Pages: ${ev.pages.join(', ')}.`,
    ev.language ? `Write every word in ${ev.language}.` : '',
  ].filter(Boolean)
}

export function voiceLines(v: VoiceAnswer): string[] {
  return [
    `Their voice: ${v.evidence}`,
    v.name.trim() ? `Their name, as they write it: ${v.name.trim()}.` : '',
    v.signatures.length
      ? `Their signature words: ${v.signatures
          .slice(0, 4)
          .map((w) => `"${w}"`)
          .join(', ')}.`
      : 'Their signature words: none known.',
    v.home_language.trim() && v.home_language.trim().toLowerCase() !== 'none'
      ? `A home language they use as flavour: ${v.home_language.trim()}.`
      : '',
    `Formality: ${v.formality}; humour: ${v.humour}; exclamation marks: ${v.exclamations}; emoji: ${v.emoji}.`,
    v.vocabulary.length
      ? `Their words for what they do: ${v.vocabulary.slice(0, 8).join(', ')}.`
      : '',
    v.avoid.length ? `Avoid: ${v.avoid.slice(0, 4).join('; ')}.` : '',
  ].filter(Boolean)
}

/** Words with case, marks and closing punctuation set aside, for telling copies apart. */
const norm = (s: string) =>
  key(plainWords(s))
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
const same = (a: string, b: string) => !!norm(a) && norm(a) === norm(b)
/** A sales line of four words or more, reused inside a longer line. */
const reused = (line: string, site: string) =>
  norm(site).split(' ').length >= 4 && ` ${norm(line)} `.includes(` ${norm(site)} `)

const EMOJI = /\p{Extended_Pictographic}/u

/** The company's name as a whole word, in any case. */
function nameMatcher(name: string): RegExp | null {
  const written = name.trim()
  if (!written) return null
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
}

/** Whether the words name the company other than as it writes its name ("acme" for "Acme"). */
function misnamed(words: string, name: string): boolean {
  const found = nameMatcher(name) && words.match(nameMatcher(name)!)
  return !!found && found.some((seen) => seen !== name.trim())
}

/**
 * The name as the voice read gives it, unless it is all lower case where the
 * site's own sentences never write it so: a lower-case logo read as the name.
 */
export function nameAsWritten(
  name: string,
  ev: Pick<WordsEvidence, 'headline' | 'subtitle'>
): string {
  const written = name.trim()
  if (!written || written !== written.toLowerCase() || written === written.toUpperCase())
    return written
  const sentences = `${ev.headline} ${ev.subtitle}`
  if (nameMatcher(written)?.test(sentences) && sentences.includes(written)) return written
  return written.charAt(0).toUpperCase() + written.slice(1)
}

/** The answer with the company's name written as they write it wherever it appears. */
export function withTheirName(answer: WordsAnswer, name: string): WordsAnswer {
  const matcher = nameMatcher(name)
  if (!matcher) return answer
  const out = { ...answer }
  for (const line of WORD_LINES) out[line] = out[line].replace(matcher, name.trim())
  return out
}

const HEADLINES: ReadonlySet<WordLine> = new Set(['home_headline', 'feedback_headline'])

/** A date, a number or a time limit: true today, stale tomorrow, and never the portal's to say. */
const TIMELY =
  /\p{N}|\b(january|february|march|april|june|july|august|september|october|november|december|sunset\w*|deadline|until|expir\w*|ending soon|last chance|limited time|this (week|month|year))\b/iu
/** A promise or a claim about how they work, which a welcome cannot keep. */
const PROMISE =
  /\b(shaped by|built (by|with|from|on) (you|your|our (customers|users|community))|we put you first|you come first|guarantee\w*|promise\w*|always|every (idea|voice|suggestion) (counts|matters|is heard)|we (read|answer|reply to) (every|all))\b/i
/** A greeting that hails the brand, not the customer ("Hello Fernway", "Hello, Acme team"). */
const hailsTheBrand = (words: string, name: string) => {
  const written = name.trim()
  if (!written) return false
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `^(hello|hi|hey|hej|hola|ciao|bonjour|hallo|welcome|greetings)[,!.]?\\s+(the\\s+)?${escaped}(?![\\p{L}\\p{N}])`,
    'iu'
  ).test(words)
}

/** A greeting leading a line. */
const GREETINGS =
  "hello|hi|hiya|hey|heya|howdy|hej|hola|ciao|bonjour|salut|hallo|moin|servus|aloha|ahoy|yo|g'?day|ola|olá|namaste|kia ora"
const GREETING = new RegExp(`^(${GREETINGS})(?![\\p{L}\\p{N}])`, 'iu')
/** The site's own words a line is held against. */
type SiteWords = Pick<WordsEvidence, 'headline' | 'subtitle' | 'button'> & {
  seen?: readonly string[]
  name?: string | null
  /** The language the portal is written in, when not English: the invitation checks read English. */
  language?: string | null
}

/** A welcome leading a headline, after a greeting or not ("Hello, and welcome to ..."). */
const WELCOME = new RegExp(`^((${GREETINGS})[,!.]?\\s+(and\\s+)?)?welcome(?![\\p{L}\\p{N}])`, 'iu')
/** A line's sentences; a dot inside a name ("Acme.io") ends none. */
const sentencesOf = (words: string) =>
  words
    .split(/(?<=[.!?\u2026])\s+(?=\S)/u)
    .map((s) => s.trim())
    .filter(Boolean)
/** Whether a sentence is a short greeting of theirs, which may lead another ("Hej! Pull up a chair"). */
const greets = (sentence: string, signatures: readonly string[]) =>
  sentence.split(/\s+/).length <= 3 &&
  (GREETING.test(sentence) || signatures.some((s) => same(s, sentence)))
/** Whether a line only greets ("Hello, pen pal!", "Hi from the Acme team"), asking nothing. */
const onlyGreets = (words: string, signatures: readonly string[]) =>
  sentencesOf(words).every(
    (sentence) =>
      greets(sentence, signatures) || (GREETING.test(sentence) && !sentence.includes('?'))
  )
/** A question asked without its question mark ("What should we build next"). */
const QUESTION =
  /^((what|where|which|who|how|when|why)\s+(should|would|could|can|will|shall|do|does|did|is|are)|(should|would|could|can|will|shall|do|does|is|are)\s+(we|you|i|it|they))(?![\p{L}\p{N}])/iu

/**
 * A Home headline any company could use, once their name is taken out ("What
 * should Acme build next?", "Help us make Acme better"), read as bare words.
 */
const STOCK_HEADLINE = new RegExp(
  [
    '^(so )?what should (we |you )?(build|do|make|add|create|ship|improve|fix|change|work on)( for you)?( next)?$',
    '^tell (us )?what (to|should|we should|you want( us)? to) (build|do|make|add|create|ship|improve|fix|change)( next)?$',
    '^help us (build|make|improve)( what( comes| does| is)? next| whats next| better| it better| even better)?$',
    '^whats next( (for|on|at|with))?$',
    '^(we value|share) your (feedback|ideas)$',
  ].join('|'),
  'u'
)
/** Words that name nothing of a company's own in a composer prompt. */
const STOCK_PROMPT_WORDS = new Set(
  (
    'a an the or and of for to in on with your you we us our it its some any one new better ' +
    'suggest describe share tell send add want need would like could should what which how ' +
    'help team idea ideas feature features fix fixes improvement improvements request requests ' +
    'suggestion suggestions thought thoughts feedback change changes tweak tweaks thing things ' +
    'have mind see do make build next'
  ).split(' ')
)
/** A button any company could have: bare, or "Send to" with only their name or "the team". */
const STOCK_BUTTON =
  /^(submit|send)( (idea|feedback|your idea|your feedback|a suggestion))?$|^send (it )?to( the)?( team)?$/u

/**
 * What a customer does on the portal rather than with the product: a question
 * about these ("What would you like to see?") is the portal's own.
 */
const PORTAL_VERBS = new Set(
  (
    'see suggest share tell change improve fix add ask say vote like want love need think wish ' +
    'have us we our' +
    // Not a verb at all ("vote on what you need and see ...", "what you need in your decks").
    ' and or but to from in on at of for with most next here now from the a an your'
  ).split(' ')
)
/** "We help you send", "here to help you book": the brand offering its service, not help with it. */
const OFFERS_HELP =
  /(?<!\bshould )\b(we|i|we'll|we're|here to|let us|let's) help you\b(?!\s+(with|find (help|answers)|get (help|answers)))/iu
/** A question about what the customer will do with the product ("Where would you like to go?"). */
const ASKS_USE =
  /\b(?:what|where|which|how)\s+(?:would|will|do|can|could|shall)\s+you\s+(?:(?:like|want|love|need)\s+to\s+)?(\p{L}+)/iu
/** "Tell us what you want delivered": what the customer wants of the service, not of the portal. */
const WANTS_OF_SERVICE =
  /\bwhat\s+you(?:'d)?\s+(?:want|would like|need|like)(?:\s+to)?\s+(\p{L}+)/iu
/** Whether a line offers the brand's own service, as if the portal were the product. */
function offersService(words: string): boolean {
  if (OFFERS_HELP.test(words)) return true
  return [ASKS_USE, WANTS_OF_SERVICE].some((asks) => {
    const verb = asks.exec(words)?.[1]?.toLowerCase()
    return !!verb && !PORTAL_VERBS.has(verb)
  })
}
/** Words that invite feedback or offer help in a Home headline (a greeting of theirs alone may lead). */
const INVITES_HEADLINE =
  /\b(suggest\w*|feedback|vot(e|es|ing)|tell|share|wish\w*|improv\w*|better|listen\w*|hear|say|thoughts?|ask\w*|requests?|roadmap|coming|shape|help|answers?|support|questions?|write to us|with us|on your mind|in mind)\b|\b(what|where|which|how) (should|could|can|shall) (we|i)\b|\bwhat would make\b|\b(like|want|love|need) us to\b|\b(bring|send|post|give|pitch|turn|got|have) (us |me )?(your|an?|any) ideas?\b|\bwith your ideas\b/iu
/**
 * A question that asks for ideas or what comes next ("Which transfer should we add next?"): an
 * idea or "next" counts only in a question, never in a tagline ("Make your next idea real").
 */
const asksForIdeas = (words: string) =>
  sentencesOf(words).some(
    (sentence) => sentence.endsWith('?') && /\b(ideas?|next|should|would)\b/iu.test(sentence)
  )
/** Words that invite feedback in Home's subtitle: help may sit beside them, never alone. */
const INVITES_SUBTITLE =
  /\b(ideas?|suggest\w*|feedback|vot(e|es|ing)|tell|share|wish\w*|improv\w*|better|requests?|ask (us )?for|roadmap|what( i|')s (coming|next)|what changed)\b/iu
/** The lines that welcome a customer, which must never offer the brand's service. */
const WELCOME_LINES: ReadonlySet<WordLine> = new Set([
  'home_headline',
  'home_subtitle',
  'feedback_headline',
  'feedback_subtitle',
])
const SERVICE_OFFER =
  'offers their own service, as if the portal were the product ("What can we help you send?", "Where would you like to go?"): invite their customers to tell them what to improve or make next, or to get help with it'

/** Words that carry nothing of a line's own (for telling a slogan's words apart). */
const LITTLE_WORDS = new Set(
  (
    'a an the and or but of for to in on at by with from into your you we us our it its is are ' +
    'be was this that these those what which who how where when why should would could can will ' +
    'do does did next new more most all every any some my me i so just not no as up out than then'
  ).split(' ')
)
const contentWords = (text: string) =>
  norm(text)
    .split(' ')
    .filter((w) => w && !LITTLE_WORDS.has(w))
const pairsOf = (words: readonly string[]) => words.slice(1).map((w, i) => `${words[i]} ${w}`)
/** A signature that greets or calls out ("Hello, pen pal!", "Lights on!"), which may lead a question. */
const calls = (signature: string) => GREETING.test(signature.trim()) || /!\s*$/u.test(signature)
/**
 * A part of a headline that is their slogan, not an invitation: outside a question, not a
 * greeting, and saying a catchphrase of theirs or two words running from their headline or
 * subtitle ("Ride further, and tell us where next", "Ride further with your ideas"). Their
 * words inside a question that asks are the invitation ("What would help you ride further?").
 */
function sloganClause(words: string, ev: SiteWords, signatures: readonly string[]): boolean {
  const slogans = signatures.filter((s) => !calls(s) && contentWords(s).length)
  const theirPairs = new Set(
    [ev.headline, ev.subtitle].flatMap((site) => pairsOf(contentWords(site)))
  )
  return sentencesOf(words).some((sentence) => {
    const parts = sentence.split(/,\s+/u)
    return parts.some((part, i) => {
      const asks = (i === parts.length - 1 && sentence.endsWith('?')) || QUESTION.test(part)
      if (asks || GREETING.test(part) || greets(part, signatures.filter(calls))) return false
      const said = ` ${norm(part)} `
      return (
        slogans.some((s) => said.includes(` ${norm(s)} `)) ||
        pairsOf(contentWords(part)).some((pair) => theirPairs.has(pair))
      )
    })
  })
}
const SLOGAN_HEADLINE =
  'their slogan, with an invitation fitted round it: ask plainly what would make their product or service better, or what to make next, in their voice and their words for what they do ("What would help you ride further?", "Got a request for your rides?"); their slogan\'s words only where the question still makes plain sense read literally, or lead with a greeting of theirs'

/** What is wrong with one line, or null when it passes. */
export function lineLint(
  line: WordLine,
  text: string,
  ev: SiteWords,
  voice:
    | (Pick<VoiceAnswer, 'emoji' | 'name'> & {
        signatures?: readonly string[]
        vocabulary?: readonly string[]
      })
    | null
): string | null {
  const words = plainWords(text).trim()
  if (!words) return 'empty'
  if (words.length > WORDS_LIMITS[line]) return `longer than ${WORDS_LIMITS[line]} characters`
  if (/[\u2013\u2014]/.test(words)) return 'a dash'
  if (words === words.toUpperCase() && words !== words.toLowerCase() && /\p{L}{2}/u.test(words))
    return 'all capitals'
  if (voice?.emoji === 'never' && EMOJI.test(words)) return 'an emoji from a brand that uses none'
  if (voice && misnamed(words, voice.name)) return 'their name, not written as they write it'
  if ([ev.headline, ev.subtitle, ev.button].some((site) => same(words, site)))
    return 'the site’s own sales line, copied'
  if ([ev.headline, ev.subtitle].some((site) => reused(words, site)))
    return 'the site’s own sales line, with words tacked on'
  if (
    HEADLINES.has(line) &&
    norm(ev.button).split(' ').length >= 2 &&
    ` ${norm(words)} `.includes(` ${norm(ev.button)} `)
  )
    return 'the site’s button, in a headline'
  const name = voice?.name.trim() || ev.name?.trim() || ''
  const unnamed = name ? words.replace(nameMatcher(name)!, '') : words
  if (TIMELY.test(unnamed)) return 'a date, a number or a time limit'
  if (PROMISE.test(unnamed)) return 'a promise or a claim about how they work'
  if (name && hailsTheBrand(words, name)) return 'a greeting to the brand, not the customer'
  const stock = norm(unnamed)
  if (line === 'submit' && STOCK_BUTTON.test(stock))
    return 'a stock button, bare or with only their name on it: use a verb or a word of theirs ("Send to the roasters", "Post it")'
  if (line === 'submit' && !ev.language && sentToStrangers(words, ev, voice)) return STRANGER_BUTTON
  if (line === 'prompt' && stock.split(' ').every((w) => STOCK_PROMPT_WORDS.has(w)))
    return 'a prompt that names nothing of theirs ("a feature or a fix"): name a thing customers ask them for, in their words'
  if (line === 'home_headline' && STOCK_HEADLINE.test(stock))
    return 'a line any company could use with only their name in it: say something only they would say'
  if (WELCOME_LINES.has(line) && offersService(words)) return SERVICE_OFFER
  const english = !ev.language && !/[^\P{L}\p{Script=Latin}]/u.test(words)
  if (line === 'home_subtitle' && english && !INVITES_SUBTITLE.test(words))
    return 'invites nothing: Home’s subtitle invites their customers to share feedback and vote, with help beside it if they like'
  if (!HEADLINES.has(line)) return null
  if (WELCOME.test(words))
    return 'opens with a welcome, a preamble that says nothing of them: open with what only they would say'
  if (line === 'home_headline' && english && sloganClause(words, ev, voice?.signatures ?? []))
    return SLOGAN_HEADLINE
  const [first, ...rest] = sentencesOf(words)
  // A short call and answer ("Got a craving? Tell us!") is one beat.
  const short = words.split(/\s+/).length <= 5
  if (rest.length && !short && !greets(first!, voice?.signatures ?? []))
    return 'two thoughts in one headline: say one thing, or lead with a short greeting of theirs'
  const last = sentencesOf(words).pop()!
  if (QUESTION.test(last) && !last.endsWith('?')) return 'a question without its question mark'
  if (
    line === 'home_headline' &&
    english &&
    !INVITES_HEADLINE.test(words) &&
    !asksForIdeas(words) &&
    !onlyGreets(words, voice?.signatures ?? [])
  )
    return 'invites nothing: a line about their product, not an invitation to tell them what to improve or make next (or a greeting of theirs alone)'
  return null
}

/** Every line's problem, in the order the lines are written. */
export function wordsLints(
  answer: WordsAnswer,
  ev: SiteWords,
  voice: Parameters<typeof lineLint>[3]
): Array<{ line: WordLine; problem: string }> {
  return WORD_LINES.flatMap((line) => {
    const problem =
      lineLint(line, answer[line], ev, voice) ??
      (line === 'feedback_headline' && same(answer.feedback_headline, answer.home_headline)
        ? 'the same as Home’s headline'
        : null)
    return problem ? [{ line, problem }] : []
  })
}
