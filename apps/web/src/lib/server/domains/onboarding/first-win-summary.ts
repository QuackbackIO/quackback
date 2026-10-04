/**
 * The first win, named: who outside the team acted, on what, and where to see
 * it. Home's celebration card says this instead of a generic "first result".
 * Whether the win happened is decided by `detectFirstWin`; this only finds the
 * record worth naming, so a missing name never hides a real win.
 */
import {
  db,
  and,
  asc,
  boards,
  conversationMessages,
  conversations,
  eq,
  helpCenterArticleFeedback,
  helpCenterArticles,
  inArray,
  isNull,
  or,
  posts,
  principal,
  sql,
  statusSubscriptions,
  user,
  type SetupState,
} from '@/lib/server/db'
import { notTestPrincipal } from '@/lib/server/test-data'

export interface FirstWinSummary {
  kind: 'idea' | 'teamIdea' | 'conversation' | 'helpful' | 'subscriber'
  /** The person's name, when they gave one. */
  name: string | null
  /** Their email's domain, which names their company. */
  domain: string | null
  /** The idea or article title, or the start of the message. */
  subject: string | null
  /** Votes on the idea so far. */
  votes?: number
  at: string
  /** Where the team sees it. */
  href: string
}

const outside = and(
  or(eq(principal.role, 'user'), eq(principal.type, 'anonymous')),
  notTestPrincipal(principal.id)
)!

function domainOf(email: string | null | undefined): string | null {
  if (!email || email.startsWith('temp-')) return null
  const at = email.lastIndexOf('@')
  return at > 0 ? email.slice(at + 1).toLowerCase() : null
}

function nameOf(displayName: string | null, userName: string | null): string | null {
  const name = (userName || displayName || '').trim()
  return name.length > 0 ? name : null
}

function snippet(text: string | null): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

/** The record that made the workspace's first win, or null when there is none to name. */
export async function firstWinSummary(state: SetupState | null): Promise<FirstWinSummary | null> {
  const primary = state?.goals?.[0] ?? state?.useCase ?? 'product_feedback'
  const outcome = primary === 'product_feedback' && state?.feedbackPrivate ? 'internal' : primary
  const who = {
    displayName: principal.displayName,
    userName: user.name,
    email: user.email,
  }

  if (outcome === 'customer_support') {
    const [row] = await db
      .select({ id: conversations.id, at: conversations.createdAt, ...who })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          inArray(conversations.source, ['widget', 'email']),
          sql`coalesce(${conversations.customAttributes}->>'test', 'false') <> 'true'`,
          notTestPrincipal(conversations.visitorPrincipalId)
        )
      )
      .orderBy(asc(conversations.createdAt))
      .limit(1)
    if (!row) return null
    const [first] = await db
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, row.id))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
      .limit(1)
    return {
      kind: 'conversation',
      name: nameOf(row.displayName, row.userName),
      domain: domainOf(row.email),
      subject: snippet(first?.content ?? null),
      at: row.at.toISOString(),
      href: `/admin/inbox?c=${row.id}`,
    }
  }

  if (outcome === 'status_page') {
    const [row] = await db
      .select({ at: statusSubscriptions.createdAt, ...who })
      .from(statusSubscriptions)
      .innerJoin(principal, eq(principal.id, statusSubscriptions.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(and(isNull(statusSubscriptions.unsubscribedAt), outside))
      .orderBy(asc(statusSubscriptions.createdAt))
      .limit(1)
    if (!row) return null
    return {
      kind: 'subscriber',
      name: nameOf(row.displayName, row.userName),
      domain: domainOf(row.email),
      subject: null,
      at: row.at.toISOString(),
      href: '/admin/status?view=subscribers',
    }
  }

  if (outcome === 'help_center') {
    const [row] = await db
      .select({
        at: helpCenterArticleFeedback.createdAt,
        articleId: helpCenterArticles.id,
        title: helpCenterArticles.title,
        ...who,
      })
      .from(helpCenterArticleFeedback)
      .innerJoin(helpCenterArticles, eq(helpCenterArticles.id, helpCenterArticleFeedback.articleId))
      .innerJoin(principal, eq(principal.id, helpCenterArticleFeedback.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          eq(helpCenterArticleFeedback.helpful, true),
          isNull(helpCenterArticles.deletedAt),
          outside
        )
      )
      .orderBy(asc(helpCenterArticleFeedback.createdAt))
      .limit(1)
    if (!row) return null
    return {
      kind: 'helpful',
      name: nameOf(row.displayName, row.userName),
      domain: domainOf(row.email),
      subject: row.title,
      at: row.at.toISOString(),
      href: `/admin/help-center?article=${row.articleId}`,
    }
  }

  // Ideas: by a customer on any board, or by a teammate on a private team board.
  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      votes: posts.voteCount,
      at: posts.createdAt,
      ...who,
    })
    .from(posts)
    .innerJoin(principal, eq(principal.id, posts.principalId))
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        isNull(posts.deletedAt),
        sql`coalesce(${posts.widgetMetadata}->>'onboardingGenerated', 'false') <> 'true'`,
        outcome === 'internal'
          ? and(sql`${boards.access}->>'view' = 'team'`, notTestPrincipal(principal.id))
          : outside
      )
    )
    .orderBy(asc(posts.createdAt))
    .limit(1)
  if (!row) return null
  return {
    kind: outcome === 'internal' ? 'teamIdea' : 'idea',
    name: nameOf(row.displayName, row.userName),
    domain: outcome === 'internal' ? null : domainOf(row.email),
    subject: row.title,
    votes: row.votes,
    at: row.at.toISOString(),
    href: `/admin/feedback?post=${row.id}`,
  }
}
