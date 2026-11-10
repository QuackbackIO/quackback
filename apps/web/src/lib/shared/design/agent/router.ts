/**
 * Which way Ask AI takes a request: one call, as before, for a plain change
 * (a setting, a block, the menu, words), or the loop (plan, act, check what
 * was drawn, correct) for what a single answer gets wrong most: states such
 * as hover, a look described by feel or by another product, a picture to
 * match, contrast, and styles of one element or one block. Decided from the
 * words alone, so it costs nothing; anything unsure takes one call.
 */
import type { StyleRegistry, StyleStateId, StyleTarget } from './style-registry'
import type { OverridePage } from '../style-overrides'

export interface Route {
  mode: 'single' | 'loop'
  /** Why, in a few words, for the record. */
  why: string
  /** The elements the request names, read before acting so a change can be compared with them. */
  targets: StyleTarget[]
}

const STATE_WORDS: Array<[RegExp, StyleStateId]> = [
  [/\bhover(?:ed|ing|s)?\b|\bmouse ?over\b|\bpointer\b/i, 'hover'],
  [/\bfocus(?:ed|es)?\b|\bkeyboard\b/i, 'focus'],
  [/\bpress(?:ed|ing)?\b|\bclick(?:ed|ing)?\b|\bactive state\b/i, 'active'],
  [
    /\bcurrent (?:page|tab|item)\b|\bselected (?:tab|item)\b|\bactive (?:tab|page|item|menu)\b/i,
    'current',
  ],
  [/\bvoted\b|\bonce (?:someone|a visitor|they) votes?\b/i, 'current'],
  [/\bdisabled\b|\bcannot be (?:used|clicked)\b/i, 'disabled'],
]

const FEEL =
  /\b(?:feel|look|vibe|style|aesthetic)s?\b.{0,40}\b(?:like|of)\b|\binspired by\b|\bin the style of\b|\bmore like\b|\bsimilar to\b|\bmatch(?:es|ing)?\b.{0,40}\b(?:screenshot|image|picture|this|attached|style)\b/i
const CONTRAST =
  /\bcontrast\b|\breadab(?:le|ility)\b|\blegib(?:le|ility)\b|\baccessib(?:le|ility)\b|\bwcag\b|\bhard to read\b/i
const STYLE_WORDS =
  /\bshadows?\b|\bborders?\b|\boutlines?\b|\bedges?\b|\bglow\b|\bunderlines?\b|\bbackground(?: colou?r)?\b|\bfill\b|\bdarker\b|\blighter\b|\bsubtle\b|\bopacity\b|\blift\b|\bletter[- ]spacing\b|\btight(?:er)?\b|\bpadding\b|\bgradient\b/i
const ONE_BLOCK =
  /\b(?:only|just)\b.{0,30}\bblock\b|\bthe (?:\w+ ){0,2}block\b.{0,40}\b(?:background|border|shadow|tint|colou?r)\b|\b(?:background|border|shadow|tint|colou?r)\b.{0,40}\bthe (?:\w+ ){0,2}block\b/i

const ONE_CALL_ELEMENTS = new Set(['page', 'headline', 'subtitle'])

/**
 * Where a request's change goes, read from its words: one page, phones, one
 * part. English words only, so a hint for the model and the route, never
 * the authority: how far a request may reach is the composer chip's
 * (ai-reach.ts), which the server holds every change to.
 */
export interface RequestScope {
  page?: OverridePage
  phone: boolean
  one: boolean
}

const PAGE_WORD: Array<[RegExp, OverridePage]> = [
  [/home ?page|home/, 'home'],
  [/feedback(?: page| board)?/, 'feedback'],
  [/roadmap/, 'roadmap'],
  [/changelog/, 'changelog'],
  [/help cent(?:er|re)|knowledge base/, 'help'],
  [/support/, 'support'],
  [/status/, 'status'],
  [/post page|posts? pages?/, 'post'],
]
const ON_PAGE = new RegExp(
  `\\b(?:on|in|for)\\s+(?:the\\s+)?(${PAGE_WORD.map(([re]) => re.source).join('|')})(?:'s)?(?:\\s+page)?\\b(?!\\s+(?:block|tab|menu|item|link|column))`,
  'i'
)
const PHONE =
  /\bon (?:a |the )?(?:phones?|mobiles?|small screens?|mobile devices?|narrow screens?)\b|\bphones?\b(?! number)|\bon mobile\b|\bmobile (?:only|view|screens?|devices?)\b|\bsmall screens?\b/i
