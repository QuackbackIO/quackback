/**
 * The REST API for roadmaps (/api/v1/roadmaps, its columns and its posts).
 * Journeys API-R-078..085.
 *
 * Each test makes its own status and a roadmap whose only column is that
 * status, so the roadmap's posts are this test's posts alone.
 *
 * Owner questions (the contested half is not asserted either way):
 * - API-R-078, 079: whether roadmap reads (and roadmap posts from team-only
 *   boards) should need roadmap.manage and read:feedback. Only shape and the
 *   happy path with an admin key.
 * - API-R-080: whether roadmap posts should move to cursor paging; the offset
 *   envelope is asserted as it is today.
 */
import { generateId } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { expectJson, type Wire } from '../../support/api-client'
import {
  expectError,
  keyApi,
  restBoard,
  restPost,
  shortToken,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 60_000 })

const ROADMAP_KEYS = [
  'baseFilter',
  'columns',
  'createdAt',
  'dateSource',
  'description',
  'frequency',
  'id',
  'name',
  'position',
  'slug',
  'type',
  'visibility',
  'visibleSegmentIds',
]

async function makeStatus(api: APIRequestContext, marker: string, suffix = 's'): Promise<Wire> {
  const t = shortToken(marker)
  return (
    await expectJson(
      await api.post('/api/v1/statuses', {
        data: {
          name: `${t} ${suffix}`,
          slug: `${t}_${suffix}`,
          color: '#123456',
          category: 'active',
        },
      }),
      201
    )
  ).data
}

async function makeRoadmap(
  api: APIRequestContext,
  marker: string,
  suffix: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  return (
    await expectJson(
      await api.post('/api/v1/roadmaps', {
        data: { name: `${marker} ${suffix}`, slug: `${marker}-${suffix}`, ...extra },
      }),
      201
    )
  ).data
}

const column = (statusId: string, name = 'Planned') => ({
  statusId,
  name,
  color: '#123456',
  position: 0,
})

test.describe('REST roadmaps: reads', () => {
  test(
    'API-R-078 list, get and columns of a roadmap carry the documented fields',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const status = await makeStatus(api, marker)
      const roadmap = await makeRoadmap(api, marker, 'plan', {
        visibility: 'team',
        columns: [column(status.id)],
      })

      const list = await expectJson(await api.get('/api/v1/roadmaps'), 200)
      const listed = list.data.find((r: { id: string }) => r.id === roadmap.id)
      expect(Object.keys(listed).sort()).toEqual(ROADMAP_KEYS)
      expect(listed).toMatchObject({ slug: `${marker}-plan`, visibility: 'team', type: 'column' })

      const one = await expectJson(await api.get(`/api/v1/roadmaps/${roadmap.id}`), 200)
      expect(Object.keys(one.data).sort()).toEqual(ROADMAP_KEYS)
      expect(one.data.columns).toEqual([
        expect.objectContaining({ statusId: status.id, name: 'Planned', position: 0 }),
      ])
      const cols = await expectJson(await api.get(`/api/v1/roadmaps/${roadmap.id}/columns`), 200)
      expect(cols.data.map((c: { id: string }) => c.id)).toEqual([one.data.columns[0].id])
    }
  )

  test(
    'API-R-079 roadmap posts list the posts in its columns with board and status',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const status = await makeStatus(api, marker)
      const roadmap = await makeRoadmap(api, marker, 'plan', { columns: [column(status.id)] })
      const board = await restBoard(api, `${marker} board`)
      const inside = await restPost(api, board.id, `${marker} inside`, { statusId: status.id })
      const outside = await restPost(api, board.id, `${marker} outside`)

      const { data } = await expectJson(await api.get(`/api/v1/roadmaps/${roadmap.id}/posts`), 200)
      expect(Object.keys(data).sort()).toEqual(['hasMore', 'items', 'total'])
      expect(data.total).toBe(1)
      expect(data.hasMore).toBe(false)
      expect(data.items).toEqual([
        {
          id: inside.id,
          title: `${marker} inside`,
          voteCount: expect.any(Number),
          statusId: status.id,
          eta: null,
          board: { id: board.id, name: `${marker} board`, slug: board.slug },
        },
      ])
      expect(data.items.map((p: { id: string }) => p.id)).not.toContain(outside.id)
    }
  )

  test(
    'API-R-080 roadmap posts page by offset inside data; a malformed statusId is 400',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const a = await makeStatus(api, marker, 'a')
      const b = await makeStatus(api, marker, 'b')
      const roadmap = await makeRoadmap(api, marker, 'plan', {
        columns: [column(a.id, 'A'), { ...column(b.id, 'B'), position: 1 }],
      })
      const board = await restBoard(api, `${marker} board`)
      const ids = []
      for (const [i, s] of [a, a, b].entries()) {
        ids.push((await restPost(api, board.id, `${marker} ${i}`, { statusId: s.id })).id)
      }
      const url = `/api/v1/roadmaps/${roadmap.id}/posts`

      const all = await expectJson(await api.get(`${url}?limit=10`), 200)
      expect(all.data.total).toBe(3)
      const page = await expectJson(await api.get(`${url}?limit=1&offset=1`), 200)
      expect(page.data.items).toHaveLength(1)
      expect(page.data.items[0].id).toBe(all.data.items[1].id)
      expect(page.data).toMatchObject({ total: 3, hasMore: true })
      expect(page.meta).toBeUndefined()
      const last = await expectJson(await api.get(`${url}?limit=1&offset=2`), 200)
      expect(last.data.hasMore).toBe(false)

      const onlyB = await expectJson(await api.get(`${url}?statusId=${b.id}`), 200)
      expect(onlyB.data.items.map((p: { id: string }) => p.id)).toEqual([ids[2]])
      await expectError(
        await api.get(`${url}?statusId=x`),
        400,
        'VALIDATION_ERROR',
        'Invalid status ID format'
      )
    }
  )

  test(
    'API-R-080 roadmap posts refuse a negative offset with 400',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const status = await makeStatus(api, marker)
      const roadmap = await makeRoadmap(api, marker, 'plan', { columns: [column(status.id)] })
      const board = await restBoard(api, `${marker} board`)
      await restPost(api, board.id, `${marker} p`, { statusId: status.id })
      for (const q of ['offset=-1']) {
        const res = await api.get(`/api/v1/roadmaps/${roadmap.id}/posts?${q}`)
        expect(res.status(), `${q}: ${await res.text()}`).toBe(400)
      }
    }
  )
})

