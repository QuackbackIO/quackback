import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { answerToInsertContent } from './copilot-insert-content'

/** Controlled rich-text value plus the markdown mirror persisted for search. */
export type ComposerDraft = { json: TiptapContent | null; markdown: string }

export const EMPTY_DRAFT: ComposerDraft = { json: null, markdown: '' }

function textToParagraphs(text: string): TiptapContent[] {
  return text
    .split('\n')
    .map((line) =>
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    )
}

function appendToDraft(
  previous: ComposerDraft,
  nodes: TiptapContent[],
  markdown: string
): ComposerDraft {
  const empty = isEmptyTiptapDoc(previous.json ?? undefined)
  const existing = !empty && previous.json?.content ? previous.json.content : []
  return {
    json: { type: 'doc', content: [...existing, ...nodes] },
    markdown:
      !empty && previous.markdown.trim() ? `${previous.markdown.trim()}\n\n${markdown}` : markdown,
  }
}

export function appendTextToDraft(previous: ComposerDraft, text: string): ComposerDraft {
  return appendToDraft(previous, textToParagraphs(text), text)
}

export function appendAnswerToDraft(previous: ComposerDraft, answer: string): ComposerDraft {
  const { nodes, markdown } = answerToInsertContent(answer)
  return appendToDraft(previous, nodes, markdown)
}

export function answerToDraft(answer: string): ComposerDraft {
  const { nodes, markdown } = answerToInsertContent(answer, { stripCitations: false })
  return { json: { type: 'doc', content: nodes }, markdown }
}
