/**
 * The kinds of source a Quinn citation / retrieved item can point at. The
 * single source of truth for both `AssistantCitation.type`
 * (assistant.toolspec.ts) and `RetrievedItem.sourceType` / `KnowledgeSource`
 * (retrieval-sources.ts) — kept in this tiny leaf module so neither of those
 * two files has to import the other just to share the union.
 */
export const ASSISTANT_CITATION_TYPES = [
  'article',
  'post',
  'snippet',
  'summary',
  'ticket',
  'changelog',
] as const

export type AssistantCitationType = (typeof ASSISTANT_CITATION_TYPES)[number]
