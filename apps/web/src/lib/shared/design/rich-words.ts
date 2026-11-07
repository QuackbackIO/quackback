/**
 * The portal's words as rich text: what each kind of words may hold, how a
 * headline's accent phrase reads as a mark on its words, and a small markup
 * the AI reads and writes for both. The design keeps its own fields (a
 * headline's text, its accent phrase and the phrase's style; a Welcome body as
 * a document); this maps them to and from the editor's documents, so the
 * builder's editor, the AI and the brand match all set the same fields.
 *
 * Kinds:
 * - headline: one line; one phrase may be set apart (Accent, Highlight or Lighter).
 * - plain: one line, no marks (subtitles, block headings, button labels, menu names).
 * - rich: paragraphs, headings (H2, H3), line breaks, bold, italic, links,
 *   lists, alignment and colours from the brand's colour roles (Welcome bodies).
 *   No word has a size of its own: type stays consistent.
 */
import { DESIGN_OPTIONS } from './options'

export type WordsKind = 'headline' | 'plain' | 'rich'
export type AccentStyle = (typeof DESIGN_OPTIONS.headlineAccent)[number]
export type ColourRole = (typeof DESIGN_OPTIONS.colourRole)[number]
export type RichMark = 'bold' | 'italic' | 'link' | 'colour'
/** Where a paragraph or heading sits: the start (left unset), the centre or the end. */
export type WordsAlign = 'start' | 'center' | 'end'

/** The heading levels rich words hold. */
export const RICH_HEADINGS = [2, 3] as const
/** The alignments rich words keep; the start is the default and left unset. */
export const RICH_ALIGNS = ['center', 'end'] as const

/** Whether a value is one of the brand's colour roles. */
export const isColourRole = (value: unknown): value is ColourRole =>
  (DESIGN_OPTIONS.colourRole as readonly unknown[]).includes(value)

const isRichHeading = (level: unknown) => (RICH_HEADINGS as readonly unknown[]).includes(level)
export const isRichAlign = (align: unknown): align is 'center' | 'end' =>
  (RICH_ALIGNS as readonly unknown[]).includes(align)

/**
 * The colour words in a role are drawn in: the design's colour for words in
 * that role, moved until it reads where the words sit (words-colour.ts),
 * else the role's own colour, else the brand colour.
 */
export function wordsColour(role: ColourRole): string {
  const brand = 'var(--qb-accent-text, var(--primary))'
  return role === 'accent'
    ? `var(--qb-words-accent, ${brand})`
    : `var(--qb-words-${role}, var(--qb-role-${role}, ${brand}))`
}

/** The words an accent phrase holds at most. */
export const ACCENT_MAX = 60

/** How each accent style is named to people, its word in the markup, and how it looks. */
export const ACCENT_LOOKS: ReadonlyArray<{
  style: AccentStyle
  name: string
  markup: string
  looks: string
}> = [
  { style: 'colour', name: 'Accent', markup: 'accent', looks: 'in the brand colour' },
  {
    style: 'highlight',
    name: 'Highlight',
    markup: 'highlight',
    looks: 'a marker highlight behind the words',
  },
  {
    style: 'muted',
    name: 'Lighter',
    markup: 'lighter',
    looks: 'a lighter second tone, as a two-tone headline',
  },
]

/** The markup's word for each style. */
const MARKUP_STYLE = Object.fromEntries(
  ACCENT_LOOKS.map((look) => [look.style, look.markup])
) as Record<AccentStyle, string>

/** The words the markup reads for each style, its own and others people write. */
const STYLE_WORDS: Record<string, AccentStyle> = {
  accent: 'colour',
  colour: 'colour',
  color: 'colour',
  highlight: 'highlight',
  highlighted: 'highlight',
  lighter: 'muted',
  muted: 'muted',
  light: 'muted',
}

/** The words the markup reads for each colour role, its own and others people write. */
const ROLE_WORDS: Record<string, ColourRole> = {
  accent: 'accent',
  brand: 'accent',
  primary: 'accent',
  support: 'support',
  second: 'support',
  secondary: 'support',
  extra1: 'extra1',
  extra2: 'extra2',
}

/** A colour role from a word of the markup, or null for none of the brand's. */
export const roleOfWord = (word: string): ColourRole | null =>
  ROLE_WORDS[word.trim().toLowerCase()] ?? null

