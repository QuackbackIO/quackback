/**
 * Outgoing webhooks for feedback events: posts, votes and comments, from the
 * portal, the admin, REST and MCP. Journeys API-W-28, 31, 32, 33, 36, 37, 38,
 * 39, 41, 42, 43, 45, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60.
 *
 * Each test subscribes webhooks on its own sink channels (deleted in
 * `finally`), filters deliveries by its own post or comment ids, and proves
 * every "not delivered" after a later delivery on the same channel arrived.
 */
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { apiFor, createKey, mcpCall, newTeammate } from '../../support/api-client'
import { callServerFn, personApi } from '../../support/server-fns'
import { sink } from '../../support/webhook-sink-client'
import { bodyOf, expectSigned } from '../../support/webhooks'
import {
  adminApi,
  delivered,
  eventRows,
  expectNone,
  getHook,
  is,
  json,
  newBoard,
  newComment,
  newPost,
  seedTestCustomer,
  statusId,
  withHook,
  withHooks,
  type Api,
  type Json,
} from '../../product/webhooks'

test.describe.configure({ timeout: 90_000 })

type Body = Record<string, Json & Record<string, unknown>>

const data = (d: Parameters<typeof bodyOf>[0]) => bodyOf<Body>(d).data

/** Turn on the per-board approval queue for signed-in posts and comments. */
async function holdBoard(boardId: string): Promise<void> {
  await supportDb()`UPDATE boards SET access = jsonb_set(jsonb_set(access, '{moderation,signedPosts}', '"on"'),
    '{moderation,comments}', '"on"') WHERE id = ${toUuid(boardId as `board_${string}`)}`
}

async function postTag(api: Api, name: string): Promise<string> {
  const { data: tag } = await json<{ data: { id: string } }>(
    await api.post('/api/v1/tags', { data: { name } }),
    201
  )
  return tag.id
}

test.describe('feedback webhook delivery rules', () => {
  test(
    'API-W-28 a board filter limits post and comment events to that board',
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const [a, b] = [await newBoard(api, marker, 'a'), await newBoard(api, marker, 'b')]
      const filtered = `${marker}-w1`
      const all = `${marker}-w2`
      const events = ['post.created', 'comment.created', 'post.status_changed']
      try {
        await withHooks(
          api,
          [
            { channel: filtered, events, boardIds: [a.id] },
            { channel: all, events },
          ],
          async () => {
            const onB = await newPost(api, b.id, `On B ${marker}`)
            const onBComment = await newComment(api, onB.id, `Comment on B ${marker}`)
            const onA = await newPost(api, a.id, `On A ${marker}`)
            const onAComment = await newComment(api, onA.id, `Comment on A ${marker}`)

            await delivered(all, 'post.created', onB.id)
            await delivered(all, 'comment.created', onBComment.id)
            await delivered(all, 'post.created', onA.id)
            await delivered(all, 'comment.created', onAComment.id)

            const [aPost] = await delivered(filtered, 'post.created', onA.id)
            const [aComment] = await delivered(filtered, 'comment.created', onAComment.id)
            expect(data(aPost).post.boardId).toBe(a.id)
            expect(data(aComment).post.id).toBe(onA.id)
            await expectNone(filtered, (d) => d.body.includes(onB.id), 'board B on the A webhook')
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    "API-W-31 a test customer's posts and comments, and comments on their posts, are never delivered",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      // A teammate has at most one test customer, so each run makes its own owner.
      const owner = newTeammate(`Hooks tester ${marker}`, [])
      const tester = await seedTestCustomer(owner.principalId, marker)
      try {
        await withHook(api, marker, ['post.created', 'comment.created'], async () => {
          const real = await newPost(api, board.id, `Real ${marker}`)
          const testPost = await newPost(api, board.id, `Test post ${marker}`, {
            authorPrincipalId: tester.principalId,
          })
          const testComment = await newComment(api, real.id, `Test comment ${marker}`, {
            authorPrincipalId: tester.principalId,
          })
          const onTestPost = await newComment(api, testPost.id, `Real on test ${marker}`, {
            authorPrincipalId: people.people.customer.principalId,
          })
          // Positive control, enqueued after the test-customer events.
          const control = await newComment(api, real.id, `Real comment ${marker}`)
          await delivered(marker, 'post.created', real.id)
          await delivered(marker, 'comment.created', control.id)

          for (const [type, id] of [
            ['post.created', testPost.id],
            ['comment.created', testComment.id],
            ['comment.created', onTestPost.id],
          ] as const) {
            const rows = await eventRows(type, id)
            expect(rows, `${type} ${id} recorded`).toHaveLength(1)
            expect(rows[0].published_at, `${type} ${id} published at insert`).not.toBeNull()
          }
          await expectNone(
            marker,
            (d) => [testPost.id, testComment.id, onTestPost.id].some((id) => d.body.includes(id)),
            'test-customer content'
          )
        })
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-32 a non-retryable answer is tried once and counts one failure',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      await sink.respondWith(marker, 410)
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const post = await newPost(api, board.id, `Gone ${marker}`)
            const [first] = await delivered(marker, 'post.created', post.id)
            expect(first.status).toBe(410)
            await expect.poll(async () => (await getHook(api, hook.id)).failureCount).toBe(1)
            // The fast retry would land about a second later; there is none.
            await new Promise((r) => setTimeout(r, 4_000))
            expect(await sink.deliveries(marker)).toHaveLength(1)
            expect(await getHook(api, hook.id)).toMatchObject({
              status: 'active',
              failureCount: 1,
              lastError: 'HTTP 410',
              lastTriggeredAt: expect.any(String),
            })
          },
          [board.id]
        )
      } finally {
        await sink.respondWith(marker, null)
        await api.dispose()
      }
    }
  )

  test(
    'API-W-33 a successful delivery resets the failure count',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      await sink.respondWith(marker, 410)
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const failed = await newPost(api, board.id, `Fails ${marker}`)
            await delivered(marker, 'post.created', failed.id)
            await expect.poll(async () => (await getHook(api, hook.id)).failureCount).toBe(1)
            const firstTriggered = String((await getHook(api, hook.id)).lastTriggeredAt)

            await sink.respondWith(marker, null)
            const ok = await newPost(api, board.id, `Works ${marker}`)
            const [d] = await delivered(marker, 'post.created', ok.id)
            expect(d.status).toBe(200)
            await expect.poll(async () => (await getHook(api, hook.id)).failureCount).toBe(0)
            const after = await getHook(api, hook.id)
            expect(after.lastError).toBeNull()
            expect(Date.parse(String(after.lastTriggeredAt))).toBeGreaterThan(
              Date.parse(firstTriggered)
            )
          },
          [board.id]
        )
      } finally {
        await sink.respondWith(marker, null)
        await api.dispose()
      }
    }
  )
})

