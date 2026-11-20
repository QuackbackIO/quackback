/**
 * The REST API for boards, statuses and tags (/api/v1/boards, /statuses,
 * /tags). Journeys API-R-063..077.
 *
 * Boards, statuses and tags are workspace-wide lists the other worker changes
 * too: each test asserts only on rows carrying its own marker or token.
 *
 * Owner questions (the contested half is not asserted either way):
 * - API-R-063, 070, 074: whether bare-auth reads should need a view
 *   permission and read:feedback. Only shape and order with an admin key.
 * Not covered here:
 * - API-R-069 (board cap): tier limits are a no-op in this build and
 *   `withSettings` has no tier-limit column.
 * - API-R-071 step 4 and API-R-072 steps 3-4: they move the workspace default
 *   status, a post_statuses row `withSettings` cannot express.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { expectJson } from '../../support/api-client'
import {
  defaultStatusId,
  expectError,
  keyApi,
  restBoard,
  restPost,
  shortToken,
  uuid,
  waitForAudit,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 60_000 })

const BOARD_LIST_KEYS = [
  'audience',
  'createdAt',
  'description',
  'id',
  'name',
  'postCount',
  'slug',
  'updatedAt',
]
const STATUS_KEYS = [
  'category',
  'color',
  'createdAt',
  'id',
  'isDefault',
  'name',
  'position',
  'showOnRoadmap',
  'slug',
]
const TAG_KEYS = ['color', 'createdAt', 'description', 'id', 'isPublic', 'name']

test.describe('REST boards', () => {
  test(
    'API-R-063 the board list has the documented shape and counts live posts only',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      await restPost(api, board.id, `${marker} one`)
      const gone = await restPost(api, board.id, `${marker} two`)
      await supportDb()`UPDATE posts SET deleted_at = NOW() WHERE id = ${uuid(gone.id)}`

      const { data } = await expectJson(await api.get('/api/v1/boards'), 200)
      const mine = data.find((b: { id: string }) => b.id === board.id)
      expect(Object.keys(mine).sort()).toEqual(BOARD_LIST_KEYS)
      expect(mine).toMatchObject({
        name: `${marker} board`,
        slug: board.slug,
        audience: { kind: 'public' },
        postCount: 1,
      })
    }
  )

  test(
    'API-R-064 get a board with its settings; malformed 400, unknown 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const { data } = await expectJson(await api.get(`/api/v1/boards/${board.id}`), 200)
      expect(Object.keys(data).sort()).toEqual(
        [
          'audience',
          'createdAt',
          'description',
          'id',
          'name',
          'settings',
          'slug',
          'updatedAt',
        ].sort()
      )
      expect(data).toMatchObject({ id: board.id, name: `${marker} board` })
      expect(typeof data.settings).toBe('object')
      await expectError(
        await api.get('/api/v1/boards/nope'),
        400,
        'VALIDATION_ERROR',
        'Invalid board ID format'
      )
      await expectError(
        await api.get(`/api/v1/boards/${generateId('board')}`),
        404,
        'NOT_FOUND',
        'Board not found'
      )
    }
  )

  test(
    'API-R-065 create a board: public, slug suffixed on collision, audience dropped, bad slug 400',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const res = await api.post('/api/v1/boards', {
        data: { name: `${marker} Ideas`, description: 'Ideas board' },
      })
      const first = (await expectJson(res, 201)).data
      expect(Object.keys(first).sort()).toEqual(
        ['audience', 'createdAt', 'description', 'id', 'name', 'slug', 'updatedAt'].sort()
      )
      expect(first).toMatchObject({
        name: `${marker} Ideas`,
        slug: `${marker}-ideas`,
        description: 'Ideas board',
        audience: { kind: 'public' },
      })
      const second = await restBoard(api, `${marker} Ideas`)
      expect(second.slug).toBe(`${marker}-ideas-1`)

      // An explicit slug held by another board is suffixed too, not refused.
      const explicit = (
        await expectJson(
          await api.post('/api/v1/boards', {
            data: { name: `${marker} again`, slug: `${marker}-ideas` },
          }),
          201
        )
      ).data
      expect(explicit.slug).not.toBe(`${marker}-ideas`)
      expect(explicit.slug.startsWith(`${marker}-ideas`)).toBe(true)

      const privateTry = (
        await expectJson(
          await api.post('/api/v1/boards', {
            data: {
              name: `${marker} private try`,
              audience: { kind: 'team' },
              access: { view: 'team' },
            },
          }),
          201
        )
      ).data
      expect(privateTry.audience).toEqual({ kind: 'public' })
      const [row] = await supportDb()`SELECT access FROM boards WHERE id = ${uuid(privateTry.id)}`
      expect((row.access as { view: string }).view).toBe('anonymous')

      const bad = await expectError(
        await api.post('/api/v1/boards', { data: { name: `${marker} bad`, slug: 'Bad_Slug' } }),
        400,
        'BAD_REQUEST',
        'Invalid request body'
      )
      expect(JSON.stringify(bad.error.details)).toContain(
        'Slug must contain only lowercase letters, numbers, and hyphens'
      )

      const [audit] = await waitForAudit(first.id, 'board.created')
      expect(audit.actor_type).toBe('service')
    }
  )

  test(
    'API-R-066 update a board: slug follows the name, a taken slug is 409, free-form slugs are slugified, readOnly toggles',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const other = await restBoard(api, `${marker} other`)
      const url = `/api/v1/boards/${board.id}`

      const renamed = await expectJson(
        await api.patch(url, { data: { name: `${marker} New Name` } }),
        200
      )
      expect(renamed.data).toMatchObject({
        name: `${marker} New Name`,
        slug: `${marker}-new-name`,
      })

      await expectError(
        await api.patch(url, { data: { slug: other.slug } }),
        409,
        'CONFLICT',
        `A board with slug "${other.slug}" already exists`
      )

      const slugged = await expectJson(
        await api.patch(url, { data: { slug: `My Slug! ${marker}` } }),
        200
      )
      expect(slugged.data.slug).toBe(`my-slug-${marker}`)

      const ro = await expectJson(
        await api.patch(url, { data: { readOnly: true, audience: { kind: 'team' } } }),
        200
      )
      expect(ro.data.readOnly).toBe(true)
      expect(ro.data.audience).toEqual({ kind: 'public' })
      const back = await expectJson(await api.patch(url, { data: { readOnly: false } }), 200)
      expect(back.data.readOnly).toBe(false)
    }
  )

  test(
    'API-R-067 deleting a board answers 204, drops it from webhook filters and closes its posts; a second delete is 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const keep = await restBoard(api, `${marker} keep`)
      const post = await restPost(api, board.id, `${marker} post`)
      const hookRes = await api.post('/api/v1/webhooks', {
        data: {
          url: `https://hooks.example/${marker}`,
          events: ['post.created'],
          boardIds: [board.id, keep.id],
        },
      })
      const hook = (await expectJson(hookRes, 201)).data
      try {
        expect((await api.delete(`/api/v1/boards/${board.id}`)).status()).toBe(204)
        const [row] = await supportDb()`SELECT deleted_at FROM boards WHERE id = ${uuid(board.id)}`
        expect(row.deleted_at).not.toBeNull()
        await waitForAudit(board.id, 'board.deleted')

        await expect
          .poll(async () => {
            const got = await expectJson(await api.get(`/api/v1/webhooks/${hook.id}`), 200)
            return got.data.boardIds
          })
          .toEqual([keep.id])

        await expectError(
          await api.post(`/api/v1/posts/${post.id}/comments`, { data: { content: marker } }),
          404,
          'NOT_FOUND',
          'Post not found'
        )
        await expectError(
          await api.delete(`/api/v1/boards/${board.id}`),
          404,
          'NOT_FOUND',
          'Board not found'
        )
      } finally {
        await api.delete(`/api/v1/webhooks/${hook.id}`)
      }
    }
  )

  test(
    'API-R-068 board writes need board.manage and write:feedback',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, people)
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })
      const readOnly = await keyApi(playwright, baseURL, people, { scopes: ['read:feedback'] })
      const board = await restBoard(admin.api, `${marker} board`)
      const calls = (api: typeof admin.api) => [
        api.post('/api/v1/boards', { data: { name: `${marker} refused` } }),
        api.patch(`/api/v1/boards/${board.id}`, { data: { name: `${marker} refused` } }),
        api.delete(`/api/v1/boards/${board.id}`),
      ]
      for (const res of calls(contributor.api)) {
        await expectError(await res, 403, 'FORBIDDEN', "Requires the 'board.manage' permission")
      }
      for (const res of calls(readOnly.api)) {
        await expectError(
          await res,
          403,
          'FORBIDDEN',
          "This API key is missing the 'write:feedback' scope required by 'board.manage'"
        )
      }
      // Positive control: the admin key's rename goes through.
      const ok = await expectJson(
        await admin.api.patch(`/api/v1/boards/${board.id}`, {
          data: { name: `${marker} renamed` },
        }),
        200
      )
      expect(ok.data.name).toBe(`${marker} renamed`)
    }
  )
})

test.describe('REST statuses', () => {
  test(
    'API-R-070 the status list is ordered active, complete, closed then position and leaves out deleted ones',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const make = async (suffix: string, category: string, position: number) =>
        (
          await expectJson(
            await api.post('/api/v1/statuses', {
              data: {
                name: `${t} ${suffix}`,
                slug: `${t}_${suffix}`,
                color: '#123456',
                category,
                position,
              },
            }),
            201
          )
        ).data
      const closed = await make('closed', 'closed', 0)
      const active2 = await make('active2', 'active', 9)
      const complete = await make('complete', 'complete', 0)
      const active1 = await make('active1', 'active', 8)
      const gone = await make('gone', 'active', 7)
      expect((await api.delete(`/api/v1/statuses/${gone.id}`)).status()).toBe(204)

      const { data } = await expectJson(await api.get('/api/v1/statuses'), 200)
      const mine = data
        .filter((s: { slug: string }) => s.slug.startsWith(`${t}_`))
        .map((s: { id: string }) => s.id)
      expect(mine).toEqual([active1.id, active2.id, complete.id, closed.id])
      const one = data.find((s: { id: string }) => s.id === active1.id)
      expect(Object.keys(one).sort()).toEqual(STATUS_KEYS)

      const got = await expectJson(await api.get(`/api/v1/statuses/${complete.id}`), 200)
      expect(got.data).toMatchObject({ id: complete.id, category: 'complete' })
    }
  )

  test(
    'API-R-071 create a status: defaults, a slug held even by a deleted status is 409, bad input 400',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const created = await expectJson(
        await api.post('/api/v1/statuses', {
          data: { name: `${t} review`, slug: `${t}_review`, color: '#3b82f6', category: 'active' },
        }),
        201
      )
      expect(Object.keys(created.data).sort()).toEqual(STATUS_KEYS)
      expect(created.data).toMatchObject({
        name: `${t} review`,
        slug: `${t}_review`,
        color: '#3b82f6',
        category: 'active',
        showOnRoadmap: false,
        isDefault: false,
        position: 0,
      })
      await expectError(
        await api.post('/api/v1/statuses', {
          data: { name: `${t} dup`, slug: `${t}_review`, color: '#3b82f6', category: 'active' },
        }),
        409,
        'CONFLICT',
        `A status with slug '${t}_review' already exists`
      )
      expect((await api.delete(`/api/v1/statuses/${created.data.id}`)).status()).toBe(204)
      await expectError(
        await api.post('/api/v1/statuses', {
          data: { name: `${t} again`, slug: `${t}_review`, color: '#3b82f6', category: 'active' },
        }),
        409,
        'CONFLICT',
        `A status with slug '${t}_review' already exists`
      )
      for (const bad of [
        { slug: `${t}-In-Review`, color: '#3b82f6', category: 'active' },
        { slug: `${t}_blue`, color: 'blue', category: 'active' },
        { slug: `${t}_done`, color: '#3b82f6', category: 'done' },
      ]) {
        await expectError(
          await api.post('/api/v1/statuses', { data: { name: `${t} bad`, ...bad } }),
          400,
          'BAD_REQUEST',
          'Invalid request body'
        )
      }
    }
  )

  test(
    'API-R-072 status PATCH changes name, color and the roadmap flag; slug, category and position are ignored',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const created = (
        await expectJson(
          await api.post('/api/v1/statuses', {
            data: { name: `${t} s`, slug: `${t}_s`, color: '#111111', category: 'active' },
          }),
          201
        )
      ).data
      const url = `/api/v1/statuses/${created.id}`
      const updated = await expectJson(
        await api.patch(url, {
          data: { name: `${t} renamed`, color: '#222222', showOnRoadmap: true },
        }),
        200
      )
      expect(updated.data).toMatchObject({
        name: `${t} renamed`,
        color: '#222222',
        showOnRoadmap: true,
      })
      // Alongside a real change, slug, category and position are stripped.
      const mixed = await expectJson(
        await api.patch(url, {
          data: { name: `${t} again`, slug: 'x', category: 'closed', position: 3 },
        }),
        200
      )
      expect(mixed.data).toMatchObject({
        name: `${t} again`,
        slug: `${t}_s`,
        category: 'active',
        position: 0,
      })
      const [row] = await supportDb()`SELECT slug, category, position FROM post_statuses
                                      WHERE id = ${uuid(created.id)}`
      expect(row).toEqual({ slug: `${t}_s`, category: 'active', position: 0 })
    }
  )

  test(
    'API-R-072 a status PATCH holding only ignored fields answers 200 with nothing changed',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'PATCH /statuses/:id with only stripped fields (slug, category, position) answers 500: updateStatus runs an UPDATE with an empty SET (apps/web/src/lib/server/domains/statuses/status.service.ts:100-150)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const created = (
        await expectJson(
          await api.post('/api/v1/statuses', {
            data: { name: `${t} s`, slug: `${t}_s`, color: '#111111', category: 'active' },
          }),
          201
        )
      ).data
      const ignored = await expectJson(
        await api.patch(`/api/v1/statuses/${created.id}`, {
          data: { slug: 'x', category: 'closed', position: 3 },
        }),
        200
      )
      expect(ignored.data).toMatchObject({ slug: `${t}_s`, category: 'active', position: 0 })
    }
  )

  test(
    'API-R-073 deleting the default or an in-use status is 403; an unused one is 204 then 404',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const def = await defaultStatusId()
      await expectError(
        await api.delete(`/api/v1/statuses/${def}`),
        403,
        'FORBIDDEN',
        'Cannot delete the default status. Set another status as default first.'
      )

      const make = async (suffix: string) =>
        (
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
      const used = await make('used')
      const unused = await make('unused')
      const board = await restBoard(api, `${marker} board`)
      await restPost(api, board.id, `${marker} a`, { statusId: used.id })
      await restPost(api, board.id, `${marker} b`, { statusId: used.id })
      const gone = await restPost(api, board.id, `${marker} c`, { statusId: used.id })
      await supportDb()`UPDATE posts SET deleted_at = NOW() WHERE id = ${uuid(gone.id)}`

      await expectError(
        await api.delete(`/api/v1/statuses/${used.id}`),
        403,
        'FORBIDDEN',
        'Cannot delete status. 2 post(s) are using this status. Reassign them first.'
      )
      expect((await api.delete(`/api/v1/statuses/${unused.id}`)).status()).toBe(204)
      await expectError(
        await api.delete(`/api/v1/statuses/${unused.id}`),
        404,
        'NOT_FOUND',
        'Status not found'
      )
      const [row] =
        await supportDb()`SELECT deleted_at FROM post_statuses WHERE id = ${uuid(used.id)}`
      expect(row.deleted_at).toBeNull()
    }
  )
})

test.describe('REST tags', () => {
  test(
    'API-R-074 the tag list and a single tag carry the documented fields, team-only tags with isPublic false',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const tag = (
        await expectJson(
          await api.post('/api/v1/tags', { data: { name: `${t} internal`, isPublic: false } }),
          201
        )
      ).data
      const { data } = await expectJson(await api.get('/api/v1/tags'), 200)
      const mine = data.find((x: { id: string }) => x.id === tag.id)
      expect(Object.keys(mine).sort()).toEqual(TAG_KEYS)
      expect(mine).toMatchObject({ name: `${t} internal`, isPublic: false })
      const one = await expectJson(await api.get(`/api/v1/tags/${tag.id}`), 200)
      expect(one.data).toMatchObject({ id: tag.id, isPublic: false })
    }
  )

  test(
    'API-R-075 create a tag with defaults; a case-insensitive duplicate, even of a deleted tag, is 409',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const created = await expectJson(
        await api.post('/api/v1/tags', { data: { name: `${t} Mobile` } }),
        201
      )
      expect(created.data).toMatchObject({ name: `${t} Mobile`, color: '#6b7280', isPublic: true })
      await expectError(
        await api.post('/api/v1/tags', { data: { name: `${t} mobile` } }),
        409,
        'CONFLICT',
        `A tag with name "${t} mobile" already exists`
      )
      expect((await api.delete(`/api/v1/tags/${created.data.id}`)).status()).toBe(204)
      await expectError(
        await api.post('/api/v1/tags', { data: { name: `${t} Mobile` } }),
        409,
        'CONFLICT',
        `A tag with name "${t} Mobile" already exists`
      )
    }
  )

  test(
    'API-R-076 update and delete a tag; renaming onto another tag is 409; a second delete is 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const tag = (
        await expectJson(
          await api.post('/api/v1/tags', { data: { name: `${t} a`, description: 'first' } }),
          201
        )
      ).data
      const other = (
        await expectJson(await api.post('/api/v1/tags', { data: { name: `${t} b` } }), 201)
      ).data
      const updated = await expectJson(
        await api.patch(`/api/v1/tags/${tag.id}`, {
          data: { name: `${t} c`, color: '#ff0000', description: null, isPublic: false },
        }),
        200
      )
      expect(updated.data).toMatchObject({
        name: `${t} c`,
        color: '#ff0000',
        description: null,
        isPublic: false,
      })
      const clash = await api.patch(`/api/v1/tags/${tag.id}`, { data: { name: other.name } })
      expect(clash.status(), await clash.text()).toBe(409)

      expect((await api.delete(`/api/v1/tags/${tag.id}`)).status()).toBe(204)
      const again = await expectJson(await api.delete(`/api/v1/tags/${tag.id}`), 404)
      expect(again.error.code).toBe('NOT_FOUND')
      const unknown = await expectJson(
        await api.patch(`/api/v1/tags/${generateId('post_tag')}`, {
          data: { name: `${t} z` },
        }),
        404
      )
      expect(unknown.error.code).toBe('NOT_FOUND')
    }
  )

  test(
    'API-R-076 a missing tag answers "Tag not found", not the internal model name',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'TAG_NOT_FOUND maps to the public text "PostTag not found" (apps/web/src/lib/server/domains/api/responses.ts:180)',
      },
    },
    async ({ playwright, baseURL, people }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      await expectError(
        await api.get(`/api/v1/tags/${generateId('post_tag')}`),
        404,
        'NOT_FOUND',
        'Tag not found'
      )
    }
  )
})

test.describe('REST taxonomy: deleted rows', () => {
  test(
    'API-R-077 deleted boards, statuses and tags answer 404 on GET and PATCH',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Soft-deleted boards, statuses and tags stay readable and editable by id (board.service.ts:184-186,321-324; status.service.ts:103-105,204-207; post-tag.service.ts:93-95,165-169)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const t = shortToken(marker)
      const board = await restBoard(api, `${marker} board`)
      const status = (
        await expectJson(
          await api.post('/api/v1/statuses', {
            data: { name: `${t} s`, slug: `${t}_s`, color: '#123456', category: 'active' },
          }),
          201
        )
      ).data
      const tag = (
        await expectJson(await api.post('/api/v1/tags', { data: { name: `${t} t` } }), 201)
      ).data
      for (const path of [
        `/api/v1/boards/${board.id}`,
        `/api/v1/statuses/${status.id}`,
        `/api/v1/tags/${tag.id}`,
      ]) {
        expect((await api.delete(path)).status(), path).toBe(204)
        expect((await api.get(path)).status(), `GET ${path}`).toBe(404)
        expect(
          (await api.patch(path, { data: { name: `${t} edited` } })).status(),
          `PATCH ${path}`
        ).toBe(404)
      }
    }
  )
})
