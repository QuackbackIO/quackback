/**
 * The helpdesk app endpoints (/api/v1/apps/*): boards, search, similar-post
 * suggest, ticket links and posts created from a ticket. Journeys
 * API-R-091, 092, 094 and 096..100.
 *
 * Not covered here: API-R-093 (similar-post suggest: not completed; the
 * vector-seeding approach was not finished) and API-R-095 (owner question: should apps/link and
 * apps/posts create and rename people without people.manage?).
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { expectJson } from '../../support/api-client'
import { bodyOf, deliveriesOf } from '../../support/webhooks'
import {
  customRoleApi,
  expectError,
  keyApi,
  restBoard,
  restPost,
  uuid,
  withHook,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 90_000 })

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-max-age': '86400',
}

async function linkRows(postId: string, externalId: string) {
  return supportDb()`SELECT * FROM post_external_links
    WHERE post_id = ${uuid(postId)} AND external_id = ${externalId}`
}

async function voteOf(postId: string, principalId: string) {
  const [row] = await supportDb()`SELECT * FROM post_votes
    WHERE post_id = ${uuid(postId)} AND principal_id = ${uuid(principalId)}`
  return row
}

test.describe('REST apps: reads', () => {
  test(
    'API-R-091 apps boards answers the preflight and lists boards, team-only included, with CORS headers',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const team = await restBoard(api, `${marker} team`)
      await supportDb()`UPDATE boards SET access = jsonb_set(access, '{view}', '"team"')
                        WHERE id = ${uuid(team.id)}`

      const pre = await api.fetch('/api/v1/apps/boards', { method: 'OPTIONS' })
      expect(pre.status()).toBe(204)
      expect(pre.headers()).toMatchObject(CORS)

      const res = await api.get('/api/v1/apps/boards')
      expect(res.headers()).toMatchObject(CORS)
      const { data } = await expectJson(res, 200)
      const mine = data.boards.filter((b: { name: string }) => b.name.startsWith(marker))
      expect(
        mine.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
      ).toEqual([
        { id: board.id, name: `${marker} board`, slug: board.slug },
        { id: team.id, name: `${marker} team`, slug: team.slug },
      ])
    }
  )

  test(
    'API-R-092 apps search returns matching posts top-voted first; a blank query returns none',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const low = await restPost(api, board.id, `${marker} low`)
      const high = await restPost(api, board.id, `${marker} high`)
      await supportDb()`UPDATE posts SET vote_count = 50 WHERE id = ${uuid(high.id)}`

      const res = await api.get(`/api/v1/apps/search?q=${encodeURIComponent(marker)}&limit=50`)
      expect(res.headers()['access-control-allow-origin']).toBe('*')
      const { data } = await expectJson(res, 200)
      expect(data.posts.map((p: { id: string }) => p.id)).toEqual([high.id, low.id])
      expect(Object.keys(data.posts[0]).sort()).toEqual(
        ['board', 'id', 'statusColor', 'statusName', 'title', 'voteCount'].sort()
      )
      expect(data.posts[0]).toMatchObject({
        title: `${marker} high`,
        voteCount: 50,
        board: { name: `${marker} board` },
      })
      const blank = await expectJson(await api.get('/api/v1/apps/search?q='), 200)
      expect(blank.data).toEqual({ posts: [] })
    }
  )

  test(
    'API-R-092 apps search fills in each post status name and colour',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const [status] = await supportDb()`SELECT s.name, s.color FROM posts p
        JOIN post_statuses s ON s.id = p.status_id WHERE p.id = ${uuid(post.id)}`
      const { data } = await expectJson(
        await api.get(`/api/v1/apps/search?q=${encodeURIComponent(marker)}`),
        200
      )
      expect(data.posts[0]).toMatchObject({ statusName: status.name, statusColor: status.color })
    }
  )
})

test.describe('REST apps: ticket links', () => {
  test(
    'API-R-094 linking a ticket with a requester creates the link, the person and their vote; a repeat answers the same link',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const email = `${marker}@customers.example`
      const ticket = `${marker}-T1`
      const body = {
        postId: post.id,
        integrationType: 'helpdesk',
        externalId: ticket,
        externalUrl: `https://desk.example/${ticket}`,
        requester: { email, name: `Requester ${marker}` },
      }

      const res = await api.post('/api/v1/apps/link', { data: body })
      expect(res.headers()['access-control-allow-origin']).toBe('*')
      const first = (await expectJson(res, 201)).data
      expect(first).toMatchObject({
        voted: true,
        linkId: expect.stringMatching(/^post_external_link_/),
      })
      const [user] =
        await supportDb()`SELECT p.id FROM "user" u JOIN principal p ON p.user_id = u.id
                                       WHERE u.email = ${email}`
      expect(uuid(first.principalId)).toBe(user.id)
      expect(first.voteCount).toBe(post.voteCount + 1)
      expect(await linkRows(post.id, ticket)).toHaveLength(1)
      const vote = await voteOf(post.id, first.principalId)
      expect(vote).toMatchObject({
        source_type: 'helpdesk',
        source_external_url: `https://desk.example/${ticket}`,
      })

      const again = (await expectJson(await api.post('/api/v1/apps/link', { data: body }), 201))
        .data
      expect(again).toMatchObject({
        linkId: first.linkId,
        voted: false,
        voteCount: first.voteCount,
        principalId: first.principalId,
      })
      expect(await linkRows(post.id, ticket)).toHaveLength(1)

      const bare = (
        await expectJson(
          await api.post('/api/v1/apps/link', {
            data: { postId: post.id, integrationType: 'helpdesk', externalId: `${marker}-T2` },
          }),
          201
        )
      ).data
      expect(bare).toMatchObject({ voted: false, principalId: null, voteCount: first.voteCount })
    }
  )

  test(
    'API-R-096 linking a deleted or unknown post answers 404 and leaves no link row',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      await supportDb()`UPDATE posts SET deleted_at = NOW() WHERE id = ${uuid(post.id)}`
      const requester = { email: `${marker}@customers.example` }

      await expectError(
        await api.post('/api/v1/apps/link', {
          data: {
            postId: post.id,
            integrationType: 'helpdesk',
            externalId: `${marker}-T`,
            requester,
          },
        }),
        404,
        'NOT_FOUND',
        'Post not found'
      )
      expect(await linkRows(post.id, `${marker}-T`)).toHaveLength(0)
      const unknown = await api.post('/api/v1/apps/link', {
        data: {
          postId: generateId('post'),
          integrationType: 'helpdesk',
          externalId: `${marker}-U`,
          requester,
        },
      })
      expect(unknown.status(), await unknown.text()).toBe(404)
    }
  )

  test(
    'API-R-097 unlink answers success twice, removes the link and keeps the vote',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const board = await restBoard(api, `${marker} board`)
      const post = await restPost(api, board.id, `${marker} post`)
      const ticket = `${marker}-T1`
      const linked = (
        await expectJson(
          await api.post('/api/v1/apps/link', {
            data: {
              postId: post.id,
              integrationType: 'helpdesk',
              externalId: ticket,
              requester: { email: `${marker}@customers.example` },
            },
          }),
          201
        )
      ).data
      const body = { postId: post.id, integrationType: 'helpdesk', externalId: ticket }
      for (let i = 0; i < 2; i++) {
        const res = await expectJson(await api.post('/api/v1/apps/unlink', { data: body }), 200)
        expect(res.data).toEqual({ success: true })
      }
      expect(await linkRows(post.id, ticket)).toHaveLength(0)
      expect(await voteOf(post.id, linked.principalId)).toBeTruthy()
    }
  )

  test(
    'API-R-098 posts linked to a ticket are listed newest link first without deleted posts; missing parameters 400; no integration.view 403',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const contributor = await keyApi(playwright, baseURL, people, { roleKey: 'contributor' })
      const noView = await customRoleApi(playwright, baseURL, people, `No view ${marker}`, [
        'post.view_private',
      ])
      const board = await restBoard(api, `${marker} board`)
      const first = await restPost(api, board.id, `${marker} first`)
      const second = await restPost(api, board.id, `${marker} second`)
      const gone = await restPost(api, board.id, `${marker} gone`)
      const ticket = `${marker}-T1`
      for (const p of [first, second, gone]) {
        await expectJson(
          await api.post('/api/v1/apps/link', {
            data: { postId: p.id, integrationType: 'helpdesk', externalId: ticket },
          }),
          201
        )
      }
      // Distinct link times, oldest first.
      await supportDb()`UPDATE post_external_links SET created_at = NOW() - interval '1 minute'
                        WHERE post_id = ${uuid(first.id)} AND external_id = ${ticket}`
      await supportDb()`UPDATE posts SET deleted_at = NOW() WHERE id = ${uuid(gone.id)}`

      const res = await contributor.api.get(
        `/api/v1/apps/linked?integrationType=helpdesk&externalId=${encodeURIComponent(ticket)}`
      )
      expect(res.headers()['access-control-allow-origin']).toBe('*')
      const { data } = await expectJson(res, 200)
      expect(data.posts.map((p: { id: string }) => p.id)).toEqual([second.id, first.id])
      expect(Object.keys(data.posts[0]).sort()).toEqual(
        [
          'board',
          'id',
          'linkId',
          'linkedAt',
          'statusColor',
          'statusName',
          'title',
          'voteCount',
        ].sort()
      )
      expect(data.posts[0].statusName).toEqual(expect.any(String))
      expect(data.posts[0].board).toEqual({ name: `${marker} board` })

      await expectError(
        await api.get('/api/v1/apps/linked?integrationType=helpdesk'),
        400,
        'BAD_REQUEST',
        'integrationType and externalId are required'
      )
      await expectError(
        await noView.api.get(
          `/api/v1/apps/linked?integrationType=helpdesk&externalId=${encodeURIComponent(ticket)}`
        ),
        403,
        'FORBIDDEN',
        "Requires the 'integration.view' permission"
      )
    }
  )

  test(
    'API-R-099 a post created from a helpdesk is authored and voted by the requester, linked, and announced even in import mode',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await keyApi(playwright, baseURL, people, { roleKey: 'owner' })
      const board = await restBoard(api, `${marker} board`)
      const email = `${marker}@customers.example`
      const ticket = `${marker}-T1`

      await withHook(api, marker, ['post.created'], async () => {
        const res = await api.post('/api/v1/apps/posts', {
          headers: { 'x-import-mode': 'true' },
          data: {
            boardId: board.id,
            title: `${marker} from desk`,
            content: 'Please add this',
            requester: { email, name: `Requester ${marker}` },
            link: { integrationType: 'helpdesk', externalId: ticket },
          },
        })
        expect(res.headers()['access-control-allow-origin']).toBe('*')
        const { data } = await expectJson(res, 201)
        expect(Object.keys(data).sort()).toEqual(
          ['boardId', 'content', 'createdAt', 'id', 'statusId', 'title', 'voteCount'].sort()
        )
        expect(data).toMatchObject({
          title: `${marker} from desk`,
          voteCount: 1,
          boardId: board.id,
        })

        const [row] = await supportDb()`SELECT p.principal_id, p.moderation_state, u.email
          FROM posts p JOIN principal pr ON pr.id = p.principal_id
          JOIN "user" u ON u.id = pr.user_id WHERE p.id = ${uuid(data.id)}`
        expect(row).toMatchObject({ email, moderation_state: 'published' })
        const [vote] = await supportDb()`SELECT principal_id FROM post_votes
                                         WHERE post_id = ${uuid(data.id)}`
        expect(vote.principal_id).toBe(row.principal_id)
        expect(await linkRows(data.id, ticket)).toHaveLength(1)

        const [delivery] = await deliveriesOf(marker, 'post.created', data.id)
        expect(bodyOf<{ post: { authorEmail: string } }>(delivery).data.post.authorEmail).toBe(
          email
        )
      })
    }
  )

  test(
    'API-R-100 apps error responses carry the CORS headers too',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people }) => {
      const { api } = await keyApi(playwright, baseURL, people)
      const unauthorized = await api.get('/api/v1/apps/boards', {
        headers: { authorization: 'Bearer qb_nope' },
      })
      expect(unauthorized.status()).toBe(401)
      expect(unauthorized.headers()['access-control-allow-origin']).toBe('*')
      const bad = await api.post('/api/v1/apps/link', { data: {} })
      expect(bad.status()).toBe(400)
      expect(bad.headers()['access-control-allow-origin']).toBe('*')
    }
  )
})
