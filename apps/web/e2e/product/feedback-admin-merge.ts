/**
 * Helpers for the merge and moderation journeys (FBA-M-*, FBA-Q-*),
 * e2e/tests/feedback/admin-merge.spec.ts and admin-moderation.spec.ts.
 * The shared seeding helpers are in feedback-admin.ts.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'
import { callServerFn } from '../support/server-fns'
import { uuid } from './feedback-admin'

/** The customer (or teammate) behind `api` toggles their vote on a post. */
export async function vote(api: APIRequestContext, postId: string): Promise<void> {
  const res = await callServerFn(api, 'toggleVoteFn', { postId })
  if (!res.ok) throw new Error(`toggleVoteFn failed: ${res.raw.slice(0, 300)}`)
}

/** A pending merge suggestion "source is a duplicate of target", as the AI check writes it. */
export async function seedSuggestion(
  sourcePostId: string,
  targetPostId: string,
  opts: { reasoning?: string; createdAt?: Date; status?: string } = {}
): Promise<string> {
  const id = toUuid(generateId('post_merge_suggestion'))
  await supportDb()`
    INSERT INTO post_merge_suggestions
      (id, source_post_id, target_post_id, status, vector_score, fts_score, hybrid_score,
       llm_confidence, llm_reasoning, llm_model, created_at, updated_at)
    VALUES (${id}, ${uuid(sourcePostId)}, ${uuid(targetPostId)}, ${opts.status ?? 'pending'},
            0.95, 0.9, 0.93, 0.9, ${opts.reasoning ?? 'Both ask for the same thing'}, 'e2e',
            ${opts.createdAt ?? new Date()}, ${opts.createdAt ?? new Date()})`
  return fromUuid('post_merge_sug', id)
}

/** A suggestion's row (status, resolved_by_principal_id, resolved_at). */
export async function suggestionRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM post_merge_suggestions WHERE id = ${uuid(id)}`
  return row
}

/** Activity types on a post, oldest first. */
export async function activityTypes(postId: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT type FROM post_activity WHERE post_id = ${uuid(postId)} ORDER BY created_at, id`
  return rows.map((r) => String(r.type))
}

/** Audit actions recorded about an entity id (TypeID or uuid in the row). */
export async function auditActions(entityId: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT event_type FROM audit_log
    WHERE target_id IN (${entityId}, ${uuid(entityId)}) ORDER BY occurred_at`
  return rows.map((r) => String(r.event_type))
}

/** The merge icon in the post modal's metadata bar (no accessible name; tooltip `Merge`). */
export function mergeMenuButton(page: Page) {
  return page.getByRole('dialog').locator('button:visible:has(svg.tabler-icon-git-merge)').first()
}

/** Open the merge menu and pick one of its two items. */
export async function pickMergeAction(
  page: Page,
  item: 'into this' | 'into another'
): Promise<void> {
  await mergeMenuButton(page).click()
  await page.getByRole('menuitem', { name: new RegExp(`^Merge ${item}`) }).click()
}

/** Wait until the delayed `merge-recheck:<canonical>` job for a post has run (3 s delay). */
export async function waitForMergeRecheck(canonicalPostId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await supportDb()`
          SELECT status FROM job_queue WHERE dedupe_key = ${`merge-recheck:${canonicalPostId}`}`
        return rows.length > 0 && rows.every((r) => r.status === 'succeeded')
      },
      { timeout: 20_000 }
    )
    .toBe(true)
}

export type ModerationRule = 'inherit' | 'on' | 'off'

/**
 * Set a board's own moderation override (Board settings > Moderation) through
 * updateBoardAccessFn, keeping the rest of its access as it is. Only that
 * board's submissions are held, so a shared test can use it.
 */
export async function setBoardModeration(
  api: APIRequestContext,
  boardId: string,
  rules: Partial<Record<'anonPosts' | 'signedPosts' | 'comments', ModerationRule>>
): Promise<void> {
  const [row] = await supportDb()`SELECT access FROM boards WHERE id = ${uuid(boardId)}`
  const access = (typeof row.access === 'string' ? JSON.parse(row.access) : row.access) as {
    moderation: Record<string, ModerationRule>
  }
  access.moderation = { ...access.moderation, ...rules }
  const res = await callServerFn(api, 'updateBoardAccessFn', { boardId, access })
  if (!res.ok) throw new Error(`updateBoardAccessFn failed: ${res.raw.slice(0, 300)}`)
}

/** The queue page's row for a pending post or comment, found by its text. */
export function queueRow(page: Page, text: string) {
  return page.locator('li', { hasText: text })
}

/** A held post: a customer submits it on a board that holds signed-in posts. */
export async function heldPost(
  api: APIRequestContext,
  customer: { api: APIRequestContext },
  boardId: string,
  title: string,
  content = ''
): Promise<string> {
  await setBoardModeration(api, boardId, { signedPosts: 'on' })
  const res = await callServerFn<{ id: string }>(customer.api, 'createPublicPostFn', {
    boardId,
    title,
    content,
  })
  if (!res.ok) throw new Error(`createPublicPostFn failed: ${res.raw.slice(0, 300)}`)
  return res.data.id
}