/** What each kind of words may hold. */
export const WORDS_KINDS: Record<
  WordsKind,
  { marks: readonly string[]; lines: 'one' | 'many'; lists: boolean }
> = {
  headline: { marks: ['accent'], lines: 'one', lists: false },
  plain: { marks: [], lines: 'one', lists: false },
  rich: { marks: ['bold', 'italic', 'link', 'colour'], lines: 'many', lists: true },
}

/* Documents */

export interface WordsMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface WordsNode {
  type: string
  text?: string
  marks?: WordsMark[]
  attrs?: Record<string, unknown>
  content?: WordsNode[]
}
export interface WordsDoc {
  type: 'doc'
  content?: WordsNode[]
}

/**
 * A headline as the design keeps it: its words and the phrase set apart, with
 * the colour role the phrase is drawn in when it is not the brand colour.
 * Words read from the markup leave `colour` out, so the design keeps its own.
 */
export interface HeadlineWords {
  title: string
  accent: { text: string; style: AccentStyle; colour?: ColourRole } | null
}

const textNode = (text: string, marks?: WordsMark[]): WordsNode =>
  marks?.length ? { type: 'text', text, marks } : { type: 'text', text }

/** One line of words as a document. */
export function plainDoc(text: string): WordsDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', ...(text ? { content: [textNode(text)] } : {}) }],
  }
}

/** All the words of a document, a line's words joined by a space. */
export function docText(doc: WordsDoc | WordsNode | null | undefined): string {
  if (!doc) return ''
  const blocks: string[] = []
  const walk = (node: WordsNode, into: string[]) => {
    if (node.type === 'text') into.push(node.text ?? '')
    else if (node.type === 'hardBreak') into.push(' ')
    else node.content?.forEach((child) => walk(child, into))
  }
  for (const block of (doc as WordsNode).content ?? []) {
    const words: string[] = []
    walk(block, words)
    blocks.push(words.join(''))
  }
  return blocks.join(' ').replace(/\s+/g, ' ').trim()
}

/** A line's words with runs of space made one, as a one-line field keeps them. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A headline as the editor's document: its accent phrase a mark on the words it covers. */
export function headlineDoc(words: HeadlineWords): WordsDoc {
  const { title, accent } = words
  const at = accent?.text ? title.indexOf(accent.text) : -1
  if (!accent || at < 0) return plainDoc(title)
  const mark = {
    type: 'accent',
    attrs: { style: accent.style, ...(ownRole(accent.colour) ? { colour: accent.colour } : {}) },
  }
  const runs = [title.slice(0, at), accent.text, title.slice(at + accent.text.length)]
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: runs
          .map((text, index) => (index === 1 ? textNode(text, [mark]) : textNode(text)))
          .filter((node) => node.text),
      },
    ],
  }
}

/**
 * A headline's words and accent from the editor's document. One phrase is
 * set apart: the first run of accented words; a second is left as words.
 */
export function headlineFromDoc(doc: WordsDoc): HeadlineWords {
  const runs: Array<{ text: string; style: AccentStyle | null; colour?: ColourRole }> = []
  const walk = (node: WordsNode) => {
    if (node.type === 'text') {
      const mark = node.marks?.find((each) => each.type === 'accent')
      const style = mark ? styleOf(mark.attrs?.style) : null
      const colour = mark?.attrs?.colour
      runs.push({ text: node.text ?? '', style, colour: ownRole(colour) ? colour : undefined })
    } else if (node.type === 'hardBreak') runs.push({ text: ' ', style: null })
    else node.content?.forEach(walk)
  }
  ;(doc.content ?? []).forEach((block, index) => {
    if (index > 0) runs.push({ text: ' ', style: null })
    walk(block)
  })
  // Leading space trimmed first, so the phrase's place is counted in the kept words.
  let title = ''
  let phrase = ''
  let style: AccentStyle | null = null
  let colour: ColourRole | undefined
  let done = false
  for (const run of runs) {
    if (run.style && !done && (style === null || style === run.style)) {
      if (style === null) colour = run.colour
      style = run.style
      phrase += run.text
    } else if (style !== null) done = true
    title += run.text
  }
  const kept = oneLine(title)
  const set = oneLine(phrase).slice(0, ACCENT_MAX)
  return {
    title: kept,
    accent:
      style && set && kept.includes(set)
        ? { text: set, style, ...(colour ? { colour } : {}) }
        : null,
  }
}

