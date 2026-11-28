/**
 * The text an article's AI translation works on, and the way back.
 *
 * The model translates Markdown. Before it sees the body, everything that must
 * not be translated is swapped for a token it is told to keep:
 *
 * - rich nodes Markdown cannot carry (embeds, videos, sized images), which go
 *   back exactly as they were;
 * - code blocks and inline code;
 * - link and image targets (the link text and image alt text stay, and are
 *   translated);
 * - placeholders such as {{name}}.
 *
 * After the model answers, the tokens are put back. A token the model lost
 * shows up in the checks (help-center-translation-checks.ts) as missing code,
 * a missing link or a missing image.
 */
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/server/db'
import { markdownToTiptapJson, tiptapJsonToMarkdown } from '@/lib/server/markdown-tiptap'

/** Node types the Markdown round trip keeps; anything else is lifted out whole. */
const MARKDOWN_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
])

/** Node types whose children are inline (text), so a lifted child stays inline. */
const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading'])

const TOKEN = /⟦\s*([NCIUP])\s*(\d+)\s*⟧/g

const token = (kind: string, i: number) => `⟦${kind}${i}⟧`

export interface PreparedTranslationText {
  /** The Markdown the model translates. */
  markdown: string
  /** What each token stands for, by token. */
  tokens: Map<string, string>
  /** Rich nodes lifted out of the body, by token. */
  nodes: Map<string, JSONContent>
}

function liftRichNodes(
  node: JSONContent,
  nodes: Map<string, JSONContent>,
  inTextblock: boolean
): JSONContent {
  if (node.type && !MARKDOWN_NODE_TYPES.has(node.type)) {
    const t = token('N', nodes.size)
    nodes.set(t, node)
    const text: JSONContent = { type: 'text', text: t }
    return inTextblock ? text : { type: 'paragraph', content: [text] }
  }
  if (!node.content) return node
  const textblock = TEXTBLOCK_TYPES.has(node.type ?? '')
  return { ...node, content: node.content.map((c) => liftRichNodes(c, nodes, textblock)) }
}

/** Swap code, link and image targets and placeholders in Markdown for tokens. */
export function maskMarkdown(markdown: string, tokens: Map<string, string>): string {
  const next = (kind: string, value: string) => {
    const t = token(kind, tokens.size)
    tokens.set(t, value)
    return t
  }
  return (
    markdown
      // Fenced code blocks, whole, fences included.
      .replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, (m) => next('C', m))
      // Inline code.
      .replace(/`[^`\n]+`/g, (m) => next('I', m))
      // Link and image targets: [text](target "title") keeps text, hides the rest.
      .replace(/\]\(([^()\s]+(?:\([^()\s]*\))?[^()\s]*)((?:\s+"[^"]*")?)\)/g, (_m, url, title) => {
        return `](${next('U', `${url}${title}`)})`
      })
      // Autolinks.
      .replace(/<(https?:\/\/[^>\s]+)>/g, (m) => next('U', m))
      // Placeholders.
      .replace(/\{\{[^{}\n]+\}\}/g, (m) => next('P', m))
  )
}

/** Put masked values back. Unknown tokens are left as they are, for the checks to find. */
export function unmaskMarkdown(markdown: string, tokens: Map<string, string>): string {
  return markdown.replace(TOKEN, (m, kind: string, i: string) => {
    if (kind === 'N') return m
    return tokens.get(token(kind, Number(i))) ?? m
  })
}

/** The body as Markdown for the model, with everything that must not change hidden. */
export function prepareTranslationText(body: TiptapContent): PreparedTranslationText {
  const nodes = new Map<string, JSONContent>()
  const lifted = liftRichNodes(body as JSONContent, nodes, false)
  const tokens = new Map<string, string>()
  const markdown = maskMarkdown(tiptapJsonToMarkdown(lifted), tokens)
  return { markdown, tokens, nodes }
}

function restoreRichNodes(node: JSONContent, nodes: Map<string, JSONContent>): JSONContent[] {
  // A paragraph holding only a token was a block node.
  if (node.type === 'paragraph' && node.content?.length === 1) {
    const only = node.content[0]
    const t = only.type === 'text' ? only.text?.trim() : undefined
    if (t && nodes.has(t)) return [nodes.get(t)!]
  }
  if (node.type === 'text' && node.text && /⟦\s*N\s*\d+\s*⟧/.test(node.text)) {
    // An inline token: split the text around it.
    const out: JSONContent[] = []
    let last = 0
    for (const m of node.text.matchAll(/⟦\s*N\s*(\d+)\s*⟧/g)) {
      const t = token('N', Number(m[1]))
      const lifted = nodes.get(t)
      if (!lifted) continue
      if (m.index! > last) out.push({ ...node, text: node.text.slice(last, m.index) })
      out.push(lifted)
      last = m.index! + m[0].length
    }
    if (last < node.text.length) out.push({ ...node, text: node.text.slice(last) })
    return out
  }
  if (!node.content) return [node]
  return [{ ...node, content: node.content.flatMap((c) => restoreRichNodes(c, nodes)) }]
}

/** The translated Markdown back as a rich body, with code, targets and rich nodes restored. */
export function restoreTranslationText(
  translatedMarkdown: string,
  prepared: Pick<PreparedTranslationText, 'tokens' | 'nodes'>
): { markdown: string; contentJson: TiptapContent } {
  const markdown = unmaskMarkdown(translatedMarkdown, prepared.tokens)
  const parsed = markdownToTiptapJson(markdown) as JSONContent
  const [restored] = restoreRichNodes(parsed, prepared.nodes)
  return { markdown, contentJson: restored as TiptapContent }
}
