/**
 * The REST API for post comments (/api/v1/posts/:id/comments,
 * /api/v1/comments/:id). Journeys API-R-044..055.
 *
 * Every key is made per test and every request context has its own client
 * address. Each test makes its own board and post over REST and finds its rows
 * by marker. Owner questions (not asserted either way): API-R-047 (which
 * comment-create gate is right; only the uncontested half, a Contributor key
 * passing REST, is tested) and API-R-054 (MCP hard delete; only the REST soft
 * delete is tested).
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { expectJson, newTeammate, seedCustomer } from '../../support/api-client'
import { bellsFor, waitForBells, waitForEventHandled } from '../../support/bells'
import { mailTo, waitForMail } from '../../support/mailpit'
import { bodyOf, deliveriesOf } from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import {
  activityOf,
  commentRow,
  expectError,
  keyApi,
  postRow,
  restBoard,
  restComment,
  restPost,
  seedComment,
  subscribePost,
  subscriptionOf,
  uuid,
  withHook,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 90_000 })

const CREATED_KEYS = [
  'authorName',
  'content',
  'createdAt',
  'id',
  'isPrivate',
  'isTeamMember',
  'parentId',
  'postId',
  'principalId',
]

test.describe('REST comments: create', () => {
  test(
    'API-R-045 a key comments: 201, the count rises, comment.created fires and a subscribed customer is emailed and belled',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await keyApi(playwright, baseURL, people)
      const commenter = await keyApi(playwright, baseURL, people)
      const board = await restBoard(owner.api, `${marker} board`)
      const post = await restPost(owner.api, board.id, `${marker} post`)
      const customerEmail = `${marker}@customers.example`
      const customer = await seedCustomer(customerEmail, `Customer ${marker}`)
      await subscribePost(post.id, customer.principalId)
      const before = Number((await postRow(post.id)).comment_count)

      await withHook(owner.api, marker, ['comment.created'], async () => {
        const content = `Thanks, **shipping soon** ${marker}`
        const res = await commenter.api.post(`/api/v1/posts/${post.id}/comments`, {
          data: { content },
        })
        const { data } = await expectJson(res, 201)
        expect(Object.keys(data).sort()).toEqual(CREATED_KEYS)
        expect(data).toMatchObject({
          postId: post.id,
          parentId: null,
          principalId: commenter.principalId,
          isTeamMember: true,
          isPrivate: false,
        })
        expect(data.content).toContain(marker)

        expect(Number((await postRow(post.id)).comment_count)).toBe(before + 1)
        expect((await subscriptionOf(post.id, commenter.principalId))?.reason).toBe('comment')

        const [delivery] = await deliveriesOf(marker, 'comment.created', data.id)
        const hookBody = bodyOf<{ comment: { id: string }; post: { id: string } }>(delivery)
        expect(hookBody.type).toBe('comment.created')
        expect(hookBody.data.comment.id).toBe(data.id)
        expect(hookBody.data.post.id).toBe(post.id)

        const mail = await waitForMail({ to: customerEmail })
        expect(mail.HTML + mail.Text).toContain(marker)
        const bells = await waitForBells(customer.principalId, undefined, (rows) =>
          rows.some((r) => r.type === 'comment_created')
        )
        expect(bells.filter((b) => b.type === 'comment_created')).toHaveLength(1)

        // Once the event is fully handled, the key itself was never notified.
        await waitForEventHandled(data.id, { type: 'comment.created' })
        expect(await bellsFor(commenter.principalId)).toEqual([])
      })
    }
  )

  test(
    'API-R-046 a private comment and a reply to it are both private, uncounted and reach only the teammate',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await keyApi(playwright, baseURL, people)
      const board = await restBoard(owner.api, `${marker} board`)
      const post = await restPost(owner.api, board.id, `${marker} post`)
      const customerEmail = `${marker}@customers.example`
      const customer = await seedCustomer(customerEmail, `Customer ${marker}`)
      const mate = newTeammate(`Mate ${marker}`, ['post.view_private'])
      await subscribePost(post.id, customer.principalId)
      await subscribePost(post.id, mate.principalId)
      const before = Number((await postRow(post.id)).comment_count)

      const note = await restComment(owner.api, post.id, `Private note ${marker}`, {
        isPrivate: true,
      })
      expect(note.isPrivate).toBe(true)
      const reply = await restComment(owner.api, post.id, `Private reply ${marker}`, {
        parentId: note.id,
      })
      expect(reply.isPrivate).toBe(true)
      expect(reply.parentId).toBe(note.id)
      expect((await commentRow(reply.id)).is_private).toBe(true)
      expect(Number((await postRow(post.id)).comment_count)).toBe(before)

      // The teammate gets both, by email and bell.
      await waitForBells(
        mate.principalId,
        undefined,
        (rows) => rows.filter((r) => r.type === 'comment_created').length === 2
      )
      await expect.poll(async () => (await mailTo(mate.email)).length, { timeout: 15_000 }).toBe(2)

      // The customer gets nothing once both events are handled.
      await waitForEventHandled(note.id, { type: 'comment.created' })
      await waitForEventHandled(reply.id, { type: 'comment.created' })
      expect(await bellsFor(customer.principalId)).toEqual([])
      expect(await mailTo(customerEmail)).toEqual([])
    }
  )

  test(
    'API-R-047 a Contributor key (holds comment.moderate) comments over REST; a key without it is refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await keyApi(playwright, baseURL, people)
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })
      const board = await restBoard(owner.api, `${marker} board`)
      const post = await restPost(owner.api, board.id, `${marker} post`)

      const made = await restComment(contributor.api, post.id, `Contributor says ${marker}`)
      expect(made).toMatchObject({ principalId: contributor.principalId, isTeamMember: true })

      // The read-only scope half: a Contributor key with only read:feedback.
      const readOnly = await keyApi(playwright, baseURL, people, {
        roleKey: 'contributor',
        scopes: ['read:feedback'],
      })
      await expectError(
        await readOnly.api.post(`/api/v1/posts/${post.id}/comments`, {
          data: { content: `Refused ${marker}` },
        }),
        403,
        'FORBIDDEN',
        "This API key is missing the 'write:feedback' scope required by 'comment.moderate'"
      )
    }
  )

  test(
    'API-R-048 an admin key comments as a customer, backdated; never privately; a Contributor key override is ignored',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })
      const board = await restBoard(admin.api, `${marker} board`)
      const post = await restPost(admin.api, board.id, `${marker} post`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const createdAt = '2024-03-01T10:00:00.000Z'

      const asCustomer = await restComment(admin.api, post.id, `On behalf ${marker}`, {
        authorPrincipalId: customer.principalId,
        createdAt,
      })
      expect(asCustomer).toMatchObject({
        principalId: customer.principalId,
        isTeamMember: false,
        createdAt,
        authorName: `Customer ${marker}`,
      })

      await expectError(
        await admin.api.post(`/api/v1/posts/${post.id}/comments`, {
          data: {
            content: `Private on behalf ${marker}`,
            authorPrincipalId: customer.principalId,
            isPrivate: true,
          },
        }),
        403,
        'FORBIDDEN',
        'Only team members can post private comments'
      )

      const ignored = await restComment(contributor.api, post.id, `Override ignored ${marker}`, {
        authorPrincipalId: customer.principalId,
        createdAt,
      })
      expect(ignored.principalId).toBe(contributor.principalId)
      expect(ignored.isTeamMember).toBe(true)
      expect(ignored.createdAt).not.toBe(createdAt)

      await expectError(
        await admin.api.post(`/api/v1/posts/${post.id}/comments`, {
          data: { content: `Nobody ${marker}`, authorPrincipalId: generateId('principal') },
        }),
        404,
        'NOT_FOUND',
        'User not found'
      )
      await expectError(
        await admin.api.post(`/api/v1/posts/${post.id}/comments`, {
          data: { content: `Service ${marker}`, authorPrincipalId: contributor.principalId },
        }),
        400,
        'VALIDATION_ERROR',
        'authorPrincipalId may not reference a service principal'
      )
    }
  )

  test(
    'API-R-049 comment validation and not-found refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const other = await restPost(api, board.id, `${marker} other`)
      const otherComment = await restComment(api, other.id, `On the other post ${marker}`)
      const url = `/api/v1/posts/${post.id}/comments`

      for (const data of [{ content: '' }, {}, { content: 'x'.repeat(5001) }]) {
        await expectError(await api.post(url, { data }), 400, 'BAD_REQUEST', 'Invalid request body')
      }
      await expectError(
        await api.post(url, { data: { content: '   ' } }),
        400,
        'VALIDATION_ERROR',
        'Content is required'
      )
      await expectError(
        await api.post(url, { data: { content: `c ${marker}`, parentId: 'x' } }),
        400,
        'VALIDATION_ERROR',
        'Invalid parent ID format'
      )
      const missingParent = generateId('post_comment')
      await expectError(
        await api.post(url, { data: { content: `c ${marker}`, parentId: missingParent } }),
        400,
        'VALIDATION_ERROR',
        `Parent comment with ID ${missingParent} not found`
      )
      await expectError(
        await api.post(url, { data: { content: `c ${marker}`, parentId: otherComment.id } }),
        400,
        'VALIDATION_ERROR',
        'Parent comment belongs to a different post'
      )
      await expectError(
        await api.post(`/api/v1/posts/${generateId('post')}/comments`, {
          data: { content: `c ${marker}` },
        }),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      // Positive control: the same body on the real post is accepted.
      await restComment(api, post.id, `c ${marker}`)
    }
  )

  test(
    'API-R-050 a key comments on a comment-locked post and a merged duplicate, but not on a read-only board',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const locked = await restPost(api, board.id, `${marker} locked`)
      const canonical = await restPost(api, board.id, `${marker} canonical`)
      const duplicate = await restPost(api, board.id, `${marker} duplicate`)
      const sql = supportDb()
      await sql`UPDATE posts SET is_comments_locked = true WHERE id = ${uuid(locked.id)}`
      await sql`UPDATE posts SET canonical_post_id = ${uuid(canonical.id)}, merged_at = NOW()
                WHERE id = ${uuid(duplicate.id)}`

      await restComment(api, locked.id, `Locked but team ${marker}`)
      await restComment(api, duplicate.id, `Merged but team ${marker}`)

      const readOnly = await expectJson(
        await api.patch(`/api/v1/boards/${board.id}`, { data: { readOnly: true } }),
        200
      )
      expect(readOnly.data.readOnly).toBe(true)
      await expectError(
        await api.post(`/api/v1/posts/${locked.id}/comments`, {
          data: { content: `Read-only ${marker}` },
        }),
        403,
        'FORBIDDEN',
        /isn.t taking new feedback right now/
      )
    }
  )

  test(
    'API-R-051 an import-mode comment is stored and counted but sends no event, email or bell and subscribes nobody',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await keyApi(playwright, baseURL, people)
      const importer = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const board = await restBoard(owner.api, `${marker} board`)
      const post = await restPost(owner.api, board.id, `${marker} post`)
      const customerEmail = `${marker}@customers.example`
      const customer = await seedCustomer(customerEmail, `Customer ${marker}`)
      await subscribePost(post.id, customer.principalId)
      const before = Number((await postRow(post.id)).comment_count)

      await withHook(owner.api, marker, ['comment.created'], async () => {
        const imported = await expectJson(
          await importer.api.post(`/api/v1/posts/${post.id}/comments`, {
            headers: { 'x-import-mode': 'true' },
            data: { content: `Imported ${marker}` },
          }),
          201
        )
        expect(Number((await postRow(post.id)).comment_count)).toBe(before + 1)
        expect(await subscriptionOf(post.id, importer.principalId)).toBeUndefined()

        // A later control comment on the same channel: once it is delivered and
        // handled, the imported one's delivery, email and bell are never coming.
        const control = await restComment(owner.api, post.id, `Control ${marker}`)
        await deliveriesOf(marker, 'comment.created', control.id)
        await waitForEventHandled(control.id, { type: 'comment.created' })
        const deliveries = await sink.deliveries(marker)
        expect(deliveries.some((d) => d.body.includes(imported.data.id))).toBe(false)
        const bells = await bellsFor(customer.principalId)
        expect(bells.map((b) => b.type)).toEqual(['comment_created'])
        expect(JSON.stringify(bells[0].metadata)).not.toContain(`Imported ${marker}`)
        expect(await mailTo(customerEmail)).toHaveLength(1)
      })
    }
  )
})

test.describe('REST comments: read', () => {
  test(
    'API-R-044 the comment list nests replies, includes private notes and marks only team removals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api, principalId: keyPrincipal } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)

      const root = await seedComment(post.id, customer.principalId, `Root ${marker}`, {
        ageMinutes: 5,
      })
      const reply = await seedComment(post.id, keyPrincipal, `Reply ${marker}`, {
        parentId: root,
        isTeamMember: true,
        ageMinutes: 4,
      })
      const note = await seedComment(post.id, keyPrincipal, `Note ${marker}`, {
        isPrivate: true,
        isTeamMember: true,
        ageMinutes: 3,
      })
      const selfDeleted = await seedComment(post.id, customer.principalId, `Self ${marker}`, {
        ageMinutes: 2,
      })
      const removed = await seedComment(post.id, customer.principalId, `Removed ${marker}`, {
        ageMinutes: 1,
      })
      const sql = supportDb()
      await sql`UPDATE post_comments SET deleted_at = NOW(), deleted_by_principal_id = principal_id
                WHERE id = ${uuid(selfDeleted)}`
      await sql`UPDATE post_comments SET deleted_at = NOW(),
                deleted_by_principal_id = ${uuid(keyPrincipal)} WHERE id = ${uuid(removed)}`
      await sql`INSERT INTO post_comment_reactions (id, comment_id, principal_id, emoji, created_at)
                VALUES (${uuid(generateId('reaction'))}, ${uuid(root)},
                        ${uuid(customer.principalId)}, '👍', NOW())`

      const { data } = await expectJson(await api.get(`/api/v1/posts/${post.id}/comments`), 200)
      const byId = new Map<string, Record<string, unknown>>(
        data.map((c: { id: string }) => [c.id, c])
      )
      expect([...byId.keys()].sort()).toEqual([root, note, selfDeleted, removed].sort())
      const rootBody = byId.get(root) as Record<string, unknown> & {
        replies: Array<Record<string, unknown>>
        reactions: Array<Record<string, unknown>>
      }
      expect(Object.keys(rootBody).sort()).toEqual(
        [
          'authorName',
          'content',
          'contentJson',
          'createdAt',
          'deletedAt',
          'id',
          'isPrivate',
          'isRemovedByTeam',
          'isTeamMember',
          'parentId',
          'postId',
          'principalId',
          'reactions',
          'replies',
        ].sort()
      )
      expect(rootBody.replies.map((r) => r.id)).toEqual([reply])
      expect(rootBody.replies[0]).toMatchObject({ parentId: root, isTeamMember: true })
      expect(rootBody.reactions).toEqual([expect.objectContaining({ emoji: '👍', count: 1 })])
      expect(byId.get(note)).toMatchObject({ isPrivate: true })
      expect(byId.get(selfDeleted)).toMatchObject({
        deletedAt: expect.any(String),
        isRemovedByTeam: false,
      })
      expect(byId.get(removed)).toMatchObject({
        deletedAt: expect.any(String),
        isRemovedByTeam: true,
      })
      expect(byId.get(root)).toMatchObject({ deletedAt: null, isRemovedByTeam: false })
    }
  )

  test(
    'API-R-052 get one comment, a deleted one included; malformed 400, unknown 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const customerEmail = `${marker}@customers.example`
      const customer = await seedCustomer(customerEmail, `Customer ${marker}`)
      const live = await restComment(api, post.id, `Live ${marker}`, {
        authorPrincipalId: customer.principalId,
      })
      const note = await restComment(api, post.id, `Note ${marker}`, { isPrivate: true })
      const gone = await restComment(api, post.id, `Gone ${marker}`)
      expect((await api.delete(`/api/v1/comments/${gone.id}`)).status()).toBe(204)

      const { data } = await expectJson(await api.get(`/api/v1/comments/${live.id}`), 200)
      expect(Object.keys(data).sort()).toEqual(
        [
          'authorEmail',
          'authorName',
          'content',
          'contentJson',
          'createdAt',
          'deletedAt',
          'id',
          'isPrivate',
          'isTeamMember',
          'parentId',
          'postId',
          'principalId',
        ].sort()
      )
      expect(data).toMatchObject({
        id: live.id,
        postId: post.id,
        content: `Live ${marker}`,
        authorName: `Customer ${marker}`,
        authorEmail: customerEmail,
        principalId: customer.principalId,
        isTeamMember: false,
        isPrivate: false,
        deletedAt: null,
      })
      const priv = await expectJson(await api.get(`/api/v1/comments/${note.id}`), 200)
      expect(priv.data.isPrivate).toBe(true)
      const deleted = await expectJson(await api.get(`/api/v1/comments/${gone.id}`), 200)
      expect(deleted.data.deletedAt).toEqual(expect.any(String))

      await expectError(
        await api.get('/api/v1/comments/nope'),
        400,
        'VALIDATION_ERROR',
        'Invalid comment ID format'
      )
      await expectError(
        await api.get(`/api/v1/comments/${generateId('post_comment')}`),
        404,
        'NOT_FOUND',
        'Comment not found'
      )
    }
  )
})

test.describe('REST comments: edit and delete', () => {
  test(
    'API-R-053 a comment.edit key edits any comment and fires comment.updated; Contributor keys and deleted comments are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })
      const board = await restBoard(admin.api, `${marker} board`)
      const post = await restPost(admin.api, board.id, `${marker} post`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const theirs = await restComment(admin.api, post.id, `Customer words ${marker}`, {
        authorPrincipalId: customer.principalId,
      })
      const contributorOwn = await restComment(contributor.api, post.id, `Mine ${marker}`)

      await withHook(admin.api, marker, ['comment.updated'], async () => {
        const edited = await expectJson(
          await admin.api.patch(`/api/v1/comments/${theirs.id}`, {
            data: { content: `Edited words ${marker}` },
          }),
          200
        )
        expect(edited.data).toMatchObject({
          id: theirs.id,
          content: `Edited words ${marker}`,
          principalId: customer.principalId,
          authorName: `Customer ${marker}`,
        })
        expect((await commentRow(theirs.id)).content).toBe(`Edited words ${marker}`)
        const [delivery] = await deliveriesOf(marker, 'comment.updated', theirs.id)
        expect(bodyOf(delivery).type).toBe('comment.updated')
      })

      for (const id of [theirs.id, contributorOwn.id]) {
        await expectError(
          await contributor.api.patch(`/api/v1/comments/${id}`, {
            data: { content: `Contributor edit ${marker}` },
          }),
          403,
          'FORBIDDEN',
          "Requires the 'comment.edit' permission"
        )
      }
      expect((await commentRow(contributorOwn.id)).content).toBe(`Mine ${marker}`)

      expect((await admin.api.delete(`/api/v1/comments/${contributorOwn.id}`)).status()).toBe(204)
      await expectError(
        await admin.api.patch(`/api/v1/comments/${contributorOwn.id}`, {
          data: { content: `Too late ${marker}` },
        }),
        403,
        'FORBIDDEN',
        'Cannot edit a deleted comment'
      )
    }
  )

  test(
    'API-R-054 deleting a pinned customer comment soft-deletes it, drops the count, unpins and keeps replies',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const board = await restBoard(admin.api, `${marker} board`)
      const post = await restPost(admin.api, board.id, `${marker} post`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const pinned = await restComment(admin.api, post.id, `Pinned ${marker}`, {
        authorPrincipalId: customer.principalId,
      })
      const reply = await restComment(admin.api, post.id, `Reply ${marker}`, {
        parentId: pinned.id,
        authorPrincipalId: customer.principalId,
      })
      const own = await restComment(admin.api, post.id, `Own ${marker}`)
      await supportDb()`UPDATE posts SET pinned_comment_id = ${uuid(pinned.id)}, pinned_at = NOW()
                        WHERE id = ${uuid(post.id)}`
      const before = Number((await postRow(post.id)).comment_count)

      expect((await admin.api.delete(`/api/v1/comments/${pinned.id}`)).status()).toBe(204)
      const row = await commentRow(pinned.id)
      expect(row.deleted_at).not.toBeNull()
      expect(row.deleted_by_principal_id).toBe(uuid(admin.principalId))
      const after = await postRow(post.id)
      expect(Number(after.comment_count)).toBe(before - 1)
      expect(after.pinned_comment_id).toBeNull()
      expect((await commentRow(reply.id)).deleted_at).toBeNull()
      await expect.poll(async () => (await activityOf(post.id, 'comment.removed')).length).toBe(1)
      const [removed] = await activityOf(post.id, 'comment.removed')
      expect(removed.metadata).toMatchObject({
        commentId: pinned.id,
        commentAuthorPrincipalId: customer.principalId,
      })

      // The key deleting its own comment is a self delete.
      expect((await admin.api.delete(`/api/v1/comments/${own.id}`)).status()).toBe(204)
      await expect.poll(async () => (await activityOf(post.id, 'comment.deleted')).length).toBe(1)
      const [self] = await activityOf(post.id, 'comment.deleted')
      expect(self.metadata).toMatchObject({ commentId: own.id })
      expect(Number((await postRow(post.id)).comment_count)).toBe(before - 2)
    }
  )

  test(
    'API-R-055 a second delete is 403 with no second activity; an unknown comment is 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const comment = await restComment(api, post.id, `Twice ${marker}`)

      expect((await api.delete(`/api/v1/comments/${comment.id}`)).status()).toBe(204)
      await expect.poll(async () => (await activityOf(post.id, 'comment.deleted')).length).toBe(1)
      await expectError(
        await api.delete(`/api/v1/comments/${comment.id}`),
        403,
        'FORBIDDEN',
        'Comment has already been deleted'
      )
      await expectError(
        await api.delete(`/api/v1/comments/${generateId('post_comment')}`),
        404,
        'NOT_FOUND',
        'Comment not found'
      )
      // Activity is fire-and-forget: give a stray second row time to land.
      await new Promise((r) => setTimeout(r, 1000))
      expect(await activityOf(post.id, 'comment.deleted')).toHaveLength(1)
    }
  )
})
