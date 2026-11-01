/**
 * A page's elements as a tree, read from its HTML without a browser: each
 * element knows its parent, how far into the page it opens and, for links and
 * buttons, its words. Scripts, styles and drawings are left out.
 */
import type { Element } from './css-cascade'

export interface PageNode extends Element {
  attrs: string
  /** The index of its parent, or -1 at the top. */
  parent: number
  /** How far into the page it opens, 0 at the top and 1 at the end. */
  at: number
  /** A link's or button's words. */
  text?: string
  /** It holds words of its own straight after it opens, not only inside its children. */
  worded?: boolean
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const WORDED = new Set(['a', 'button'])
const LIMIT = 8000

const BLOCK = /<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi
const BLOCK_OPEN = /<(script|style|svg|noscript|template)\b/i
const BLOCK_CLOSE = /<\/(script|style|svg|noscript|template)\b/gi

/**
 * The page without its scripts, styles and drawings. Removal repeats until
 * nothing changes, since taking one block out can join the pieces of
 * another. A block left open runs to the end of the page, as a browser
 * reads it, and a stray closing tag is blanked.
 */
function withoutBlocks(html: string): string {
  let body = html
  for (let pass = 0; pass < 8; pass++) {
    const next = body.replace(BLOCK, ' ')
    if (next === body) break
    body = next
  }
  const open = BLOCK_OPEN.exec(body)
  return (open ? body.slice(0, open.index) : body).replace(BLOCK_CLOSE, ' ')
}

export function pageTree(html: string): PageNode[] {
  const body = withoutBlocks(html)
  const nodes: PageNode[] = []
  const open: number[] = []
  const starts = new Map<number, number>()
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[2]!.toLowerCase()
    const at = m.index ?? 0
    if (m[1]) {
      // A closing tag closes its element and any left open inside it.
      const depth = open.findLastIndex((i) => nodes[i]!.tag === tag)
      if (depth < 0) continue
      const index = open[depth]!
      if (WORDED.has(tag)) {
        const text = body
          .slice(starts.get(index)!, at)
          .slice(0, 600)
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&nbsp;|&#160;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text) nodes[index]!.text = text
      }
      open.length = depth
      continue
    }
    if (nodes.length >= LIMIT) break
    const attrs = m[3] ?? ''
    nodes.push({
      tag,
      id: /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? null,
      classes: new Set(
        (/\bclass\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean)
      ),
      attrs,
      parent: open.at(-1) ?? -1,
      at: at / Math.max(1, body.length),
    })
    const index = nodes.length - 1
    const after = at + m[0].length
    if (/^[^<]*[\p{L}\p{N}]/u.test(body.slice(after, after + 200))) nodes[index]!.worded = true
    if (WORDED.has(tag)) starts.set(index, after)
    if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/')) open.push(index)
  }
  return nodes
}
