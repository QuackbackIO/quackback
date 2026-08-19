import {
  db,
  helpCenterArticles,
  helpCenterArticleFeedback,
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  sql,
} from '@/lib/server/db'
import { createId } from '@quackback/ids'
import type { KbArticleFeedbackId, KbArticleId, PrincipalId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { ARTICLE_FEEDBACK_REASON_MAX_LENGTH } from '@/lib/shared/schemas/help-center'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'help-center-article-feedback' })

/**
 * Records a helpful/unhelpful vote and returns the id of the row that holds it.
 *
 * The caller needs that id to attach a free-text reason afterwards: an
 * anonymous visitor has no principal to look the row back up by, so the id is
 * the only handle on their own vote.
 */
export async function recordArticleFeedback(
  articleId: KbArticleId,
  helpful: boolean,
  principalId?: PrincipalId | null
): Promise<KbArticleFeedbackId> {
  return db.transaction(async (tx) => {
    if (principalId) {
      const existing = await tx.query.helpCenterArticleFeedback.findFirst({
        where: and(
          eq(helpCenterArticleFeedback.articleId, articleId),
          eq(helpCenterArticleFeedback.principalId, principalId)
        ),
      })

      if (existing) {
        if (existing.helpful === helpful) return existing.id
        // A reason explains an unhelpful vote, so it does not survive the flip.
        await tx
          .update(helpCenterArticleFeedback)
          .set({ helpful, reason: null })
          .where(eq(helpCenterArticleFeedback.id, existing.id))
        await tx
          .update(helpCenterArticles)
          .set({
            helpfulCount: helpful
              ? sql`${helpCenterArticles.helpfulCount} + 1`
              : sql`${helpCenterArticles.helpfulCount} - 1`,
            notHelpfulCount: helpful
              ? sql`${helpCenterArticles.notHelpfulCount} - 1`
              : sql`${helpCenterArticles.notHelpfulCount} + 1`,
          })
          .where(eq(helpCenterArticles.id, articleId))
        return existing.id
      }
    }

    const id = createId('kb_article_feedback')
    await tx.insert(helpCenterArticleFeedback).values({
      id,
      articleId,
      principalId: principalId ?? null,
      helpful,
    })
    await tx
      .update(helpCenterArticles)
      .set(
        helpful
          ? { helpfulCount: sql`${helpCenterArticles.helpfulCount} + 1` }
          : { notHelpfulCount: sql`${helpCenterArticles.notHelpfulCount} + 1` }
      )
      .where(eq(helpCenterArticles.id, articleId))
    return id
  })
}

/** Largest page the admin-side reason list will read in one go. */
const ARTICLE_FEEDBACK_REASON_PAGE_MAX = 100

export interface ArticleFeedbackReason {
  id: KbArticleFeedbackId
  reason: string
  createdAt: Date
}

/**
 * Attaches a visitor's free-text reason to the unhelpful vote they just cast.
 *
 * The guard lives in the WHERE clause rather than a prior read, which makes the
 * write once-only: the reason lands only on an unhelpful vote that has none
 * yet. That is what keeps an unauthenticated caller holding a vote id from
 * rewriting a reason or turning the row into open-ended storage.
 */
export async function attachArticleFeedbackReason(
  feedbackId: KbArticleFeedbackId,
  reason: string
): Promise<void> {
  const trimmed = reason.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('FEEDBACK_REASON_EMPTY', 'A reason cannot be blank')
  }
  if (trimmed.length > ARTICLE_FEEDBACK_REASON_MAX_LENGTH) {
    throw new ValidationError(
      'FEEDBACK_REASON_TOO_LONG',
      `A reason can be at most ${ARTICLE_FEEDBACK_REASON_MAX_LENGTH} characters`
    )
  }

  const updated = await db
    .update(helpCenterArticleFeedback)
    .set({ reason: trimmed })
    .where(
      and(
        eq(helpCenterArticleFeedback.id, feedbackId),
        eq(helpCenterArticleFeedback.helpful, false),
        isNull(helpCenterArticleFeedback.reason)
      )
    )
    .returning({ id: helpCenterArticleFeedback.id })

  if (updated.length === 0) {
    throw new ValidationError(
      'FEEDBACK_REASON_UNAVAILABLE',
      'That vote is not an unhelpful vote awaiting a reason'
    )
  }

  log.debug({ feedback_id: feedbackId, length: trimmed.length }, 'article feedback reason recorded')
}

/** Reasons left on one article's unhelpful votes, newest first. */
export async function listArticleFeedbackReasons(
  articleId: KbArticleId,
  limit = 50
): Promise<ArticleFeedbackReason[]> {
  const rows = await db.query.helpCenterArticleFeedback.findMany({
    where: and(
      eq(helpCenterArticleFeedback.articleId, articleId),
      eq(helpCenterArticleFeedback.helpful, false),
      isNotNull(helpCenterArticleFeedback.reason)
    ),
    orderBy: desc(helpCenterArticleFeedback.createdAt),
    limit: Math.min(Math.max(limit, 1), ARTICLE_FEEDBACK_REASON_PAGE_MAX),
    columns: { id: true, reason: true, createdAt: true },
  })

  return rows.map((row) => ({
    id: row.id,
    reason: row.reason ?? '',
    createdAt: row.createdAt,
  }))
}
