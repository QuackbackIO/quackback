/**
 * A submit button's words, with no model call: whether a customer must guess what it does (it
 * sends the idea to their customers, or its verb sends nothing), and whether it names someone
 * the company never calls itself ("the team", "the builders") where their own words hold no
 * such word.
 */
import { plainWords } from '@/lib/shared/design/words-markup'

/** Words with case and marks set aside, as the lints read them. */
const norm = (s: string) =>
  plainWords(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A button's verbs that send the idea on, in any voice ("Pitch it", "Post your idea"). */
const SENDING = new Set(
  (
    'send post share pass pitch suggest submit drop hand tell ship push file raise add propose ' +
    'leave mail email message whisper pop toss slide beam fire'
  ).split(' ')
)
/** Words for a brand's customers or users: the people who send ideas, not those who read them. */
const CUSTOMERS = new Set(
  (
    'drivers riders passengers hosts guests travellers travelers readers listeners viewers ' +
    'audience fans artists creators sellers buyers shoppers customers users members ' +
    'community communities players gamers athletes runners learners students subscribers ' +
    'followers patients couriers merchants meditators schedulers patrons diners commuters ' +
    'renters tenants homeowners parents families clients investors traders savers borrowers ' +
    'voters residents visitors attendees campers hikers cyclists'
  ).split(' ')
)
/** Where a button sends the idea: the last "to", "for", "into" or "with" and after. */
const SENT_TO = /\s(?:to|for|into|with)\s+(?:the\s+|our\s+|your\s+|all\s+)?([\p{L}\p{N}' ]+)$/iu
/**
 * A verb that does something other than send ("Hang out with us", "Give it kudos", "Bring it
 * to life", "Put it to work", "Let's get to work"): an idiom with no idea going anywhere.
 */
const ELSEWHERE =
  /^(let'?s\s)|\b(hang(ing)? out|kudos|high five|to life|to work|get going|have fun|join (us|in)|come (along|with))\b/iu
/**
 * A verb that is not sending, taking the idea somewhere that is no one ("Take it on the road",
 * "Take it for a spin", "Shake it up"): an idiom with no destination.
 */
const NOWHERE = /^\p{L}+ (it|this|that|one) (on|around|out|off|up|down|along|for an?)\b/iu

/**
 * Why a customer would have to guess what a submit button does, or null: it sends the idea to
 * the brand's customers or users ("Take it to the drivers"), or its verb does something other
 * than send ("Hang out with us"). A product noun as the place it goes is fine ("Send it to the
 * vault"), and so is any verb of theirs that does send ("Deploy the idea", "Get it built").
 * English buttons only.
 */
export function unclearButton(text: string, ev: { language?: string | null }): string | null {
  if (ev.language) return null
  const words = plainWords(text)
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const to = SENT_TO.exec(words)
  const last = to?.[1]!.trim().split(' ').pop()
  if (last && CUSTOMERS.has(last))
    return 'a button that sends the idea to their customers, not to the people at the company who read it'
  if (!SENDING.has(words.split(' ')[0] ?? '') && (ELSEWHERE.test(words) || NOWHERE.test(words)))
    return 'a button whose verb does something other than send the idea'
  return null
}

/**
 * The whole rule for a button, told with its problem so a fix does not swing to another kind
 * of weak button (a stock one, or one a customer must guess at).
 */
export const BUTTON_RULE =
  'A button says plainly, in a few words (under 24 characters) and in their voice, that it sends the idea on: a sending verb, or one of theirs that sends. It names the company\'s people only by a word their own words use (for a coffee roaster whose pages say "Meet the roasters", "Send to the roasters"); where they have none it names no one ("Post it", "Share it"). Never "the team" or a word for their people they never use ("the builders"), never a verb that does something else ("Put it to work"), never to their customers ("Send to the drivers" for a ride company), and never their name after "Send to"'

/** Words for a company's people that any company could put on its button ("the team", "the crew"). */
const ANYONE = new Set(
  'team teams crew folks people staff squad gang group humans everyone experts hq'.split(' ')
)
/** Words that name the company as one, never anyone they do not call themselves. */
const OURSELVES = new Set('us me our way'.split(' '))
/** A word and the singular it may stand for ("roasters", "roaster"). */
const forms = (word: string) => [word, word.replace(/s$/u, ''), word.replace(/es$/u, '')]
const sameWord = (a: string, b: string) => forms(a).some((f) => forms(b).includes(f))
/**
 * Whether a button sends the idea to someone they never call themselves: "the team" (or "the
 * crew", "HQ") where their own pages never call their people so, or a word for their people
 * found nowhere in their words or their vocabulary ("the builders"). Their own word for their
 * people, their name, "us", or a sending verb with no one named pass.
 */
export function sentToStrangers(
  words: string,
  ev: {
    headline: string
    subtitle: string
    button: string
    seen?: readonly string[]
    name?: string | null
    language?: string | null
  },
  voice: { name?: string; vocabulary?: readonly string[]; signatures?: readonly string[] } | null
): boolean {
  // Their customers, or a verb that sends nothing, are told apart with their own reason.
  if (unclearButton(words, ev)) return false
  const plain = norm(words)
  const to = SENT_TO.exec(plain)
  if (!to) return false
  const name = new Set(
    norm(`${voice?.name ?? ''} ${ev.name ?? ''}`)
      .split(' ')
      .filter(Boolean)
  )
  const named = to[1]!
    .trim()
    .split(' ')
    .filter((w) => w && !name.has(w))
  if (!named.length || named.every((w) => OURSELVES.has(w))) return false
  const head = named.at(-1)!
  const pages = [ev.headline, ev.subtitle, ev.button, ...(ev.seen ?? [])].map(norm).join(' | ')
  if (ANYONE.has(head)) return !new RegExp(`\\b(the|our) (\\p{L}+ )?${head}\\b`, 'u').test(pages)
  const theirs = [pages, ...(voice?.vocabulary ?? []), ...(voice?.signatures ?? [])]
    .flatMap((text) => norm(text).split(' '))
    .filter(Boolean)
  return !theirs.some((w) => sameWord(w, head))
}
export const STRANGER_BUTTON =
  'names someone they never call themselves ("the team", "the builders"): send it to their people only by a word their own words use, else name no one, with a sending verb ("Post it", "Share it")'
