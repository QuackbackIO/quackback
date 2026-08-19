/**
 * The Tiptap-facing half of the Copilot insert-fidelity fix (the pure parse
 * half lives in lib/shared/assistant/copilot-format.ts): turns a Copilot
 * answer / transform result into real editor nodes — bold, italic, and code
 * marks, bullet/ordered lists, code blocks — instead of the literal text
 * nodes `textToParagraphs` (agent-conversation-thread.tsx) builds for
 * plain-text seams like macros and emoji. Node/mark names follow the
 * composer's StarterKit schema (rich-text-editor.tsx): paragraph, bulletList,
 * orderedList, listItem, codeBlock, text with bold/italic/code marks.
 */
import {
  answerMarkdownForInsert,
  parseAnswerMarkdown,
  type AnswerInsertOptions,
  type AnswerInsertSpan,
} from '@/lib/shared/assistant/copilot-format'
import type { TiptapContent } from '@/lib/shared/db-types'

function spansToTextNodes(spans: AnswerInsertSpan[]): TiptapContent[] {
  const nodes: TiptapContent[] = []
  for (const span of spans) {
    if (!span.text) continue
    const marks: { type: string }[] = []
    if (span.bold) marks.push({ type: 'bold' })
    if (span.italic) marks.push({ type: 'italic' })
    if (span.code) marks.push({ type: 'code' })
    nodes.push(
      marks.length > 0
        ? { type: 'text', text: span.text, marks }
        : { type: 'text', text: span.text }
    )
  }
  return nodes
}

function paragraphNode(spans: AnswerInsertSpan[]): TiptapContent {
  const content = spansToTextNodes(spans)
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export interface AnswerInsertContent {
  /** The answer as composer nodes: one paragraph node per line (matching
   *  textToParagraphs' line handling), one bulletList/orderedList node per
   *  list block, and one codeBlock per fenced block. Never empty — an answer
   *  that parses to nothing (e.g. only citation markers) yields a single
   *  empty paragraph, same as inserting "". */
  nodes: TiptapContent[]
  /** The matching markdown mirror (the composer's `content` field),
   *  guaranteed consistent with `nodes` — both come from one pass. */
  markdown: string
}

/**
 * A Copilot answer (or a Format-chip transform of the teammate's own draft —
 * see `AnswerInsertOptions` for which strip rules apply to which path)
 * converted for the composer in a single pass: the markdown mirror is
 * prepared once (answerMarkdownForInsert) and the editor nodes are parsed
 * from it, rather than each side re-running the strip/parse.
 */
export function answerToInsertContent(
  text: string,
  options: AnswerInsertOptions = {}
): AnswerInsertContent {
  const markdown = answerMarkdownForInsert(text, options)
  const nodes: TiptapContent[] = []
  for (const block of parseAnswerMarkdown(markdown)) {
    if (block.kind === 'codeBlock') {
      // StarterKit codeBlock: verbatim text, no inline parsing.
      nodes.push(
        block.text
          ? { type: 'codeBlock', content: [{ type: 'text', text: block.text }] }
          : { type: 'codeBlock' }
      )
      continue
    }
    if (block.kind === 'list') {
      nodes.push({
        type: block.ordered ? 'orderedList' : 'bulletList',
        // StarterKit orderedList supports a start attribute; only a list that
        // doesn't begin at 1 needs it spelled out.
        ...(block.ordered && block.start !== undefined ? { attrs: { start: block.start } } : {}),
        content: block.items.map((item) => ({
          type: 'listItem',
          content: [paragraphNode(item)],
        })),
      })
      continue
    }
    for (const line of block.lines) nodes.push(paragraphNode(line))
  }
  return { nodes: nodes.length > 0 ? nodes : [{ type: 'paragraph' }], markdown }
}
