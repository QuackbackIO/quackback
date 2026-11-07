/**
 * The words critic, and the words step it closes: each writing angle's set
 * written in parallel, then an editor who sees the voice read and the site's
 * own words judges every set on plain sense, the brand's voice and delight,
 * chooses one and may swap in a line another set says better. The choice is
 * held to rules (lints first, then plain sense) so a critic's slip cannot
 * put an odd line on the portal.
 */
import { z } from 'zod'
import { logger } from '@/lib/server/logger'
import { plainWords } from '@/lib/shared/design/words-markup'
import type { FamilyCaller } from './brand-brief'
import {
  lineLint,
  BUTTON_RULE,
  nameAsWritten,
  unclearButton,
  voiceLines,
  withTheirName,
  WORD_LINES,
  wordsEvidenceLines,
  wordsLints,
  wordsSchema,
  type HomeArrangement,
  type VoiceAnswer,
  type WordLine,
  type WordsAnswer,
  type WordsEvidence,
} from './words-evidence'
import { WRITING_ANGLES, type WritingAngle } from './words-examples'
import { PORTAL, WORDS_VERSION, wordsPrompt, writeCandidate } from './words-family'
import { agreedLayoutOf, chooseLayout } from './words-layout'

const log = logger.child({ module: 'words-pick' })

const SETS = ['a', 'b', 'c'] as const

/** 1 to 5; a strict answer is not held to the range, so none is checked here. */
const score = z.number().int()

export const wordsPickSchema = z.object({
  reviews: z.array(
    z.object({
      set: z.enum(SETS),
      problems: z
        .array(z.string())
        .describe('each weak line quoted, with what is wrong; [] when none'),
      plain_sense: score,
      voice: score,
      delight: score,
    })
  ),
  choice: z.enum(SETS),
  swaps: z
    .array(z.object({ line: z.enum(WORD_LINES as [WordLine, ...WordLine[]]), from: z.enum(SETS) }))
    .describe(
      'at most two: a weak line in the chosen set, taken instead from another set; [] when none'
    ),
  why: z.string().describe('one short sentence on the choice'),
})
export type WordsPick = z.infer<typeof wordsPickSchema>

/** One writer's set, by its angle. */
export interface WordsCandidate {
  angle: WritingAngle
  answer: WordsAnswer
}

const RUBRIC = `You are an editor choosing the words for a company's customer portal: ${PORTAL}. Writers each wrote a set, in the brand's voice as read below.
Read every line as a customer arriving at the portal, then score each set from 1 to 5:
plain_sense: would a customer understand each line at once, literally? A pun, a twisted slogan or a metaphor that does not hold when read literally (for a bakery, "Your ideas make us all rise"; ideas that hug you) is 1 or 2 however clever; an invented product, claim or offer, a date or a deadline, or a promise about how they work ("we put you first", "shaped by our customers") is 1. A greeting must greet the customer, never the brand ("Hello, Acme team" greets the company). A Home line that offers their own service, as if the portal were the product ("What can we help you send?", "Where would you like to go?"), or is their slogan, inviting nothing, or their slogan or catchphrase with an invitation fitted round it ("Ride further, and tell us where next", "Ride further with your ideas"), is 1 or 2: Home invites customers to tell them what to improve or make next (help may sit beside it).
voice: does it sound like this brand and no other: its name written as they write it, its signature where it has one (a greeting, a catchphrase, a word in its home language), its vocabulary and punctuation? A generic set, whose lines have nothing of them in them and any company could use word for word ("We value your feedback", "Tell us what to build next"), is 1 or 2: as wrong as an odd one. Their name written otherwise than they write it ("acme" for "Acme") is a weak line, and so is a stock button (a bare "Submit", or "Send to" with only their name) where another set's button speaks in their voice, and a button sent to "the team" or to a word for their people that their words never use ("the builders") where another set's button names no one ("Post it") or uses a word of theirs, and a button that sends the idea to their customers rather than their own people ("Send to the drivers") or whose verb sends nothing ("Put it to work"), and a prompt that names nothing of theirs ("A feature or a fix").
delight: would it make the customer feel welcome, even smile, without trying too hard? A line that only works as marketing (selling, a price or claim, a slogan that means nothing on a portal) is 1 or 2; echoing their own words or rhythm in a line that makes sense as a welcome is voice, not marketing; their headline or slogan reused with words tacked on is marketing.
List each set's weak lines, quoted, with what is wrong.
Choose the set that is both plain and theirs: a generic set loses to a sensible set with their voice as surely as an odd set does. Where the chosen set has one weak line that another set says better, swap that line in (at most two, and never a line in another language or a voice that clashes).
Answer with the JSON object only.`

