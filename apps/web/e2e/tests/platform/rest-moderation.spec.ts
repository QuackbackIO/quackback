/**
 * The REST moderation queue (/api/v1/moderation/*). Journeys API-R-056..062.
 *
 * Held posts and comments are seeded straight into the database
 * (moderation_state 'pending') on a board this test owns: workspace moderation
 * is never turned on, since that would hold every other test's posts. So the
 * "a held item does not count or announce" half of API-R-056 is not provable
 * here (the product did not create the row); deferral is proven on approval
 * instead: the count moves and the created event fires only then.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { eventsFor, expectJson, seedCustomer } from '../../support/api-client'
import { waitForMail } from '../../support/mailpit'
import { bodyOf, deliveriesOf } from '../../support/webhooks'
import {
  auditFor,
  commentRow,
  expectError,
  keyApi,
  postRow,
  restBoard,
  restComment,
  restPost,
  seedComment,
  seedHeldPost,
  subscribePost,
  waitForAudit,
  withHook,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 90_000 })

test.describe('REST moderation queue', () => {
  test(
    'API-R-056 held posts and comments are listed with the documented fields, newest first',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const host = await restPost(api, board.id, `${marker} host`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const older = await seedHeldPost(board.id, customer.principalId, `${marker} older`, 2)
      const newer = await seedHeldPost(board.id, customer.principalId, `${marker} newer`, 1)
      const comment = await seedComment(host.id, customer.principalId, `Held ${marker}`, {
        moderationState: 'pending',
      })

      const { data } = await expectJson(await api.get('/api/v1/moderation/pending'), 200)
      const postIds = data.posts.map((p: { id: string }) => p.id)
      expect(postIds).toContain(newer)
      expect(postIds.indexOf(newer)).toBeLessThan(postIds.indexOf(older))
      const mine = data.posts.find((p: { id: string }) => p.id === newer)
      expect(Object.keys(mine).sort()).toEqual(
        ['authorName', 'boardName', 'content', 'createdAt', 'id', 'title'].sort()
      )
      expect(mine).toMatchObject({
        title: `${marker} newer`,
        boardName: `${marker} board`,
        authorName: `Customer ${marker}`,
      })
      const held = data.comments.find((c: { id: string }) => c.id === comment)
      expect(Object.keys(held).sort()).toEqual(
        [
          'authorName',
          'boardName',
          'boardSlug',
          'content',
          'contentJson',
          'createdAt',
          'id',
          'postId',
          'postTitle',
        ].sort()
      )
      expect(held).toMatchObject({
        content: `Held ${marker}`,
        postId: host.id,
        postTitle: `${marker} host`,
        boardName: `${marker} board`,
        boardSlug: board.slug,
        authorName: `Customer ${marker}`,
      })
      // A published post is not in the queue.
      expect(postIds).not.toContain(host.id)
    }
  )

  test(
    'API-R-057 a read:feedback key holding post.approve cannot read the queue',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const readOnly = await keyApi(playwright, baseURL, people, {
        roleKey: 'contributor',
        scopes: ['read:feedback'],
      })
      await expectError(
        await readOnly.api.get('/api/v1/moderation/pending'),
        403,
        'FORBIDDEN',
        "This API key is missing the 'write:feedback' scope required by 'post.approve'"
      )
      const writer = await keyApi(playwright, baseURL, people, {
        roleKey: 'contributor',
        scopes: ['write:feedback'],
      })
      await expectJson(await writer.api.get('/api/v1/moderation/pending'), 200)
    }
  )

  test(
    'API-R-058 approving a held post publishes it, audits the key and only now announces post.created as the author',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const moderator = await keyApi(playwright, baseURL, people)
      const board = await restBoard(moderator.api, `${marker} board`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const held = await seedHeldPost(board.id, customer.principalId, `${marker} held`)

      await withHook(moderator.api, marker, ['post.created'], async () => {
        const res = await moderator.api.post(`/api/v1/moderation/posts/${held}/approve`)
        expect((await expectJson(res, 200)).data).toEqual({ ok: true })
        expect((await postRow(held)).moderation_state).toBe('published')

        const [audit] = await waitForAudit(held, 'post.moderation.approved')
        expect(audit).toMatchObject({ actor_type: 'service', auth_method: 'api_key' })
        expect(audit.metadata).toMatchObject({ apiKeyId: moderator.keyId })
        expect(audit.before_value).toEqual({ moderationState: 'pending' })
        expect(audit.after_value).toEqual({ moderationState: 'published' })

        const deliveries = await deliveriesOf(marker, 'post.created', held)
        expect(deliveries).toHaveLength(1)
        const body = bodyOf<{ post: Record<string, unknown> }>(deliveries[0])
        expect(body.data.post).toMatchObject({
          id: held,
          authorName: `Customer ${marker}`,
          authorEmail: `${marker}@customers.example`,
        })
        // The recorded event's actor is the author, not the key.
        const [event] = await eventsFor(held, ['post.created'])
        expect(event.actor_id).toBe(customer.principalId)
      })
    }
  )

  test(
    'API-R-059 approving or rejecting a post that is not pending is 409 with no audit row',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const held = await seedHeldPost(board.id, customer.principalId, `${marker} held`)
      const live = await restPost(api, board.id, `${marker} live`)

      await expectJson(await api.post(`/api/v1/moderation/posts/${held}/approve`), 200)
      await waitForAudit(held, 'post.moderation.approved')
      await expectError(
        await api.post(`/api/v1/moderation/posts/${held}/approve`),
        409,
        'CONFLICT',
        'Post is not awaiting review'
      )
      for (const action of ['approve', 'reject']) {
        await expectError(
          await api.post(`/api/v1/moderation/posts/${live.id}/${action}`),
          409,
          'CONFLICT',
          'Post is not awaiting review'
        )
      }
      expect(await auditFor(held, 'post.moderation.approved')).toHaveLength(1)
      expect(await auditFor(live.id, 'post.moderation.approved')).toEqual([])
      expect(await auditFor(live.id, 'post.moderation.rejected')).toEqual([])

      await expectError(
        await api.post(`/api/v1/moderation/posts/${generateId('post')}/approve`),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      await expectError(
        await api.post('/api/v1/moderation/posts/post_123/approve'),
        400,
        'VALIDATION_ERROR',
        'Invalid post ID format'
      )
    }
  )

  test(
    'API-R-060 rejecting a held post soft-deletes it and audits the reason and key; a 501-character reason is 400',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const moderator = await keyApi(playwright, baseURL, people)
      const { api } = moderator
      const board = await restBoard(api, `${marker} board`)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const spam = await seedHeldPost(board.id, customer.principalId, `${marker} spam`)
      const plain = await seedHeldPost(board.id, customer.principalId, `${marker} plain`)
      const long = await seedHeldPost(board.id, customer.principalId, `${marker} long`)

      const res = await api.post(`/api/v1/moderation/posts/${spam}/reject`, {
        data: { reason: 'spam' },
      })
      expect((await expectJson(res, 200)).data).toEqual({ ok: true })
      const row = await postRow(spam)
      expect(row.deleted_at).not.toBeNull()
      expect(row.moderation_state).toBe('pending')
      const [audit] = await waitForAudit(spam, 'post.moderation.rejected')
      expect(audit.metadata).toMatchObject({ reason: 'spam', apiKeyId: moderator.keyId })

      await expectJson(await api.post(`/api/v1/moderation/posts/${plain}/reject`), 200)
      const [plainAudit] = await waitForAudit(plain, 'post.moderation.rejected')
      expect(plainAudit.metadata).toMatchObject({ reason: null })

      await expectError(
        await api.post(`/api/v1/moderation/posts/${long}/reject`, {
          data: { reason: 'x'.repeat(501) },
        }),
        400,
        'BAD_REQUEST',
        'Invalid request body'
      )
      expect((await postRow(long)).deleted_at).toBeNull()
    }
  )

  test(
    'API-R-061 approving a held comment publishes it, counts it once, audits it and announces comment.created',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const moderator = await keyApi(playwright, baseURL, people)
      const board = await restBoard(moderator.api, `${marker} board`)
      const post = await restPost(moderator.api, board.id, `${marker} post`)
      const author = await seedCustomer(`${marker}-a@customers.example`, `Author ${marker}`)
      const followerEmail = `${marker}-f@customers.example`
      const follower = await seedCustomer(followerEmail, `Follower ${marker}`)
      await subscribePost(post.id, follower.principalId)
      const comment = await seedComment(post.id, author.principalId, `Held ${marker}`, {
        moderationState: 'pending',
      })
      const before = Number((await postRow(post.id)).comment_count)

      await withHook(moderator.api, marker, ['comment.created'], async () => {
        const res = await moderator.api.post(`/api/v1/moderation/comments/${comment}/approve`)
        expect((await expectJson(res, 200)).data).toEqual({ ok: true })
        expect((await commentRow(comment)).moderation_state).toBe('published')
        expect(Number((await postRow(post.id)).comment_count)).toBe(before + 1)

        const [audit] = await waitForAudit(comment, 'comment.moderation.approved')
        expect(audit).toMatchObject({ actor_type: 'service', auth_method: 'api_key' })
        expect(audit.metadata).toMatchObject({ apiKeyId: moderator.keyId })
        await deliveriesOf(marker, 'comment.created', comment)
        const mail = await waitForMail({ to: followerEmail })
        expect(mail.HTML + mail.Text).toContain(marker)

        await expectError(
          await moderator.api.post(`/api/v1/moderation/comments/${comment}/approve`),
          409,
          'CONFLICT',
          'Comment is not awaiting review'
        )
        expect(Number((await postRow(post.id)).comment_count)).toBe(before + 1)
      })
    }
  )

  test(
    'API-R-062 rejecting a held comment soft-deletes it without touching the count; a published comment is 409',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const moderator = await keyApi(playwright, baseURL, people)
      const { api } = moderator
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const author = await seedCustomer(`${marker}@customers.example`, `Author ${marker}`)
      const held = await seedComment(post.id, author.principalId, `Held ${marker}`, {
        moderationState: 'pending',
      })
      const published = await restComment(api, post.id, `Published ${marker}`)
      const before = Number((await postRow(post.id)).comment_count)

      const res = await api.post(`/api/v1/moderation/comments/${held}/reject`, {
        data: { reason: `off topic ${marker}` },
      })
      expect((await expectJson(res, 200)).data).toEqual({ ok: true })
      expect((await commentRow(held)).deleted_at).not.toBeNull()
      expect(Number((await postRow(post.id)).comment_count)).toBe(before)
      const [audit] = await waitForAudit(held, 'comment.moderation.rejected')
      expect(audit.metadata).toMatchObject({
        reason: `off topic ${marker}`,
        apiKeyId: moderator.keyId,
      })

      await expectError(
        await api.post(`/api/v1/moderation/comments/${published.id}/reject`, {
          data: { reason: 'no' },
        }),
        409,
        'CONFLICT',
        'Comment is not awaiting review'
      )
      expect((await commentRow(published.id)).deleted_at).toBeNull()
    }
  )
})
