import {
  isValidTypeId,
  type KbArticleId,
  type PostId,
  type ChangelogId,
  type AssistantDocumentId,
  type AssistantSnippetId,
  type AssistantWebSourceId,
} from '@quackback/ids'
import {
  db,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  boards,
  changelogEntries,
  assistantDocuments,
  assistantSnippets,
  assistantWebSources,
  and,
  eq,
  isNull,
} from '@/lib/server/db'
import { helpCenterVisibilityConditions } from '@/lib/server/domains/help-center/help-center-search.service'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { postsVisibilityConditions } from './posts-retrieval'
import { changelogVisibilityConditions } from './changelog-retrieval'
import { snippetsVisibilityConditions } from './snippets-retrieval'
import { sourceUseFilter } from './source-use'
import type { AssistantConfig } from '@/lib/shared/assistant/config'

/** Serve current public text, not captured evidence or private originals. */
export async function getCustomerCitationSource(
  type: string,
  id: string,
  knowledge: AssistantConfig['agents']['agent']['knowledge']
): Promise<{ title: string; content: string } | null> {
  if (!isValidTypeId(id)) return null
  let rows: { title: string; content: string }[] = []
  switch (type) {
    case 'article':
      if (!knowledge.helpCenter || !isValidTypeId(id, 'article')) return null
      rows = await db
        .select({ title: helpCenterArticles.title, content: helpCenterArticles.content })
        .from(helpCenterArticles)
        .innerJoin(helpCenterCategories, eq(helpCenterArticles.categoryId, helpCenterCategories.id))
        .where(
          and(
            eq(helpCenterArticles.id, id as KbArticleId),
            sourceUseFilter(helpCenterArticles, 'public'),
            ...helpCenterVisibilityConditions('public', ANONYMOUS_ACTOR)
          )
        )
        .limit(1)
      break
    case 'post':
      if (!knowledge.posts || !isValidTypeId(id, 'post')) return null
      rows = await db
        .select({ title: posts.title, content: posts.content })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(and(eq(posts.id, id as PostId), ...postsVisibilityConditions('public')))
        .limit(1)
      break
    case 'changelog':
      if (!knowledge.changelog || !isValidTypeId(id, 'changelog')) return null
      rows = await db
        .select({ title: changelogEntries.title, content: changelogEntries.content })
        .from(changelogEntries)
        .where(
          and(
            eq(changelogEntries.id, id as ChangelogId),
            ...changelogVisibilityConditions('public')
          )
        )
        .limit(1)
      break
    case 'document':
      if (!knowledge.documents || !isValidTypeId(id, 'assistant_document')) return null
      rows = await db
        .select({ title: assistantDocuments.title, content: assistantDocuments.content })
        .from(assistantDocuments)
        .where(
          and(
            eq(assistantDocuments.id, id as AssistantDocumentId),
            isNull(assistantDocuments.deletedAt),
            sourceUseFilter(assistantDocuments, 'public')
          )
        )
        .limit(1)
      break
    case 'snippet':
      if (!isValidTypeId(id, 'assistant_snippet')) return null
      rows = await db
        .select({ title: assistantSnippets.title, content: assistantSnippets.content })
        .from(assistantSnippets)
        .where(
          and(
            eq(assistantSnippets.id, id as AssistantSnippetId),
            ...snippetsVisibilityConditions('public')
          )
        )
        .limit(1)
      break
    case 'webpage':
      if (!knowledge.webPages || !isValidTypeId(id, 'assistant_web_source')) return null
      rows = await db
        .select({ title: assistantWebSources.title, content: assistantWebSources.content })
        .from(assistantWebSources)
        .where(
          and(
            eq(assistantWebSources.id, id as AssistantWebSourceId),
            eq(assistantWebSources.enabled, true),
            sourceUseFilter(assistantWebSources, 'public')
          )
        )
        .limit(1)
      break
  }
  return rows[0] ?? null
}