export function wordsPickPrompt(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  sets: WordsAnswer[]
): string {
  const shown = (a: WordsAnswer) =>
    JSON.stringify(Object.fromEntries(WORD_LINES.map((line) => [line, a[line]])))
  return [
    RUBRIC,
    `The brand:\n${[...wordsEvidenceLines(ev), ...(voice ? voiceLines(voice) : [])].join('\n')}`,
    sets.map((a, i) => `Set ${SETS[i]}: ${shown(a)}`).join('\n'),
  ].join('\n\n')
}

export function critiqueWords(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  sets: WordsAnswer[],
  call: FamilyCaller
): Promise<WordsPick> {
  return call({
    family: 'words_pick',
    version: WORDS_VERSION,
    prompt: wordsPickPrompt(ev, voice, sets),
    images: [],
    schema: wordsPickSchema,
    maxTokens: 1500,
  })
}

/** Without a critic, or between equals: the brand's signature first, its play last. */
const PREFERENCE: WritingAngle[] = ['signature', 'plain', 'playful']
const preference = (c: WordsCandidate) => PREFERENCE.indexOf(c.angle)

/** Plain sense below this is not chosen while another set reaches it, and voice below VOICED. */
const SENSIBLE = 4
const VOICED = 3

export interface PickedWords {
  answer: WordsAnswer
  angle: WritingAngle
  /** The lines swapped in from another set, with the angle each came from. */
  swapped: Array<{ line: WordLine; from: WritingAngle }>
}

/**
 * The set to use: never one with a lint while another has none; then the
 * critic's choice when it makes plain sense in the brand's voice, else the
 * best by plain sense and voice (alike) and delight; without a critic, the
 * signature angle.
 * A swap stands only where the line it brings passes the lints and its set
 * makes plain sense.
 */
export function pickWords(
  written: readonly WordsCandidate[],
  pick: WordsPick | null,
  ev: Parameters<typeof lineLint>[2],
  voice: Parameters<typeof lineLint>[3]
): PickedWords | null {
  if (!written.length) return null
  // The name as they write it, wherever a writer wrote it otherwise.
  const name = voice?.name ?? ''
  const candidates = written.map((c) => ({ ...c, answer: withTheirName(c.answer, name) }))
  const letter = (c: WordsCandidate) => SETS[candidates.indexOf(c)]!
  const review = (c: WordsCandidate) => pick?.reviews.find((r) => r.set === letter(c))
  const sense = (c: WordsCandidate) => review(c)?.plain_sense ?? 0
  const weak = (line: WordLine, text: string) => !!lineLint(line, text, ev, voice)
  const canGive = (c: WordsCandidate) => !pick?.reviews.length || sense(c) >= SENSIBLE
  // A set whose failing lines another sensible set writes well is mended, not passed over: its
  // voice (its branded button too) stays, and only its weak lines go.
  const mendable = (c: WordsCandidate) =>
    wordsLints(c.answer, ev, voice).every(({ line }) =>
      candidates.some(
        (d) =>
          d !== c &&
          canGive(d) &&
          !weak(line, d.answer[line]) &&
          !WORD_LINES.some((other) => other !== line && sameWords(c.answer[other], d.answer[line]))
      )
    )
  const clean = candidates.filter((c) => mendable(c))
  const pool = clean.length ? clean : candidates
  const voiced = (c: WordsCandidate) => (review(c)?.voice ?? 0) >= VOICED
  // Generic costs as much as odd: plain sense and voice count alike.
  const total = (c: WordsCandidate) => {
    const r = review(c)
    return r ? (r.plain_sense + r.voice) * 2 + r.delight : 0
  }
  const byPreference = [...pool].sort((a, b) => preference(a) - preference(b))
  let chosen = byPreference[0]!
  if (pick?.reviews.length) {
    const both = pool.filter((c) => sense(c) >= SENSIBLE && voiced(c))
    const sensible = pool.filter((c) => sense(c) >= SENSIBLE)
    const eligible = both.length ? both : sensible.length ? sensible : pool
    const named = eligible.find((c) => letter(c) === pick.choice)
    chosen =
      named ??
      [...eligible].sort((a, b) => total(b) - total(a) || preference(a) - preference(b))[0]!
  }
  // Home's arrangement is not a matter of wording: the writers' only when they all agree.
  const answer = { ...chosen.answer, home_layout: agreedLayout(candidates) }
  const swapped: PickedWords['swapped'] = []
  for (const swap of (pick?.swaps ?? []).slice(0, 2)) {
    const from = candidates.find((c) => letter(c) === swap.from)
    if (!from || from === chosen || sense(from) < SENSIBLE) continue
    if (swapped.some((s) => s.line === swap.line)) continue
    const text = from.answer[swap.line]
    if (lineLint(swap.line, text, ev, voice)) continue
    answer[swap.line] = text
    swapped.push({ line: swap.line, from: from.angle })
  }
  // A line that fails a lint takes another sensible set's line that passes: the chosen set's
  // voice stays, its weak line goes.
  const donors = candidates
    .filter((c) => c !== chosen && canGive(c))
    .sort((a, b) => total(b) - total(a) || preference(a) - preference(b))
  for (const { line } of wordsLints(answer, ev, voice)) {
    const elsewhere = (text: string) =>
      WORD_LINES.some((other) => other !== line && sameWords(answer[other], text))
    const donor = donors.find((c) => !weak(line, c.answer[line]) && !elsewhere(c.answer[line]))
    if (!donor) continue
    answer[line] = donor.answer[line]
    swapped.splice(0, swapped.length, ...swapped.filter((s) => s.line !== line))
    swapped.push({ line, from: donor.angle })
  }
  return { answer, angle: chosen.angle, swapped }
}