test.describe('post events', () => {
  test(
    'API-W-36 post.created from a signed-in portal user carries their details and a markdown body',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const portal = await personApi(playwright, 'customer')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const title = `Portal post ${marker}`
            const res = await callServerFn<{ id: string }>(portal, 'createPublicPostFn', {
              boardId: board.id,
              title,
              content: 'Please add bold support',
              contentJson: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Please add ' },
                      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                      { type: 'text', text: ' support' },
                    ],
                  },
                ],
              },
            })
            expect(res.ok, res.error).toBe(true)
            const postId = res.data.id
            const [d] = await delivered(marker, 'post.created', postId)
            expectSigned(d, hook.secret)
            expect(d.headers['x-quackback-event']).toBe('post.created')
            const body = bodyOf<Body>(d)
            expect(body.type).toBe('post.created')
            expect(body.id).toMatch(/^evt_/)
            const [row] = await supportDb()`SELECT vote_count FROM posts
              WHERE id = ${toUuid(postId as `post_${string}`)}`
            expect(body.data.post).toEqual({
              id: postId,
              title,
              content: 'Please add **bold** support',
              boardId: board.id,
              boardSlug: board.slug,
              authorEmail: people.people.customer.email,
              authorName: people.people.customer.displayName,
              voteCount: row.vote_count,
            })
            expect(await eventRows('post.created', postId)).toHaveLength(1)
            await new Promise((r) => setTimeout(r, 1_500))
            expect(await sink.deliveries(marker)).toHaveLength(1)
          },
          [board.id]
        )
      } finally {
        await portal.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-37 post.created over REST on behalf of a person, and over MCP',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'personal',
        name: `Hooks key ${marker}`,
      })
      const api = await apiFor(playwright, baseURL, key.key)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async () => {
            const onBehalf = await newPost(api, board.id, `On behalf ${marker}`, {
              authorPrincipalId: people.people.customer.principalId,
            })
            const [rest] = await delivered(marker, 'post.created', onBehalf.id)
            expect(data(rest).post).toMatchObject({
              authorEmail: people.people.customer.email,
              authorName: people.people.customer.displayName,
            })

            const mcp = await mcpCall(api, 'create_post', {
              boardId: board.id,
              title: `Via MCP ${marker}`,
            })
            expect(mcp.isError, mcp.text).toBe(false)
            const mcpId = mcp.json.id as string
            const [viaMcp] = await delivered(marker, 'post.created', mcpId)
            const [keyPrincipal] = await supportDb()`SELECT display_name FROM principal
              WHERE id = ${toUuid(key.principalId as `principal_${string}`)}`
            expect(data(viaMcp).post.authorName).toBe(keyPrincipal.display_name)
            expect(data(viaMcp).post).not.toHaveProperty('authorEmail')
            await new Promise((r) => setTimeout(r, 1_500))
            expect((await sink.deliveries(marker)).filter(is('post.created', mcpId))).toHaveLength(
              1
            )
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-38 import mode on an admin key suppresses post.created and comment.created; other keys still emit',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const writer = newTeammate(`Hooks writer ${marker}`, ['post.create', 'post.view_private'])
      const writerApi = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: writer.email, kind: 'personal' }).key
      )
      const importing = { 'x-import-mode': 'true' }
      try {
        await withHook(
          api,
          marker,
          ['post.created', 'comment.created'],
          async () => {
            const imported = await newPost(api, board.id, `Imported ${marker}`, {}, importing)
            const comment = await json<{ data: { id: string } }>(
              await api.post(`/api/v1/posts/${imported.id}/comments`, {
                data: { content: `Imported comment ${marker}` },
                headers: importing,
              }),
              201
            )
            await json(
              await api.post(`/api/v1/posts/${imported.id}/vote/proxy`, {
                data: { voterPrincipalId: people.people.customer.principalId },
                headers: importing,
              }),
              200
            )
            const ignored = await newPost(writerApi, board.id, `Not admin ${marker}`, {}, importing)
            await delivered(marker, 'post.created', ignored.id)

            expect(await eventRows('post.created', imported.id)).toHaveLength(0)
            expect(await eventRows('comment.created', comment.data.id)).toHaveLength(0)
            const proxy = await supportDb()`SELECT id FROM post_activity
              WHERE post_id = ${toUuid(imported.id as `post_${string}`)} AND type = 'vote.proxy'`
            expect(proxy).toHaveLength(0)
            await expectNone(marker, (d) => d.body.includes(imported.id), 'imported post')
          },
          [board.id]
        )
      } finally {
        await writerApi.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-39 a held post sends post.created only when approved; a rejected one never',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      await holdBoard(board.id)
      const portal = await personApi(playwright, 'customer')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async () => {
            const submit = async (title: string) => {
              const res = await callServerFn<{ id: string }>(portal, 'createPublicPostFn', {
                boardId: board.id,
                title,
              })
              expect(res.ok, res.error).toBe(true)
              return res.data.id
            }
            const approved = await submit(`Held then approved ${marker}`)
            const rejected = await submit(`Held then rejected ${marker}`)
            const [row] = await supportDb()`SELECT moderation_state FROM posts
              WHERE id = ${toUuid(approved as `post_${string}`)}`
            expect(row.moderation_state).toBe('pending')

            await json(await api.post(`/api/v1/moderation/posts/${rejected}/reject`), 200)
            await json(await api.post(`/api/v1/moderation/posts/${approved}/approve`), 200)
            const [d] = await delivered(marker, 'post.created', approved)
            expect(data(d).post).toMatchObject({
              authorEmail: people.people.customer.email,
              authorName: people.people.customer.displayName,
            })
            // A control after the rejection, so its absence is meaningful.
            const control = await newPost(api, board.id, `Control ${marker}`)
            await delivered(marker, 'post.created', control.id)
            await expectNone(marker, (x) => x.body.includes(rejected), 'rejected post')
            expect(
              (await sink.deliveries(marker)).filter(is('post.created', approved))
            ).toHaveLength(1)
          },
          [board.id]
        )
      } finally {
        await portal.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-41 post.status_changed from the admin status change names the old and new status',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const admin = await personApi(playwright, 'admin')
      try {
        await withHook(
          api,
          marker,
          ['post.status_changed'],
          async () => {
            const post = await newPost(api, board.id, `Status ${marker}`)
            for (const slug of ['planned', 'in_progress']) {
              const res = await callServerFn(admin, 'changePostStatusFn', {
                id: post.id,
                statusId: await statusId(api, slug),
              })
              expect(res.ok, res.error).toBe(true)
            }
            const ds = await delivered(marker, 'post.status_changed', post.id, { count: 2 })
            const payloads = ds
              .map(data)
              .sort((x, y) => String(x.previousStatus).localeCompare(String(y.previousStatus)))
            expect(payloads).toEqual([
              {
                post: { id: post.id, title: post.title, boardId: board.id, boardSlug: board.slug },
                previousStatus: 'Open',
                newStatus: 'Planned',
              },
              {
                post: { id: post.id, title: post.title, boardId: board.id, boardSlug: board.slug },
                previousStatus: 'Planned',
                newStatus: 'In Progress',
              },
            ])
            const activity = await supportDb()`SELECT id FROM post_activity
              WHERE post_id = ${toUuid(post.id as `post_${string}`)} AND type = 'status.changed'`
            expect(activity).toHaveLength(2)
          },
          [board.id]
        )
      } finally {
        await admin.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-42 post.status_changed over REST and MCP once per real change',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['post.status_changed'],
          async () => {
            const post = await newPost(api, board.id, `REST status ${marker}`)
            const planned = await statusId(api, 'planned')
            for (let i = 0; i < 2; i++) {
              await json(
                await api.patch(`/api/v1/posts/${post.id}`, { data: { statusId: planned } }),
                200
              )
            }
            const mcp = await mcpCall(api, 'triage_post', {
              postId: post.id,
              statusId: await statusId(api, 'complete'),
            })
            expect(mcp.isError, mcp.text).toBe(false)
            const ds = await delivered(marker, 'post.status_changed', post.id, { count: 2 })
            expect(ds.map((d) => `${data(d).previousStatus}>${data(d).newStatus}`).sort()).toEqual([
              'Open>Planned',
              'Planned>Complete',
            ])
            await new Promise((r) => setTimeout(r, 2_000))
            expect(
              (await sink.deliveries(marker)).filter(is('post.status_changed', post.id))
            ).toHaveLength(2)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-45 post.updated lists the changed fields; a status change alone sends none',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const tag = await postTag(api, `hooks-${marker}`)
      try {
        await withHook(
          api,
          marker,
          ['post.updated', 'post.owner_assigned'],
          async () => {
            const post = await newPost(api, board.id, `Updated ${marker}`)
            const patch = (body: Json) =>
              api.patch(`/api/v1/posts/${post.id}`, { data: body }).then((r) => json(r, 200))
            const seen = async (n: number) =>
              (
                await delivered(marker, 'post.updated', post.id, { count: n, timeoutMs: 20_000 })
              ).map((d) => data(d))

            await patch({ title: `Renamed ${marker}` })
            await seen(1)
            await patch({ tagIds: [tag] })
            await seen(2)
            await patch({ statusId: await statusId(api, 'planned') })
            await patch({ ownerPrincipalId: people.people.admin.principalId })
            await seen(3)
            await patch({ ownerPrincipalId: null })
            const all = await seen(4)
            expect(all.map((p) => p.changedFields)).toEqual([
              ['title'],
              ['tags'],
              ['owner'],
              ['owner'],
            ])
            expect(all[0].post).toEqual({
              id: post.id,
              title: `Renamed ${marker}`,
              boardId: board.id,
              boardSlug: board.slug,
            })
            // Only the assignment sends post.owner_assigned; the unassignment does not.
            await new Promise((r) => setTimeout(r, 1_500))
            expect(
              (await sink.deliveries(marker)).filter(is('post.owner_assigned', post.id))
            ).toHaveLength(1)
            expect(
              (await sink.deliveries(marker)).filter(is('post.updated', post.id))
            ).toHaveLength(4)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-47 post.owner_assigned carries the new and previous owner, self-assignment included',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const x = people.people.agentB.principalId
      const y = people.people.contributor.principalId
      try {
        await withHook(
          api,
          marker,
          ['post.owner_assigned'],
          async () => {
            const post = await newPost(api, board.id, `Owner ${marker}`)
            for (const owner of [x, y]) {
              await json(
                await api.patch(`/api/v1/posts/${post.id}`, { data: { ownerPrincipalId: owner } }),
                200
              )
              await delivered(marker, 'post.owner_assigned', owner)
            }
            const ds = await delivered(marker, 'post.owner_assigned', post.id, { count: 2 })
            const byOwner = Object.fromEntries(ds.map((d) => [data(d).ownerPrincipalId, data(d)]))
            expect(byOwner[x]).toMatchObject({
              postId: post.id,
              postTitle: post.title,
              boardSlug: board.slug,
              boardId: board.id,
              postUrl: expect.stringContaining(post.id),
              previousOwnerPrincipalId: null,
            })
            expect(byOwner[y].previousOwnerPrincipalId).toBe(x)

            // Assigning yourself (the teammate signed in) still sends the webhook.
            const admin = await personApi(playwright, 'admin')
            const self = await callServerFn(admin, 'setPostOwnerFn', {
              id: post.id,
              ownerId: people.people.admin.principalId,
            })
            await admin.dispose()
            expect(self.ok, self.error).toBe(true)
            await delivered(marker, 'post.owner_assigned', people.people.admin.principalId)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-48 post.deleted is sent for REST and MCP deletes with the post reference',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['post.deleted'],
          async () => {
            const viaRest = await newPost(api, board.id, `Delete REST ${marker}`)
            const viaMcp = await newPost(api, board.id, `Delete MCP ${marker}`)
            expect((await api.delete(`/api/v1/posts/${viaRest.id}`)).status()).toBe(204)
            const mcp = await mcpCall(api, 'delete_post', { postId: viaMcp.id })
            expect(mcp.isError, mcp.text).toBe(false)
            for (const post of [viaRest, viaMcp]) {
              const [d] = await delivered(marker, 'post.deleted', post.id)
              expect(data(d).post).toEqual({
                id: post.id,
                title: post.title,
                boardId: board.id,
                boardSlug: board.slug,
              })
              const activity = await supportDb()`SELECT id FROM post_activity
                WHERE post_id = ${toUuid(post.id as `post_${string}`)} AND type = 'post.deleted'`
              expect(activity).toHaveLength(1)
            }
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-48 post.deleted says who deleted the post',
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const admin = await personApi(playwright, 'admin')
      try {
        await withHook(
          api,
          marker,
          ['post.deleted'],
          async () => {
            const post = await newPost(api, board.id, `Deleted by ${marker}`)
            const res = await callServerFn(admin, 'deletePostFn', { id: post.id })
            expect(res.ok, res.error).toBe(true)
            const [d] = await delivered(marker, 'post.deleted', post.id)
            expect([people.people.admin.email, people.people.admin.displayName]).toContain(
              data(d).deletedBy
            )
          },
          [board.id]
        )
      } finally {
        await admin.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-49 post.restored on a restore; refused restores send nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['post.restored', 'post.created'],
          async () => {
            const live = await newPost(api, board.id, `Live ${marker}`)
            const old = await newPost(api, board.id, `Old ${marker}`)
            const back = await newPost(api, board.id, `Back ${marker}`)
            expect((await api.delete(`/api/v1/posts/${old.id}`)).status()).toBe(204)
            expect((await api.delete(`/api/v1/posts/${back.id}`)).status()).toBe(204)
            await supportDb()`UPDATE posts SET deleted_at = NOW() - interval '31 days'
              WHERE id = ${toUuid(old.id as `post_${string}`)}`

            const notDeleted = await mcpCall(api, 'restore_post', { postId: live.id })
            expect(notDeleted.isError).toBe(true)
            expect(notDeleted.text).toContain('Post is not deleted')
            const expired = await mcpCall(api, 'restore_post', { postId: old.id })
            expect(expired.isError).toBe(true)
            expect(expired.text).toContain('Posts can only be restored within 30 days of deletion')

            const ok = await mcpCall(api, 'restore_post', { postId: back.id })
            expect(ok.isError, ok.text).toBe(false)
            const [d] = await delivered(marker, 'post.restored', back.id)
            expect(data(d).post).toEqual({
              id: back.id,
              title: back.title,
              boardId: board.id,
              boardSlug: board.slug,
            })
            await expectNone(
              marker,
              (x) =>
                x.headers['x-quackback-event'] === 'post.restored' &&
                (x.body.includes(live.id) || x.body.includes(old.id)),
              'refused restores'
            )
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-50 post.merged and post.unmerged reach a webhook filtered to the duplicate board',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const [a, b] = [await newBoard(api, marker, 'a'), await newBoard(api, marker, 'b')]
      try {
        await withHook(
          api,
          marker,
          ['post.merged', 'post.unmerged'],
          async () => {
            const canonical = await newPost(api, a.id, `Canonical ${marker}`)
            const duplicate = await newPost(api, b.id, `Duplicate ${marker}`)
            await json(
              await api.post(`/api/v1/posts/${duplicate.id}/merge`, {
                data: { canonicalPostId: canonical.id },
              }),
              200
            )
            const [merged] = await delivered(marker, 'post.merged', duplicate.id)
            const ref = (p: typeof canonical, board: typeof a) => ({
              id: p.id,
              title: p.title,
              boardId: board.id,
              boardSlug: board.slug,
            })
            expect(data(merged)).toEqual({
              duplicatePost: ref(duplicate, b),
              canonicalPost: ref(canonical, a),
            })

            const unmerge = await mcpCall(api, 'unmerge_post', { postId: duplicate.id })
            expect(unmerge.isError, unmerge.text).toBe(false)
            const [unmerged] = await delivered(marker, 'post.unmerged', duplicate.id)
            expect(data(unmerged)).toEqual({
              post: ref(duplicate, b),
              formerCanonicalPost: ref(canonical, a),
            })
          },
          [b.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-52 post.voted on a self vote with the count after it; unvoting is silent',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const portal = await personApi(playwright, 'customer')
      try {
        await withHook(
          api,
          marker,
          ['post.voted'],
          async () => {
            // Authored by someone else, so neither voter starts with the author vote.
            const post = await newPost(api, board.id, `Votes ${marker}`, {
              authorPrincipalId: people.people.agentB.principalId,
            })
            const vote = await callServerFn<{ voted: boolean; voteCount: number }>(
              portal,
              'toggleVoteFn',
              { postId: post.id }
            )
            expect(vote.ok, vote.error).toBe(true)
            expect(vote.data.voted).toBe(true)
            const [d] = await delivered(marker, 'post.voted', post.id)
            expect(data(d)).toEqual({
              post: { id: post.id, title: post.title, boardId: board.id, boardSlug: board.slug },
              voterEmail: people.people.customer.email,
              voterName: people.people.customer.displayName,
              voteCount: vote.data.voteCount,
            })

            const unvote = await callServerFn<{ voted: boolean }>(portal, 'toggleVoteFn', {
              postId: post.id,
            })
            expect(unvote.data.voted).toBe(false)

            // A REST self vote by the key, after the unvote: the control.
            const rest = await json<{ data: { voted: boolean; voteCount: number } }>(
              await api.post(`/api/v1/posts/${post.id}/vote`),
              200
            )
            expect(rest.data.voted).toBe(true)
            const both = await delivered(marker, 'post.voted', post.id, { count: 2 })
            expect(data(both[1]).voteCount).toBe(rest.data.voteCount)
            await new Promise((r) => setTimeout(r, 1_500))
            expect((await sink.deliveries(marker)).filter(is('post.voted', post.id))).toHaveLength(
              2
            )
          },
          [board.id]
        )
      } finally {
        await portal.dispose()
        await api.dispose()
      }
    }
  )
})

test.describe('comment events', () => {
  test(
    'API-W-55 comment.created from the portal, REST and MCP',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const portal = await personApi(playwright, 'customer')
      try {
        await withHook(
          api,
          marker,
          ['comment.created'],
          async () => {
            const post = await newPost(api, board.id, `Comments ${marker}`)
            const postRef = {
              id: post.id,
              title: post.title,
              boardId: board.id,
              boardSlug: board.slug,
            }
            const fromPortal = await callServerFn<{ comment?: { id: string }; id?: string }>(
              portal,
              'createCommentFn',
              { postId: post.id, content: `Portal comment ${marker}` }
            )
            expect(fromPortal.ok, fromPortal.error).toBe(true)
            const portalId = String(fromPortal.data.comment?.id ?? fromPortal.data.id)
            const [p] = await delivered(marker, 'comment.created', portalId)
            expect(data(p)).toEqual({
              comment: {
                id: portalId,
                content: `Portal comment ${marker}`,
                authorName: people.people.customer.displayName,
                authorEmail: people.people.customer.email,
                isPrivate: false,
              },
              post: postRef,
            })

            const rest = await newComment(api, post.id, `REST comment ${marker}`)
            const [r] = await delivered(marker, 'comment.created', rest.id)
            expect(data(r).comment).toMatchObject({ content: `REST comment ${marker}` })
            expect(data(r).post).toEqual(postRef)

            const mcp = await mcpCall(api, 'add_comment', {
              postId: post.id,
              content: `MCP comment ${marker}`,
            })
            expect(mcp.isError, mcp.text).toBe(false)
            const [m] = await delivered(marker, 'comment.created', String(mcp.json.id))
            expect(data(m).comment).toMatchObject({
              content: `MCP comment ${marker}`,
              isPrivate: false,
            })
          },
          [board.id]
        )
      } finally {
        await portal.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-56 a held comment sends comment.created only when approved',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const portal = await personApi(playwright, 'customer')
      try {
        await withHook(
          api,
          marker,
          ['comment.created'],
          async () => {
            const post = await newPost(api, board.id, `Held comments ${marker}`)
            await holdBoard(board.id)
            const held = await callServerFn<{ comment?: { id: string }; id?: string }>(
              portal,
              'createCommentFn',
              { postId: post.id, content: `Held comment ${marker}` }
            )
            expect(held.ok, held.error).toBe(true)
            const heldId = String(held.data.comment?.id ?? held.data.id)
            const control = await newComment(api, post.id, `Team comment ${marker}`)
            await delivered(marker, 'comment.created', control.id)
            await expectNone(marker, is('comment.created', heldId), 'held comment before approval')

            await json(await api.post(`/api/v1/moderation/comments/${heldId}/approve`), 200)
            const [d] = await delivered(marker, 'comment.created', heldId)
            expect(data(d).comment).toMatchObject({
              authorEmail: people.people.customer.email,
              authorName: people.people.customer.displayName,
            })
          },
          [board.id]
        )
      } finally {
        await portal.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-57 a private comment is never delivered, though its events are recorded',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['comment.created', 'comment.updated', 'comment.deleted'],
          async () => {
            const post = await newPost(api, board.id, `Private ${marker}`)
            const note = await newComment(api, post.id, `Team note ${marker}`, { isPrivate: true })
            await json(
              await api.patch(`/api/v1/comments/${note.id}`, {
                data: { content: `Team note edited ${marker}` },
              }),
              200
            )
            const del = await mcpCall(api, 'delete_comment', { commentId: note.id })
            expect(del.isError, del.text).toBe(false)

            const control = await newComment(api, post.id, `Public ${marker}`)
            await delivered(marker, 'comment.created', control.id)
            for (const type of ['comment.created', 'comment.updated', 'comment.deleted']) {
              const rows = await eventRows(type, note.id)
              expect(rows, type).toHaveLength(1)
              expect((rows[0].payload as { comment: Json }).comment.isPrivate, type).toBe(true)
            }
            await expectNone(marker, (d) => d.body.includes(note.id), 'private comment')
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-60 deleting a comment over MCP sends comment.deleted',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['comment.deleted'],
          async () => {
            const post = await newPost(api, board.id, `Delete comment ${marker}`)
            const comment = await newComment(api, post.id, `Doomed ${marker}`)
            const del = await mcpCall(api, 'delete_comment', { commentId: comment.id })
            expect(del.isError, del.text).toBe(false)
            const [d] = await delivered(marker, 'comment.deleted', comment.id)
            expect(data(d)).toEqual({
              comment: { id: comment.id, isPrivate: false },
              post: { id: post.id, title: post.title, boardId: board.id, boardSlug: board.slug },
            })
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )
})

test.describe('more feedback events', () => {
  test(
    'API-W-43 a comment that changes the status sends comment.created and post.status_changed',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const admin = await personApi(playwright, 'admin')
      try {
        await withHook(
          api,
          marker,
          ['comment.created', 'post.status_changed'],
          async () => {
            const post = await newPost(api, board.id, `Comment status ${marker}`)
            const res = await callServerFn<{ comment: { id: string } }>(admin, 'createCommentFn', {
              postId: post.id,
              content: `Shipping it ${marker}`,
              statusId: await statusId(api, 'complete'),
            })
            expect(res.ok, res.error).toBe(true)
            await delivered(marker, 'comment.created', res.data.comment.id)
            const [s] = await delivered(marker, 'post.status_changed', post.id)
            expect(data(s)).toMatchObject({ previousStatus: 'Open', newStatus: 'Complete' })
          },
          [board.id]
        )
      } finally {
        await admin.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-51 accepting a merge suggestion sends post.merged; dismiss and restore send nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const sql = supportDb()
      const suggest = async (source: string, target: string) => {
        const id = generateId('post_merge_sug')
        await sql`INSERT INTO post_merge_suggestions
          (id, source_post_id, target_post_id, status, vector_score, fts_score, hybrid_score, llm_confidence)
          VALUES (${toUuid(id)}, ${toUuid(source as `post_${string}`)}, ${toUuid(target as `post_${string}`)},
                  'pending', 0.9, 0.9, 0.9, 0.9)`
        return id
      }
      try {
        await withHook(
          api,
          marker,
          ['post.merged'],
          async () => {
            const dup = await newPost(api, board.id, `Dup ${marker}`)
            const keep = await newPost(api, board.id, `Keep ${marker}`)
            const other = await newPost(api, board.id, `Other ${marker}`)
            const otherKeep = await newPost(api, board.id, `Other keep ${marker}`)
            const quiet = await suggest(other.id, otherKeep.id)
            await json(await api.post(`/api/v1/suggestions/${quiet}/dismiss`), 200)
            await json(await api.post(`/api/v1/suggestions/${quiet}/restore`), 200)

            const accepted = await suggest(dup.id, keep.id)
            await json(await api.post(`/api/v1/suggestions/${accepted}/accept`), 200)
            const [d] = await delivered(marker, 'post.merged', dup.id)
            expect(data(d)).toMatchObject({
              duplicatePost: { id: dup.id },
              canonicalPost: { id: keep.id },
            })
            await expectNone(marker, (x) => x.body.includes(other.id), 'dismissed and restored')
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-58 comment.updated over REST and MCP carries the new content and no author',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['comment.updated'],
          async () => {
            const post = await newPost(api, board.id, `Edits ${marker}`)
            const viaRest = await newComment(api, post.id, `Before REST ${marker}`)
            const viaMcp = await newComment(api, post.id, `Before MCP ${marker}`)
            await json(
              await api.patch(`/api/v1/comments/${viaRest.id}`, {
                data: { content: `After REST ${marker}` },
              }),
              200
            )
            const mcp = await mcpCall(api, 'update_comment', {
              commentId: viaMcp.id,
              content: `After MCP ${marker}`,
            })
            expect(mcp.isError, mcp.text).toBe(false)
            const postRef = {
              id: post.id,
              title: post.title,
              boardId: board.id,
              boardSlug: board.slug,
            }
            for (const [id, content] of [
              [viaRest.id, `After REST ${marker}`],
              [viaMcp.id, `After MCP ${marker}`],
            ]) {
              const [d] = await delivered(marker, 'comment.updated', id)
              expect(data(d)).toEqual({
                comment: { id, content, isPrivate: false },
                post: postRef,
              })
            }
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )
})

test(
  'API-W-54 post.mentioned once per newly mentioned person, self-mentions included',
  { tag: '@nightly' },
  async ({ playwright, baseURL, people, marker }) => {
    const api = await adminApi(playwright, baseURL, people, marker)
    const board = await newBoard(api, marker)
    const admin = await personApi(playwright, 'admin')
    const t = people.people.agentB
    const u = people.people.contributor
    const me = people.people.admin
    const doc = (...who: Array<{ principalId: string; displayName: string }>) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `Looping in ${marker} ` },
            ...who.map((p) => ({
              type: 'mention',
              attrs: { id: p.principalId, label: p.displayName },
            })),
          ],
        },
      ],
    })
    try {
      await withHook(
        api,
        marker,
        ['post.mentioned'],
        async () => {
          const created = await callServerFn<{ id: string }>(admin, 'createPostFn', {
            boardId: board.id,
            title: `Mentions ${marker}`,
            content: `Looping in ${marker}`,
            contentJson: doc(t),
          })
          expect(created.ok, created.error).toBe(true)
          const postId = created.data.id
          const [first] = await delivered(marker, 'post.mentioned', t.principalId)
          expect(data(first)).toMatchObject({
            postId,
            postTitle: `Mentions ${marker}`,
            postUrl: expect.stringContaining(postId),
            boardId: board.id,
            mentionedPrincipalId: t.principalId,
            mentioningPrincipalId: me.principalId,
            excerpt: expect.stringContaining(marker),
          })

          const edit = async (contentJson: Json) => {
            const res = await callServerFn(admin, 'updatePostFn', {
              id: postId,
              content: `Looping in ${marker}`,
              contentJson,
            })
            expect(res.ok, res.error).toBe(true)
          }
          await edit(doc(t))
          await edit(doc(t, u))
          await delivered(marker, 'post.mentioned', u.principalId)
          await edit(doc(t, u, me))
          const self = await delivered(
            marker,
            'post.mentioned',
            `"mentionedPrincipalId":"${me.principalId}"`
          )
          expect(data(self[0]).mentioningPrincipalId).toBe(me.principalId)

          await new Promise((r) => setTimeout(r, 1_500))
          const all = (await sink.deliveries(marker)).filter(is('post.mentioned', postId))
          expect(all.map((d) => data(d).mentionedPrincipalId).sort()).toEqual(
            [t.principalId, u.principalId, me.principalId].sort()
          )
        },
        [board.id]
      )
    } finally {
      await admin.dispose()
      await api.dispose()
    }
  }
)
