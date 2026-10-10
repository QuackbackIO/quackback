/**
 * The first win, named: who outside the team acted, on what, and where to see
 * it. Home's celebration card says this instead of a generic "first result".
 * Whether the win happened is decided by `detectFirstWin`; this only finds the
 * record worth naming, so a missing name never hides a real win.
 */
import {
  db,
  asc,
  conversationMessages,
  conversations,
  eq,
  helpCenterArticleFeedback,
  helpCenterArticles,
  posts,
  postVotes,
  principal,
  statusSubscriptions,
  user,
  type SetupState,
} from '@/lib/server/db'
import {
  internalWinPost,
  internalWinScope,
  winOutcome,
  winRules,
} from '@/lib/server/activation-wins'
import { resolveUserAvatarUrl } from '@/lib/server/domains/principals/principal-display'
import { principalShownName } from '@/lib/shared/greeting-name'

export interface FirstWinSummary {
  kind: 'idea' | 'vote' | 'teamIdea' | 'conversation' | 'helpful' | 'subscriber'
  /** The person's name, or the name a signed-out visitor was given. */
  name: string | null
  /** A signed-out visitor: any name is one generated for them, not theirs. */
  visitor?: boolean
  /** Their picture, when they have one. */
  avatarUrl: string | null
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

function domainOf(email: string | null | undefined): string | null {
  if (!email || email.startsWith('temp-')) return null
  const at = email.lastIndexOf('@')
  return at > 0 ? email.slice(at + 1).toLowerCase() : null
}

interface Who {
  principalType: string | null
  displayName: string | null
  userName: string | null
  email: string | null
  userImage: string | null
  userImageKey: string | null
  avatarUrl: string | null
  avatarKey: string | null
}

/**
 * Who acted, by the shown-name rule, with their picture as every other
 * surface resolves it, an upload first. A signed-out visitor is marked as
 * one, so a generated name is never read as theirs, and shows no picture.
 */
function nameOf(row: Who): { name: string | null; avatarUrl: string | null; visitor?: true } {
  const name = principalShownName({
    type: row.principalType,
    displayName: row.displayName,
    name: row.userName,
    email: row.email,
  })
  if (row.principalType === 'anonymous') return { name, avatarUrl: null, visitor: true }
  const avatarUrl = resolveUserAvatarUrl({
    userImage: row.userImage,
    userImageKey: row.userImageKey,
    principalAvatarUrl: row.avatarUrl,
    principalAvatarKey: row.avatarKey,
  })
  return { name, avatarUrl }
}

function snippet(text: string | null): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

/** The record that made the workspace's first win, or null when there is none to name. */
export async function firstWinSummary(state: SetupState | null): Promise<FirstWinSummary | null> {
  const outcome = winOutcome(state)
  const who = {
    principalType: principal.type,
    displayName: principal.displayName,
    userName: user.name,
    email: user.email,
    userImage: user.image,
    userImageKey: user.imageKey,
    avatarUrl: principal.avatarUrl,
    avatarKey: principal.avatarKey,
  }

  if (outcome === 'customer_support') {
    const [row] = await db
      .select({ id: conversations.id, at: conversations.createdAt, ...who })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(winRules.customerConversation)
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
      ...nameOf(row),
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
      .where(winRules.selfServeSubscriber)
      .orderBy(asc(statusSubscriptions.createdAt))
      .limit(1)
    if (!row) return null
    return {
      kind: 'subscriber',
      ...nameOf(row),
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
        principalId: helpCenterArticleFeedback.principalId,
        ...who,
      })
      .from(helpCenterArticleFeedback)
      .innerJoin(helpCenterArticles, eq(helpCenterArticles.id, helpCenterArticleFeedback.articleId))
      // A signed-out reader's vote has no principal and still names the article.
      .leftJoin(principal, eq(principal.id, helpCenterArticleFeedback.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(winRules.helpfulVote)
      .orderBy(asc(helpCenterArticleFeedback.createdAt))
      .limit(1)
    if (!row) return null
    return {
      kind: 'helpful',
      ...nameOf(row),
      domain: domainOf(row.email),
      ...(row.principalId === null ? { visitor: true as const } : {}),
      subject: row.title,
      at: row.at.toISOString(),
      href: `/admin/help-center?article=${row.articleId}`,
    }
  }

  const idea = {
    id: posts.id,
    title: posts.title,
    votes: posts.voteCount,
    at: posts.createdAt,
    ...who,
  }

  // A private team board: a teammate's idea on the board the win is judged on.
  if (outcome === 'internal') {
    const scope = await internalWinScope(state)
    if (!scope) return null
    const [row] = await db
      .select(idea)
      .from(posts)
      .innerJoin(principal, eq(principal.id, posts.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(internalWinPost(scope))
      .orderBy(asc(posts.createdAt))
      .limit(1)
    if (!row) return null
    return {
      kind: 'teamIdea',
      ...nameOf(row),
      domain: null,
      subject: row.title,
      votes: row.votes,
      at: row.at.toISOString(),
      href: `/admin/feedback?post=${row.id}`,
    }
  }

  // Ideas: the earlier of a customer's idea and a customer's vote on any idea.
  const [[posted], [voted]] = await Promise.all([
    db
      .select(idea)
      .from(posts)
      .innerJoin(principal, eq(principal.id, posts.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(winRules.outsideIdea)
      .orderBy(asc(posts.createdAt))
      .limit(1),
    db
      .select({ ...idea, at: postVotes.createdAt })
      .from(postVotes)
      .innerJoin(posts, eq(posts.id, postVotes.postId))
      // The voter is who acted.
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(winRules.outsideVote)
      .orderBy(asc(postVotes.createdAt))
      .limit(1),
  ])
  const vote = voted && (!posted || voted.at < posted.at)
  const row = vote ? voted : posted
  if (!row) return null
  return {
    kind: vote ? 'vote' : 'idea',
    ...nameOf(row),
    domain: domainOf(row.email),
    subject: row.title,
    votes: row.votes,
    at: row.at.toISOString(),
    href: `/admin/feedback?post=${row.id}`,
  }
}
