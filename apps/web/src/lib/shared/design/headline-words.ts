/**
 * Writing a page's headline words, by language: Home's and the feed's
 * headlines and the other pages' titles. Words emptied in every language
 * leave the page on its usual words.
 */
import { DESIGN_OPTIONS } from './options'
import {
  headlineDoc,
  headlineFromDoc,
  docText,
  plainDoc,
  type HeadlineWords,
  type WordsDoc,
  type WordsKind,
} from './rich-words'
import type { PortalDesign } from './schema'
import { checkedWords } from './words-schema'

export type WordedPage = 'home' | 'feedback' | (typeof DESIGN_OPTIONS.titledPage)[number]
export type WordsPart = 'title' | 'subtitle'

/** A Home block's plain words other than its heading: its way on, its line, its empty message. */
export type BlockWordsPart = 'link' | 'text' | 'empty'

/**
 * What a `data-qb-words` mark names: part of a page's headline, a Home
 * block's heading, way on, line or empty message, a Welcome block's words,
 * or the feed's welcome message.
 */
export type WordsField =
  | { kind: 'page'; page: WordedPage; part: WordsPart }
  | { kind: 'block'; id: string; part?: 'heading' | 'body' | BlockWordsPart }
  | { kind: 'welcome' }
  /** Home's call to action in the hero, or its quiet second button. */
  | { kind: 'button'; part: 'label' | 'secondLabel' }

/** The most a hero button's words hold. */
export const BUTTON_WORDS_MAX = 40

/** Where each of a block's own plain words is stored, its length, and the blocks that have it. */
const BLOCK_WORDS: Record<
  BlockWordsPart,
  { key: 'link' | 'text' | 'emptyText'; max: number; name: string; types: readonly string[] }
> = {
  link: {
    key: 'link',
    max: 40,
    name: 'Link',
    types: ['ideas', 'roadmap', 'updates', 'help_search', 'help_topics', 'status', 'contact'],
  },
  text: { key: 'text', max: 160, name: 'Words', types: ['contact'] },
  empty: {
    key: 'emptyText',
    max: 80,
    name: 'Message when empty',
    types: ['ideas', 'roadmap', 'updates', 'help_topics', 'status'],
  },
}

const ownPart = (field: WordsField) =>
  field.kind === 'block' && field.part && field.part in BLOCK_WORDS
    ? BLOCK_WORDS[field.part as BlockWordsPart]
    : null

/** Reads a mark such as `roadmap.title`, `block-<id>.heading` or `feedback.welcome`. */
export function readWordsField(field: unknown): WordsField | null {
  if (typeof field !== 'string') return null
  if (field === 'feedback.welcome') return { kind: 'welcome' }
  if (field === 'home.button') return { kind: 'button', part: 'label' }
  if (field === 'home.secondButton') return { kind: 'button', part: 'secondLabel' }
  const block = /^block-([a-z0-9]{8,24})\.(heading|body|link|text|empty)$/.exec(field)
  if (block)
    return block[2] === 'heading'
      ? { kind: 'block', id: block[1]! }
      : { kind: 'block', id: block[1]!, part: block[2] as 'body' | BlockWordsPart }
  const [page, part, ...rest] = field.split('.')
  const pages: readonly string[] = ['home', 'feedback', ...DESIGN_OPTIONS.titledPage]
  if (rest.length || !pages.includes(page!) || (part !== 'title' && part !== 'subtitle'))
    return null
  return { kind: 'page', page: page as WordedPage, part }
}

/** Sets a Home block's heading in one language; emptied in every language, it takes its usual one. */
export function setBlockHeading(
  draft: PortalDesign,
  id: string,
  locale: string,
  text: string
): void {
  const block = draft.pages.home.blocks.find((candidate) => candidate.id === id)
  if (!block) return
  const heading = block.heading ?? {}
  const value = text.slice(0, 60)
  if (value) heading[locale] = value
  else delete heading[locale]
  if (Object.keys(heading).length) block.heading = heading
  else delete block.heading
}

/** Sets one of a Home block's own plain words in one language; emptied in every language, it takes its usual. */
function setBlockWords(
  draft: PortalDesign,
  id: string,
  part: BlockWordsPart,
  locale: string,
  text: string
): void {
  const { key, max, types } = BLOCK_WORDS[part]
  const block = draft.pages.home.blocks.find((candidate) => candidate.id === id) as
    (Record<string, unknown> & { type: string }) | undefined
  if (!block || !types.includes(block.type)) return
  const words = { ...(block[key] as Record<string, string> | undefined) }
  const value = text.slice(0, max)
  if (value) words[locale] = value
  else delete words[locale]
  if (Object.keys(words).length) block[key] = words
  else delete block[key]
}

