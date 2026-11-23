/**
 * Roadmap helpers for the product suite (e2e/tests/roadmap/).
 *
 * Every test makes its own board, status, posts and roadmap through the REST
 * API with an admin workspace key (one per worker), names them with the
 * test's marker, and deletes its roadmaps afterwards (`retireRoadmaps`), so
 * the shared /roadmap and /admin/roadmap only ever hold a test's rows while
 * it runs.
 *
 *   const rm = await roadmapApi(playwright, people)
 *   const status = await rm.status(marker)
 *   const board = await rm.board(marker)
 *   const post = await rm.post({ boardId: board.id, title: `${marker} post`, statusId: status.id })
 *   const roadmap = await rm.roadmap({ name: `${marker} map`, columns: [column(status)] })
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { generateId, toUuid } from '@quackback/ids'
import { apiFor, createKey, expectJson, type Wire } from '../support/api-client'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import type { SeededPeople } from '../support/people'
import { callServerFn } from '../support/server-fns'

type Playwright = Parameters<typeof apiFor>[0]

let workerKey: string | null = null

/** The worker's admin workspace key (made once per worker process). */
function adminKey(people: SeededPeople): string {
  workerKey ??= createKey({
    creatorEmail: people.people.admin.email,
    kind: 'workspace',
    name: 'roadmap e2e',
  }).key
  return workerKey
}

export interface Status {
  id: string
  name: string
  slug: string
}
export interface Board {
  id: string
  name: string
  slug: string
}
export interface Post {
  id: string
  title: string
  boardId: string
  voteCount: number
}
export interface ColumnInput {
  statusId: string
  name: string
  color: string
  position: number
  icon?: string | null
}
export interface Roadmap {
  id: string
  name: string
  slug: string
  description: string | null
  type: 'column' | 'date'
  visibility: 'public' | 'team' | 'segment'
  columns: Array<ColumnInput & { id: string }>
}

/** A column on `status`, named like the status unless given a name. */
export function column(status: Status, position = 0, name = status.name): ColumnInput {
  return { statusId: status.id, name, color: '#3b82f6', position }
}

/** A slug from free text (lowercase, hyphens). */
export function slugOf(text: string, sep = '-'): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    .slice(0, 90)
}

export interface RoadmapApi {
  rest: APIRequestContext
  status: (marker: string, opts?: { name?: string; category?: string }) => Promise<Status>
  board: (marker: string, opts?: { name?: string }) => Promise<Board>
  post: (opts: {
    boardId: string
    title: string
    statusId?: string
    tagIds?: string[]
  }) => Promise<Post>
  roadmap: (body: Record<string, unknown> & { name: string }) => Promise<Roadmap>
  setStatus: (postId: string, statusId: string) => Promise<void>
  dispose: () => Promise<void>
}

const made: string[] = []

/** REST helpers as the admin, for one test. */
export async function roadmapApi(
  playwright: Playwright,
  people: SeededPeople
): Promise<RoadmapApi> {
  const rest = await apiFor(playwright, supportEnv().baseUrl, adminKey(people))
  return {
    rest,
    status: async (marker, opts = {}) => {
      const name = opts.name ?? `${marker} status`
      const body = await expectJson(
        await rest.post('/api/v1/statuses', {
          data: {
            name: name.slice(0, 50),
            slug: slugOf(`${marker}-${generateId('post_status').slice(-6)}`, '_').slice(0, 50),
            color: '#8b5cf6',
            category: opts.category ?? 'active',
          },
        }),
        201
      )
      return body.data as Status
    },
    board: async (marker, opts = {}) => {
      const name = opts.name ?? `${marker} board`
      const body = await expectJson(
        await rest.post('/api/v1/boards', {
          data: { name, slug: slugOf(`${marker}-${generateId('board').slice(-6)}`) },
        }),
        201
      )
      return body.data as Board
    },
    post: async (opts) => {
      const body = await expectJson(await rest.post('/api/v1/posts', { data: opts }), 201)
      const data = body.data as Wire
      return {
        id: data.id,
        title: data.title,
        boardId: opts.boardId,
        voteCount: data.voteCount ?? 0,
      }
    },
    roadmap: async (body) => {
      const res = await rest.post('/api/v1/roadmaps', {
        data: { slug: slugOf(`${body.name}-${generateId('roadmap').slice(-6)}`), ...body },
      })
      const created = (await expectJson(res, 201)).data as Roadmap
      made.push(created.id)
      return created
    },
    setStatus: async (postId, statusId) => {
      await expectJson(await rest.patch(`/api/v1/posts/${postId}`, { data: { statusId } }), 200)
    },
    dispose: () => rest.dispose(),
  }
}

/** Soft-delete every roadmap this worker made since the last call. */
export async function retireRoadmaps(): Promise<void> {
  const ids = made.splice(0)
  if (ids.length === 0) return
  await supportDb()`UPDATE roadmaps SET deleted_at = now()
    WHERE id = ANY(${ids.map((id) => toUuid(id as `roadmap_${string}`))}::uuid[])
      AND deleted_at IS NULL`
}

/** Track a roadmap made another way (the admin UI) for `retireRoadmaps`. */
export function trackRoadmap(id: string): void {
  made.push(id)
}

/** Set a post's ETA as `person`'s request context (setPostEtaFn). */
export async function setEta(
  api: APIRequestContext,
  postId: string,
  eta: string | null
): Promise<void> {
  const res = await callServerFn(api, 'setPostEtaFn', { id: postId, eta })
  expect(res.ok, res.error).toBe(true)
}

/** A manual segment with these principals (uuid) in it. Returns its TypeID. */
export async function segmentWith(marker: string, principalUuids: string[]): Promise<string> {
  const id = generateId('segment')
  const uuid = toUuid(id)
  await supportDb()`INSERT INTO segments (id, name, slug, type)
    VALUES (${uuid}, ${`${marker} segment`}, ${slugOf(`${marker}-${id.slice(-6)}`)}, 'manual')`
  for (const p of principalUuids) {
    await supportDb()`INSERT INTO user_segments (principal_id, segment_id) VALUES (${p}, ${uuid})`
  }
  return id
}

/** UTC first-of-month ISO string, `months` from the current month. */
export function monthFromNow(months: number): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)).toISOString()
}

/** "Mar 2027" for an ISO date, as the portal formats it in en-US. */
export function monYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// ---------------------------------------------------------------------------
// The portal board
// ---------------------------------------------------------------------------

/** A roadmap column card on the portal board, by its title. */
export function portalColumn(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: title }),
  })
}

/** A post card (link) inside a column or page, by the post title. */
export function roadmapCard(scope: Page | Locator, title: string): Locator {
  return scope.locator('a.roadmap-card').filter({ hasText: title })
}

/** The total badge in a portal column header. */
export function columnBadge(col: Locator): Locator {
  return col.locator('[data-slot="card-header"] [data-slot="badge"]')
}
