/**
 * REST v1 posts: list, read, create, edit, delete, merge, and the scope and
 * permission matrices on the feedback routes.
 *
 * Journeys: API-R-001..API-R-014, API-R-016, API-R-018, API-R-020..API-R-029,
 * API-R-031..API-R-034, API-R-103, API-R-104. Not pinned (owner questions):
 * API-R-015 (author override follows role admin, not post.set_author),
 * API-R-019 (plan-cap 402 body), and the default-status half of API-R-010.
 * API-R-017 (a required custom field blocks every REST post) is listed for the
 * owner, and API-R-030 (post move) waits for #791.
 *
 * Every test makes its own board (so lists are filtered to rows it owns), its
 * own keys and its own customers. Webhooks are deleted in `finally` (the
 * 25-webhook cap is workspace-wide).
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { expectJson, newTeammate, seedCustomer } from '../../support/api-client'
import { deliveriesOf, bodyOf, subscribe, unsubscribe, type Hook } from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import { waitForMail } from '../../support/mailpit'
import { pollFor, supportDb } from '../../support/db'
import {
  activityOf,
  bellsFor,
  expectError,
  keyApi,
  newBoard,
  newPost,
  newTag,
  postRow,
  postTagIds,
  statusIdBySlug,
  subscriptionsOf,
  uuid,
  votesOf,
  waitForActivity,
} from '../../product/api-rest'

// Key and teammate scripts start the app's modules (about a second each).
test.describe.configure({ timeout: 60_000 })

const LIST_ITEM_KEYS = [
  'authorName',
  'boardId',
  'boardName',
  'boardSlug',
  'canonicalPostId',
  'commentCount',
  'content',
  'createdAt',
  'deletedAt',
  'id',
  'isCommentsLocked',
  'mergedAt',
  'ownerId',
  'statusId',
  'summaryJson',
  'tags',
  'title',
  'updatedAt',
  'voteCount',
]

test.describe('REST posts: list and read', () => {
  test(
    'API-R-001 list posts answers the documented shape, newest first, with cursor paging',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const first = await newPost(admin.api, board.id, `${marker} first`)
      const second = await newPost(admin.api, board.id, `${marker} second`)
      const third = await newPost(admin.api, board.id, `${marker} third`)

      const page1 = await expectJson(
        await admin.api.get(`/api/v1/posts?boardId=${board.id}&limit=2`),
        200
      )
      expect(page1.data.map((p: { id: string }) => p.id)).toEqual([third.id, second.id])
      expect(page1.meta.pagination).toEqual({ cursor: expect.any(String), hasMore: true })
      expect(Object.keys(page1.data[0]).sort()).toEqual(LIST_ITEM_KEYS)
      expect(page1.data[0]).toMatchObject({
        title: `${marker} third`,
        content: 'Body',
        voteCount: 1,
        commentCount: 0,
        boardId: board.id,
        boardSlug: board.slug,
        boardName: board.name,
        tags: [],
        canonicalPostId: null,
        mergedAt: null,
        isCommentsLocked: false,
        deletedAt: null,
      })

      const page2 = await expectJson(
        await admin.api.get(
          `/api/v1/posts?boardId=${board.id}&limit=2&cursor=${page1.meta.pagination.cursor}`
        ),
        200
      )
      expect(page2.data.map((p: { id: string }) => p.id)).toEqual([first.id])
      expect(page2.meta.pagination.hasMore).toBe(false)

      // A limit below 1 or not a whole number is refused (400), not clamped.
      for (const bad of ['-5', '0', 'abc']) {
        const res = await admin.api.get(`/api/v1/posts?boardId=${board.id}&limit=${bad}`)
        expect(res.status(), `limit=${bad}`).toBe(400)
      }
      await admin.api.dispose()
    }
  )

  test(
    'API-R-004 post reads need read:feedback and post.view_private',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} post`)
      const comment = (
        await expectJson(
          await admin.api.post(`/api/v1/posts/${post.id}/comments`, {
            data: { content: `${marker} comment` },
          }),
          201
        )
      ).data
      const paths = [
        '/api/v1/posts',
        `/api/v1/posts/${post.id}`,
        `/api/v1/posts/${post.id}/comments`,
        `/api/v1/posts/${post.id}/activity`,
        `/api/v1/posts/${post.id}/voters`,
        `/api/v1/comments/${comment.id}`,
      ]

      for (const scopes of [['read:chat'], ['write:changelog']]) {
        const k = await keyApi(playwright, baseURL, {
          creatorEmail: people.people.admin.email,
          kind: 'workspace',
          scopes,
        })
        for (const path of paths) {
          await expectError(
            await k.api.get(path),
            403,
            'FORBIDDEN',
            "This API key is missing the 'read:feedback' scope required by 'post.view_private'"
          )
        }
        await k.api.dispose()
      }

      // A creator without post.view_private: the permission is checked first.
      const mate = newTeammate(`Reader ${marker}`, ['member.view'])
      const narrow = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        scopes: ['read:feedback'],
      })
      for (const path of paths) {
        await expectError(
          await narrow.api.get(path),
          403,
          'FORBIDDEN',
          "Requires the 'post.view_private' permission"
        )
      }

      // Positive control: write:feedback implies read.
      const writer = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        scopes: ['write:feedback'],
      })
      for (const path of paths) {
        const res = await writer.api.get(path)
        expect(res.status(), `${path}: ${await res.text()}`).toBe(200)
      }
      for (const k of [admin, narrow, writer]) await k.api.dispose()
    }
  )
})

test.describe('REST posts: create', () => {
  test(
    'API-R-009 creating a post answers 201, auto-votes, subscribes the author and announces it',
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        name: `Key ${marker}`,
      })
      const board = await newBoard(admin.api, marker)
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.created'])
        const res = await admin.api.post('/api/v1/posts', {
          data: { boardId: board.id, title: `${marker} created`, content: 'Some **markdown**' },
        })
        const { data } = await expectJson(res, 201)
        expect(Object.keys(data).sort()).toEqual([
          'authorName',
          'boardId',
          'content',
          'createdAt',
          'id',
          'statusId',
          'title',
          'updatedAt',
          'voteCount',
        ])
        expect(data).toMatchObject({
          title: `${marker} created`,
          content: 'Some **markdown**',
          voteCount: 1,
          boardId: board.id,
          // The key itself is the author.
          authorName: `Key ${marker}`,
        })
        expect(data.id).toMatch(/^post_/)

        // The author (the key's principal) auto-votes and is subscribed.
        const votes = await votesOf(data.id)
        expect(votes.map((v) => v.principalId)).toEqual([admin.principalId])
        expect(await subscriptionsOf(data.id)).toEqual({ [admin.principalId]: 'author' })

        const [created] = await waitForActivity(data.id, 'post.created')
        expect(created.metadata).toMatchObject({ boardName: board.name })

        const [delivery] = await deliveriesOf(marker, 'post.created', data.id)
        const event = bodyOf<{ post: Record<string, unknown> }>(delivery)
        expect(event.type).toBe('post.created')
        expect(event.data.post).toMatchObject({
          id: data.id,
          title: `${marker} created`,
          boardSlug: board.slug,
          authorName: `Key ${marker}`,
          voteCount: 1,
        })
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-010 a post created without statusId lands in the open status',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // The contested half (open slug versus a different workspace default) is
      // an owner question and needs a workspace flip; this pins only the part
      // both rules agree on in a workspace whose default is "open".
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} no status`)
      expect(post.statusId).toBe(await statusIdBySlug('open'))
      const planned = await statusIdBySlug('planned')
      const explicit = await newPost(admin.api, board.id, `${marker} planned`, {
        statusId: planned,
      })
      expect(explicit.statusId).toBe(planned)
      await admin.api.dispose()
    }
  )

  test(
    'API-R-011 create post validation and not-found refusals',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const post = (data: Record<string, unknown>) => api.post('/api/v1/posts', { data })

      const empty = await expectError(await post({}), 400, 'BAD_REQUEST', 'Invalid request body')
      expect(Object.keys(empty.error.details.errors).sort()).toEqual(['boardId', 'title'])
      const blank = await expectError(
        await post({ boardId: board.id, title: '' }),
        400,
        'BAD_REQUEST'
      )
      expect(blank.error.details.errors.title).toBeTruthy()

      await expectError(
        await post({ boardId: board.id, title: 'x'.repeat(201) }),
        400,
        'BAD_REQUEST'
      )
      const exactly200 = await expectJson(
        await post({ boardId: board.id, title: `${marker}`.padEnd(200, 'x') }),
        201
      )
      expect(exactly200.data.title).toHaveLength(200)
      await expectError(
        await post({ boardId: board.id, title: `${marker} long`, content: 'y'.repeat(10_001) }),
        400,
        'BAD_REQUEST'
      )

      await expectError(
        await post({ boardId: 'nope', title: marker }),
        400,
        'VALIDATION_ERROR',
        'Invalid board ID format'
      )
      await expectError(
        await post({ boardId: board.id, title: marker, statusId: 'nope' }),
        400,
        'VALIDATION_ERROR',
        'Invalid status ID format'
      )
      await expectError(
        await post({ boardId: board.id, title: marker, tagIds: ['nope'] }),
        400,
        'VALIDATION_ERROR',
        'Invalid tag IDs format'
      )
      await expectError(
        await post({ boardId: generateId('board'), title: marker }),
        404,
        'NOT_FOUND',
        'Board not found'
      )
      await expectError(
        await post({ boardId: board.id, title: marker, statusId: generateId('post_status') }),
        404,
        'NOT_FOUND',
        'Status not found'
      )
      await expectError(
        await post({ boardId: board.id, title: '   ' }),
        400,
        'VALIDATION_ERROR',
        'Title is required'
      )

      // A soft-deleted board is not found either.
      const gone = await newBoard(api, `${marker}-gone`)
      expect((await api.delete(`/api/v1/boards/${gone.id}`)).status()).toBe(204)
      await expectError(
        await post({ boardId: gone.id, title: marker }),
        404,
        'NOT_FOUND',
        'Board not found'
      )
      await api.dispose()
    }
  )

  test(
    'API-R-014 an admin key posts on behalf of a customer, backdated',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // An admin's personal key holds the admin role (a workspace key on the
      // Admin preset is role member; only Owner maps to admin).
      const admin = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const board = await newBoard(admin.api, marker)
      const email = `${marker}@customers.example`
      const customer = await seedCustomer(email, `Customer ${marker}`)
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.created'])
        const post = await newPost(admin.api, board.id, `${marker} on behalf`, {
          authorPrincipalId: customer.principalId,
          createdAt: '2024-01-02T00:00:00Z',
        })
        expect(post.authorName).toBe(`Customer ${marker}`)
        expect(post.createdAt).toBe('2024-01-02T00:00:00.000Z')
        expect((await postRow(post.id)).principal_id).toBe(uuid(customer.principalId))
        expect((await votesOf(post.id)).map((v) => v.principalId)).toEqual([customer.principalId])
        expect(await subscriptionsOf(post.id)).toEqual({ [customer.principalId]: 'author' })

        const [delivery] = await deliveriesOf(marker, 'post.created', post.id)
        expect(bodyOf<{ post: Record<string, unknown> }>(delivery).data.post).toMatchObject({
          authorName: `Customer ${marker}`,
          authorEmail: email,
        })

        await expectError(
          await admin.api.post('/api/v1/posts', {
            data: {
              boardId: board.id,
              title: marker,
              authorPrincipalId: generateId('principal'),
            },
          }),
          404,
          'NOT_FOUND',
          'User not found'
        )
        await expectError(
          await admin.api.post('/api/v1/posts', {
            data: { boardId: board.id, title: marker, authorPrincipalId: admin.principalId },
          }),
          400,
          'VALIDATION_ERROR',
          'authorPrincipalId may not reference a service principal'
        )
        await expectError(
          await admin.api.post('/api/v1/posts', {
            data: { boardId: board.id, title: marker, authorPrincipalId: 'bad' },
          }),
          400,
          'VALIDATION_ERROR',
          'Invalid authorPrincipalId format'
        )
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-016 a read-only board refuses new posts until it is reopened',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      await expectJson(
        await admin.api.patch(`/api/v1/boards/${board.id}`, { data: { readOnly: true } }),
        200
      )
      await expectError(
        await admin.api.post('/api/v1/posts', {
          data: { boardId: board.id, title: `${marker} refused` },
        }),
        403,
        'FORBIDDEN',
        "This board isn't taking new feedback right now."
      )
      const [{ n }] = await supportDb()`
        SELECT count(*)::int AS n FROM posts WHERE board_id = ${uuid(board.id)}`
      expect(n).toBe(0)

      await expectJson(
        await admin.api.patch(`/api/v1/boards/${board.id}`, { data: { readOnly: false } }),
        200
      )
      await newPost(admin.api, board.id, `${marker} accepted`)
      await admin.api.dispose()
    }
  )

  test(
    'API-R-018 import mode skips subscriptions, activity and webhooks for an admin key only',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // An admin's personal key holds the admin role; the manager key is role member.
      const admin = await keyApi(
        playwright,
        baseURL,
        { creatorEmail: people.people.admin.email },
        { 'x-import-mode': 'true' }
      )
      const member = await keyApi(
        playwright,
        baseURL,
        { creatorEmail: people.people.admin.email, kind: 'workspace', roleKey: 'manager' },
        { 'x-import-mode': 'true' }
      )
      const board = await newBoard(admin.api, marker)
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.created'])
        const imported = await newPost(admin.api, board.id, `${marker} imported`)
        const live = await newPost(member.api, board.id, `${marker} member`)

        // The member key's import header is ignored: everything fires. Its
        // delivery is the control that the imported post's would have arrived.
        await deliveriesOf(marker, 'post.created', live.id)
        await waitForActivity(live.id, 'post.created')
        expect(await subscriptionsOf(live.id)).toEqual({ [member.principalId]: 'author' })

        expect((await votesOf(imported.id)).map((v) => v.principalId)).toEqual([admin.principalId])
        expect(await subscriptionsOf(imported.id)).toEqual({})
        expect(await activityOf(imported.id, 'post.created')).toEqual([])
        const all = await sink.deliveries(marker)
        expect(all.filter((d) => d.body.includes(imported.id))).toEqual([])
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
        await member.api.dispose()
      }
    }
  )
})

test.describe('REST posts: update, delete, merge', () => {
  test(
    "API-R-022 changing a post's status notifies its subscribers once",
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const email = `${marker}@customers.example`
      const customer = await seedCustomer(email, `Customer ${marker}`)
      const inProgress = await statusIdBySlug('in_progress')
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.status_changed'])
        const post = await newPost(admin.api, board.id, `${marker} status`)
        // The customer votes through the key, which subscribes them.
        await expectJson(
          await admin.api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
            data: { voterPrincipalId: customer.principalId },
          }),
          200
        )

        const patched = await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, { data: { statusId: inProgress } }),
          200
        )
        expect(patched.data.statusId).toBe(inProgress)

        const [delivery] = await deliveriesOf(marker, 'post.status_changed', post.id)
        expect(bodyOf(delivery).data).toMatchObject({
          previousStatus: 'Open',
          newStatus: 'In Progress',
        })
        const [changed] = await waitForActivity(post.id, 'status.changed')
        expect(changed.metadata).toMatchObject({
          fromName: 'Open',
          toName: 'In Progress',
          toSlug: 'in_progress',
        })
        const mail = await waitForMail({ to: email, subject: 'In Progress' })
        expect(mail.Subject).toBe('A post you follow is now In Progress')
        await pollFor('status bell', async () =>
          (await bellsFor(customer.principalId, post.id)).includes('post_status_changed')
            ? true
            : null
        )
        // The key's own principal is never notified.
        expect(await bellsFor(admin.principalId, post.id)).toEqual([])

        // The same status again is a no-op; a later change is the control.
        await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, { data: { statusId: inProgress } }),
          200
        )
        await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, {
            data: { statusId: await statusIdBySlug('complete') },
          }),
          200
        )
        await pollFor('second status change', async () =>
          (await activityOf(post.id, 'status.changed')).length >= 2 ? true : null
        )
        const changes = await activityOf(post.id, 'status.changed')
        expect(changes.map((c) => c.metadata.toSlug)).toEqual(['in_progress', 'complete'])
        const deliveries = await deliveriesOf(marker, 'post.status_changed', post.id, {
          count: 2,
        })
        expect(deliveries).toHaveLength(2)
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-025 PATCH checks the permission and scope of every field it carries',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} original`)
      const patch = (k: { api: typeof admin.api }, data: Record<string, unknown>) =>
        k.api.patch(`/api/v1/posts/${post.id}`, { data })

      // (a) Contributor: no post.edit, but status, tags and owner are allowed.
      const contributor = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.contributor.email,
        scopes: ['write:feedback'],
      })
      await expectError(
        await patch(contributor, { title: `${marker} contributor` }),
        403,
        'FORBIDDEN',
        "Requires the 'post.edit' permission"
      )
      await expectJson(
        await patch(contributor, {
          statusId: await statusIdBySlug('planned'),
          tagIds: [],
          ownerPrincipalId: people.people.admin.principalId,
        }),
        200
      )

      // (b) post.edit without post.set_status: refused before anything is written.
      const mate = newTeammate(`Editor ${marker}`, ['post.view_private', 'post.edit'])
      const editor = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        scopes: ['write:feedback'],
      })
      await expectError(
        await patch(editor, {
          title: `${marker} changed`,
          statusId: await statusIdBySlug('complete'),
        }),
        403,
        'FORBIDDEN',
        "Requires the 'post.set_status' permission"
      )
      expect((await postRow(post.id)).title).toBe(`${marker} original`)
      await expectJson(await patch(editor, { title: `${marker} edited` }), 200)

      // (c) read-only scope on a write field.
      const reader = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        scopes: ['read:feedback'],
      })
      await expectError(
        await patch(reader, { tagIds: [] }),
        403,
        'FORBIDDEN',
        "This API key is missing the 'write:feedback' scope required by 'post.set_tags'"
      )
      for (const k of [admin, contributor, editor, reader]) await k.api.dispose()
    }
  )

  test(
    'API-R-026 a PATCH with no recognised field is refused to a key that cannot read posts',
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} secret`)
      const chat = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        scopes: ['read:chat'],
      })
      // Control: the same key is refused the read.
      await expectError(await chat.api.get(`/api/v1/posts/${post.id}`), 403, 'FORBIDDEN')

      for (const data of [{}, { boardId: generateId('board') }]) {
        const res = await chat.api.patch(`/api/v1/posts/${post.id}`, { data })
        const text = await res.text()
        expect(res.status(), text).toBeGreaterThanOrEqual(400)
        expect(text).not.toContain(`${marker} secret`)
      }
      await admin.api.dispose()
      await chat.api.dispose()
    }
  )

  test(
    "API-R-027 PATCH tags with an unknown tag id is refused and keeps the post's tags",
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const a = await newTag(admin.api, `${marker}-a`)
      const b = await newTag(admin.api, `${marker}-b`)
      const post = await newPost(admin.api, board.id, `${marker} tagged`, { tagIds: [a.id, b.id] })
      const before = [a.id, b.id].sort()
      expect(await postTagIds(post.id)).toEqual(before)

      for (const tagIds of [
        [a.id, generateId('post_tag')],
        [a.id, a.id],
      ]) {
        const res = await admin.api.patch(`/api/v1/posts/${post.id}`, { data: { tagIds } })
        const text = await res.text()
        expect([400, 404], text).toContain(res.status())
        expect(await postTagIds(post.id)).toEqual(before)
      }
      await admin.api.dispose()
    }
  )

  test(
    'API-R-031 deleting a post soft-deletes it, announces it and recounts the canonical post',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const canonical = await newPost(admin.api, board.id, `${marker} canonical`)
      const dup = await newPost(admin.api, board.id, `${marker} duplicate`)
      const customer = await seedCustomer(`${marker}@customers.example`)
      await expectJson(
        await admin.api.post(`/api/v1/posts/${dup.id}/vote/proxy`, {
          data: { voterPrincipalId: customer.principalId },
        }),
        200
      )
      const merged = await expectJson(
        await admin.api.post(`/api/v1/posts/${dup.id}/merge`, {
          data: { canonicalPostId: canonical.id },
        }),
        200
      )
      // The key's own vote is shared; the customer's adds one.
      expect(merged.data.canonicalPost.voteCount).toBe(2)

      const contributor = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.contributor.email,
        scopes: ['write:feedback'],
      })
      await expectError(
        await contributor.api.delete(`/api/v1/posts/${dup.id}`),
        403,
        'FORBIDDEN',
        "Requires the 'post.delete' permission"
      )

      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.deleted'])
        const res = await admin.api.delete(`/api/v1/posts/${dup.id}`)
        expect(res.status()).toBe(204)
        expect(await res.text()).toBe('')

        const row = await postRow(dup.id)
        expect(row.deleted_at).not.toBeNull()
        expect(row.deleted_by_principal_id).toBe(uuid(admin.principalId))
        await waitForActivity(dup.id, 'post.deleted')
        const [delivery] = await deliveriesOf(marker, 'post.deleted', dup.id)
        expect(bodyOf<{ post: Record<string, unknown> }>(delivery).data.post).toMatchObject({
          id: dup.id,
          boardSlug: board.slug,
        })

        const canon = await expectJson(await admin.api.get(`/api/v1/posts/${canonical.id}`), 200)
        expect(canon.data.voteCount).toBe(1)

        const got = await expectJson(await admin.api.get(`/api/v1/posts/${dup.id}`), 200)
        expect(got.data.deletedAt).toEqual(expect.any(String))

        // A deleted (unmerged) post leaves the list; showDeleted lists it.
        const plain = await newPost(admin.api, board.id, `${marker} plain`)
        expect((await admin.api.delete(`/api/v1/posts/${plain.id}`)).status()).toBe(204)
        const list = await expectJson(await admin.api.get(`/api/v1/posts?boardId=${board.id}`), 200)
        expect(list.data.map((p: { id: string }) => p.id)).toEqual([canonical.id])
        const withDeleted = await expectJson(
          await admin.api.get(`/api/v1/posts?boardId=${board.id}&showDeleted=true`),
          200
        )
        const deleted = withDeleted.data.find((p: { id: string }) => p.id === plain.id)
        expect(deleted?.deletedAt).toEqual(expect.any(String))
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
        await contributor.api.dispose()
      }
    }
  )

  test(
    'API-R-033 merging a duplicate counts a shared voter once and lists the duplicate',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const canonical = await newPost(admin.api, board.id, `${marker} canonical`)
      const dup = await newPost(admin.api, board.id, `${marker} duplicate`)
      const onlyDup = await seedCustomer(`${marker}-d@customers.example`)
      const onlyCanon = await seedCustomer(`${marker}-c@customers.example`)
      const proxy = (postId: string, voterPrincipalId: string) =>
        admin.api.post(`/api/v1/posts/${postId}/vote/proxy`, { data: { voterPrincipalId } })
      await expectJson(await proxy(dup.id, onlyDup.principalId), 200)
      await expectJson(await proxy(canonical.id, onlyCanon.principalId), 200)

      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.merged'])
        const merged = await expectJson(
          await admin.api.post(`/api/v1/posts/${dup.id}/merge`, {
            data: { canonicalPostId: canonical.id },
          }),
          200
        )
        // The key voted on both (as author): counted once. Plus one customer each.
        expect(merged.data).toEqual({
          canonicalPost: { id: canonical.id, voteCount: 3 },
          duplicatePost: { id: dup.id },
        })

        const row = await postRow(dup.id)
        expect(row.canonical_post_id).toBe(uuid(canonical.id))
        expect(row.merged_at).not.toBeNull()
        expect(row.merged_by_principal_id).toBe(uuid(admin.principalId))

        const [mergedIn] = await waitForActivity(canonical.id, 'post.merged_in')
        expect(JSON.stringify(mergedIn.metadata)).toContain(`${marker} duplicate`)
        await waitForActivity(dup.id, 'post.merged_away')

        const [delivery] = await deliveriesOf(marker, 'post.merged', dup.id)
        expect(delivery.body).toContain(canonical.id)

        const canon = await expectJson(await admin.api.get(`/api/v1/posts/${canonical.id}`), 200)
        expect(canon.data.mergedPosts).toEqual([
          expect.objectContaining({ id: dup.id, title: `${marker} duplicate` }),
        ])
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )
})

test.describe('REST posts: key matrices', () => {
  // One test per scope set, so no test waits on many key scripts. GET
  // /boards (a bare read any key passes) is left out: whether it should need
  // read:feedback is an owner question.
  const ALLOWED = { listPosts: 200, createPost: 201, vote: 200, pending: 200, createTag: 201 }
  const REFUSED = { listPosts: 403, createPost: 403, vote: 403, pending: 403, createTag: 403 }
  const SCOPE_MATRIX: Array<[string, string[] | null, Record<string, number>, string]> = [
    [
      'read:feedback',
      ['read:feedback'],
      { ...REFUSED, listPosts: 200 },
      "This API key is missing the 'write:feedback' scope required by 'post.create'",
    ],
    ['write:feedback', ['write:feedback'], ALLOWED, ''],
    [
      'write:changelog',
      ['write:changelog'],
      REFUSED,
      "This API key is missing the 'write:feedback' scope required by 'post.create'",
    ],
    [
      'read:chat',
      ['read:chat'],
      REFUSED,
      "This API key is missing the 'write:feedback' scope required by 'post.create'",
    ],
    ['legacy NULL scopes', null, ALLOWED, ''],
  ]
  for (const [label, scopes, expected, createRefusal] of SCOPE_MATRIX) {
    test(
      `API-R-103 a ${label} key on the feedback routes`,
      { tag: '@core' },
      async ({ playwright, baseURL, people, marker }) => {
        const admin = await keyApi(playwright, baseURL, {
          creatorEmail: people.people.admin.email,
          kind: 'workspace',
        })
        const board = await newBoard(admin.api, marker)
        const target = await newPost(admin.api, board.id, `${marker} target`)
        const k = await keyApi(playwright, baseURL, {
          creatorEmail: people.people.admin.email,
          kind: 'workspace',
          ...(scopes ? { scopes } : { legacy: true }),
        })
        const create = await k.api.post('/api/v1/posts', {
          data: { boardId: board.id, title: `${marker} by key` },
        })
        const createBody = await create.text()
        const out = {
          listPosts: (await k.api.get(`/api/v1/posts?boardId=${board.id}`)).status(),
          createPost: create.status(),
          vote: (await k.api.post(`/api/v1/posts/${target.id}/vote`)).status(),
          pending: (await k.api.get('/api/v1/moderation/pending')).status(),
          createTag: (
            await k.api.post('/api/v1/tags', { data: { name: `${marker}-tag`.slice(0, 50) } })
          ).status(),
        }
        expect(out).toEqual(expected)
        // The refusal names the scope and the permission.
        if (createRefusal) expect(JSON.parse(createBody).error.message).toBe(createRefusal)
        await k.api.dispose()
        await admin.api.dispose()
      }
    )
  }

  test(
    "API-R-104 a Contributor's key reaches the writes its role grants and no others",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const customer = await seedCustomer(`${marker}@customers.example`)
      const c = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.contributor.email,
        scopes: ['write:feedback'],
      })
      const { api } = c

      // Allowed.
      const post = (
        await expectJson(
          await api.post('/api/v1/posts', { data: { boardId: board.id, title: `${marker} c` } }),
          201
        )
      ).data
      const other = await newPost(admin.api, board.id, `${marker} other`)
      await expectJson(
        await api.patch(`/api/v1/posts/${post.id}`, {
          data: {
            statusId: await statusIdBySlug('planned'),
            tagIds: [],
            ownerPrincipalId: people.people.contributor.principalId,
          },
        }),
        200
      )
      await expectJson(await api.post(`/api/v1/posts/${other.id}/vote`), 200)
      await expectJson(
        await api.post(`/api/v1/posts/${other.id}/vote/proxy`, {
          data: { voterPrincipalId: customer.principalId },
        }),
        200
      )
      const comment = (
        await expectJson(
          await api.post(`/api/v1/posts/${post.id}/comments`, { data: { content: marker } }),
          201
        )
      ).data
      await expectJson(
        await api.post(`/api/v1/posts/${other.id}/merge`, { data: { canonicalPostId: post.id } }),
        200
      )

      // Refused, each naming its permission.
      const refusals: Array<[string, Promise<Awaited<ReturnType<typeof api.get>>>]> = [
        ['post.edit', api.patch(`/api/v1/posts/${post.id}`, { data: { title: 'x' } })],
        ['post.delete', api.delete(`/api/v1/posts/${post.id}`)],
        ['comment.edit', api.patch(`/api/v1/comments/${comment.id}`, { data: { content: 'x' } })],
        ['comment.edit', api.delete(`/api/v1/comments/${comment.id}`)],
        ['board.manage', api.post('/api/v1/boards', { data: { name: `${marker} b` } })],
        ['board.manage', api.patch(`/api/v1/boards/${board.id}`, { data: { name: 'x' } })],
        [
          'status.manage',
          api.post('/api/v1/statuses', {
            data: {
              name: 'x',
              slug: `${marker}`.slice(0, 40).replace(/-/g, '_'),
              color: '#000000',
              category: 'active',
            },
          }),
        ],
        ['tag.manage', api.post('/api/v1/tags', { data: { name: `${marker}-t`.slice(0, 50) } })],
        ['roadmap.manage', api.post('/api/v1/roadmaps', { data: { name: `${marker} r` } })],
      ]
      for (const [perm, pending] of refusals) {
        await expectError(await pending, 403, 'FORBIDDEN', `Requires the '${perm}' permission`)
      }
      await admin.api.dispose()
      await api.dispose()
    }
  )
})

test.describe('REST posts: nightly', () => {
  test(
    'API-R-002 list filters: board, status slug, tags, search, dates, sort, deleted',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const tagA = await newTag(api, `${marker}-a`)
      const tagB = await newTag(api, `${marker}-b`)
      const planned = await statusIdBySlug('planned')
      const old = await newPost(api, board.id, `${marker} old zebra`, { tagIds: [tagA.id] })
      const mid = await newPost(api, board.id, `${marker} mid`, {
        statusId: planned,
        tagIds: [tagB.id],
      })
      const top = await newPost(api, board.id, `${marker} top`)
      const gone = await newPost(api, board.id, `${marker} gone`)
      expect((await api.delete(`/api/v1/posts/${gone.id}`)).status()).toBe(204)
      // Spread the dates: old is two days back, mid yesterday.
      await supportDb()`UPDATE posts SET created_at = NOW() - interval '2 days' WHERE id = ${uuid(old.id)}`
      await supportDb()`UPDATE posts SET created_at = NOW() - interval '1 day' WHERE id = ${uuid(mid.id)}`
      // top gets a second vote so sort=votes puts it first.
      const c = await seedCustomer(`${marker}@customers.example`)
      await expectJson(
        await api.post(`/api/v1/posts/${top.id}/vote/proxy`, {
          data: { voterPrincipalId: c.principalId },
        }),
        200
      )
      const ids = async (q: string) =>
        (await expectJson(await api.get(`/api/v1/posts?boardId=${board.id}&${q}`), 200)).data.map(
          (p: { id: string }) => p.id
        )
      const day = (offset: number) =>
        new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

      expect(await ids('')).toEqual([top.id, mid.id, old.id])
      expect(await ids('status=planned')).toEqual([mid.id])
      expect(await ids(`tagIds=${tagA.id},${tagB.id}`)).toEqual([mid.id, old.id])
      expect(await ids('search=zebra')).toEqual([old.id])
      expect(await ids(`dateTo=${day(2)}`)).toEqual([old.id])
      expect(await ids(`dateFrom=${day(1)}T00:00:00Z`)).toEqual([top.id, mid.id])
      expect(await ids('sort=oldest')).toEqual([old.id, mid.id, top.id])
      expect((await ids('sort=votes'))[0]).toBe(top.id)
      expect(await ids('showDeleted=true')).toEqual([gone.id])
      await api.dispose()
    }
  )

  test(
    'API-R-003 malformed list filters are dropped, not refused',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const tag = await newTag(api, `${marker}-t`)
      // A word no other post has, for the workspace-wide search below.
      const word = `zq${Date.now().toString(36)}w${test.info().workerIndex}`
      const tagged = await newPost(api, board.id, `${marker} tagged ${word}`, { tagIds: [tag.id] })
      const plain = await newPost(api, board.id, `${marker} plain ${word}`)
      const ids = async (q: string) =>
        (await expectJson(await api.get(`/api/v1/posts?${q}`), 200)).data.map(
          (p: { id: string }) => p.id
        )
      // An invalid board id is dropped: the newest posts of the whole workspace.
      expect(await ids(`boardId=invalid&limit=100&search=${word}`)).toEqual(
        expect.arrayContaining([tagged.id, plain.id])
      )
      expect(await ids(`boardId=${board.id}&tagIds=junk,${tag.id}`)).toEqual([tagged.id])
      // An unknown sort is not refused; which order it takes is unspecified.
      expect((await ids(`boardId=${board.id}&sort=banana`)).sort()).toEqual(
        [plain.id, tagged.id].sort()
      )
      expect(await ids(`boardId=${board.id}&dateFrom=notadate`)).toEqual([plain.id, tagged.id])
      await api.dispose()
    }
  )

  test(
    'API-R-005 one post reads in full, including a deleted one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const tag = await newTag(api, `${marker}-t`)
      const canonical = await newPost(api, board.id, `${marker} canonical`, {
        tagIds: [tag.id],
      })
      const dup = await newPost(api, board.id, `${marker} dup`)
      await expectJson(
        await api.patch(`/api/v1/posts/${canonical.id}`, {
          data: { ownerPrincipalId: people.people.admin.principalId },
        }),
        200
      )
      await expectJson(
        await api.post(`/api/v1/posts/${dup.id}/merge`, {
          data: { canonicalPostId: canonical.id },
        }),
        200
      )
      const { data } = await expectJson(await api.get(`/api/v1/posts/${canonical.id}`), 200)
      expect(data).toMatchObject({
        id: canonical.id,
        title: `${marker} canonical`,
        content: 'Body',
        contentJson: expect.objectContaining({ type: 'doc' }),
        boardId: board.id,
        boardSlug: board.slug,
        ownerPrincipalId: people.people.admin.principalId,
        tags: [{ id: tag.id, name: `${marker}-t`, color: expect.any(String) }],
        pinnedComment: null,
        canonicalPostId: null,
        deletedAt: null,
        eta: null,
        mergedPosts: [
          expect.objectContaining({
            id: dup.id,
            title: `${marker} dup`,
            mergedAt: expect.any(String),
          }),
        ],
      })

      expect((await api.delete(`/api/v1/posts/${canonical.id}`)).status()).toBe(204)
      const deleted = await expectJson(await api.get(`/api/v1/posts/${canonical.id}`), 200)
      expect(deleted.data.deletedAt).toEqual(expect.any(String))
      await api.dispose()
    }
  )

  test(
    'API-R-006 malformed, wrong-prefix and unknown post ids',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      for (const id of ['post_invalid123', generateId('board')]) {
        await expectError(
          await api.get(`/api/v1/posts/${id}`),
          400,
          'VALIDATION_ERROR',
          'Invalid post ID format'
        )
      }
      await expectError(
        await api.get(`/api/v1/posts/${generateId('post')}`),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      await api.dispose()
    }
  )

  test(
    'API-R-007 the activity log lists REST changes newest first, by the key',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        name: `Key ${marker}`,
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const tag = await newTag(api, `${marker}-t`)
      const post = await newPost(api, board.id, `${marker} logged`)
      await waitForActivity(post.id, 'post.created')
      await expectJson(
        await api.patch(`/api/v1/posts/${post.id}`, {
          data: { statusId: await statusIdBySlug('planned') },
        }),
        200
      )
      await waitForActivity(post.id, 'status.changed')
      await expectJson(
        await api.patch(`/api/v1/posts/${post.id}`, { data: { tagIds: [tag.id] } }),
        200
      )
      await waitForActivity(post.id, 'tags.added')
      await expectJson(
        await api.patch(`/api/v1/posts/${post.id}`, {
          data: { ownerPrincipalId: people.people.admin.principalId },
        }),
        200
      )
      await waitForActivity(post.id, 'owner.assigned')

      const { data } = await expectJson(await api.get(`/api/v1/posts/${post.id}/activity`), 200)
      expect(data.map((a: { type: string }) => a.type)).toEqual([
        'owner.assigned',
        'tags.added',
        'status.changed',
        'post.created',
      ])
      expect(data[2]).toMatchObject({
        postId: post.id,
        principalId: admin.principalId,
        actorName: `Key ${marker}`,
        metadata: expect.objectContaining({ toName: 'Planned', toSlug: 'planned' }),
      })
      expect(data[1].metadata.tagNames).toEqual([`${marker}-t`])

      const unknown = await expectJson(
        await api.get(`/api/v1/posts/${generateId('post')}/activity`),
        200
      )
      expect(unknown.data).toEqual([])
      await api.dispose()
    }
  )

  test(
    'API-R-008 the voters list pages with a cursor and ignores a malformed one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        name: `Key ${marker}`,
      })
      const { api } = admin
      const board = await newBoard(api, marker)
      const post = await newPost(api, board.id, `${marker} voters`)
      const a = await seedCustomer(`${marker}-a@customers.example`, `Voter A ${marker}`)
      const b = await seedCustomer(`${marker}-b@customers.example`, `Voter B ${marker}`)
      for (const v of [a, b]) {
        await expectJson(
          await api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
            data: { voterPrincipalId: v.principalId },
          }),
          200
        )
      }
      const url = `/api/v1/posts/${post.id}/voters`
      const page1 = await expectJson(await api.get(`${url}?limit=2`), 200)
      expect(page1.data).toHaveLength(2)
      expect(page1.meta.pagination.hasMore).toBe(true)
      const page2 = await expectJson(
        await api.get(`${url}?limit=2&cursor=${page1.meta.pagination.cursor}`),
        200
      )
      expect(page2.data).toHaveLength(1)
      expect(page2.meta.pagination.hasMore).toBe(false)
      const all = [...page1.data, ...page2.data]
      expect(new Set(all.map((v: { principalId: string }) => v.principalId))).toEqual(
        new Set([admin.principalId, a.principalId, b.principalId])
      )
      expect(
        all.find((v: { principalId: string }) => v.principalId === a.principalId)
      ).toMatchObject({
        displayName: `Voter A ${marker}`,
        email: `${marker}-a@customers.example`,
        isAnonymous: false,
        sourceType: 'proxy',
        addedByName: `Key ${marker}`,
      })
      const garbage = await expectJson(await api.get(`${url}?limit=2&cursor=garbage`), 200)
      expect(garbage.data.map((v: { principalId: string }) => v.principalId)).toEqual(
        page1.data.map((v: { principalId: string }) => v.principalId)
      )
      await api.dispose()
    }
  )

  test(
    'API-R-012 an unknown or repeated tag id on create is refused without leaving a post',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const tag = await newTag(api, `${marker}-t`)
      for (const tagIds of [[generateId('post_tag')], [tag.id, tag.id]]) {
        const res = await api.post('/api/v1/posts', {
          data: { boardId: board.id, title: `${marker} tags`, tagIds },
        })
        const text = await res.text()
        expect([400, 404], text).toContain(res.status())
      }
      const [{ n }] = await supportDb()`
        SELECT count(*)::int AS n FROM posts WHERE board_id = ${uuid(board.id)}`
      expect(n).toBe(0)
      await api.dispose()
    }
  )

  test(
    'API-R-013 a soft-deleted status is not found on create or update',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const status = (
        await expectJson(
          await api.post('/api/v1/statuses', {
            data: {
              name: `S ${marker}`.slice(0, 50),
              slug: `s_${Date.now().toString(36)}_${test.info().workerIndex}`,
              color: '#123456',
              category: 'active',
            },
          }),
          201
        )
      ).data
      expect((await api.delete(`/api/v1/statuses/${status.id}`)).status()).toBe(204)
      await expectError(
        await api.post('/api/v1/posts', {
          data: { boardId: board.id, title: `${marker} deleted status`, statusId: status.id },
        }),
        404,
        'NOT_FOUND',
        'Status not found'
      )
      const post = await newPost(api, board.id, `${marker} live`)
      await expectError(
        await api.patch(`/api/v1/posts/${post.id}`, { data: { statusId: status.id } }),
        404,
        'NOT_FOUND',
        'Status not found'
      )
      await api.dispose()
    }
  )

  test(
    'API-R-020 a malformed JSON body is a bad request, not a server error',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const post = await newPost(api, board.id, `${marker} json`)
      const raw = { headers: { 'content-type': 'application/json' }, data: '{"title":' }
      for (const [method, path] of [
        ['post', '/api/v1/posts'],
        ['patch', `/api/v1/posts/${post.id}`],
        ['post', `/api/v1/posts/${post.id}/comments`],
        ['post', `/api/v1/posts/${post.id}/merge`],
        ['post', '/api/v1/boards'],
        ['post', '/api/v1/tags'],
      ] as const) {
        await expectError(await api[method](path, raw), 400, 'BAD_REQUEST')
      }
      await api.dispose()
    }
  )

  test(
    'API-R-021 editing title and content answers the post and announces the changed fields',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} before`)
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.updated'])
        const { data } = await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, {
            data: { title: `${marker} after`, content: 'New body' },
          }),
          200
        )
        expect(Object.keys(data).sort()).toEqual([
          'boardId',
          'content',
          'contentJson',
          'createdAt',
          'id',
          'ownerPrincipalId',
          'statusId',
          'title',
          'updatedAt',
          'voteCount',
        ])
        expect(data).toMatchObject({ title: `${marker} after`, content: 'New body' })
        const [delivery] = await deliveriesOf(marker, 'post.updated', post.id)
        expect(
          (bodyOf<{ changedFields: string[] }>(delivery).data.changedFields ?? []).sort()
        ).toEqual(['content', 'title'])
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )

  test(
    "API-R-023 replacing a post's tags logs what was added and removed",
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const [a, b, c] = [
        await newTag(api, `${marker}-a`),
        await newTag(api, `${marker}-b`),
        await newTag(api, `${marker}-c`),
      ]
      const post = await newPost(api, board.id, `${marker} tags`, { tagIds: [a.id, b.id] })
      await expectJson(
        await api.patch(`/api/v1/posts/${post.id}`, { data: { tagIds: [b.id, c.id] } }),
        200
      )
      expect(await postTagIds(post.id)).toEqual([b.id, c.id].sort())
      const [added] = await waitForActivity(post.id, 'tags.added')
      expect(added.metadata.tagNames).toEqual([`${marker}-c`])
      const [removed] = await waitForActivity(post.id, 'tags.removed')
      expect(removed.metadata.tagNames).toEqual([`${marker}-a`])
      await expectJson(await api.patch(`/api/v1/posts/${post.id}`, { data: { tagIds: [] } }), 200)
      expect(await postTagIds(post.id)).toEqual([])
      await api.dispose()
    }
  )

  test(
    "API-R-024 assigning and unassigning a post's owner",
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} owner`)
      const owner = people.people.agentB.principalId
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.owner_assigned'])
        await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, { data: { ownerPrincipalId: owner } }),
          200
        )
        const [assigned] = await waitForActivity(post.id, 'owner.assigned')
        expect(assigned.metadata.ownerName).toBe(people.people.agentB.displayName)
        const [delivery] = await deliveriesOf(marker, 'post.owner_assigned', post.id)
        expect(bodyOf(delivery).data).toMatchObject({ ownerPrincipalId: owner })
        await pollFor('owner bell', async () =>
          (await bellsFor(owner, post.id)).includes('post_owner_assigned') ? true : null
        )

        await expectJson(
          await admin.api.patch(`/api/v1/posts/${post.id}`, { data: { ownerPrincipalId: null } }),
          200
        )
        await waitForActivity(post.id, 'owner.unassigned')
        expect((await postRow(post.id)).owner_principal_id).toBeNull()
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-028 a deleted post cannot be edited',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const post = await newPost(api, board.id, `${marker} deleted`)
      expect((await api.delete(`/api/v1/posts/${post.id}`)).status()).toBe(204)
      await expectError(
        await api.patch(`/api/v1/posts/${post.id}`, {
          data: { statusId: await statusIdBySlug('complete') },
        }),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      expect((await postRow(post.id)).status_id).toBe(uuid(await statusIdBySlug('open')))
      await api.dispose()
    }
  )

  test(
    'API-R-029 PATCH validation refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const post = await newPost(api, board.id, `${marker} validation`)
      const patch = (data: Record<string, unknown>, id = post.id) =>
        api.patch(`/api/v1/posts/${id}`, { data })
      await expectError(await patch({ title: '' }), 400, 'BAD_REQUEST')
      await expectError(
        await patch({ title: '   ' }),
        400,
        'VALIDATION_ERROR',
        'Title cannot be empty'
      )
      await expectError(await patch({ content: 'y'.repeat(10_001) }), 400, 'BAD_REQUEST')
      await expectError(
        await patch({ statusId: 'x' }),
        400,
        'VALIDATION_ERROR',
        'Invalid status ID format'
      )
      await expectError(
        await patch({ statusId: generateId('post_status') }),
        404,
        'NOT_FOUND',
        'Status not found'
      )
      await expectError(
        await patch({ tagIds: ['x'] }),
        400,
        'VALIDATION_ERROR',
        'Invalid tag IDs format'
      )
      await expectError(
        await patch({ title: 'x' }, 'nope'),
        400,
        'VALIDATION_ERROR',
        'Invalid post ID format'
      )
      await expectError(
        await patch({ title: 'x' }, generateId('post')),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      expect((await postRow(post.id)).title).toBe(`${marker} validation`)
      await api.dispose()
    }
  )

  test(
    'API-R-032 deleting twice is refused; a missing post is not found',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const post = await newPost(api, board.id, `${marker} twice`)
      expect((await api.delete(`/api/v1/posts/${post.id}`)).status()).toBe(204)
      await expectError(
        await api.delete(`/api/v1/posts/${post.id}`),
        403,
        'FORBIDDEN',
        'Post has already been deleted'
      )
      await expectError(
        await api.delete(`/api/v1/posts/${generateId('post')}`),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      await waitForActivity(post.id, 'post.deleted')
      expect(await activityOf(post.id, 'post.deleted')).toHaveLength(1)
      await api.dispose()
    }
  )

  test(
    'API-R-034 merge refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(api, marker)
      const [a, b, c, d] = [
        await newPost(api, board.id, `${marker} a`),
        await newPost(api, board.id, `${marker} b`),
        await newPost(api, board.id, `${marker} c`),
        await newPost(api, board.id, `${marker} d`),
      ]
      const merge = (dup: string, canonicalPostId: unknown) =>
        api.post(`/api/v1/posts/${dup}/merge`, { data: { canonicalPostId } })

      await expectError(
        await merge(a.id, a.id),
        400,
        'VALIDATION_ERROR',
        'A post cannot be merged into itself'
      )
      await expectJson(await merge(b.id, a.id), 200)
      await expectError(
        await merge(b.id, c.id),
        409,
        'CONFLICT',
        'This post is already merged into another post. Unmerge it first.'
      )
      await expectError(
        await merge(c.id, b.id),
        400,
        'VALIDATION_ERROR',
        'Cannot merge into a post that is itself merged. Choose the canonical post instead.'
      )
      await expectError(
        await merge(a.id, c.id),
        409,
        'CONFLICT',
        'A canonical post with merged children cannot itself be merged.'
      )
      await expectError(await merge(d.id, generateId('post')), 404, 'NOT_FOUND', 'Post not found')
      await expectError(
        await api.post(`/api/v1/posts/${d.id}/merge`, { data: {} }),
        400,
        'BAD_REQUEST'
      )
      await expectError(
        await merge(d.id, 'nope'),
        400,
        'VALIDATION_ERROR',
        'Invalid canonical post ID format'
      )
      const mate = newTeammate(`Merger ${marker}`, ['post.view_private'])
      const narrow = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        scopes: ['write:feedback'],
      })
      await expectError(
        await narrow.api.post(`/api/v1/posts/${d.id}/merge`, { data: { canonicalPostId: c.id } }),
        403,
        'FORBIDDEN',
        "Requires the 'post.merge' permission"
      )
      await narrow.api.dispose()
      await api.dispose()
    }
  )
})
