import type { PhrasingContent, RootContent } from 'mdast'
import {
  prepareAnswerMarkdown,
  type AnswerInsertOptions,
} from '@/lib/shared/assistant/copilot-format'
import type { TiptapContent } from '@/lib/shared/db-types'

type Marks = NonNullable<TiptapContent['marks']>

/** Convert parsed Markdown to the conversation editor's existing node schema. */
function inlineNodes(nodes: PhrasingContent[], marks: Marks = []): TiptapContent[] {
  return nodes.flatMap((node): TiptapContent[] => {
    switch (node.type) {
      case 'text':
        return node.value
          .split('\n')
          .flatMap((text, index) => [
            ...(index ? [{ type: 'hardBreak' }] : []),
            ...(text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []),
          ])
      case 'break':
        return [{ type: 'hardBreak' }]
      case 'inlineCode':
        return [{ type: 'text', text: node.value, marks: [...marks, { type: 'code' }] }]
      case 'strong':
        return inlineNodes(node.children, [...marks, { type: 'bold' }])
      case 'emphasis':
        return inlineNodes(node.children, [...marks, { type: 'italic' }])
      case 'delete':
        return inlineNodes(node.children, [...marks, { type: 'strike' }])
      case 'link':
        return inlineNodes(node.children, [...marks, { type: 'link', attrs: { href: node.url } }])
      default:
        return [] // References, images and HTML were normalized before conversion.
    }
  })
}

function blockNodes(nodes: RootContent[]): TiptapContent[] {
  return nodes.flatMap((node): TiptapContent[] => {
    switch (node.type) {
      case 'paragraph': {
        const content = inlineNodes(node.children)
        return [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }]
      }
      case 'code':
        return [
          {
            type: 'codeBlock',
            ...(node.lang ? { attrs: { language: node.lang } } : {}),
            ...(node.value ? { content: [{ type: 'text', text: node.value }] } : {}),
          },
        ]
      case 'blockquote': {
        const content = blockNodes(node.children)
        return [{ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] }]
      }
      case 'list':
        return [
          {
            type: node.ordered ? 'orderedList' : 'bulletList',
            ...(node.ordered && node.start !== null && node.start !== undefined && node.start !== 1
              ? { attrs: { start: node.start } }
              : {}),
            content: node.children.map((item) => ({
              type: 'listItem',
              content: blockNodes(item.children),
            })),
          },
        ]
      default:
        return [] // Unsupported document structures were normalized to paragraphs.
    }
  })
}

export interface AnswerInsertContent {
  nodes: TiptapContent[]
  markdown: string
}

/** Parse once for both the rich draft and its Markdown projection. */
export function answerToInsertContent(
  text: string,
  options: AnswerInsertOptions = {}
): AnswerInsertContent {
  const { tree, markdown } = prepareAnswerMarkdown(text, options)
  const nodes = blockNodes(tree.children)
  return { nodes: nodes.length ? nodes : [{ type: 'paragraph' }], markdown }
}