const ONE =
  /\bjust (?:this|that|the)\b|\bonly (?:this|that|the \w+(?:'s|’s) )|\bthis one\b|\bbut (?:leave|not|keep) (?:the )?(?:other|rest)|\bleave the others?\b|\bnot the others?\b|\bthe rest alone\b|\bonly (?:this|that) one\b/i

/** The scope a request's words name: one page, phones, one part. */
export function scopeOf(text: string): RequestScope {
  const on = ON_PAGE.exec(text)
  const word = on?.[1]?.toLowerCase() ?? ''
  const page = on
    ? PAGE_WORD.find(([re]) => new RegExp(`^(?:${re.source})$`).test(word))?.[1]
    : undefined
  return { ...(page ? { page } : {}), phone: PHONE.test(text), one: ONE.test(text) }
}

/** What the scope a request names asks of the operations, for the model; '' for none. */
export function scopeNote(text: string): string {
  const { page, phone, one } = scopeOf(text)
  const said = [
    page && `only the ${page} page (op override, target page:${page})`,
    phone &&
      'phones only (op override, key phone.<element>.<state>.<property>: sizes and shapes, as colours are the same on every screen)',
    one &&
      'one part only (op override, target part:<id>: the part picked, or the one the request names), never every one of its kind',
  ].filter(Boolean)
  return said.length ? `The request reads as about ${said.join('; and ')}.` : ''
}

/** Elements named in a request, by the registry's names and other words. */
export function namedElements(registry: StyleRegistry, text: string): string[] {
  const lower = text.toLowerCase()
  return registry.elements
    .filter((element) =>
      [
        element.id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
        element.name.toLowerCase(),
        ...element.aliases,
      ].some((word) =>
        new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(lower)
      )
    )
    .map((element) => element.id)
}

/** The way a request goes, and the elements it names. */
export function routeRequest(
  registry: StyleRegistry,
  input: { message: string; images: number }
): Route {
  const text = input.message
  const elements = namedElements(registry, text)
  const states = STATE_WORDS.filter(([word]) => word.test(text)).map(([, state]) => state)
  const targets: StyleTarget[] = elements.flatMap((element) => {
    const own = registry.elements.find((e) => e.id === element)!
    return (['base', ...states] as StyleStateId[])
      .filter((state, at, all) => own.states.includes(state) && all.indexOf(state) === at)
      .map((state) => ({ element, state, block: '' }))
  })
  const take = (why: string): Route => ({ mode: 'loop', why, targets })
  // One part, one page or phones: one call, whose override says exactly where.
  const scoped = scopeOf(text)
  if (input.images === 0 && (scoped.page || scoped.phone || scoped.one))
    return { mode: 'single', why: 'one part, page or screen', targets }
  // The current menu item's mark (tabs, an underline, a pill) is a Theme choice; only its
  // own colours or weight need the loop.
  const voted = /\bvoted\b|\bonce (?:someone|a visitor|they) votes?\b/i.test(text)
  const own = states.filter(
    (state) =>
      state !== 'current' ||
      voted ||
      STYLE_WORDS.test(text) ||
      /\b(?:bold|colou?r|weight)\b/i.test(text)
  )
  if (own.length > 0) return take(`a ${own.join(' and ')} state`)
  if (input.images > 0 && /\b(?:match|like|copy|same|this)\b/i.test(text))
    return take('a picture to match')
  if (FEEL.test(text)) return take('a look described by feel')
  if (CONTRAST.test(text)) return take('contrast')
  if (ONE_BLOCK.test(text)) return take('one block’s style')
  // The page's background is its own operation, and a headline's lighter half a mark: one call each.
  const styled = elements.filter((element) => !ONE_CALL_ELEMENTS.has(element))
  if (STYLE_WORDS.test(text) && styled.length > 0) return take('an element’s style')
  return { mode: 'single', why: 'a plain change', targets }
}
