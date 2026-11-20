/**
 * Helpers for the post-management journeys of the team's feedback inbox
 * (e2e/tests/feedback/admin-post-actions, admin-post-comments, admin-votes).
 * Read the rows the product promises: activity, domain events, votes,
 * subscriptions, comments and bells for one post.
 */
import { expect, type Page } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { supportDb, pollFor } from '../support/db'
import { uuid } from './feedback-admin'

export interface ActivityRow {
  type: string
  metadata: Record<string, unknown>
  principal_id: string | null
}

/** The post's activity rows, oldest first. */
export async function activityOf(postId: string): Promise<ActivityRow[]> {
  return supportDb()<ActivityRow[]>`
    SELECT type, metadata, principal_id FROM post_activity
    WHERE post_id = ${uuid(postId)} ORDER BY created_at ASC, id ASC`
}

export async function activityTypesOf(postId: string): Promise<string[]> {
  return (await activityOf(postId)).map((a) => a.type)
}

/**
 * Activity rows are written after the action answers: wait until the post
 * has at least `count` rows of `type`, then return them all.
 */
export async function waitForActivity(
  postId: string,
  type: string,
  count = 1
): Promise<ActivityRow[]> {
  return pollFor(`${count} ${type} activity row(s) on ${postId}`, async () => {
    const rows = (await activityOf(postId)).filter((a) => a.type === type)
    return rows.length >= count ? rows : undefined
  })
}

export interface PostEvent {
  type: string
  payload: Record<string, unknown>
}

/** Domain events whose payload names the post (oldest first). */
export async function eventsOfPost(postId: string): Promise<PostEvent[]> {
  return supportDb()<PostEvent[]>`
    SELECT type, payload FROM events
    WHERE entity_id = ${postId} OR payload::text LIKE ${'%' + postId + '%'}
    ORDER BY id ASC`
}

export async function eventTypesOfPost(postId: string): Promise<string[]> {
  return (await eventsOfPost(postId)).map((e) => e.type)
}

/** Wait until the post has an event of `type`; returns all of that type. */
export async function waitForPostEvent(postId: string, type: string): Promise<PostEvent[]> {
  return pollFor(
    `${type} event for ${postId}`,
    async () => {
      const rows = (await eventsOfPost(postId)).filter((e) => e.type === type)
      return rows.length > 0 ? rows : undefined
    },
    { timeoutMs: 15_000 }
  )
}

export interface VoteRow {
  principal_id: string
  source_type: string | null
  added_by_principal_id: string | null
}

export async function votesOf(postId: string): Promise<VoteRow[]> {
  return supportDb()<VoteRow[]>`
    SELECT principal_id, source_type, added_by_principal_id FROM post_votes
    WHERE post_id = ${uuid(postId)} ORDER BY created_at`
}

export interface SubscriptionRow {
  principal_id: string
  reason: string
  notify_comments: boolean
  notify_status_changes: boolean
}

export async function subscriptionsOf(postId: string): Promise<SubscriptionRow[]> {
  return supportDb()<SubscriptionRow[]>`
    SELECT principal_id, reason, notify_comments, notify_status_changes FROM post_subscriptions
    WHERE post_id = ${uuid(postId)} ORDER BY created_at`
}

export interface CommentRow {
  id: string
  content: string
  is_team_member: boolean
  is_private: boolean
  deleted_at: Date | null
  status_change_from_id: string | null
  status_change_to_id: string | null
  parent_id: string | null
}

export async function commentsOf(postId: string): Promise<CommentRow[]> {
  return supportDb()<CommentRow[]>`
    SELECT id, content, is_team_member, is_private, deleted_at, status_change_from_id,
           status_change_to_id, parent_id
    FROM post_comments WHERE post_id = ${uuid(postId)} ORDER BY created_at`
}

/** Bells about this post, with the recipient's TypeID. */
export async function bellsOfPost(
  postId: string
): Promise<{ type: string; principalId: string }[]> {
  const rows = await supportDb()<{ type: string; principal_id: string }[]>`
    SELECT type, principal_id FROM in_app_notifications WHERE post_id = ${uuid(postId)}`
  return rows.map((r) => ({ type: r.type, principalId: fromUuid('principal', r.principal_id) }))
}

/** A principal TypeID as the raw uuid stored in rows. */
export function principalUuid(principalId: string): string {
  return uuid(principalId)
}

/** The modal's sidebar row for a label (Status, Board, Owner, ETA, Tags). */
export function sidebarRow(page: Page, label: string) {
  return page
    .getByRole('dialog')
    .getByRole('complementary')
    .getByText(label, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "justify-between")][1]')
    .first()
}

/** Pick another status in the post modal's sidebar. */
export async function pickStatus(page: Page, current: string, next: string): Promise<void> {
  await sidebarRow(page, 'Status').getByRole('button', { name: current }).click()
  await popover(page).getByRole('button', { name: next, exact: true }).click()
}

/** The open popover (base-ui renders it in a portal at the end of the body). */
export function popover(page: Page) {
  return page.locator('[data-side]').filter({ visible: true }).last()
}

/** Open the modal's Activity tab and wait for a line. */
export async function openActivity(page: Page, line: string | RegExp): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(line).first()).toBeVisible()
}

/**
 * Press a Manage icon in the post modal's sidebar. The icons carry no label,
 * only a tooltip; Delete/Restore is always last and Lock just before it.
 * Callers assert the stored outcome, so pressing the wrong icon fails.
 */
export async function pressManage(
  page: Page,
  label: 'Delete post' | 'Restore post' | 'Lock comments' | 'Unlock comments'
): Promise<void> {
  const buttons = page
    .getByRole('dialog')
    .getByText('Manage', { exact: true })
    .locator('xpath=..')
    .locator('button')
    .filter({ visible: true })
  await expect(buttons.last()).toBeVisible()
  const count = await buttons.count()
  await buttons.nth(label.endsWith('post') ? count - 1 : count - 2).click()
}

/** The post's status slug as stored. */
export async function statusSlugOf(postId: string): Promise<string | null> {
  const [r] = await supportDb()`
    SELECT s.slug FROM posts p LEFT JOIN post_statuses s ON s.id = p.status_id
    WHERE p.id = ${uuid(postId)}`
  return (r?.slug as string | null) ?? null
}
