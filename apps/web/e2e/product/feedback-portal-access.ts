/**
 * Helpers for the customer-side access, widget and profile journeys
 * (tests/feedback/portal-access.spec.ts, portal-widget.spec.ts,
 * portal-profile.spec.ts). Builds on feedback-portal.ts.
 */
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { supportDb } from '../support/db'
import { fbFn } from './feedback-portal'

export interface TestSegment {
  id: string
  uuid: string
  name: string
}

/** A manual segment only this test uses. */
export async function createSegment(marker: string, suffix = 'seg'): Promise<TestSegment> {
  const uuid = toUuid(generateId('segment'))
  const name = `${marker} ${suffix}`
  await supportDb()`INSERT INTO segments (id, name, slug, type)
    VALUES (${uuid}, ${name}, ${`${marker}-${suffix}`.toLowerCase().slice(0, 60)}, 'manual')`
  return { id: fromUuid('segment', uuid), uuid, name }
}

/** Manual membership, read by the app on the next request. */
export async function addToSegment(segment: TestSegment, principalUuid: string): Promise<void> {
  await supportDb()`INSERT INTO user_segments (principal_id, segment_id, added_by)
    VALUES (${principalUuid}, ${segment.uuid}, 'manual') ON CONFLICT DO NOTHING`
}

export async function removeFromSegment(
  segment: TestSegment,
  principalUuid: string
): Promise<void> {
  await supportDb()`DELETE FROM user_segments
    WHERE principal_id = ${principalUuid} AND segment_id = ${segment.uuid}`
}

export interface FeedPage {
  items: Array<{ id: string; title: string; [k: string]: unknown }>
  facets?: { boards: Record<string, number>; total: number } | null
}

/** Post ids the caller sees on the portal feed, filtered to `boardSlugs`. */
export async function visiblePostIds(
  request: APIRequestContext,
  opts: { search?: string; boardSlug?: string } = {}
): Promise<string[]> {
  const res = await fbFn<FeedPage>(request, 'publicPosts', 'listPublicPostsFn', {
    sort: 'new',
    limit: 100,
    ...opts,
  })
  if (res.error) throw new Error(`listPublicPostsFn: ${res.error.message}`)
  return (res.value?.items ?? []).map((p) => p.id)
}

/** Board slugs the caller may see (fetchPublicBoards). */
export async function visibleBoardSlugs(request: APIRequestContext): Promise<string[]> {
  const res = await fbFn<Array<{ slug: string }>>(request, 'portal', 'fetchPublicBoards')
  if (res.error) throw new Error(`fetchPublicBoards: ${res.error.message}`)
  return (res.value ?? []).map((b) => b.slug)
}
