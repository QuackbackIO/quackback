/**
 * Anchor ids for content headings. The article HTML and the help center's table
 * of contents both build ids from the same heading nodes, in document order, so
 * a heading's anchor and its table-of-contents link always agree. Repeated
 * heading text (an "Options" section under each platform, say) gets `-1`, `-2`
 * suffixes, so every heading has its own anchor and the scrollspy marks one
 * entry at a time. A heading keeps its natural slug even when repeats before it
 * would otherwise take that slug as a suffix.
 */

/** The parts of a TipTap node that heading ids read. */
export interface HeadingNode {
  type?: string
  text?: string
  content?: HeadingNode[]
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The text of a node and everything beneath it. */
export function plainText(node: HeadingNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  return node.content?.map(plainText).join('') ?? ''
}

/**
 * Every heading in a document, in document order, wherever it nests. The root
 * counts too, so a bare heading node (serialized without a doc around it) keeps
 * its id.
 */
export function collectHeadings<T extends HeadingNode>(root: {
  type?: string
  content?: T[]
}): T[] {
  const headings: T[] = []
  const visit = (node: HeadingNode) => {
    if (node.type === 'heading') headings.push(node as T)
    else for (const child of node.content ?? []) visit(child)
  }
  visit(root)
  return headings
}

/**
 * Ids for one document's headings, keyed by heading node. Pass the headings from
 * `collectHeadings`. Every natural slug is reserved before any suffix is handed
 * out, so a suffix never takes a slug that a later heading owns. Headings with
 * no text get no entry.
 */
export function createHeadingIds(headings: readonly HeadingNode[]): Map<HeadingNode, string> {
  const slugs = headings.map((node) => slugifyHeading(plainText(node)))
  const reserved = new Set(slugs.filter(Boolean))
  const used = new Set<string>()
  const ids = new Map<HeadingNode, string>()

  const claim = (base: string): string => {
    if (!used.has(base)) return base
    let n = 1
    while (used.has(`${base}-${n}`) || reserved.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }

  headings.forEach((node, index) => {
    const base = slugs[index]
    if (!base) return
    const id = claim(base)
    used.add(id)
    ids.set(node, id)
  })
  return ids
}