/** Writes what a words mark names, in one language, as plain words. */
export function setWords(
  draft: PortalDesign,
  field: WordsField,
  locale: string,
  text: string
): void {
  if (field.kind === 'page') setHeadlineWords(draft, field.page, field.part, locale, text)
  else if (field.kind === 'button') setButtonWords(draft, field.part, locale, text)
  else if (field.kind === 'block' && ownPart(field))
    setBlockWords(draft, field.id, field.part as BlockWordsPart, locale, text)
  else if (field.kind === 'block' && field.part !== 'body')
    setBlockHeading(draft, field.id, locale, text)
  else setWordsDoc(draft, field, locale, plainDoc(text))
}

/* The words as the editor holds them */

/** What kind of words a mark names: a headline's title, rich words, or plain. */
export function wordsKindOf(field: WordsField): WordsKind {
  if (field.kind === 'page') return field.part === 'title' ? 'headline' : 'plain'
  if (field.kind === 'button') return 'plain'
  if (field.kind === 'block') return field.part === 'body' ? 'rich' : 'plain'
  return 'rich'
}

/** The characters a mark's words hold at most; none for rich words. */
export function wordsLimitOf(field: WordsField): number | null {
  if (field.kind === 'page') return 280
  if (field.kind === 'button') return BUTTON_WORDS_MAX
  const own = ownPart(field)
  if (own) return own.max
  if (field.kind === 'block' && field.part !== 'body') return 60
  return null
}

/** What a mark's words are called in the builder's undo, such as "Headline". */
export function wordsName(field: WordsField): string {
  if (field.kind === 'welcome') return 'Welcome message'
  if (field.kind === 'button') return field.part === 'label' ? 'Button' : 'Second button'
  const own = ownPart(field)
  if (own) return own.name
  if (field.kind === 'block') return field.part === 'body' ? 'Welcome' : 'Block heading'
  if (field.part === 'subtitle') return 'Subtitle'
  return field.page === 'home' || field.page === 'feedback' ? 'Headline' : 'Page title'
}

/** Whether words are by language: everything but the Welcome bodies. */
export const wordsByLanguage = (field: WordsField) =>
  field.kind === 'page' ||
  field.kind === 'button' ||
  (field.kind === 'block' && field.part !== 'body')

const blockOfId = (design: PortalDesign, id: string) =>
  design.pages.home.blocks.find((candidate) => candidate.id === id)

/** A block's own plain words by language, by where they are stored. */
const ownWordsOf = (block: object | undefined, key: string) =>
  (block as Record<string, Record<string, string> | undefined> | undefined)?.[key]

/** A headline's words and accent in one language. */
export function headlineWordsOf(
  design: PortalDesign,
  page: WordedPage,
  locale: string
): HeadlineWords {
  const headline = headlineOf(design, page)
  const title = headline?.title[locale] ?? ''
  const phrase = headline?.accent?.text[locale]
  const colour = headline?.accent?.colour
  return {
    title,
    accent:
      phrase && headline?.accent
        ? { text: phrase, style: headline.accent.style, ...(colour ? { colour } : {}) }
        : null,
  }
}

/** The words a mark names in one language, as the editor's document. */
export function wordsDocOf(design: PortalDesign, field: WordsField, locale: string): WordsDoc {
  if (field.kind === 'page') {
    if (field.part === 'title') return headlineDoc(headlineWordsOf(design, field.page, locale))
    return plainDoc(headlineOf(design, field.page)?.subtitle[locale] ?? '')
  }
  if (field.kind === 'button')
    return plainDoc(design.pages.home.button?.[field.part]?.[locale] ?? '')
  if (field.kind === 'block') {
    const block = blockOfId(design, field.id)
    const own = ownPart(field)
    if (own) return plainDoc(ownWordsOf(block, own.key)?.[locale] ?? '')
    if (field.part !== 'body') return plainDoc(block?.heading?.[locale] ?? '')
    return ((block as { body?: WordsDoc } | undefined)?.body ?? {
      type: 'doc',
      content: [],
    }) as WordsDoc
  }
  return design.pages.feedback.welcome.body as WordsDoc
}

/** The same words in the other languages that have them, for a hint while one is edited. */
export function wordsElsewhere(
  design: PortalDesign,
  field: WordsField,
  locale: string
): Array<{ locale: string; text: string }> {
  let byLocale: Record<string, string> | undefined
  const own = ownPart(field)
  if (field.kind === 'page') byLocale = headlineOf(design, field.page)?.[field.part]
  else if (field.kind === 'button') byLocale = design.pages.home.button?.[field.part]
  else if (field.kind === 'block' && own)
    byLocale = ownWordsOf(blockOfId(design, field.id), own.key)
  else if (field.kind === 'block' && field.part !== 'body')
    byLocale = blockOfId(design, field.id)?.heading
  return Object.entries(byLocale ?? {})
    .filter(([other, text]) => other !== locale && text)
    .map(([other, text]) => ({ locale: other, text }))
}