const sameWords = (a: string, b: string) =>
  plainWords(a).trim().toLowerCase() === plainWords(b).trim().toLowerCase()

/** The chosen set written again with only its failing lines changed; throws when the call fails. */
function reviseLines(
  ev: WordsEvidence,
  voice: VoiceAnswer | null,
  picked: PickedWords,
  problems: ReadonlyArray<{ line: WordLine; problem: string }>,
  call: FamilyCaller,
  earlier: Partial<Record<WordLine, readonly string[]>> = {}
): Promise<WordsAnswer> {
  const failing = problems.map(({ line, problem }) => {
    const before = (earlier[line] ?? []).filter((text) => text !== picked.answer[line])
    const tried = before.length
      ? ` (also tried before, and failing: ${before.map((text) => `"${text}"`).join(', ')})`
      : ''
    return `${line} ("${picked.answer[line]}"): ${problem}${tried}`
  })
  return call({
    family: 'words',
    version: WORDS_VERSION,
    prompt: `${wordsPrompt(ev, voice, picked.angle)}\n\nYour set: ${JSON.stringify(picked.answer)}\nThese lines fail: ${failing.join('; ')}.\nWrite the set again, changing only those lines.`,
    images: [],
    schema: wordsSchema,
    maxTokens: 2000,
  })
}

/**
 * Home's arrangement: one the writers all chose (at least two of them), else
 * the default. The words step does not quietly move Home about on a split.
 */
function agreedLayout(candidates: readonly WordsCandidate[]): HomeArrangement {
  const [first, ...rest] = candidates.map((c) => c.answer.home_layout)
  return rest.length && rest.every((layout) => layout === first) ? first! : 'portal'
}

/** A promise held to a time; null when it runs out or fails. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), Math.max(0, ms))
  })
  try {
    return await Promise.race([promise, timeout])
  } catch (err) {
    log.warn({ err }, `words: ${what} failed`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Share of the step's time the writers may take, leaving the rest for the critic. */
const WRITERS_SHARE = 0.6
/** How many times the lines no set wrote well are asked for. */
const FIX_ROUNDS = 2
/** A critic with less time than this left is skipped. */
const CRITIC_LEAST = 2_000

/**
 * The words step after the voice read: every angle's set at once, then the
 * critic, all inside `ms`. A writer whose answer does not parse is left out;
 * when none parses, the plain angle is asked once more.
 */
