import type { BoardId } from '@quackback/ids'
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
  isNotNull,
  isNull,
  ne,
  or,
  posts,
  postVotes,
  principal,
  sql,
  statusSubscriptions,
  type OnboardingOutcome,
  type SetupState,
} from '@/lib/server/db'
import { notTestPrincipal } from '@/lib/server/test-data'

/**
 * Evidence for a first win. Every win is something a person outside the
 * team did; what the team sets up itself (a service, an article, an idea of
 * the owner's own) never counts.
 */
export interface FirstWinFacts {
  customerOriginatedConversation?: boolean
  /** Someone outside the team subscribed to status updates themselves. */
  visitorSubscribed?: boolean
  /** Someone outside the team marked an article helpful. */
  visitorFoundHelpful?: boolean
  deleted?: boolean
  externalPost?: boolean
  externalVote?: boolean
  onInternalBoard?: boolean
  /** The idea is the owner's own. */
  byOwner?: boolean
  onboardingGenerated?: boolean
  testRecord?: boolean
}

/** Pure predicate used by tests and by the DB-query contract documentation. */
export function qualifiesAsFirstWin(outcome: OnboardingOutcome, facts: FirstWinFacts): boolean {
  if (facts.onboardingGenerated || facts.testRecord || facts.deleted) return false
  switch (outcome) {
    case 'customer_support':
      return facts.customerOriginatedConversation === true
    case 'status_page':
      return facts.visitorSubscribed === true
    case 'help_center':
      return facts.visitorFoundHelpful === true
    case 'internal':
      // A private board has no customers: its win is a teammate who is not the owner.
      return facts.onInternalBoard === true && facts.byOwner !== true
    case 'product_feedback':
    default:
      return facts.externalPost === true || facts.externalVote === true
  }
}

export interface FirstWinResult {
  reached: boolean
  reachedAt: string | null
}

const notGeneratedPost = and(
  sql`coalesce(${posts.widgetMetadata}->>'onboardingGenerated', 'false') <> 'true'`,
  notTestPrincipal(posts.principalId)
)!
const externalPrincipal = and(
  or(eq(principal.role, 'user'), eq(principal.type, 'anonymous')),
  notTestPrincipal(principal.id)
)

/** Query the first real outcome; onboarding-generated/test records never qualify. */
export async function detectFirstWin(state: SetupState | null): Promise<FirstWinResult> {
  const primary = state?.goals?.[0] ?? state?.useCase ?? 'product_feedback'
  const outcome = primary === 'product_feedback' && state?.feedbackPrivate ? 'internal' : primary
  if (outcome === 'customer_support') {
    const [row] = await db
      .select({ reachedAt: conversations.createdAt })
      .from(conversations)
      .where(
        and(
          // Keyed on `source` alone, deliberately. `channel` is now current
          // state (a thread promotes to 'email' when the customer replies by
          // mail), and this is evaluated at read time — so filtering on it would
          // silently UN-REACH a genuine first win the moment that customer
          // answered from their inbox. `source` is immutable provenance, which
          // is the question this actually asks.
          // A conversation the customer opened, by Messenger or email: its
          // first message is theirs. One a teammate starts does not count.
          inArray(conversations.source, ['widget', 'email']),
          sql`(select ${conversationMessages.senderType} from ${conversationMessages}
            where ${conversationMessages.conversationId} = ${conversations.id}
            order by ${conversationMessages.createdAt} asc, ${conversationMessages.id} asc
            limit 1) = 'visitor'`,
          isNotNull(conversations.visitorPrincipalId),
          sql`coalesce(${conversations.customAttributes}->>'onboardingGenerated', 'false') <> 'true'`,
          sql`coalesce(${conversations.customAttributes}->>'test', 'false') <> 'true'`,
          notTestPrincipal(conversations.visitorPrincipalId)
        )
      )
      .orderBy(asc(conversations.createdAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt.toISOString() ?? null }
  }

  if (outcome === 'status_page') {
    // A customer subscribing themselves; services the team adds do not count.
    const [row] = await db
      .select({ reachedAt: statusSubscriptions.createdAt })
      .from(statusSubscriptions)
      .innerJoin(principal, eq(principal.id, statusSubscriptions.principalId))
      .where(
        and(
          eq(statusSubscriptions.source, 'self_serve'),
          isNull(statusSubscriptions.unsubscribedAt),
          externalPrincipal
        )
      )
      .orderBy(asc(statusSubscriptions.createdAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt.toISOString() ?? null }
  }

  if (outcome === 'help_center') {
    // A visitor finding an article helpful; publishing one is the team's own
    // act. A signed-out visitor's vote carries no principal and still counts.
    const [row] = await db
      .select({ reachedAt: helpCenterArticleFeedback.createdAt })
      .from(helpCenterArticleFeedback)
      .innerJoin(
        helpCenterArticles,
        eq(helpCenterArticles.id, helpCenterArticleFeedback.articleId)
      )
      .leftJoin(principal, eq(principal.id, helpCenterArticleFeedback.principalId))
      .where(
        and(
          eq(helpCenterArticleFeedback.helpful, true),
          isNull(helpCenterArticles.deletedAt),
          or(isNull(helpCenterArticleFeedback.principalId), externalPrincipal)
        )
      )
      .orderBy(asc(helpCenterArticleFeedback.createdAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt.toISOString() ?? null }
  }

  if (outcome === 'internal') {
    const resource = state?.steps.startingPoint
    const storedBoard =
      resource?.outcome === 'internal' && resource.resourceType === 'board' && resource.resourceId
        ? await db.query.boards.findFirst({
            where: and(eq(boards.id, resource.resourceId as BoardId), isNull(boards.deletedAt)),
            columns: { id: true },
          })
        : null
    const internalBoard =
      storedBoard ??
      (await db.query.boards.findFirst({
        where: and(isNull(boards.deletedAt), sql`${boards.access}->>'view' = 'team'`),
        columns: { id: true },
      }))
    if (!internalBoard) return { reached: false, reachedAt: null }
    // The owner is the first human admin; their own ideas do not count.
    const [owner] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))
      .orderBy(asc(principal.createdAt))
      .limit(1)
    const [row] = await db
      .select({ reachedAt: posts.createdAt })
      .from(posts)
      .where(
        and(
          eq(posts.boardId, internalBoard.id as BoardId),
          isNull(posts.deletedAt),
          notGeneratedPost,
          owner ? ne(posts.principalId, owner.id) : undefined
        )
      )
      .orderBy(asc(posts.createdAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt.toISOString() ?? null }
  }

  const [externalPost, externalVote] = await Promise.all([
    db
      .select({ reachedAt: posts.createdAt })
      .from(posts)
      .innerJoin(principal, eq(principal.id, posts.principalId))
      .where(and(isNull(posts.deletedAt), externalPrincipal, notGeneratedPost))
      .orderBy(asc(posts.createdAt))
      .limit(1),
    db
      .select({ reachedAt: postVotes.createdAt })
      .from(postVotes)
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .innerJoin(posts, eq(posts.id, postVotes.postId))
      .where(and(isNull(posts.deletedAt), externalPrincipal, notGeneratedPost))
      .orderBy(asc(postVotes.createdAt))
      .limit(1),
  ])
  const dates = [externalPost[0]?.reachedAt, externalVote[0]?.reachedAt].filter(
    (date): date is Date => date instanceof Date
  )
  const reachedAt =
    dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null
  return { reached: Boolean(reachedAt), reachedAt: reachedAt?.toISOString() ?? null }
}