test.describe('REST roadmaps: writes', () => {
  test(
    'API-R-081 create column and date roadmaps; legacy isPublic false maps to team; taken and bad slugs are refused',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })

      const plain = await makeRoadmap(api, marker, 'public-plan')
      expect(plain).toMatchObject({ type: 'column', visibility: 'public' })
      expect(Array.isArray(plain.columns)).toBe(true)

      const dated = await makeRoadmap(api, marker, 'dated', {
        type: 'date',
        frequency: 'quarterly',
      })
      expect(dated).toMatchObject({ type: 'date', dateSource: 'eta', frequency: 'quarterly' })
      expect(dated.columns).toEqual([])

      expect((await makeRoadmap(api, marker, 'legacy', { isPublic: false })).visibility).toBe(
        'team'
      )
      expect(
        (await makeRoadmap(api, marker, 'explicit', { visibility: 'public', isPublic: false }))
          .visibility
      ).toBe('public')

      await expectError(
        await api.post('/api/v1/roadmaps', {
          data: { name: `${marker} dup`, slug: `${marker}-public-plan` },
        }),
        409,
        'CONFLICT',
        `A roadmap with slug "${marker}-public-plan" already exists`
      )
      expect((await api.delete(`/api/v1/roadmaps/${dated.id}`)).status()).toBe(204)
      await expectError(
        await api.post('/api/v1/roadmaps', {
          data: { name: `${marker} re`, slug: `${marker}-dated` },
        }),
        409,
        'CONFLICT',
        `A roadmap with slug "${marker}-dated" already exists`
      )
      const bad = await expectError(
        await api.post('/api/v1/roadmaps', { data: { name: `${marker} bad`, slug: 'Bad Slug' } }),
        400,
        'BAD_REQUEST',
        'Invalid request body'
      )
      expect(JSON.stringify(bad.error.details)).toContain(
        'Slug must contain only lowercase letters, numbers, and hyphens'
      )
      await expectError(
        await contributor.api.post('/api/v1/roadmaps', {
          data: { name: `${marker} c`, slug: `${marker}-c` },
        }),
        403,
        'FORBIDDEN',
        "Requires the 'roadmap.manage' permission"
      )
    }
  )

  test(
    'API-R-082 switching to a date roadmap drops its columns; leaving segment visibility clears segments; a deleted roadmap is 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const status = await makeStatus(api, marker)
      const other = await makeStatus(api, marker, 'o')
      const roadmap = await makeRoadmap(api, marker, 'plan', { columns: [column(status.id)] })
      const url = `/api/v1/roadmaps/${roadmap.id}`

      const replaced = await expectJson(
        await api.patch(url, { data: { columns: [column(other.id, 'Other')] } }),
        200
      )
      expect(replaced.data.columns).toEqual([
        expect.objectContaining({ statusId: other.id, name: 'Other' }),
      ])

      const segment = generateId('segment')
      const seg = await expectJson(
        await api.patch(url, { data: { visibility: 'segment', visibleSegmentIds: [segment] } }),
        200
      )
      expect(seg.data).toMatchObject({ visibility: 'segment', visibleSegmentIds: [segment] })
      const pub = await expectJson(await api.patch(url, { data: { visibility: 'public' } }), 200)
      expect(pub.data.visibility).toBe('public')
      expect(pub.data.visibleSegmentIds ?? []).toEqual([])

      const dated = await expectJson(await api.patch(url, { data: { type: 'date' } }), 200)
      expect(dated.data).toMatchObject({ type: 'date', dateSource: 'eta', frequency: 'monthly' })
      expect(dated.data.columns).toEqual([])
      const cols = await expectJson(await api.get(`${url}/columns`), 200)
      expect(cols.data).toEqual([])

      expect((await api.delete(url)).status()).toBe(204)
      await expectError(
        await api.patch(url, { data: { name: `${marker} late` } }),
        404,
        'NOT_FOUND',
        'Roadmap not found'
      )
    }
  )

  test(
    'API-R-083 deleting a roadmap answers 204, then 404, and it can no longer be read',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const roadmap = await makeRoadmap(api, marker, 'gone')
      const url = `/api/v1/roadmaps/${roadmap.id}`
      await expectJson(await api.get(url), 200)
      expect((await api.delete(url)).status()).toBe(204)
      await expectError(await api.delete(url), 404, 'NOT_FOUND', 'Roadmap not found')
      await expectError(await api.get(url), 404, 'NOT_FOUND', 'Roadmap not found')
    }
  )

  test(
    'API-R-084 roadmap columns can be added, edited and removed; date roadmaps take none',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const a = await makeStatus(api, marker, 'a')
      const b = await makeStatus(api, marker, 'b')
      const roadmap = await makeRoadmap(api, marker, 'plan', { columns: [column(a.id, 'A')] })
      const url = `/api/v1/roadmaps/${roadmap.id}/columns`

      const added = await expectJson(
        await api.post(url, { data: { statusId: b.id, name: 'B', color: '#654321' } }),
        201
      )
      expect(added.data).toMatchObject({ statusId: b.id, name: 'B', position: 1 })
      const colUrl = `${url}/${added.data.id}`
      const edited = await expectJson(
        await api.patch(colUrl, { data: { name: 'Bee', position: 5 } }),
        200
      )
      expect(edited.data).toMatchObject({ name: 'Bee', position: 5 })
      expect((await api.delete(colUrl)).status()).toBe(204)
      await expectError(
        await api.delete(colUrl),
        404,
        'NOT_FOUND',
        `Roadmap column ${added.data.id} not found`
      )
      const left = await expectJson(await api.get(url), 200)
      expect(left.data.map((c: { name: string }) => c.name)).toEqual(['A'])

      const dated = await makeRoadmap(api, marker, 'dated', { type: 'date' })
      await expectError(
        await api.post(`/api/v1/roadmaps/${dated.id}/columns`, {
          data: { statusId: b.id, name: 'B', color: '#654321' },
        }),
        400,
        'VALIDATION_ERROR',
        'Date roadmaps cannot have status columns'
      )
      await expectError(
        await api.patch(`${url}/nope`, { data: { name: 'x' } }),
        400,
        'VALIDATION_ERROR',
        'Invalid roadmap column ID format'
      )
    }
  )

  test(
    'API-R-084 a column with an unknown status is refused with a client error',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const roadmap = await makeRoadmap(api, marker, 'plan')
      const res = await api.post(`/api/v1/roadmaps/${roadmap.id}/columns`, {
        data: { statusId: generateId('post_status'), name: 'X', color: '#000000' },
      })
      expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400)
      expect(res.status()).toBeLessThan(500)
    }
  )

  test(
    "API-R-085 a column of another roadmap cannot be edited or removed through a roadmap's URL",
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const status = await makeStatus(api, marker)
      const a = await makeRoadmap(api, marker, 'a')
      const b = await makeRoadmap(api, marker, 'b', { columns: [column(status.id, 'Mine')] })
      const col = b.columns[0].id
      const patch = await api.patch(`/api/v1/roadmaps/${a.id}/columns/${col}`, {
        data: { name: 'moved' },
      })
      expect(patch.status()).toBe(404)
      const del = await api.delete(`/api/v1/roadmaps/${a.id}/columns/${col}`)
      expect(del.status()).toBe(404)
      const cols = await expectJson(await api.get(`/api/v1/roadmaps/${b.id}/columns`), 200)
      expect(cols.data).toEqual([expect.objectContaining({ id: col, name: 'Mine' })])
    }
  )
})
