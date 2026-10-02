/**
 * Syntax highlighting for the text engine, split into the lines it draws.
 * Only the highlight worker loads this module, so the grammars stay in the
 * worker's own bundle and never in a page chunk.
 */
import { common, createLowlight } from 'lowlight'
import { highlightLimit, MAX_HIGHLIGHT_LINE, type HighlightedLines, type Token } from './text-lines'

/** One file's text to highlight; `language` null guesses one. */
export interface HighlightRequest {
  id: number
  text: string
  language: string | null
}

/** The answer to the request with the same id: the highlighted lines, or null to stay plain. */
export interface HighlightResponse {
  id: number
  lines: HighlightedLines | null
}

const lowlight = createLowlight(common)

type HastNode = {
  type: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

/** Splits a highlight tree into lines, each a list of tokens with its innermost class. */
function treeToLines(root: HastNode): Token[][] {
  const lines: Token[][] = [[]]
  const walk = (node: HastNode, cls: string | undefined) => {
    if (node.type === 'text') {
      const parts = (node.value ?? '').split('\n')
      parts.forEach((part, i) => {
        if (i > 0) lines.push([])
        if (part) lines[lines.length - 1]!.push(cls ? { text: part, cls } : { text: part })
      })
      return
    }
    const names = node.properties?.className
    const own = Array.isArray(names)
      ? (names as string[]).find((n) => n.startsWith('hljs-'))
      : undefined
    for (const child of node.children ?? []) walk(child, own ?? cls)
  }
  walk(root, undefined)
  return lines
}

/** A line too long to be worth colouring, as one plain token. */
function plainIfLong(tokens: Token[]): Token[] {
  let length = 0
  for (const token of tokens) length += token.text.length
  return length > MAX_HIGHLIGHT_LINE ? [{ text: tokens.map((t) => t.text).join('') }] : tokens
}

/**
 * The tokens of each line of `text`, highlighted in one piece so multi-line
 * comments and strings colour right. Null when the text is over the size it
 * may be highlighted at, the language has no grammar, or highlighting fails.
 */
export function highlightLines(text: string, language: string | null): Token[][] | null {
  if (text.length > highlightLimit(language)) return null
  if (language !== null && !lowlight.registered(language)) return null
  try {
    const tree =
      language === null ? lowlight.highlightAuto(text) : lowlight.highlight(language, text)
    return treeToLines(tree as unknown as HastNode).map(plainIfLong)
  } catch {
    return null
  }
}

/** Packs tokens into the arrays the page reads them back from (see `HighlightedLines`). */
export function encodeLines(lines: Token[][]): HighlightedLines {
  const classes: string[] = []
  const classNumber = new Map<string, number>()
  const starts = new Uint32Array(lines.length + 1)
  let count = 0
  for (const tokens of lines) count += tokens.length
  const runs = new Uint32Array(count * 2)
  let at = 0
  lines.forEach((tokens, i) => {
    starts[i] = at
    for (const token of tokens) {
      let number = 0
      if (token.cls) {
        number = classNumber.get(token.cls) ?? classes.push(token.cls)
        classNumber.set(token.cls, number)
      }
      runs[at++] = token.text.length
      runs[at++] = number
    }
  })
  starts[lines.length] = at
  return { classes, starts, runs }
}

export function handleHighlightRequest(request: HighlightRequest): HighlightResponse {
  const lines = highlightLines(request.text, request.language)
  return { id: request.id, lines: lines && encodeLines(lines) }
}
