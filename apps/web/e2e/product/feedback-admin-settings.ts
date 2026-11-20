/**
 * Helpers for the feedback settings journeys (FBA-T-*): Settings > Boards,
 * Statuses and Tags. Shared seeding (boards, posts, tags) is in
 * feedback-admin.ts.
 */
import { expect, type Page } from '@playwright/test'
import { supportDb, pollFor } from '../support/db'
import { uuid } from './feedback-admin'

/** The boards settings list row (a link) for a board name. */
export function boardRow(page: Page, name: string) {
  return page.getByRole('link').filter({ hasText: name })
}

/** Types of the events stored for an entity (by TypeID), oldest first. */
export async function eventTypesFor(typeId: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT type FROM events
    WHERE entity_id::text = ${uuid(typeId)} OR entity_id::text = ${typeId}
       OR payload::text LIKE ${'%' + typeId + '%'}
    ORDER BY occurred_at`
  return rows.map((r) => String(r.type))
}

/** Wait until an event of `type` is stored for the entity. */
export async function waitForEventType(typeId: string, type: string): Promise<void> {
  await pollFor(`${type} event for ${typeId}`, async () =>
    (await eventTypesFor(typeId)).includes(type) ? true : undefined
  )
}

/** Audit rows of `eventType` about a target (by TypeID or uuid). */
export async function auditRows(
  eventType: string,
  typeId: string
): Promise<Array<Record<string, unknown>>> {
  return supportDb()`
    SELECT * FROM audit_log
    WHERE event_type = ${eventType}
      AND (target_id = ${typeId} OR target_id = ${uuid(typeId)})
    ORDER BY occurred_at`
}

/** The board's row (snake_case columns). */
export async function boardRowDb(boardId: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM boards WHERE id = ${uuid(boardId)}`
  if (!row) throw new Error(`No board ${boardId}`)
  return row
}

/** Open a board's settings page on a tab. */
export async function openBoardSettings(
  page: Page,
  slug: string,
  tab?: 'general' | 'access' | 'moderation' | 'data'
): Promise<void> {
  await page.goto(`/admin/settings/boards/${slug}${tab && tab !== 'general' ? `?tab=${tab}` : ''}`)
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 15_000 })
}

/** Status row (snake_case) by name, live or deleted. */
export async function statusRowByName(name: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM post_statuses WHERE name = ${name}
                                   ORDER BY created_at DESC LIMIT 1`
  return row
}

/** Tag row (snake_case) by name, live or deleted. */
export async function tagRowByName(name: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM post_tags WHERE name = ${name}
                                   ORDER BY created_at DESC LIMIT 1`
  return row
}