/** A colour role other than the brand colour, which an accent names only when it is not. */
const ownRole = (value: unknown): value is Exclude<ColourRole, 'accent'> =>
  isColourRole(value) && value !== 'accent'

const styleOf = (value: unknown): AccentStyle =>
  (DESIGN_OPTIONS.headlineAccent as readonly string[]).includes(value as string)
    ? (value as AccentStyle)
    : 'colour'

/* The markup the AI reads and writes */

/** A headline in markup: `Help shape what [Acme]{accent} grows into`. */
export function headlineMarkup(words: HeadlineWords): string {
  const { title, accent } = words
  const at = accent?.text ? title.indexOf(accent.text) : -1
  if (!accent || at < 0) return title
  // The phrase's colour role after its look, where it is not the brand colour: {accent:support}.
  const role = ownRole(accent.colour) ? `:${accent.colour}` : ''
  return `${title.slice(0, at)}[${accent.text}]{${MARKUP_STYLE[accent.style]}${role}}${title.slice(at + accent.text.length)}`
}

/**
 * A phrase marked in the markup, such as `[Acme]{accent}` or
 * `[Acme]{highlight:support}`: the phrase, its look's word and its colour role's.
 */
export const ACCENT_MARKUP = /\[([^\]\n]+)\]\{\s*([a-z0-9]+)(?:\s*:\s*([a-z0-9]+))?\s*\}/gi

/** Words with any phrase marks taken off, on one line. */
export const unmarked = (text: string) => oneLine(text.replace(ACCENT_MARKUP, '$1'))

/** Whether words carry the headline markup, which plain words may not. */
export const hasAccentMarkup = (text: string) => new RegExp(ACCENT_MARKUP.source, 'i').test(text)

/**
 * A headline from markup: `[phrase]{accent}`, `{highlight}` or `{lighter}`
 * sets one phrase apart. Plain words are a headline with no phrase set apart.
 */
export function readHeadlineMarkup(
  text: string
): { ok: true; words: HeadlineWords } | { ok: false; refusal: string } {
  const found = [...text.matchAll(ACCENT_MARKUP)]
  if (found.length > 1)
    return { ok: false, refusal: 'A headline sets apart one phrase: mark one with [words]{accent}' }
  if (!found.length) return { ok: true, words: { title: oneLine(text), accent: null } }
  const [whole, phrase, word, roleWord] = found[0]!
  // A colour role alone, {support}, is the accent look in that colour.
  const alone = roleWord || STYLE_WORDS[word!.toLowerCase()] ? null : roleOfWord(word!)
  const style = STYLE_WORDS[word!.toLowerCase()] ?? (alone ? 'colour' : undefined)
  if (!style)
    return {
      ok: false,
      refusal: `A phrase is set apart as {accent}, {highlight} or {lighter}, not {${word}}`,
    }
  const colour = roleWord ? roleOfWord(roleWord) : alone
  if (roleWord && !colour)
    return {
      ok: false,
      refusal: `A phrase's colour is one of the brand's roles (${DESIGN_OPTIONS.colourRole.join(', ')}), not ${roleWord}`,
    }
  const set = oneLine(phrase!)
  if (set.length > ACCENT_MAX)
    return { ok: false, refusal: `A phrase set apart is up to ${ACCENT_MAX} characters` }
  const title = oneLine(text.replace(whole!, phrase!))
  // A role said, the brand colour's too, is kept so it can clear one the design has.
  return {
    ok: true,
    words: { title, accent: set ? { text: set, style, ...(colour ? { colour } : {}) } : null },
  }
}

const LINK_PROTOCOLS = /^(https?:\/\/|mailto:)/i

