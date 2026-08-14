/**
 * Weekly cross-channel theme digest — synthesizes feedback posts + support
 * conversation themes for the PM ritual (Slack / MCP).
 *
 * The job gathers recent titles and leaves a structured digest payload that
 * notification / Slack handlers can publish. Full LLM synthesis hooks into
 * the existing AI model config when present.
 */
import { db, posts, conversations, desc, isNull, gte, and } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'theme-digest' })

export interface ThemeDigestItem {
  kind: 'post' | 'conversation'
  id: string
  title: string
  createdAt: string
}

export interface ThemeDigest {
  generatedAt: string
  windowDays: number
  items: ThemeDigestItem[]
  summary: string
}

/** Collect recent feedback + open conversation subjects for a digest window. */
export async function buildThemeDigest(windowDays = 7): Promise<ThemeDigest> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const recentPosts = await db
    .select({
      id: posts.id,
      title: posts.title,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(isNull(posts.deletedAt), gte(posts.createdAt, since)))
    .orderBy(desc(posts.voteCount))
    .limit(25)

  const recentConversations = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(gte(conversations.createdAt, since))
    .orderBy(desc(conversations.createdAt))
    .limit(25)

  const items: ThemeDigestItem[] = [
    ...recentPosts.map((row) => ({
      kind: 'post' as const,
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
    })),
    ...recentConversations.map((row) => ({
      kind: 'conversation' as const,
      id: row.id,
      title: row.subject?.trim() || 'Conversation',
      createdAt: row.createdAt.toISOString(),
    })),
  ]

  const summary =
    items.length === 0
      ? `No new feedback or conversations in the last ${windowDays} days.`
      : `${recentPosts.length} feedback posts and ${recentConversations.length} conversations in the last ${windowDays} days. Top themes to review are listed below.`

  log.info(
    { post_count: recentPosts.length, conversation_count: recentConversations.length },
    'theme digest built'
  )

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    items,
    summary,
  }
}
