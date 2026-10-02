import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import type { Definition, PhrasingContent, Root, RootContent } from 'mdast'
import { sanitizeUrl } from '@/lib/shared/utils/sanitize'
import { CITATION_MARKER_RE } from './citation-markers'

/** Answers omit source dots when inserted. Draft transforms keep literal text. */
export interface AnswerInsertOptions {
  stripCitations?: boolean
}

// Use the same CommonMark/GFM grammar as the answer renderer, without editor
// or server dependencies. The resulting tree also supplies the draft's mirror.
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  listItemIndent: 'one',
})

/** Normalize an answer to the conversation composer's supported structures.
 * Protect code and link labels from citation removal, validate destinations,
 * and keep unsupported document structures readable as ordinary chat content. */
export function prepareAnswerMarkdown(
  text: string,
  { stripCitations = true }: AnswerInsertOptions = {}
): { tree: Root; markdown: string } {
  const stripCitationsRE = new RegExp(`[ \\t]*${CITATION_MARKER_RE.source}`, 'g')
  const tree = processor.parse(text)
  const definitions = new Map<string, Definition>()
  function collect(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'definition' && !definitions.has(node.identifier))
        definitions.set(node.identifier, node)
      if ('children' in node) collect(node.children)
    }
  }
  collect(tree.children)

  function normalize(nodes: RootContent[], strip = stripCitations): RootContent[] {
    return nodes.flatMap((node): RootContent[] => {
      switch (node.type) {
        case 'definition':
          return []
        case 'text':
          return [
            {
              ...node,
              value: strip
                ? node.value.replace(stripCitationsRE, '').replace(/[ \t]{2,}/g, ' ')
                : node.value,
            },
          ]
        case 'heading':
          return [
            { type: 'paragraph', children: normalize(node.children, strip) as PhrasingContent[] },
          ]
        case 'html':
          return [{ type: 'text', value: node.value }]
        case 'link':
        case 'linkReference': {
          const destination = node.type === 'link' ? node : definitions.get(node.identifier)
          const children = normalize(node.children, false) as PhrasingContent[]
          const url = sanitizeUrl(destination?.url ?? '')
          return url ? [{ type: 'link', url, children }] : children
        }
        case 'image':
        case 'imageReference': {
          const destination = node.type === 'image' ? node : definitions.get(node.identifier)
          const children: PhrasingContent[] = [{ type: 'text', value: node.alt || 'Image' }]
          const url = sanitizeUrl(destination?.url ?? '')
          // Conversation images use the attachment tray. Keep Markdown images
          // as links rather than inserting unsupported inline image nodes.
          return url ? [{ type: 'link', url, children }] : children
        }
        case 'table':
          return node.children.map((row) => ({
            type: 'paragraph',
            children: row.children.flatMap((cell, index) => [
              ...(index ? [{ type: 'text' as const, value: ' | ' }] : []),
              ...(normalize(cell.children, strip) as PhrasingContent[]),
            ]),
          }))
        case 'blockquote':
          return [
            {
              ...node,
              children: normalize(node.children, strip).map(asBlock) as typeof node.children,
            },
          ]
        case 'listItem': {
          const children = normalize(node.children, strip).map(asBlock) as typeof node.children
          // The composer schema requires each list item to start with a paragraph.
          if (children[0]?.type !== 'paragraph')
            children.unshift({ type: 'paragraph', children: [] })
          if (node.checked !== null && node.checked !== undefined) {
            const prefix = { type: 'text' as const, value: node.checked ? '☑ ' : '☐ ' }
            if (children[0]?.type === 'paragraph') children[0].children.unshift(prefix)
            else children.unshift({ type: 'paragraph', children: [prefix] })
          }
          return [{ ...node, checked: null, children }]
        }
        case 'footnoteDefinition': {
          const children = normalize(node.children, strip).map(asBlock)
          // The composer has no footnote nodes. Retain the label with its body.
          const prefix = { type: 'text' as const, value: `[${node.identifier}] ` }
          if (children[0]?.type === 'paragraph') children[0].children.unshift(prefix)
          else children.unshift({ type: 'paragraph', children: [prefix] })
          return children
        }
        case 'footnoteReference':
          return [{ type: 'text', value: `[${node.identifier}]` }]
        case 'thematicBreak':
          return []
        default:
          // Code/inlineCode have no children, so their contents stay verbatim.
          return [
            'children' in node
              ? ({ ...node, children: normalize(node.children, strip) } as RootContent)
              : node,
          ]
      }
    })
  }
  const nodes = normalize(tree.children)
  // Standalone HTML becomes a paragraph of escaped text, never executable HTML.
  tree.children = nodes.map(asBlock)
  return { tree, markdown: processor.stringify(tree).trim() }
}

function asBlock(node: RootContent): RootContent {
  return node.type === 'text' ? { type: 'paragraph', children: [node] } : node
}
