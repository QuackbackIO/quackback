/**
 * Board access on the portal: per-board view, vote, comment and submit tiers
 * per identity, segments, deleted boards, team roles, the workspace anonymous
 * ceiling and the private portal.
 *
 * Journeys: FBP-A-01 FBP-A-02 FBP-A-03 FBP-A-04 FBP-A-05 FBP-A-06 FBP-A-07
 * FBP-A-08 FBP-A-09
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { createRole } from '../../support/access'
import { mintCustomer } from '../../support/widget-portal'
import {
  createBoard,
  fbFn,
  personContext,
  portalCustomer,
  seedPost,
  visitor,
  wordFor,
} from '../../product/feedback-portal'
import {
  addToSegment,
  createSegment,
  removeFromSegment,
  visibleBoardSlugs,
  visiblePostIds,
} from '../../product/feedback-portal-access'

interface Caps {
  permissions: Record<string, { canVote: boolean; canSubmit: boolean }>
}

const ANON_ON = { portal_config: { 'features.allowAnonymous': true } }
const ANON_OFF = { portal_config: { 'features.allowAnonymous': false } }

async function adminUserUuid(): Promise<string> {
  const [row] =
    await supportDb()`SELECT id FROM "user" WHERE email = 'e2e-support-admin@example.com'`
  return row.id as string
}

test.describe('portal board access', () => {
  test(
    'FBP-A-01 each identity sees exactly the boards and posts its view tier allows',
    { tag: '@smoke' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const segment = await createSegment(marker)
      const boards = {
        anonymous: await createBoard(marker, { suffix: 'anon' }),
        authenticated: await createBoard(marker, {
          suffix: 'auth',
          access: { view: 'authenticated' },
        }),
        segments: await createBoard(marker, {
          suffix: 'seg',
          access: { view: 'segments', segments: { view: [segment.id] } },
        }),
        team: await createBoard(marker, { suffix: 'team', access: { view: 'team' } }),
      }
      const posts = {
        anonymous: await seedPost(boards.anonymous, { title: `${word} anon` }),
        authenticated: await seedPost(boards.authenticated, { title: `${word} auth` }),
        segments: await seedPost(boards.segments, { title: `${word} seg` }),
        team: await seedPost(boards.team, { title: `${word} team` }),
      }
      const anon = await visitor(browser, marker)
      const customer = await portalCustomer(browser, marker, { suffix: 'cust' })
      const member = await portalCustomer(browser, marker, { suffix: 'member' })
      await addToSegment(segment, member.principalUuid)
      const admin = await personContext(browser, await adminUserUuid(), marker)

      const expected = {
        anon: ['anonymous'],
        customer: ['anonymous', 'authenticated'],
        member: ['anonymous', 'authenticated', 'segments'],
        admin: ['anonymous', 'authenticated', 'segments', 'team'],
      } as const
      const who = { anon, customer, member, admin }
      const all = Object.keys(boards) as Array<keyof typeof boards>
      for (const [name, tiers] of Object.entries(expected) as Array<
        [keyof typeof who, readonly (keyof typeof boards)[]]
      >) {
        const req = who[name].request
        const ids = await visiblePostIds(req, { search: word })
        expect(ids.sort(), `${name} search`).toEqual(tiers.map((t) => posts[t].id).sort())
        const slugs = await visibleBoardSlugs(req)
        for (const t of all) {
          expect(slugs.includes(boards[t].slug), `${name} board list ${t}`).toBe(tiers.includes(t))
          const detail = await fbFn(req, 'portal', 'fetchPublicPostDetail', { postId: posts[t].id })
          expect(!!detail.value && !detail.error, `${name} detail ${t}`).toBe(tiers.includes(t))
        }
      }
    }
  )

  test(
    'FBP-A-02 writes and side reads on a post the caller cannot see answer not found or the denied shape',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const team = await createBoard(marker, { access: { view: 'team' } })
      const hidden = await seedPost(team, { title: `${word} hidden plan` })
      const customer = await portalCustomer(browser, marker)
      const vote = await fbFn(customer.request, 'publicPosts', 'toggleVoteFn', {
        postId: hidden.id,
      })
      expect(vote.error?.code).toBe('POST_NOT_FOUND')
      const sub = await fbFn(customer.request, 'subscriptions', 'subscribeToPostFn', {
        postId: hidden.id,
      })
      expect(sub.error?.code ?? '').toMatch(/NOT_FOUND$/)
      const side = await fbFn<Record<string, unknown>>(
        customer.request,
        'publicPosts',
        'getVoteSidebarDataFn',
        { postId: hidden.id }
      )
      expect(side.value).toMatchObject({ canVote: false, hasVoted: false })
      const similar = await fbFn<Array<{ id: string }>>(
        customer.request,
        'publicPosts',
        'findSimilarPostsFn',
        {
          title: `${word} hidden plan`,
        }
      )
      expect((similar.value ?? []).map((p) => p.id)).not.toContain(hidden.id)
      expect(await visiblePostIds(customer.request, { search: word })).toEqual([])
      const [rows] =
        await supportDb()`SELECT count(*)::int AS n FROM post_votes WHERE post_id = ${hidden.uuid}`
      expect(rows.n).toBe(0)
    }
  )

  test(
    'FBP-A-03 the submit tier decides the server answer; view is a precondition',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const viewSeg = await createSegment(marker, 'view')
      const submitSeg = await createSegment(marker, 'submit')
      const segSubmit = await createBoard(marker, {
        suffix: 'segsub',
        access: { submit: 'segments', segments: { submit: [submitSeg.id] } },
      })
      const teamSubmit = await createBoard(marker, {
        suffix: 'teamsub',
        access: { submit: 'team' },
      })
      const split = await createBoard(marker, {
        suffix: 'split',
        access: {
          view: 'segments',
          submit: 'segments',
          segments: { view: [viewSeg.id], submit: [submitSeg.id] },
        },
      })
      const customer = await portalCustomer(browser, marker, { suffix: 'cust' })
      const member = await portalCustomer(browser, marker, { suffix: 'member' })
      await addToSegment(submitSeg, member.principalUuid)
      const post = (who: typeof customer, boardId: string, t: string) =>
        fbFn(who.request, 'publicPosts', 'createPublicPostFn', { boardId, title: `${marker} ${t}` })

      expect((await post(customer, segSubmit.id, 'c1')).error).toMatchObject({
        code: 'POST_CREATE_DENIED',
        message: 'Only specific groups can submit on this board',
      })
      expect((await post(member, segSubmit.id, 'm1')).error).toBeUndefined()
      // A submit-segment member on a team-submit board: no access.
      expect((await post(member, teamSubmit.id, 'm2')).error).toMatchObject({
        code: 'POST_CREATE_DENIED',
        message: 'Only team members can submit on this board',
      })
      // In the submit segment but not the view segment: the board does not exist for them.
      expect((await post(member, split.id, 'm3')).error).toMatchObject({ code: 'BOARD_NOT_FOUND' })
      await addToSegment(viewSeg, member.principalUuid)
      expect((await post(member, split.id, 'm4')).error).toBeUndefined()
    }
  )

  test(
    'FBP-A-04 vote and comment tiers are independent of view',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, {
        access: { vote: 'authenticated', comment: 'team' },
      })
      const post = await seedPost(board, { title: `${marker} open to read` })
      const customer = await portalCustomer(browser, marker)
      const ghost = await mintCustomer({ anonymous: true })
      const anon = await personContext(browser, ghost.userUuid, marker)
      // Viewing is never refused.
      expect(await visiblePostIds(anon.request, { boardSlug: board.slug })).toEqual([post.id])
      expect(
        (await fbFn(anon.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })).error
      ).toMatchObject({ code: 'VOTE_NOT_ALLOWED' })
      const voted = await fbFn<{ voted: boolean }>(
        customer.request,
        'publicPosts',
        'toggleVoteFn',
        {
          postId: post.id,
        }
      )
      expect(voted.value?.voted).toBe(true)
      const comment = await fbFn(customer.request, 'comments', 'createCommentFn', {
        postId: post.id,
        content: 'can I?',
      })
      expect(comment.error?.statusCode).toBe(403)
      // The board capabilities advertise the same.
      const caps = await fbFn<Caps>(customer.request, 'portal', 'fetchBoardCapabilitiesFn')
      expect(caps.value?.permissions[board.id]).toMatchObject({ canVote: true })
      const [{ n }] =
        await supportDb()`SELECT count(*)::int AS n FROM post_comments WHERE post_id = ${post.uuid}`
      expect(n).toBe(0)
    }
  )

  test(
    'FBP-A-06 adding and removing segment membership changes what the customer sees on the next request',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const segment = await createSegment(marker)
      const board = await createBoard(marker, {
        access: { view: 'segments', segments: { view: [segment.id] } },
      })
      const post = await seedPost(board, { title: `${marker} beta only` })
      const customer = await portalCustomer(browser, marker)
      expect(await visiblePostIds(customer.request, { boardSlug: board.slug })).toEqual([])
      await addToSegment(segment, customer.principalUuid)
      expect(await visiblePostIds(customer.request, { boardSlug: board.slug })).toEqual([post.id])
      expect(await visibleBoardSlugs(customer.request)).toContain(board.slug)
      await removeFromSegment(segment, customer.principalUuid)
      expect(await visiblePostIds(customer.request, { boardSlug: board.slug })).toEqual([])
    }
  )

  test(
    'FBP-A-07 a soft-deleted board vanishes for everyone, team included, and refuses writes',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${word} on a doomed board` })
      await supportDb()`UPDATE boards SET deleted_at = now() WHERE id = ${board.uuid}`
      const customer = await portalCustomer(browser, marker)
      const admin = await personContext(browser, await adminUserUuid(), marker)
      for (const who of [customer, admin]) {
        expect(await visiblePostIds(who.request, { search: word })).toEqual([])
        expect(await visibleBoardSlugs(who.request)).not.toContain(board.slug)
      }
      expect(
        (await fbFn(customer.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })).error
      ).toMatchObject({ code: 'POST_NOT_FOUND' })
      expect(
        (
          await fbFn(customer.request, 'publicPosts', 'createPublicPostFn', {
            boardId: board.id,
            title: `${marker} late`,
          })
        ).error
      ).toMatchObject({ code: 'BOARD_NOT_FOUND' })
    }
  )

  test(
    'FBP-A-08 the team sees team boards and held posts; a custom role without post.view_private sees no held post',
    { tag: '@core' },
    async ({ browser, marker, newTeammate, playwright }) => {
      const word = wordFor(marker)
      const team = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const open = await createBoard(marker, { suffix: 'open' })
      const teamPost = await seedPost(team, { title: `${word} team` })
      const held = await seedPost(open, { title: `${word} held`, moderationState: 'pending' })
      const live = await seedPost(open, { title: `${word} live` })
      const admin = await personContext(browser, await adminUserUuid(), marker)
      expect((await visiblePostIds(admin.request, { search: word })).sort()).toEqual(
        [teamPost.id, held.id, live.id].sort()
      )
      // A custom role without post.view_private does not see held posts. (It does
      // see team-only boards: the team tier follows principal.role. Whether it
      // should is an owner question, so that half is not asserted.)
      const roleKey = await createRole(marker, ['member.view'])
      const plain = await newTeammate({ roleKey })
      const api = await plain.api(playwright)
      try {
        const seen = await visiblePostIds(api, { search: word })
        expect(seen).toContain(live.id)
        expect(seen).not.toContain(held.id)
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'FBP-A-02 a comment on a post the caller cannot see answers not found, like a missing post',
    {
      tag: '@core',
    },
    async ({ browser, marker }) => {
      const team = await createBoard(marker, { access: { view: 'team' } })
      const hidden = await seedPost(team, { title: `${marker} hidden plan` })
      const customer = await portalCustomer(browser, marker)
      const missing = await fbFn(customer.request, 'comments', 'createCommentFn', {
        postId: generateId('post'),
        content: 'peek',
      })
      expect(missing.error?.code).toBe('POST_NOT_FOUND')
      const comment = await fbFn(customer.request, 'comments', 'createCommentFn', {
        postId: hidden.id,
        content: 'peek',
      })
      expect(comment.error?.code).toBe('POST_NOT_FOUND')
    }
  )

  test.describe('workspace switches', () => {
    test.beforeEach(() => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
    })

    test(
      'FBP-A-05 the anonymous switch gates anonymous writes only, never viewing or a signed-in customer',
      { tag: ['@core', '@isolated'] },
      async ({ browser, marker }) => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} all anonymous` })
        const ghost = await mintCustomer({ anonymous: true })
        const anon = await personContext(browser, ghost.userUuid, marker)
        const customer = await portalCustomer(browser, marker)
        await withSettings(ANON_OFF, async () => {
          expect(await visiblePostIds(anon.request, { boardSlug: board.slug })).toEqual([post.id])
          expect(
            (await fbFn(anon.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })).error
              ?.code
          ).toBe('ANONYMOUS_NOT_ALLOWED')
          expect(
            (
              await fbFn(anon.request, 'comments', 'createCommentFn', {
                postId: post.id,
                content: 'hi',
              })
            ).error?.statusCode
          ).toBe(403)
          expect(
            (await fbFn(customer.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })).error
          ).toBeUndefined()
          const caps = await fbFn<Caps>(anon.request, 'portal', 'fetchBoardCapabilitiesFn')
          expect(caps.value?.permissions[board.id]).toMatchObject({
            canVote: false,
            canSubmit: false,
          })
        })
        await withSettings(ANON_ON, async () => {
          const vote = await fbFn<{ voted: boolean }>(anon.request, 'publicPosts', 'toggleVoteFn', {
            postId: post.id,
          })
          expect(vote.value?.voted).toBe(true)
          const comment = await fbFn(anon.request, 'comments', 'createCommentFn', {
            postId: post.id,
            content: 'hello from nobody',
          })
          expect(comment.error).toBeUndefined()
        })
      }
    )

    test(
      'FBP-A-09 a private portal gives a denied visitor empty reads and refuses writes',
      { tag: ['@core', '@isolated'] },
      async ({ browser, marker }) => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} private` })
        const customer = await portalCustomer(browser, marker)
        const admin = await personContext(browser, await adminUserUuid(), marker)
        await withSettings({ portal_config: { 'access.visibility': 'private' } }, async () => {
          for (const who of [await visitor(browser, marker), customer]) {
            expect(await visiblePostIds(who.request, { boardSlug: board.slug })).toEqual([])
            expect(await visibleBoardSlugs(who.request)).toEqual([])
            const detail = await fbFn(who.request, 'portal', 'fetchPublicPostDetail', {
              postId: post.id,
            })
            expect(detail.value ?? null).toBeNull()
          }
          const vote = await fbFn(customer.request, 'publicPosts', 'toggleVoteFn', {
            postId: post.id,
          })
          expect(vote.error).toMatchObject({
            code: 'PORTAL_ACCESS_REQUIRED',
            message: 'Portal access required',
          })
          const create = await fbFn(customer.request, 'publicPosts', 'createPublicPostFn', {
            boardId: board.id,
            title: `${marker} sneaky`,
          })
          expect(create.error?.code).toBe('PORTAL_ACCESS_REQUIRED')
          // The team is still let in.
          expect(await visiblePostIds(admin.request, { boardSlug: board.slug })).toEqual([post.id])
        })
      }
    )
  })
})