/** Whether a link may be kept: a web address or an email link, nothing a page would run. */
export function isAllowedHref(href: unknown): href is string {
  if (typeof href !== 'string' || !LINK_PROTOCOLS.test(href.trim())) return false
  try {
    const url = new URL(href.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

/** Rich words as compact markdown: **bold**, *italic*, [link](https://…), lists, blank lines. */
export function richMarkdown(doc: WordsDoc | null | undefined): string {
  if (!doc) return ''
  return (doc.content ?? [])
    .map((block) => blockMarkdown(block))
    .filter((block) => block !== '')
    .join('\n\n')
}

/** A paragraph's or heading's alignment as the markup writes it after its words: ` {center}`. */
const alignMarkup = (block: WordsNode) =>
  isRichAlign(block.attrs?.textAlign) ? ` {${block.attrs.textAlign}}` : ''

function blockMarkdown(block: WordsNode): string {
  switch (block.type) {
    case 'paragraph':
      return `${inlineMarkdown(block.content ?? [])}${alignMarkup(block)}`
    case 'heading':
      return `${'#'.repeat(Number(block.attrs?.level ?? 2))} ${inlineMarkdown(block.content ?? [])}${alignMarkup(block)}`
    case 'bulletList':
    case 'orderedList':
      return (block.content ?? [])
        .map((item, index) => {
          const bullet = block.type === 'bulletList' ? '-' : `${index + 1}.`
          const words = (item.content ?? []).map((child) => blockMarkdown(child)).join(' ')
          return `${bullet} ${words}`
        })
        .join('\n')
    case 'image':
      return '[an image]'
    default:
      return docText(block)
  }
}

function inlineMarkdown(nodes: readonly WordsNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '\n'
      if (node.type !== 'text') return docText(node)
      let text = node.text ?? ''
      const marks = node.marks ?? []
      if (marks.some((mark) => mark.type === 'italic')) text = `*${text}*`
      if (marks.some((mark) => mark.type === 'bold')) text = `**${text}**`
      const link = marks.find((mark) => mark.type === 'link')
      if (link) text = `[${text}](${String(link.attrs?.href ?? '')})`
      const colour = marks.find((mark) => mark.type === 'colour')
      if (colour && isColourRole(colour.attrs?.role)) text = `[${text}]{${colour.attrs.role}}`
      return text
    })
    .join('')
}

/** An alignment written after a paragraph's or heading's words, as people write it. */
const ALIGN_MARKUP = /\s*\{\s*(center|centre|middle|end|right|start|left)\s*\}\s*$/i
const ALIGN_WORDS: Record<string, 'center' | 'end' | null> = {
  center: 'center',
  centre: 'center',
  middle: 'center',
  end: 'end',
  right: 'end',
  start: null,
  left: null,
}

/** A block's words with its alignment taken off its end, and the alignment. */
function alignOf(block: string): { words: string; align: Record<string, unknown> } {
  const m = ALIGN_MARKUP.exec(block)
  if (!m) return { words: block, align: {} }
  const align = ALIGN_WORDS[m[1]!.toLowerCase()]
  return { words: block.slice(0, m.index), align: align ? { textAlign: align } : {} }
}

/**
 * Rich words from compact markdown: a blank line between paragraphs, a line
 * break within one, lines of "- " or "1. " a list, **bold**, *italic*,
 * [words](https://…), [words]{support} in a colour role, and {center} or
 * {end} after a paragraph's or heading's words. A link that is not a web or
 * email address, or a colour that is not a role, is refused.
 */
export function readRichMarkdown(
  text: string
): { ok: true; doc: WordsDoc } | { ok: false; refusal: string } {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim())
  const content: WordsNode[] = []
  for (const whole of blocks) {
    const { words: block, align } = alignOf(whole)
    const lines = block.split('\n')
    const heading = lines.length === 1 ? /^(#{2,3})\s+(\S.*)$/.exec(lines[0]!.trim()) : null
    if (heading) {
      const read = readInline(heading[2]!.trim())
      if (!read.ok) return read
      content.push({
        type: 'heading',
        attrs: { level: heading[1]!.length, ...align },
        content: read.nodes,
      })
      continue
    }
    const bullet = lines.every((line) => /^\s*[-*•]\s+/.test(line))
    const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line))
    if (bullet || ordered) {
      const items: WordsNode[] = []
      for (const line of lines) {
        const read = readInline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))
        if (!read.ok) return read
        items.push({ type: 'listItem', content: [paragraph(read.nodes)] })
      }
      content.push({ type: bullet ? 'bulletList' : 'orderedList', content: items })
      continue
    }
    const nodes: WordsNode[] = []
    for (const [index, line] of lines.entries()) {
      const read = readInline(line.trim())
      if (!read.ok) return read
      if (index > 0) nodes.push({ type: 'hardBreak' })
      nodes.push(...read.nodes)
    }
    content.push(withAttrs(paragraph(nodes), align))
  }
  return { ok: true, doc: { type: 'doc', content } }
}

