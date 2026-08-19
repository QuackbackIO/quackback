/**
 * The markdown-lite grammar AI answers are instructed to use: paragraphs,
 * ordered/bullet lists, `**bold**` runs, and — per surface — `*italic*` runs
 * and `[n]` citation markers. One parser shared by every surface that reads
 * an answer: the Ask AI card and Quinn's answer renderer consume it through
 * components/help-center/ask-ai-text.ts (citations on), and the Copilot
 * composer insert through copilot-format.ts (italic on) — so the grammar
 * can't drift between them. Anything a surface's grammar leaves off stays
 * literal text. Pure and isomorphic; output is data rendered as React text
 * nodes or Tiptap nodes, so there is no HTML injection surface.
 */

export interface MarkdownLiteSpan {
  text: string
  bold?: boolean
  italic?: boolean
  /** True when this span was a single-backtick `code` run. */
  code?: boolean
  /** 1-based citation number when this span is a `[n]` marker (Wikipedia-style). */
  cite?: number
}

export type MarkdownLiteBlock =
  | { kind: 'paragraph'; lines: MarkdownLiteSpan[][] }
  | {
      kind: 'list'
      ordered: boolean
      /** The first item's number on an ordered list, present only when it is
       *  not 1 (e.g. a numbered list resuming after an interposed paragraph)
       *  — consumers that support it map this to the list's start attribute. */
      start?: number
      items: MarkdownLiteSpan[][]
    }

/** Which optional inline constructs a surface recognizes. `**bold**` is
 *  always on; anything switched off stays literal text. */
export interface MarkdownLiteGrammar {
  /** Parse `*x*` / `_x_` runs into italic spans. */
  italic?: boolean
  /** Parse single-backtick runs into code spans. Anchored to one line, so a
   *  stray backtick can never swallow text across a newline. */
  code?: boolean
  /** Parse `[n]` markers into citation spans. */
  citations?: boolean
}

// One alternation per construct, keyed by named group. Italic content can't
// start/end with whitespace (so `2 * 3 * 4` stays literal) and the `_` form
// is word-boundary guarded (so snake_case identifiers stay literal). Order
// matters: ** wins over *.
const BOLD_SRC = String.raw`\*\*(?<bold>[^*]+)\*\*`
const STAR_ITALIC_SRC = String.raw`\*(?<star>[^*\s](?:[^*]*[^*\s])?)\*`
const UNDERSCORE_ITALIC_SRC = String.raw`(?<![\w_])_(?<under>[^_\s](?:[^_]*[^_\s])?)_(?![\w_])`
// One line only ([^`\n]) so an unpaired backtick can't swallow to a match on
// a later line; code wins over bold/italic by starting earlier (the backtick
// precedes the inner markers), never by alternation order.
const CODE_SRC = String.raw`\x60(?<code>[^\x60\n]+)\x60`
const CITE_SRC = String.raw`\[(?<cite>\d+)\]`

// Each grammar combination's regex compiles once (matchAll clones it per
// call, so sharing the instance is safe).
const inlineReCache = new Map<string, RegExp>()
function inlineRe({ italic, code, citations }: MarkdownLiteGrammar): RegExp {
  const key = `${italic ? 'i' : ''}${code ? 'x' : ''}${citations ? 'c' : ''}`
  let re = inlineReCache.get(key)
  if (!re) {
    const parts = [BOLD_SRC]
    if (italic) parts.push(STAR_ITALIC_SRC, UNDERSCORE_ITALIC_SRC)
    if (code) parts.push(CODE_SRC)
    if (citations) parts.push(CITE_SRC)
    re = new RegExp(parts.join('|'), 'g')
    inlineReCache.set(key, re)
  }
  return re
}

/** Parse one line's inline runs into spans (plain / bold / italic / cite). */
function parseInline(line: string, grammar: MarkdownLiteGrammar): MarkdownLiteSpan[] {
  const spans: MarkdownLiteSpan[] = []
  let last = 0
  for (const m of line.matchAll(inlineRe(grammar))) {
    const idx = m.index ?? 0
    if (idx > last) spans.push({ text: line.slice(last, idx) })
    const g = m.groups ?? {}
    if (g.bold !== undefined) spans.push({ text: g.bold, bold: true })
    else if (g.star !== undefined) spans.push({ text: g.star, italic: true })
    else if (g.under !== undefined) spans.push({ text: g.under, italic: true })
    else if (g.code !== undefined) spans.push({ text: g.code, code: true })
    else if (g.cite !== undefined) spans.push({ text: g.cite, cite: Number(g.cite) })
    last = idx + m[0].length
  }
  if (last < line.length) spans.push({ text: line.slice(last) })
  return spans.length > 0 ? spans : [{ text: '' }]
}

const BULLET_RE = /^\s*[-*•]\s+/
const ORDERED_RE = /^\s*(\d+)\.\s+/

/**
 * Parse answer text into paragraph and list blocks. Only the structures AI
 * answers are instructed to use (paragraphs, ordered/bullet lists, and the
 * grammar's inline constructs) are recognized; anything else stays literal
 * text. A block is a list only when every one of its lines shares one marker
 * style.
 */
export function parseMarkdownLite(
  text: string,
  grammar: MarkdownLiteGrammar = {}
): MarkdownLiteBlock[] {
  const blocks: MarkdownLiteBlock[] = []
  for (const raw of text.split(/\n{2,}/)) {
    const blockText = raw.trim()
    if (!blockText) continue
    const lines = blockText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    if (lines.length > 0 && lines.every((l) => ORDERED_RE.test(l))) {
      const start = Number(ORDERED_RE.exec(lines[0])?.[1] ?? '1')
      blocks.push({
        kind: 'list',
        ordered: true,
        ...(start !== 1 ? { start } : {}),
        items: lines.map((l) => parseInline(l.replace(ORDERED_RE, '').trim(), grammar)),
      })
      continue
    }
    if (lines.length > 0 && lines.every((l) => BULLET_RE.test(l))) {
      blocks.push({
        kind: 'list',
        ordered: false,
        items: lines.map((l) => parseInline(l.replace(BULLET_RE, '').trim(), grammar)),
      })
      continue
    }
    blocks.push({ kind: 'paragraph', lines: lines.map((l) => parseInline(l, grammar)) })
  }
  return blocks
}
