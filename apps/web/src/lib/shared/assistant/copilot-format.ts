/**
 * Pure text helpers for the Copilot panel's P2-C features (COPILOT-SIDEBAR-UX.md
 * "What P2-C adds"): saving an answer as a macro (C.2) and the Summarize chip
 * (C.3, manual half). Isomorphic: no client- or server-only imports, so the
 * server fn and the panel component can share the same formatting rules.
 */
import { parseMarkdownLite, type MarkdownLiteBlock, type MarkdownLiteSpan } from './markdown-lite'

// The `[n]` citation-marker pattern (markdown-lite's citation construct), the
// numbered dots the answer card renders inline. A macro body has no citation
// list to resolve them against, so they're stripped rather than carried over.
const CITATION_MARKER_RE = /[ \t]*\[\d+\]/g

/**
 * Strip inline `[n]` citation markers from an answer's plain text (e.g. before
 * saving it as a reusable macro body). Consumes a leading space with the
 * marker so removing it never leaves a double space or a stray space before
 * punctuation, and collapses any incidental run of spaces/tabs left behind.
 * Leaves newlines untouched, so multi-line/list formatting survives.
 */
export function stripCitationMarkers(text: string): string {
  return text
    .replace(CITATION_MARKER_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Format an on-demand conversation summary (P2-C.3's Summarize chip) as the
 * plain-text "Question / Summary" block Fin writes into the note composer
 * (COPILOT-SIDEBAR-UX.md screenshot 20). Inserted verbatim through the
 * existing note-insert seam; no markdown rendering is assumed downstream.
 */
export function formatConversationSummaryNote(question: string, bullets: string[]): string {
  const bulletLines = bullets.map((bullet) => `- ${bullet}`).join('\n')
  return `Question\n${question}\n\nSummary\n${bulletLines}`
}

/**
 * The insert-fidelity model for a Copilot answer headed into a composer
 * (COPILOT-SIDEBAR-UX.md B.4's insert seam): the shared markdown-lite grammar
 * the answer card renders (markdown-lite.ts — paragraphs, ordered/bullet
 * lists, bold), extended with italic and inline code, plus verbatim
 * triple-backtick fences as `codeBlock` blocks. The only construct with no
 * composer mapping (headings) has its markers stripped rather than passed
 * through as literal punctuation.
 */
export type AnswerInsertSpan = MarkdownLiteSpan
export type AnswerInsertBlock = MarkdownLiteBlock | { kind: 'codeBlock'; text: string }

/**
 * The strip rules a pass through the insert pipeline applies — made explicit
 * so the two callers can't share the wrong defaults: an ANSWER insert strips
 * `[n]` citation markers (a composer has no citation list to resolve them
 * against), while a DRAFT transform (the Format chip replacing the teammate's
 * own text) must not — a literal `[2]` the teammate typed is their content,
 * not a dangling citation.
 */
export interface AnswerInsertOptions {
  /** Strip `[n]` citation markers. Default true (the answer-insert path). */
  stripCitations?: boolean
}

// This surface's inline grammar: bold + italic + inline code. No citation
// spans — on the answer path the markers are stripped by
// answerMarkdownForInsert before parsing; on the draft path they stay
// literal text (this grammar simply doesn't recognize them).
const INSERT_GRAMMAR = { italic: true, code: true } as const

// Headings have no composer mapping: strip the markers, keep the text.
const HEADING_RE = /^\s*#{1,6}\s+/

// A triple-backtick fence, opening and closing markers on their own lines.
// Fences are split out BEFORE any stripping or inline parsing so their
// contents stay verbatim (a `[1]` array index or `# comment` inside code is
// code, not markup). The `m` flag anchors ^/$ per line.
const FENCE_RE = /^```[^\n]*\n[\s\S]*?\n```[ \t]*$/gm

/** Split text into alternating segments outside and inside code fences. */
function splitFences(text: string): { fence: boolean; text: string }[] {
  const segments: { fence: boolean; text: string }[] = []
  let last = 0
  for (const m of text.matchAll(FENCE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) segments.push({ fence: false, text: text.slice(last, idx) })
    segments.push({ fence: true, text: m[0] })
    last = idx + m[0].length
  }
  if (last < text.length) segments.push({ fence: false, text: text.slice(last) })
  return segments
}

/** A fence segment's inner code, without the ``` marker lines. */
function fenceBody(fence: string): string {
  return fence.replace(/^```[^\n]*\n/, '').replace(/\n```[ \t]*$/, '')
}

/**
 * A Copilot answer's text as it should read once inserted: citation markers
 * gone when `stripCitations` (the answer path; a draft transform keeps them),
 * heading markers stripped to their text, mappable markdown-lite syntax
 * (bold/italic/inline code/lists) kept, and code fences preserved verbatim —
 * this is the composer's markdown mirror for the insert.
 */
export function answerMarkdownForInsert(
  text: string,
  { stripCitations = true }: AnswerInsertOptions = {}
): string {
  return splitFences(text)
    .map((segment) => {
      if (segment.fence) return segment.text
      const stripped = stripCitations ? stripCitationMarkers(segment.text) : segment.text
      return stripped
        .split('\n')
        .map((line) => line.replace(HEADING_RE, ''))
        .join('\n')
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse markdown already prepared by `answerMarkdownForInsert` into the
 * block/span model: the single-pass seam for callers that need both the
 * markdown mirror and the blocks (copilot-insert-content.ts). Fences become
 * `codeBlock` blocks with their inner text verbatim; everything else goes
 * through the markdown-lite grammar.
 */
export function parseAnswerMarkdown(markdown: string): AnswerInsertBlock[] {
  const blocks: AnswerInsertBlock[] = []
  for (const segment of splitFences(markdown)) {
    if (segment.fence) blocks.push({ kind: 'codeBlock', text: fenceBody(segment.text) })
    else blocks.push(...parseMarkdownLite(segment.text, INSERT_GRAMMAR))
  }
  return blocks
}