const paragraph = (nodes: WordsNode[]): WordsNode =>
  nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' }

/** A block with attributes, where it has any. */
const withAttrs = (node: WordsNode, attrs: Record<string, unknown>): WordsNode =>
  Object.keys(attrs).length
    ? { type: node.type, attrs, ...(node.content ? { content: node.content } : {}) }
    : node

/** The inline words of a line, with their marks. */
function readInline(
  line: string,
  marks: WordsMark[] = []
): { ok: true; nodes: WordsNode[] } | { ok: false; refusal: string } {
  const nodes: WordsNode[] = []
  let plain = ''
  const flush = () => {
    if (plain) nodes.push(textNode(plain, marks.length ? [...marks] : undefined))
    plain = ''
  }
  let at = 0
  while (at < line.length) {
    const rest = line.slice(at)
    // Words in a colour role, which may hold a link: [words]{support}.
    const coloured = /^\[((?:[^[\]\n]|\[[^\]\n]*\]\([^)\s]*\))+)\]\{\s*([^}\n]*?)\s*\}/.exec(rest)
    if (coloured) {
      const role = roleOfWord(coloured[2]!)
      if (!role)
        return {
          ok: false,
          refusal: `Words are coloured in one of the brand's roles (${DESIGN_OPTIONS.colourRole.join(', ')}), not ${coloured[2] || 'nothing'}`,
        }
      flush()
      const inner = readInline(coloured[1]!, [...marks, { type: 'colour', attrs: { role } }])
      if (!inner.ok) return inner
      nodes.push(...inner.nodes)
      at += coloured[0].length
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)\s]*)\)/.exec(rest)
    if (link) {
      if (!isAllowedHref(link[2]))
        return {
          ok: false,
          refusal: `A link goes to a web address (https://…) or an email (mailto:…), not ${link[2] || 'nothing'}`,
        }
      flush()
      const inner = readInline(link[1]!, [...marks, { type: 'link', attrs: { href: link[2] } }])
      if (!inner.ok) return inner
      nodes.push(...inner.nodes)
      at += link[0].length
      continue
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)
    if (strong) {
      flush()
      const inner = readInline(strong[2]!, [...marks, { type: 'bold' }])
      if (!inner.ok) return inner
      nodes.push(...inner.nodes)
      at += strong[0].length
      continue
    }
    const em = /^(\*|_)(?=\S)([^*_]*?\S)\1(?![*_])/.exec(rest)
    if (em && (em[1] === '*' || !/\w/.test(line[at - 1] ?? ''))) {
      flush()
      const inner = readInline(em[2]!, [...marks, { type: 'italic' }])
      if (!inner.ok) return inner
      nodes.push(...inner.nodes)
      at += em[0].length
      continue
    }
    plain += line[at]
    at += 1
  }
  flush()
  return { ok: true, nodes: mergeRuns(nodes) }
}

/** Neighbouring runs with the same marks as one. */
function mergeRuns(nodes: WordsNode[]): WordsNode[] {
  const out: WordsNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (
      last?.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    )
      out[out.length - 1] = { ...last, text: `${last.text}${node.text}` }
    else out.push(node)
  }
  return out
}

/* Fitting a document to its kind */

/**
 * A document fitted to its kind, as words-schema.ts checks it: what a kind
 * cannot hold is cut (marks it does not allow, and for one-line kinds every
 * block but one paragraph of words; rich words keep paragraphs, H2 and H3
 * headings, line breaks and lists, other blocks becoming paragraphs of their
 * words), and the design's own rules applied: links only to web and email
 * addresses, colours only from the brand's roles, a headline's one phrase set
 * apart of up to ACCENT_MAX characters, and a line's limit of characters.
 */
