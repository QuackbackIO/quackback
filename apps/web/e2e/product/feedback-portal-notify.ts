/**
 * Helpers for the comment and notification journeys
 * (tests/feedback/portal-comments.spec.ts, portal-comment-extras.spec.ts,
 * portal-emails.spec.ts, portal-notifications.spec.ts,
 * portal-subscriptions.spec.ts). Builds on feedback-portal.ts.
 */
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb, pollFor } from '../support/db'
import { mailsMatching, waitForMailMatching } from '../support/email-journeys'
import type { SeededPeople } from '../support/people'
import {
  fbFn,
  clickUntil,
  personContext,
  restPost,
  status,
  uuid,
  type TestPost,
} from './feedback-portal'

/**
 * A cookie session for the suite admin (a teammate on the portal), for team
 * actions that go through the portal's own server functions (a team comment,
 * a comment that changes the status, a private note, pin).
 */
export async function adminSession(
  browser: Browser,
  people: SeededPeople,
  marker: string
): Promise<{ request: APIRequestContext; page: Page; principalUuid: string }> {
  const admin = people.people.admin
  const s = await personContext(browser, uuid(admin.userId), marker)
  return { request: s.request, page: s.page, principalUuid: uuid(admin.principalId) }
}

/** Change a post's status as the admin through REST (`PATCH /posts/:id`). */
export async function setStatus(
  api: APIRequestContext,
  post: Pick<TestPost, 'id'>,
  statusSlug: string
): Promise<void> {
  await restPost(api, `/posts/${post.id}`, { statusId: (await status(statusSlug)).id }, 'PATCH')
}

/** Approve a held comment through REST moderation. */
export async function approveComment(api: APIRequestContext, commentId: string): Promise<void> {
  await restPost(api, `/moderation/comments/${commentId}/approve`)
}

/** Wait for a mail to `to` whose subject contains `subject`. */
export function mailFor(to: string, subject: string, timeoutMs = 20_000) {
  return waitForMailMatching({ to, subject }, timeoutMs)
}

/** Mails to `to` whose subject contains `subject` (no wait). */
export function mailsFor(to: string, subject?: string) {
  return mailsMatching({ to, subject })
}

/** The thread's top-level comment editor (the first editor on the page). */
export function commentEditor(page: Page) {
  return page.getByTestId('comment-form-editor').locator('.ProseMirror[contenteditable="true"]')
}

/**
 * Type a comment into the editor once the page has hydrated, then press the
 * form's submit button (`Comment`, or `Reply` inside a reply form).
 */
export async function writeComment(
  page: Page,
  text: string,
  opts: { scope?: ReturnType<Page['locator']>; button?: string } = {}
): Promise<void> {
  const scope = opts.scope ?? page.locator('body')
  const box = scope.getByTestId('comment-form-editor').first()
  const editor = box.locator('.ProseMirror[contenteditable="true"]')
  // The editor is loaded on first use; a click before hydration does nothing.
  await clickUntil(box, async () => {
    await expect(editor).toBeVisible({ timeout: 1_000 })
  })
  await editor.click()
  await editor.pressSequentially(text)
  await expect(editor).toContainText(text)
  await scope
    .getByRole('button', { name: opts.button ?? 'Comment', exact: true })
    .last()
    .click()
}

/** The rendered comment element by its TypeID. */
export function commentEl(page: Page, commentId: string) {
  return page.locator(`[id="comment-${commentId}"]`)
}

/** A plain Tiptap document with one paragraph. */
export function textDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Create a comment through the portal's server function. */
export async function commentFn(
  request: APIRequestContext,
  post: Pick<TestPost, 'id'>,
  content: string,
  extra: Record<string, unknown> = {}
) {
  return fbFn<{ comment: { id: string; moderationState?: string } }>(
    request,
    'comments',
    'createCommentFn',
    { postId: post.id, content, ...extra }
  )
}

/** The comment row with this exact content (newest), or null. */
export async function commentByContent(
  postUuid: string,
  content: string
): Promise<Record<string, unknown> | null> {
  const [row] = await supportDb()`SELECT * FROM post_comments WHERE post_id = ${postUuid}
    AND content = ${content} ORDER BY created_at DESC LIMIT 1`
  return row ?? null
}

/** Wait for the comment row with this content; returns it with its TypeID. */
export async function waitForComment(postUuid: string, content: string) {
  const row = await pollFor(`comment "${content}"`, () => commentByContent(postUuid, content))
  return { ...row, typeId: fromUuid('post_comment', row.id as string) }
}

/** post_subscriptions rows of a post as { principal_id, reason, notify_* }. */
export async function subscriptionsOf(postUuid: string) {
  return supportDb()`SELECT principal_id, reason, notify_comments, notify_status_changes
    FROM post_subscriptions WHERE post_id = ${postUuid} ORDER BY created_at`
}

/** The subscription of one principal on a post, or null. */
export async function subscriptionOf(postUuid: string, principalUuid: string) {
  const [row] = await supportDb()`SELECT reason, notify_comments, notify_status_changes
    FROM post_subscriptions WHERE post_id = ${postUuid} AND principal_id = ${principalUuid}`
  return row ?? null
}

/** Insert a subscription directly (precondition). */
export async function subscribe(
  postUuid: string,
  principalUuid: string,
  opts: { comments?: boolean; status?: boolean; reason?: string } = {}
): Promise<void> {
  await supportDb()`INSERT INTO post_subscriptions
      (id, post_id, principal_id, reason, notify_comments, notify_status_changes)
    VALUES (${toUuid(generateId('post_sub'))}, ${postUuid}, ${principalUuid},
            ${opts.reason ?? 'manual'}, ${opts.comments ?? true}, ${opts.status ?? true})
    ON CONFLICT (post_id, principal_id) DO UPDATE SET
      notify_comments = EXCLUDED.notify_comments,
      notify_status_changes = EXCLUDED.notify_status_changes`
}

/** In-app notifications (bells) of a principal, newest first. */
export async function notificationsOf(principalUuid: string, postUuid?: string) {
  return postUuid
    ? supportDb()`SELECT * FROM in_app_notifications WHERE principal_id = ${principalUuid}
        AND post_id = ${postUuid} ORDER BY created_at DESC`
    : supportDb()`SELECT * FROM in_app_notifications WHERE principal_id = ${principalUuid}
        ORDER BY created_at DESC`
}
