import {
  AssistantAnswer,
  AssistantSourcesTrace,
  type RenderableCitation,
} from '@/components/shared/conversation/assistant-turn'
import type { JsonValue } from '@/lib/shared/json'

const SOURCE_TYPES = new Set([
  'article',
  'post',
  'snippet',
  'summary',
  'ticket',
  'changelog',
  'document',
  'webpage',
])

function referencesFrom(citations: JsonValue[]): RenderableCitation[] {
  const references: RenderableCitation[] = []
  citations.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    if (
      typeof value.type !== 'string' ||
      !SOURCE_TYPES.has(value.type) ||
      typeof value.id !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.url !== 'string'
    )
      return
    references[index] = {
      type: value.type as RenderableCitation['type'],
      id: value.id,
      title: value.title,
      url: value.url,
      ...(value.internal === true ? { internal: true } : {}),
      ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    }
  })
  return references
}

export function WorkspaceAssistantMessage({
  text,
  citations,
  streaming = false,
}: {
  text: string
  citations: JsonValue[]
  streaming?: boolean
}) {
  const references = referencesFrom(citations)
  return (
    <>
      <AssistantAnswer text={text} citations={references} caret={streaming} />
      {!streaming && <AssistantSourcesTrace citations={references.filter(Boolean)} />}
    </>
  )
}