export async function writeWords(input: {
  ev: WordsEvidence
  voice: VoiceAnswer | null
  call: FamilyCaller
  ms: number
  now?: () => number
}): Promise<PickedWords | null> {
  const { call } = input
  const voice = input.voice && {
    ...input.voice,
    name: nameAsWritten(input.voice.name, input.ev),
  }
  // The company named as they write it, over the name the match was given.
  const ev = voice?.name.trim() ? { ...input.ev, name: voice.name.trim() } : input.ev
  const now = input.now ?? Date.now
  const start = now()
  const left = () => start + input.ms - now()
  const writing = Promise.all(
    WRITING_ANGLES.map((angle) =>
      within(
        writeCandidate(ev, voice, angle, call),
        input.ms * WRITERS_SHARE,
        `the ${angle} writer`
      ).then((answer) => (answer ? { angle, answer } : null))
    )
  )
  // Home's arrangement, from the site alone and beside the writers: never the writers' choice.
  const layouts = Promise.all(
    WRITING_ANGLES.map((angle) =>
      within(chooseLayout(ev, voice, angle, call), input.ms * WRITERS_SHARE, `the ${angle} layout`)
    )
  )
  const written = await writing
  let candidates = written.filter((c): c is WordsCandidate => !!c)
  if (!candidates.length && left() > CRITIC_LEAST) {
    const again = await within(writeCandidate(ev, voice, 'plain', call), left(), 'the writer again')
    candidates = again ? [{ angle: 'plain', answer: again }] : []
  }
  if (!candidates.length) return null
  const pick =
    candidates.length > 1 && left() > CRITIC_LEAST
      ? await within(
          critiqueWords(
            ev,
            voice,
            candidates.map((c) => c.answer),
            call
          ),
          left(),
          'the words critic'
        )
      : null
  const picked = pickWords(candidates, pick, ev, voice)
  // Lines no set wrote well are asked for again, in the chosen set's angle: a second time with
  // the first answer's own failing lines, so a fix that echoes their site is not the last word.
  let tried: Partial<WordsAnswer> = {}
  // Every button written for the chosen set, so a button's own fix does not swing back to one.
  const buttons: string[] = picked ? [picked.answer.submit] : []
  for (let round = 0; picked && round < FIX_ROUNDS && left() > CRITIC_LEAST; round++) {
    const shown = { ...picked, answer: { ...picked.answer, ...tried } }
    const problems = wordsLints(shown.answer, ev, voice)
    if (!problems.length) break
    const fixed = await within(
      reviseLines(ev, voice, shown, problems, call),
      left(),
      'the words fix'
    )
    if (!fixed) break
    if (problems.some((p) => p.line === 'submit')) buttons.push(fixed.submit)
    tried = {}
    for (const { line } of problems) {
      const answer = { ...picked.answer, [line]: fixed[line] }
      if (wordsLints(answer, ev, voice).some((p) => p.line === line)) {
        tried[line] = fixed[line]
        continue
      }
      picked.answer[line] = fixed[line]
      picked.swapped.push({ line, from: picked.angle })
    }
  }
  // A button a customer must guess at, or one still failing a lint (too long to show whole, or
  // stock), is asked for again on its own, inside the chosen set: the set, its headlines and
  // every other line stay as chosen. When no fix passes, the button stays as the fixes above
  // left it.
  const buttonProblem = (text: string) =>
    lineLint('submit', text, ev, voice) ?? unclearButton(text, ev)
  let attempt: string | null = null as string | null
  for (
    let round = 0;
    picked && buttonProblem(picked.answer.submit) && round < FIX_ROUNDS && left() > CRITIC_LEAST;
    round++
  ) {
    const text: string = attempt ?? picked.answer.submit
    const problem = buttonProblem(text)
    const shown: PickedWords = { ...picked, answer: { ...picked.answer, submit: text } }
    const fixed: WordsAnswer | null = await within(
      reviseLines(
        ev,
        voice,
        shown,
        [{ line: 'submit', problem: `${problem}. ${BUTTON_RULE}` }],
        call,
        { submit: [...new Set(buttons)] }
      ),
      left(),
      'the button fix'
    )
    if (!fixed) break
    if (!buttons.includes(text)) buttons.push(text)
    if (!buttonProblem(fixed.submit)) {
      picked.answer.submit = fixed.submit
      picked.swapped.push({ line: 'submit', from: picked.angle })
      break
    }
    attempt = fixed.submit
  }
  if (picked) picked.answer.home_layout = agreedLayoutOf(await layouts)
  if (picked)
    log.info(
      {
        angle: picked.angle,
        swapped: picked.swapped,
        sets: candidates.length,
        critic: !!pick,
        why: pick?.why,
      },
      'words: picked'
    )
  return picked
}
