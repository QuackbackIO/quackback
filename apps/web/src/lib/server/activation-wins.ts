import type { BoardId } from '@quackback/ids'
import {
  db,
  and,
  asc,
  boards,
  conversations,
  eq,
  helpCenterArticles,
  isNotNull,
  isNull,
  lte,
  or,
  posts,
  postVotes,
  principal,
  sql,
  type OnboardingOutcome,
  type SetupState,
} from '@/lib/server/db'

export interface FirstWinFacts {
  customerOriginatedConversation?: boolean
  publishedArticle?: boolean
  deleted?: boolean
  externalPost?: boolean
  externalVote?: boolean
  onInternalBoard?: boolean
  onboardingGenerated?: boolean
  testRecord?: boolean
}

/** Pure predicate used by tests and by the DB-query contract documentation. */
export function qualifiesAsFirstWin(outcome: OnboardingOutcome, facts: FirstWinFacts): boolean {
  if (facts.onboardingGenerated || facts.testRecord || facts.deleted) return false
  switch (outcome) {
    case 'customer_support':
      return facts.customerOriginatedConversation === true
    case 'help_center':
      return facts.publishedArticle === true
    case 'internal':
      return facts.onInternalBoard === true
    case 'product_feedback':
    default:
      return facts.externalPost === true || facts.externalVote === true
  }
}

export interface FirstWinResult {
  reached: boolean
  reachedAt: string | null
}

const notGeneratedPost = sql`coalesce(${posts.widgetMetadata}->>'onboardingGenerated', 'false') <> 'true'`
const externalPrincipal = or(eq(principal.role, 'user'), eq(principal.type, 'anonymous'))

/** Query the first real outcome; onboarding-generated/test records never qualify. */
export async function detectFirstWin(state: SetupState | null): Promise<FirstWinResult> {
  const outcome = state?.useCase ?? 'product_feedback'
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
          eq(conversations.source, 'widget'),
          isNotNull(conversations.visitorPrincipalId),
          sql`coalesce(${conversations.customAttributes}->>'onboardingGenerated', 'false') <> 'true'`,
          sql`coalesce(${conversations.customAttributes}->>'test', 'false') <> 'true'`
        )
      )
      .orderBy(asc(conversations.createdAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt.toISOString() ?? null }
  }

  if (outcome === 'help_center') {
    const [row] = await db
      .select({ reachedAt: helpCenterArticles.publishedAt })
      .from(helpCenterArticles)
      .where(
        and(
          isNull(helpCenterArticles.deletedAt),
          isNotNull(helpCenterArticles.publishedAt),
          lte(helpCenterArticles.publishedAt, new Date())
        )
      )
      .orderBy(asc(helpCenterArticles.publishedAt))
      .limit(1)
    return { reached: Boolean(row), reachedAt: row?.reachedAt?.toISOString() ?? null }
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
    const [row] = await db
      .select({ reachedAt: posts.createdAt })
      .from(posts)
      .where(
        and(
          eq(posts.boardId, internalBoard.id as BoardId),
          isNull(posts.deletedAt),
          notGeneratedPost
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
