/**
 * REST v1 votes: the key's own vote toggle and proxy votes for someone else.
 *
 * Journeys: API-R-035, API-R-037, API-R-038, API-R-039, API-R-040,
 * API-R-041, API-R-042, API-R-043. API-R-036 (REST needs
 * post.vote_on_behalf, MCP vote_post needs none) is an owner question and is
 * not pinned either way.
 *
 * Every test makes its own board, posts, keys and customers.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { expectJson, seedCustomer } from '../../support/api-client'
import { deliveriesOf, bodyOf, subscribe, unsubscribe, type Hook } from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import { pollFor } from '../../support/db'
import {
  activityOf,
  expectError,
  keyApi,
  newBoard,
  newPost,
  subscriptionsOf,
  votesOf,
  waitForActivity,
} from '../../product/api-rest'

test.describe.configure({ timeout: 60_000 })

test.describe('REST votes: the key votes as itself', () => {
  test(
    "API-R-035 the vote route toggles the key's own vote and announces only the vote",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const voter = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const post = await newPost(admin.api, board.id, `${marker} vote`)
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.voted'])
        const first = await expectJson(await voter.api.post(`/api/v1/posts/${post.id}/vote`), 200)
        expect(first.data).toEqual({ voted: true, voteCount: 2 })
        expect((await votesOf(post.id)).map((v) => v.principalId).sort()).toEqual(
          [admin.principalId, voter.principalId].sort()
        )
        expect((await subscriptionsOf(post.id))[voter.principalId]).toBe('vote')
        const [delivery] = await deliveriesOf(marker, 'post.voted', post.id)
        expect(bodyOf(delivery).type).toBe('post.voted')

        const second = await expectJson(await voter.api.post(`/api/v1/posts/${post.id}/vote`), 200)
        expect(second.data).toEqual({ voted: false, voteCount: 1 })
        expect((await votesOf(post.id)).map((v) => v.principalId)).toEqual([admin.principalId])

        // An unvote never fires post.voted: a third (re-)vote is the control.
        // The webhook is workspace-wide, so count this post's deliveries only.
        await expectJson(await voter.api.post(`/api/v1/posts/${post.id}/vote`), 200)
        await deliveriesOf(marker, 'post.voted', post.id, { count: 2 })
        const all = (await sink.deliveries(marker)).filter(
          (d) => d.headers['x-quackback-event'] === 'post.voted' && d.body.includes(post.id)
        )
        expect(all).toHaveLength(2)
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
        await voter.api.dispose()
      }
    }
  )

  test(
    'API-R-037 a read-only board takes votes back but refuses new ones; deleted posts and boards are not found',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const voter = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} read-only`)
      const vote = () => voter.api.post(`/api/v1/posts/${post.id}/vote`)

      expect((await expectJson(await vote(), 200)).data.voted).toBe(true)
      await expectJson(
        await admin.api.patch(`/api/v1/boards/${board.id}`, { data: { readOnly: true } }),
        200
      )
      expect((await expectJson(await vote(), 200)).data).toEqual({ voted: false, voteCount: 1 })
      await expectError(
        await vote(),
        403,
        'FORBIDDEN',
        "This board isn't taking new feedback right now."
      )

      // A soft-deleted post, and a post whose board was deleted.
      const open = await newBoard(admin.api, `${marker}-b`)
      const deletedPost = await newPost(admin.api, open.id, `${marker} deleted`)
      expect((await admin.api.delete(`/api/v1/posts/${deletedPost.id}`)).status()).toBe(204)
      await expectError(
        await voter.api.post(`/api/v1/posts/${deletedPost.id}/vote`),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      const orphan = await newPost(admin.api, open.id, `${marker} orphan`)
      // Control: the orphan is votable while its board lives.
      await expectJson(await voter.api.post(`/api/v1/posts/${orphan.id}/vote`), 200)
      expect((await admin.api.delete(`/api/v1/boards/${open.id}`)).status()).toBe(204)
      await expectError(
        await voter.api.post(`/api/v1/posts/${orphan.id}/vote`),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      await admin.api.dispose()
      await voter.api.dispose()
    }
  )

  test(
    'API-R-038 a vote through a merged duplicate counts on the canonical post',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const voter = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const canonical = await newPost(admin.api, board.id, `${marker} canonical`)
      const dup = await newPost(admin.api, board.id, `${marker} duplicate`)
      await expectJson(
        await admin.api.post(`/api/v1/posts/${dup.id}/merge`, {
          data: { canonicalPostId: canonical.id },
        }),
        200
      )
      let hook: Hook | undefined
      try {
        hook = await subscribe(admin.api, marker, ['post.voted'])
        const res = await expectJson(await voter.api.post(`/api/v1/posts/${dup.id}/vote`), 200)
        expect(res.data).toEqual({ voted: true, voteCount: 2 })
        expect((await votesOf(canonical.id)).map((v) => v.principalId)).toContain(voter.principalId)
        expect((await votesOf(dup.id)).map((v) => v.principalId)).not.toContain(voter.principalId)
        const [delivery] = await deliveriesOf(marker, 'post.voted', canonical.id)
        expect(bodyOf<{ post: { id: string } }>(delivery).data.post.id).toBe(canonical.id)

        // A proxy vote on the canonical post for a voter who voted through the
        // duplicate is not a second vote.
        const customer = await seedCustomer(`${marker}@customers.example`)
        await expectJson(
          await admin.api.post(`/api/v1/posts/${dup.id}/vote/proxy`, {
            data: { voterPrincipalId: customer.principalId },
          }),
          200
        )
        const again = await expectJson(
          await admin.api.post(`/api/v1/posts/${canonical.id}/vote/proxy`, {
            data: { voterPrincipalId: customer.principalId },
          }),
          200
        )
        expect(again.data.voted).toBe(false)
      } finally {
        await unsubscribe(admin.api, hook)
        await admin.api.dispose()
        await voter.api.dispose()
      }
    }
  )
})

test.describe('REST votes: proxy votes', () => {
  test(
    'API-R-039 a proxy vote records the source and adder and subscribes the voter',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // Whether a proxy vote should send post.voted is an owner question; not pinned.
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} proxy`)
      const customer = await seedCustomer(`${marker}@customers.example`)

      const res = await expectJson(
        await admin.api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
          data: { voterPrincipalId: customer.principalId },
        }),
        200
      )
      expect(res.data).toEqual({ voted: true, voteCount: 2 })
      const vote = (await votesOf(post.id)).find((v) => v.principalId === customer.principalId)
      expect(vote).toMatchObject({ sourceType: 'proxy', addedBy: admin.principalId })
      expect((await subscriptionsOf(post.id))[customer.principalId]).toBe('vote')
      const [activity] = await waitForActivity(post.id, 'vote.proxy')
      expect(activity.metadata).toEqual({ voterPrincipalId: customer.principalId })

      const voters = await expectJson(await admin.api.get(`/api/v1/posts/${post.id}/voters`), 200)
      expect(
        voters.data.find((v: { principalId: string }) => v.principalId === customer.principalId)
      ).toMatchObject({ sourceType: 'proxy' })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-040 a repeated proxy vote changes nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} twice`)
      const a = await seedCustomer(`${marker}-a@customers.example`)
      const b = await seedCustomer(`${marker}-b@customers.example`)
      const proxy = (voterPrincipalId: string) =>
        admin.api.post(`/api/v1/posts/${post.id}/vote/proxy`, { data: { voterPrincipalId } })

      expect((await expectJson(await proxy(a.principalId), 200)).data.voted).toBe(true)
      const again = await expectJson(await proxy(a.principalId), 200)
      expect(again.data).toEqual({ voted: false, voteCount: 2 })
      // A later vote for b is the control that the activity writer has run.
      await expectJson(await proxy(b.principalId), 200)
      await pollFor('second proxy activity', async () =>
        (await activityOf(post.id, 'vote.proxy')).length >= 2 ? true : null
      )
      const rows = await activityOf(post.id, 'vote.proxy')
      expect(rows.map((r) => r.metadata.voterPrincipalId)).toEqual([a.principalId, b.principalId])
      await admin.api.dispose()
    }
  )

  test(
    'API-R-041 proxy vote validation refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const other = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} validation`)
      const url = `/api/v1/posts/${post.id}/vote/proxy`

      const empty = await expectError(
        await admin.api.post(url, { data: {} }),
        400,
        'BAD_REQUEST',
        'Invalid request body'
      )
      expect(empty.error.details.errors.voterPrincipalId).toBeTruthy()
      await expectError(
        await admin.api.post(url, { data: { voterPrincipalId: 'x' } }),
        400,
        'VALIDATION_ERROR',
        'Invalid voter principal ID format'
      )
      await expectError(
        await admin.api.post('/api/v1/posts/nope/vote/proxy', {
          data: { voterPrincipalId: other.principalId },
        }),
        400,
        'VALIDATION_ERROR',
        'Invalid post ID format'
      )
      await expectError(
        await admin.api.post(`/api/v1/posts/${generateId('post')}/vote/proxy`, {
          data: { voterPrincipalId: other.principalId },
        }),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      // Another key's service principal is accepted as a voter.
      expect(
        (
          await expectJson(
            await admin.api.post(url, { data: { voterPrincipalId: other.principalId } }),
            200
          )
        ).data.voted
      ).toBe(true)
      await admin.api.dispose()
      await other.api.dispose()
    }
  )

  test(
    'API-R-041 a proxy vote for an unknown voter is a not-found refusal, not a server error',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'POST /posts/:id/vote/proxy never looks the voter up; the vote insert hits the ' +
          'principal foreign key and answers 500 ' +
          '(apps/web/src/routes/api/v1/posts/$postId.vote.proxy.ts:43-63, ' +
          'apps/web/src/lib/server/domains/posts/post.voting.ts addVoteOnBehalf)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} unknown voter`)
      const res = await admin.api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
        data: { voterPrincipalId: generateId('principal') },
      })
      const text = await res.text()
      expect([400, 404], text).toContain(res.status())
      await admin.api.dispose()
    }
  )

  test(
    'API-R-042 an admin key backdates a proxy vote in import mode; a member key cannot',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // An admin's personal key holds the admin role; the manager workspace key is role member.
      const admin = await keyApi(
        playwright,
        baseURL,
        { creatorEmail: people.people.admin.email },
        { 'x-import-mode': 'true' }
      )
      const member = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'manager',
      })
      const board = await newBoard(member.api, marker)
      const post = await newPost(member.api, board.id, `${marker} backdated`)
      const a = await seedCustomer(`${marker}-a@customers.example`)
      const b = await seedCustomer(`${marker}-b@customers.example`)
      const createdAt = '2023-05-01T00:00:00Z'

      await expectJson(
        await admin.api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
          data: { voterPrincipalId: a.principalId, createdAt },
        }),
        200
      )
      await expectJson(
        await member.api.post(`/api/v1/posts/${post.id}/vote/proxy`, {
          data: { voterPrincipalId: b.principalId, createdAt },
        }),
        200
      )
      // The member's vote writes its activity; that is the control for the admin's absence.
      const [activity] = await waitForActivity(post.id, 'vote.proxy')
      expect(activity.metadata.voterPrincipalId).toBe(b.principalId)
      expect(await activityOf(post.id, 'vote.proxy')).toHaveLength(1)

      const votes = await votesOf(post.id)
      const va = votes.find((v) => v.principalId === a.principalId)
      const vb = votes.find((v) => v.principalId === b.principalId)
      expect(va?.createdAt.toISOString()).toBe('2023-05-01T00:00:00.000Z')
      expect(Date.now() - (vb?.createdAt.getTime() ?? 0)).toBeLessThan(5 * 60_000)
      await admin.api.dispose()
      await member.api.dispose()
    }
  )

  test(
    'API-R-043 removing a proxy vote is idempotent and keeps the subscription',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const board = await newBoard(admin.api, marker)
      const post = await newPost(admin.api, board.id, `${marker} remove`)
      const customer = await seedCustomer(`${marker}@customers.example`)
      const url = `/api/v1/posts/${post.id}/vote/proxy`
      await expectJson(
        await admin.api.post(url, { data: { voterPrincipalId: customer.principalId } }),
        200
      )
      // Removal works on a read-only board.
      await expectJson(
        await admin.api.patch(`/api/v1/boards/${board.id}`, { data: { readOnly: true } }),
        200
      )

      const first = await admin.api.delete(url, {
        data: { voterPrincipalId: customer.principalId },
      })
      expect(first.status(), await first.text()).toBe(204)
      expect((await votesOf(post.id)).map((v) => v.principalId)).not.toContain(customer.principalId)
      await waitForActivity(post.id, 'vote.removed')
      const second = await admin.api.delete(url, {
        data: { voterPrincipalId: customer.principalId },
      })
      expect(second.status()).toBe(204)
      expect((await subscriptionsOf(post.id))[customer.principalId]).toBe('vote')

      await expectError(await admin.api.delete(url), 400, 'BAD_REQUEST')
      // The second removal wrote no activity (the 400 above ran after it).
      expect(await activityOf(post.id, 'vote.removed')).toHaveLength(1)
      await admin.api.dispose()
    }
  )
})