export function fitDoc(
  doc: WordsDoc | null | undefined,
  kind: WordsKind,
  limit?: number | null
): WordsDoc {
  const allowed = WORDS_KINDS[kind].marks
  const keepMarks = (marks: WordsMark[] | undefined) => {
    const kept = (marks ?? [])
      .filter(
        (mark) =>
          allowed.includes(mark.type) &&
          (mark.type !== 'link' || isAllowedHref(mark.attrs?.href)) &&
          (mark.type !== 'colour' || isColourRole(mark.attrs?.role))
      )
      .map((mark): WordsMark => {
        // Only what the design keeps: a page's own link classes or targets, read back, are not words.
        if (mark.type === 'colour') return { type: 'colour', attrs: { role: mark.attrs!.role } }
        if (mark.type === 'link') return { type: 'link', attrs: { href: mark.attrs!.href } }
        if (mark.type === 'accent') {
          const colour = mark.attrs?.colour
          return {
            type: 'accent',
            attrs: {
              style: styleOf(mark.attrs?.style),
              ...(ownRole(colour) ? { colour } : {}),
            },
          }
        }
        return { type: mark.type }
      })
    return kept.length ? kept : undefined
  }
  const inline = (nodes: readonly WordsNode[] | undefined, breaks: boolean): WordsNode[] =>
    mergeRuns(
      (nodes ?? []).flatMap((node): WordsNode[] => {
        if (node.type === 'text')
          return node.text ? [textNode(node.text, keepMarks(node.marks))] : []
        if (node.type === 'hardBreak') return breaks ? [{ type: 'hardBreak' }] : [textNode(' ')]
        return inline(node.content, breaks)
      })
    )
  if (kind !== 'rich') {
    const runs: WordsNode[] = []
    for (const [index, block] of (doc?.content ?? []).entries()) {
      if (index > 0) runs.push(textNode(' '))
      runs.push(...inline(flattenBlocks(block), false))
    }
    const line: WordsDoc = {
      type: 'doc',
      content: [paragraph(cutRuns(trimRuns(mergeRuns(runs)), limit))],
    }
    // A headline as the design keeps it: one phrase set apart, of up to ACCENT_MAX characters.
    return kind === 'headline' ? headlineDoc(headlineFromDoc(line)) : line
  }
  const block = (node: WordsNode): WordsNode[] => {
    if (node.type === 'bulletList' || node.type === 'orderedList')
      return [
        {
          type: node.type,
          content: (node.content ?? []).map((item) => ({
            type: 'listItem',
            content: [paragraph(inline(flattenBlocks(item), true))],
          })),
        },
      ]
    const align = isRichAlign(node.attrs?.textAlign) ? { textAlign: node.attrs.textAlign } : {}
    if (node.type === 'paragraph') return [withAttrs(paragraph(inline(node.content, true)), align)]
    if (node.type === 'heading' && isRichHeading(node.attrs?.level)) {
      const words = inline(node.content, true)
      return [
        {
          type: 'heading',
          attrs: { level: node.attrs!.level, ...align },
          ...(words.length ? { content: words } : {}),
        },
      ]
    }
    if (node.type === 'image' || node.type === 'horizontalRule') return []
    const words = inline(flattenBlocks(node), true)
    return words.length ? [paragraph(words)] : []
  }
  return { type: 'doc', content: (doc?.content ?? []).flatMap(block) }
}

/** A block's inline words, its own blocks' words joined by line breaks. */
function flattenBlocks(node: WordsNode): WordsNode[] {
  if (!node.content) return node.type === 'text' || node.type === 'hardBreak' ? [node] : []
  if (node.content.every((child) => child.type === 'text' || child.type === 'hardBreak'))
    return node.content
  return node.content.flatMap((child, index) =>
    index > 0 ? [{ type: 'hardBreak' }, ...flattenBlocks(child)] : flattenBlocks(child)
  )
}

/** A line's runs cut to a limit of characters, when it has one. */
function cutRuns(runs: WordsNode[], limit: number | null | undefined): WordsNode[] {
  if (!limit) return runs
  let room = limit
  const out: WordsNode[] = []
  for (const run of runs) {
    if (room <= 0) break
    const text = (run.text ?? '').slice(0, room)
    room -= text.length
    out.push({ ...run, text })
  }
  return out
}

