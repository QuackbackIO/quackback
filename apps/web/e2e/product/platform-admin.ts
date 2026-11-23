/**
 * Helpers for the platform journeys on admin pages (INT-SR admin search,
 * INT-AN analytics, INT-ST settings): signed-in request contexts, and boards
 * and posts a single test owns.
 */
import { randomUUID } from 'node:crypto'
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'
import { personApi } from '../support/server-fns'
import type { SupportPersonName } from '../support/people'

/** Run `body` with a request context signed in as `person`, then dispose it. */
export async function asPersonApi<T>(
  playwright: PlaywrightWorkerArgs['playwright'],
  person: SupportPersonName,
  body: (api: APIRequestContext) => Promise<T>
): Promise<T> {
  const api = await personApi(playwright, person)
  try {
    return await body(api)
  } finally {
    await api.dispose()
  }
}

/** Run the hourly analytics refresh now through the sweep runner. */
export async function runAnalyticsRefresh(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/e2e/sweep', { data: { job: 'analytics-refresh' } })
  if (res.status() !== 200) {
    throw new Error(`sweep analytics-refresh: ${res.status()} ${await res.text()}`)
  }
}

/** A board only this test uses, written as the app stores one. */
export async function createBoard(
  marker: string,
  opts: { view?: 'anonymous' | 'team' } = {}
): Promise<{ id: string; uuid: string; slug: string; name: string }> {
  const uuid = toUuid(generateId('board'))
  const slug = marker.toLowerCase().slice(0, 60)
  const name = `Board ${marker}`
  const sql = supportDb()
  await sql`INSERT INTO boards (id, slug, name) VALUES (${uuid}, ${slug}, ${name})`
  if (opts.view) {
    await sql`UPDATE boards SET access = jsonb_set(access, '{view}', to_jsonb(${opts.view}::text))
              WHERE id = ${uuid}`
  }
  return { id: fromUuid('board', uuid), uuid, slug, name }
}

/** A post on `boardUuid` by `principalId` (TypeID); returns its TypeID and uuid. */
export async function createPost(
  boardUuid: string,
  principalId: string,
  title: string,
  content = 'Written for a platform e2e test.',
  createdAt = new Date()
): Promise<{ id: string; uuid: string }> {
  const sql = supportDb()
  const uuid = randomUUID()
  const [status] = await sql<{ id: string }[]>`
    SELECT id FROM post_statuses WHERE is_default LIMIT 1`
  await sql`
    INSERT INTO posts (id, board_id, title, content, principal_id, status_id, created_at, updated_at)
    VALUES (${uuid}, ${boardUuid}, ${title}, ${content},
            ${toUuid(principalId as `principal_${string}`)}, ${status?.id ?? null},
            ${createdAt}, ${createdAt})`
  return { id: fromUuid('post', uuid), uuid }
}