/** Sets a page's headline words and its accent phrase in one language. */
export function setHeadline(
  draft: PortalDesign,
  page: WordedPage,
  locale: string,
  words: HeadlineWords,
  /** Words from the editor, whose accent without a colour is the brand colour. */
  fromEditor = false
): void {
  setHeadlineWords(draft, page, 'title', locale, words.title)
  const headline = headlineOf(draft, page)
  if (!headline) return
  if (words.accent && words.title) {
    const accent = headline.accent ?? { style: words.accent.style, text: {} }
    accent.style = words.accent.style
    accent.text[locale] = words.accent.text
    // Words from the editor say the phrase's colour, even when it is the brand colour; markup
    // says it only when written, {accent:accent} giving the brand colour back.
    if (words.accent.colour && words.accent.colour !== 'accent') accent.colour = words.accent.colour
    else if (fromEditor || words.accent.colour === 'accent') delete accent.colour
    headline.accent = accent
  } else setHeadlineAccent(draft, page, locale, '')
}

/** Writes the editor's document to what a mark names, in one language, cut to its kind. */
export function setWordsDoc(
  draft: PortalDesign,
  field: WordsField,
  locale: string,
  doc: WordsDoc
): void {
  const kind = wordsKindOf(field)
  const fitted = checkedWords(doc, kind, wordsLimitOf(field))
  if (field.kind === 'page' && field.part === 'title')
    return setHeadline(draft, field.page, locale, headlineFromDoc(fitted), true)
  if (kind !== 'rich') return setWords(draft, field, locale, docText(fitted))
  const body =
    docText(fitted) || fitted.content?.some((node) => node.type !== 'paragraph')
      ? fitted
      : { type: 'doc' as const, content: [] }
  if (field.kind === 'welcome') {
    draft.pages.feedback.welcome.body = body as never
    return
  }
  if (field.kind === 'block') {
    const block = blockOfId(draft, field.id)
    if (block?.type === 'welcome') block.body = body as never
  }
}

/**
 * What a change to a mark's words is called in the builder's undo: "Headline:
 * words" when the words change, "Headline: accent" when only the phrase set
 * apart, or its look, does.
 */
export function wordsChangeLabel(field: WordsField, before: WordsDoc, after: WordsDoc): string {
  const name = wordsName(field)
  if (wordsKindOf(field) === 'headline') {
    const was = headlineFromDoc(before)
    const now = headlineFromDoc(after)
    if (was.title === now.title && JSON.stringify(was.accent) !== JSON.stringify(now.accent))
      return `${name}: accent`
  }
  if (wordsKindOf(field) === 'rich' && docText(before) === docText(after))
    return `${name}: formatting`
  return `${name}: words`
}

/** Sets a hero button's words in one language; emptied in every language, it takes its usual words. */
export function setButtonWords(
  draft: PortalDesign,
  part: 'label' | 'secondLabel',
  locale: string,
  text: string
): void {
  const button = { ...draft.pages.home.button }
  const words = { ...button[part] }
  const value = text.slice(0, BUTTON_WORDS_MAX)
  if (value) words[locale] = value
  else delete words[locale]
  if (Object.keys(words).length) button[part] = words
  else delete button[part]
  if (Object.keys(button).length) draft.pages.home.button = button
  else delete draft.pages.home.button
}

/** Sets one part of a page's headline in one language; empty text removes it. */
export function setHeadlineWords(
  draft: PortalDesign,
  page: WordedPage,
  part: WordsPart,
  locale: string,
  text: string
): void {
  const value = text.slice(0, 280)
  if (page === 'home' || page === 'feedback') {
    const holder = draft.pages[page]
    const headline = holder.headline ?? { title: {}, subtitle: {} }
    if (value) headline[part][locale] = value
    else delete headline[part][locale]
    holder.headline = isEmpty(headline) ? null : headline
    return
  }
  const titles = (draft.pages.titles ??= {})
  const words = titles[page] ?? { title: {}, subtitle: {} }
  if (value) words[part][locale] = value
  else delete words[part][locale]
  if (isEmpty(words)) delete titles[page]
  else titles[page] = words
  if (!Object.keys(titles).length) delete draft.pages.titles
}

function isEmpty(headline: { title: object; subtitle: object }): boolean {
  return Object.keys(headline.title).length + Object.keys(headline.subtitle).length === 0
}

/** A page's stored headline, or null while it keeps its usual words. */
export function headlineOf(design: PortalDesign, page: WordedPage) {
  if (page === 'home' || page === 'feedback') return design.pages[page].headline
  return design.pages.titles?.[page] ?? null
}

/** Sets the phrase of a page's title set apart, in one language; empty text removes it. */
export function setHeadlineAccent(
  draft: PortalDesign,
  page: WordedPage,
  locale: string,
  text: string
): void {
  const headline = headlineOf(draft, page)
  if (!headline) return
  const accent = headline.accent ?? { style: 'colour' as const, text: {} }
  if (text) accent.text[locale] = text.slice(0, 60)
  else delete accent.text[locale]
  if (Object.keys(accent.text).length) headline.accent = accent
  else delete headline.accent
}
