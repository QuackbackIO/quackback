import type { Actor } from '@/lib/server/policy/types'
import { conversationFilter } from '@/lib/server/policy/conversations'
import {
  db,
  conversations,
  conversationMessages,
  and,
  eq,
  isNull,
  sql,
  desc,
} from '@/lib/server/db'
import type { KnowledgeSource } from './retrieval-sources'
import { KNOWLEDGE_SNIPPET_CHARS } from './retrieval-sources'

/** Explicit member-only adapter; never relax the customer-scoped summary adapter. */
export function workspaceConversationSource(
  includeInternalNotes = false,
  notesOnly = false,
  actor?: Actor
): KnowledgeSource {
  return {
    sourceType: 'summary',
    async retrieve(query, ceiling, { topK }) {
      if (ceiling !== 'team' || !actor) return []
      const rows = await db
        .select({
          id: conversations.id,
          title: conversations.subject,
          content: conversationMessages.content,
          updatedAt: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
        .where(
          and(
            isNull(conversationMessages.deletedAt),
            conversationFilter(actor),
            notesOnly
              ? eq(conversationMessages.isInternal, true)
              : includeInternalNotes
                ? undefined
                : eq(conversationMessages.isInternal, false),
            sql`${conversationMessages.searchVector} @@ websearch_to_tsquery('english', ${query})`
          )
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(Math.min(topK * 3, 60))
      const seen = new Set<string>()
      return rows
        .filter((row) => {
          if (seen.has(row.id)) return false
          seen.add(row.id)
          return true
        })
        .slice(0, topK)
        .map((row) => ({
          id: row.id,
          sourceType: 'summary' as const,
          title: row.title ?? 'Support conversation',
          excerpt: row.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
          score: 0,
          updatedAt: row.updatedAt?.toISOString(),
          citation: {
            type: 'summary' as const,
            id: row.id,
            title: row.title ?? 'Support conversation',
            url: `/admin/inbox?i=${row.id}`,
            internal: true,
          },
        }))
    },
  }
}