/** A line's runs without the space at either end. */
function trimRuns(runs: WordsNode[]): WordsNode[] {
  const out = runs.map((run) => ({ ...run, text: (run.text ?? '').replace(/\s+/g, ' ') }))
  if (out[0]) out[0] = { ...out[0], text: out[0].text!.replace(/^\s+/, '') }
  const last = out.length - 1
  if (out[last]) out[last] = { ...out[last], text: out[last].text!.replace(/\s+$/, '') }
  return out.filter((run) => run.text)
}

/** JSON with its keys in order, so two documents compare as words whatever order their keys came in. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value ?? null, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )

/** Whether two documents hold the same words: the one test of "unchanged" for every place words are edited. */
export const sameWords = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b)

/** Whether a value, as a message carries it, is a words document. */
export function isWordsDoc(value: unknown): value is WordsDoc {
  if (!value || typeof value !== 'object') return false
  const { type, content } = value as { type?: unknown; content?: unknown }
  return type === 'doc' && (content === undefined || Array.isArray(content))
}

/* Keeping colours a rewrite dropped */

/** The paragraphs and headings of a document, in order, lists' items included. */
function textBlocks(doc: WordsDoc | null | undefined): WordsNode[] {
  const out: WordsNode[] = []
  const walk = (node: WordsNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') out.push(node)
    else node.content?.forEach(walk)
  }
  doc?.content?.forEach(walk)
  return out
}

/** A block's words as characters, a line break as one, each with the colour role it has. */
function colouredChars(block: WordsNode): { text: string; roles: Array<string | null> } {
  let text = ''
  const roles: Array<string | null> = []
  for (const node of block.content ?? []) {
    const words = node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : ''
    const role = node.marks?.find((m) => m.type === 'colour')?.attrs?.role
    for (const char of words) {
      text += char
      roles.push(typeof role === 'string' ? role : null)
    }
  }
  return { text, roles }
}

/**
 * Where each character of the new words was in the old: the words both
 * begin and end with line up, the words between are new.
 */
function alignChars(before: string, after: string): Array<number | null> {
  const a = [...before]
  const b = [...after]
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++
  return b.map((_, i) => (i < start ? i : i >= b.length - end ? i - b.length + a.length : null))
}

/**
 * A rewrite of rich words with the colours it dropped on words it did not
 * touch put back. A model asked to colour some words, or to change some,
 * may write the rest without the colours they had; a block whose words
 * changed, or that gained a colour, keeps the colours on the words it kept.
 * A block that only lost colours is as written: taking them away was meant.
 */
export function keepColours(before: WordsDoc | null | undefined, after: WordsDoc): WordsDoc {
  const old = textBlocks(before).map(colouredChars)
  if (!old.some((block) => block.roles.some(Boolean))) return after
  const used = new Set<number>()
  const out = structuredClone(after)
  textBlocks(out).forEach((block, index) => {
    const now = colouredChars(block)
    // Its old self: the block with the same words, else the one in its place.
    let at = old.findIndex((o, i) => !used.has(i) && o.text === now.text)
    if (at < 0 && index < old.length && !used.has(index)) at = index
    if (at < 0) return
    used.add(at)
    const was = old[at]!
    if (!was.roles.some(Boolean)) return
    const map = alignChars(was.text, now.text)
    const wasAt = (i: number) => (map[i] === null ? null : (was.roles[map[i]!] ?? null))
    const gained = now.roles.some((role, i) => role !== null && role !== wasAt(i))
    if (now.text === was.text && !gained) return
    const roles = now.roles.map((role, i) => role ?? wasAt(i))
    if (roles.every((role, i) => role === now.roles[i])) return
    let i = 0
    const content: WordsNode[] = []
    for (const node of block.content ?? []) {
      if (node.type !== 'text') {
        if (node.type === 'hardBreak') i++
        content.push(node)
        continue
      }
      const chars = [...(node.text ?? '')]
      const others = (node.marks ?? []).filter((m) => m.type !== 'colour')
      let run = ''
      let runRole: string | null | undefined
      const flush = () => {
        if (!run) return
        const marks = runRole ? [...others, { type: 'colour', attrs: { role: runRole } }] : others
        content.push({ type: 'text', text: run, ...(marks.length ? { marks } : {}) })
        run = ''
      }
      for (const char of chars) {
        const role = roles[i++] ?? null
        if (run && role !== runRole) flush()
        runRole = role
        run += char
      }
      flush()
    }
    block.content = content
  })
  return out
}
