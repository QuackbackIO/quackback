/**
 * Voting from the portal: the feed card, the detail sidebar, tier and
 * workspace gates, merges, read-only boards, subscriptions, the post.voted
 * webhook and the anonymous rate limit.
 *
 * Journeys: FBP-V-01 FBP-V-02 FBP-V-03 FBP-V-04 FBP-V-05 FBP-V-06 FBP-V-07
 * FBP-V-08 FBP-V-09 FBP-V-10 FBP-V-11 FBP-V-12 FBP-V-13 FBP-V-14 FBP-V-15
 */
import { randomUUID } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { sink } from '../../support/webhook-sink-client'
import { bodyOf, deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import {
  mintCustomer,
  mintSessionToken,
  signSsoToken,
  widgetSecret,
} from '../../support/widget-portal'
import {
  adminRest,
  cardFor,
  clickUntil,
  contextFor,
  createBoard,
  fbFn,
  ipFor,
  personContext,
  portalCustomer,
  postPath,
  postRow,
  restPost,
  seedPost,
  seedVotes,
  untilAnonymousAllowed,
  visitor,
  waitForHydration,
} from '../../product/feedback-portal'

const ANON_ON = { portal_config: { 'features.allowAnonymous': true } }
const ANON_OFF = { portal_config: { 'features.allowAnonymous': false } }

async function votesOf(postUuid: string): Promise<string[]> {
  const rows = await supportDb()`SELECT principal_id FROM post_votes WHERE post_id = ${postUuid}`
  return rows.map((r) => r.principal_id as string)
}

test.describe('portal voting', () => {
  test(
    'FBP-V-01 a signed-in vote toggles on the feed card and survives a reload',
    { tag: '@smoke' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} vote me`, voteCount: 0 })
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(`/?board=${board.slug}`)
      const card = cardFor(page, post.title)
      const button = card.getByTestId('vote-button')
      await expect(button).toHaveAttribute('aria-pressed', 'false')
      await waitForHydration(page)
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(card.getByTestId('vote-count')).toHaveText('1')
      await expect.poll(() => votesOf(post.uuid)).toEqual([cass.principalUuid])

      await page.reload()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(button).toHaveAccessibleName('Remove vote (1 vote)')
      await clickUntil(button, () =>
        expect(button).toHaveAttribute('aria-pressed', 'false', { timeout: 2_000 })
      )
      await expect(card.getByTestId('vote-count')).toHaveText('0')
      await expect.poll(() => votesOf(post.uuid)).toEqual([])
      expect((await postRow(post.uuid)).vote_count).toBe(0)
    }
  )

  test(
    'FBP-V-02 the detail sidebar votes and unvotes, and the feed agrees',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} detail vote`, voteCount: 0 })
      await seedVotes(post, [
        (await mintCustomer({ email: `${marker}-v1@customers.example` })).principalUuid,
      ])
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(postPath(post))
      const button = page.getByTestId('vote-button').first()
      await expect(button).toHaveAttribute('aria-pressed', 'false')
      await clickUntil(button, () =>
        expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 })
      )
      await expect(page.getByTestId('vote-count').first()).toHaveText('2')
      await expect.poll(async () => (await postRow(post.uuid)).vote_count).toBe(2)

      await page.goto(`/?board=${board.slug}`)
      const card = cardFor(page, post.title)
      await expect(card.getByTestId('vote-button')).toHaveAttribute('aria-pressed', 'true')
      await expect(card.getByTestId('vote-count')).toHaveText('2')

      await page.goto(postPath(post))
      await clickUntil(button, () =>
        expect(button).toHaveAttribute('aria-pressed', 'false', { timeout: 2_000 })
      )
      await expect(page.getByTestId('vote-count').first()).toHaveText('1')
      await expect.poll(() => votesOf(post.uuid)).not.toContain(cass.principalUuid)
    }
  )

  test(
    'FBP-V-04 a signed-out click on a sign-in-only board opens sign-in and records nothing',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { access: { vote: 'authenticated' } })
      const post = await seedPost(board, { title: `${marker} members vote`, voteCount: 2 })
      const anon = await visitor(browser, marker)
      await anon.page.goto(`/?board=${board.slug}`)
      const button = cardFor(anon.page, post.title).getByTestId('vote-button')
      await clickUntil(button, () =>
        expect(anon.page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
      )
      await expect(anon.page.getByRole('dialog')).toContainText(/sign in|log in|continue/i)
      expect(await votesOf(post.uuid)).toEqual([])
      expect((await postRow(post.uuid)).vote_count).toBe(2)
      // No anonymous session was minted for the attempt.
      const cookies = await anon.context.cookies()
      expect(cookies.find((c) => c.name.includes('session_token'))).toBeUndefined()
    }
  )

  test(
    'FBP-V-05 a signed-in customer the vote tier denies sees a dimmed button and the server refuses',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { access: { vote: 'team' } })
      const post = await seedPost(board, { title: `${marker} team votes` })
      const cass = await portalCustomer(browser, marker)
      await cass.page.goto(`/?board=${board.slug}`)
      const button = cardFor(cass.page, post.title).getByTestId('vote-button')
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await expect(button).toHaveAttribute('title', "You don't have access to vote on this board")
      const voteCalls: string[] = []
      cass.page.on('request', (r) => {
        if (r.url().includes('/_serverFn/') && r.method() === 'POST') voteCalls.push(r.url())
      })
      // aria-disabled: Playwright would wait for it to enable, so dispatch the click.
      await button.dispatchEvent('click')
      await cass.page.waitForTimeout(500)
      expect(voteCalls).toEqual([])

      const res = await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
      expect(res.error).toMatchObject({ code: 'VOTE_NOT_ALLOWED' })
      expect(await votesOf(post.uuid)).toEqual([])
    }
  )

  test(
    'FBP-V-06 a vote on a post the caller cannot see answers not found',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const open = await createBoard(marker)
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const goneBoard = await createBoard(marker, { suffix: 'gone' })
      const hidden = await seedPost(teamBoard, { title: `${marker} hidden` })
      const held = await seedPost(open, { title: `${marker} held`, moderationState: 'pending' })
      const deleted = await seedPost(open, { title: `${marker} deleted`, deletedAt: new Date() })
      const orphan = await seedPost(goneBoard, { title: `${marker} orphan` })
      await supportDb()`UPDATE boards SET deleted_at = now() WHERE id = ${goneBoard.uuid}`
      const cass = await portalCustomer(browser, marker)
      for (const post of [hidden, held, deleted, orphan]) {
        const res = await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
        expect(res.error, post.title).toMatchObject({ code: 'POST_NOT_FOUND' })
        expect(await votesOf(post.uuid), post.title).toEqual([])
      }
      // An id that never existed reads the same.
      const never = await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', {
        postId: generateId('post'),
      })
      expect(never.error).toMatchObject({ code: 'POST_NOT_FOUND' })
    }
  )

  test(
    'FBP-V-07 ten simultaneous votes from one person leave one vote',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} burst`, voteCount: 0 })
      const cass = await portalCustomer(browser, marker)
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          fbFn<{ voted: boolean; voteCount: number }>(cass.request, 'publicPosts', 'toggleVoteFn', {
            postId: post.id,
          })
        )
      )
      for (const r of results) expect(r.error).toBeUndefined()
      const rows = await votesOf(post.uuid)
      expect(rows.length).toBeLessThanOrEqual(1)
      const count = (await postRow(post.uuid)).vote_count as number
      expect(count).toBe(rows.length)
      expect(count).toBeGreaterThanOrEqual(0)
    }
  )

  test(
    'FBP-V-08 a vote subscribes a real customer; unvoting keeps the subscription',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} subscribe by vote` })
      const cass = await portalCustomer(browser, marker)
      const sub = async () =>
        (
          await supportDb()`SELECT reason, notify_comments, notify_status_changes FROM post_subscriptions
            WHERE post_id = ${post.uuid} AND principal_id = ${cass.principalUuid}`
        )[0]
      expect(await sub()).toBeUndefined()
      await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
      expect(await sub()).toEqual({
        reason: 'vote',
        notify_comments: true,
        notify_status_changes: true,
      })
      const off = await fbFn<{ voted: boolean }>(cass.request, 'publicPosts', 'toggleVoteFn', {
        postId: post.id,
      })
      expect(off.value?.voted).toBe(false)
      expect(await sub()).toEqual({
        reason: 'vote',
        notify_comments: true,
        notify_status_changes: true,
      })
    }
  )

  test(
    'FBP-V-09 post.voted fires for a cast vote and not for its removal',
    { tag: '@nightly' },
    async ({ browser, marker, playwright, baseURL, people }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} hooked vote` })
      const control = await seedPost(board, { title: `${marker} control vote` })
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['post.voted'])
      try {
        const cass = await portalCustomer(browser, marker)
        await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
        const [d] = await deliveriesOf(marker, 'post.voted', post.id)
        expect(bodyOf(d).data).toMatchObject({ post: { id: post.id } })
        await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
        // A later cast on another post proves the relay moved past the removal.
        await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: control.id })
        await deliveriesOf(marker, 'post.voted', control.id)
        expect(
          (await sink.deliveries(marker)).filter((x) => x.body.includes(post.id))
        ).toHaveLength(1)
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-V-10 a vote on a merged post lands on its canonical post; the merged page cannot vote',
    { tag: '@core' },
    async ({ browser, marker, playwright }) => {
      const board = await createBoard(marker)
      const canonical = await seedPost(board, { title: `${marker} canonical`, voteCount: 0 })
      const dupe = await seedPost(board, { title: `${marker} duplicate`, voteCount: 0 })
      const admin = await adminRest(playwright, marker)
      await restPost(admin, `/posts/${dupe.id}/merge`, { canonicalPostId: canonical.id })
      const cass = await portalCustomer(browser, marker)
      const res = await fbFn<{ voted: boolean; voteCount: number }>(
        cass.request,
        'publicPosts',
        'toggleVoteFn',
        { postId: dupe.id }
      )
      expect(res.value).toMatchObject({ voted: true, voteCount: 1 })
      expect(await votesOf(canonical.uuid)).toEqual([cass.principalUuid])
      expect((await postRow(canonical.uuid)).vote_count).toBe(1)

      await cass.page.goto(postPath(dupe))
      await expect(cass.page.getByText(/merged into/i).first()).toBeVisible()
      // The merged page's button is disabled: a click records nothing.
      const inert = cass.page.getByTestId('vote-button').first()
      await expect(inert).toHaveClass(/cursor-not-allowed/)
      await expect(inert).toBeDisabled()
      await expect(inert).toHaveAttribute('aria-disabled', 'true')
      // Disabled: Playwright would wait for it to enable, so dispatch the click.
      await inert.dispatchEvent('click')
      await cass.page.waitForTimeout(500)
      expect(await votesOf(canonical.uuid)).toEqual([cass.principalUuid])
      expect(await votesOf(dupe.uuid)).toEqual([])
    }
  )

  test(
    'FBP-V-11 on a read-only board a new vote is refused but an existing one can be taken back',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const voted = await seedPost(board, { title: `${marker} kept vote` })
      const fresh = await seedPost(board, { title: `${marker} new vote` })
      const cass = await portalCustomer(browser, marker)
      await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: voted.id })
      await supportDb()`UPDATE boards SET read_only = true WHERE id = ${board.uuid}`

      const add = await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: fresh.id })
      expect(add.error).toMatchObject({ code: 'BOARD_READ_ONLY' })
      expect(await votesOf(fresh.uuid)).toEqual([])
      const remove = await fbFn<{ voted: boolean; voteCount: number }>(
        cass.request,
        'publicPosts',
        'toggleVoteFn',
        { postId: voted.id }
      )
      expect(remove.value).toEqual({ voted: false, voteCount: 0 })

      await cass.page.goto(`/?board=${board.slug}`)
      await expect(
        cardFor(cass.page, fresh.title).getByRole('button', { name: '0 votes, voting closed' })
      ).toBeVisible()
    }
  )

  test(
    'FBP-V-13 a new post starts with its author vote; the author can take it back to zero',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const created = await fbFn<{ id: string; voteCount: number }>(
        cass.request,
        'publicPosts',
        'createPublicPostFn',
        { boardId: board.id, title: `${marker} mine` }
      )
      expect(created.value?.voteCount).toBe(1)
      const id = created.value?.id as string
      const postUuid = toUuid(id as `post_${string}`)
      expect(await votesOf(postUuid)).toEqual([cass.principalUuid])
      const perms = async () =>
        (
          await fbFn<{ canEdit: boolean; canDelete: boolean; editReason?: string }>(
            cass.request,
            'publicPosts',
            'getPostPermissionsFn',
            { postId: id }
          )
        ).value
      // The author's own vote does not lock their post (D13).
      expect(await perms()).toMatchObject({ canEdit: true, canDelete: true })
      const off = await fbFn<{ voted: boolean; voteCount: number }>(
        cass.request,
        'publicPosts',
        'toggleVoteFn',
        { postId: id }
      )
      expect(off.value).toEqual({ voted: false, voteCount: 0 })
      expect(await perms()).toMatchObject({ canEdit: true, canDelete: true })
    }
  )

  test(
    'FBP-V-15 the voted list is the caller own; the sidebar state is per viewer',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const mine = await seedPost(board, { title: `${marker} mine` })
      const theirs = await seedPost(board, { title: `${marker} theirs` })
      const cass = await portalCustomer(browser, marker, { suffix: 'a' })
      const other = await portalCustomer(browser, marker, { suffix: 'b' })
      await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: mine.id })
      await fbFn(other.request, 'publicPosts', 'toggleVoteFn', { postId: theirs.id })
      const voted = await fbFn<{ votedPostIds: string[] }>(
        cass.request,
        'publicPosts',
        'getVotedPostsFn'
      )
      expect(voted.value?.votedPostIds).toContain(mine.id)
      expect(voted.value?.votedPostIds).not.toContain(theirs.id)
      const anon = await visitor(browser, marker)
      const none = await fbFn<{ votedPostIds: string[] }>(
        anon.request,
        'publicPosts',
        'getVotedPostsFn'
      )
      expect(none.value?.votedPostIds).toEqual([])

      const side = async (who: { request: typeof cass.request }, postId: string) =>
        (
          await fbFn<Record<string, unknown>>(who.request, 'publicPosts', 'getVoteSidebarDataFn', {
            postId,
          })
        ).value
      expect(await side(cass, mine.id)).toMatchObject({
        hasVoted: true,
        canVote: true,
        isMember: true,
      })
      expect(await side(other, mine.id)).toMatchObject({ hasVoted: false, canVote: true })
      expect(await side(anon, mine.id)).toMatchObject({ hasVoted: false, isMember: false })
    }
  )

  test.describe('anonymous voting (workspace switch)', () => {
    test.beforeEach(() => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
    })

    test(
      'FBP-V-03 a signed-out visitor votes silently on an anonymous board: a session is minted first',
      { tag: ['@core', '@isolated'] },
      async ({ browser, marker }) => {
        await withSettings(ANON_ON, async () => {
          const board = await createBoard(marker)
          const post = await seedPost(board, { title: `${marker} anon vote`, voteCount: 0 })
          const anon = await visitor(browser, marker)
          await untilAnonymousAllowed(anon.request, board)
          await anon.page.goto(`/?board=${board.slug}`)
          const button = cardFor(anon.page, post.title).getByTestId('vote-button')
          // One click only: a second would take the vote back.
          await waitForHydration(anon.page)
          await button.click()
          // The click mints the anonymous session, then votes.
          await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
          await expect(anon.page.getByRole('dialog')).toBeHidden()
          await expect.poll(() => votesOf(post.uuid)).toHaveLength(1)
          const voters = await votesOf(post.uuid)
          const [p] = await supportDb()`SELECT type FROM principal WHERE id = ${voters[0]}`
          expect(p.type).toBe('anonymous')
          // An anonymous voter is not subscribed (no address to write to).
          const subs =
            await supportDb()`SELECT 1 FROM post_subscriptions WHERE post_id = ${post.uuid}`
          expect(subs).toHaveLength(0)
        })
      }
    )

    test(
      'FBP-V-04 with the workspace switch off an anonymous-tier board still asks to sign in',
      { tag: ['@core', '@isolated'] },
      async ({ browser, marker }) => {
        await withSettings(ANON_OFF, async () => {
          const board = await createBoard(marker)
          const post = await seedPost(board, { title: `${marker} switch off`, voteCount: 0 })
          const anon = await visitor(browser, marker)
          await anon.page.goto(`/?board=${board.slug}`)
          const button = cardFor(anon.page, post.title).getByTestId('vote-button')
          await clickUntil(button, () =>
            expect(anon.page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
          )
          expect(await votesOf(post.uuid)).toEqual([])

          // A crafted anonymous vote is refused by the workspace ceiling.
          const ghost = await mintCustomer({ anonymous: true })
          const ctx = await personContext(browser, ghost.userUuid, marker)
          const res = await fbFn(ctx.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
          expect(res.error).toMatchObject({
            code: 'ANONYMOUS_NOT_ALLOWED',
            message: 'Anonymous interaction is not enabled',
          })
          expect(await votesOf(post.uuid)).toEqual([])
        })
      }
    )

    test(
      'FBP-V-12 an address with 50 anonymous sessions in the hour cannot vote anonymously',
      { tag: ['@nightly', '@isolated'] },
      async ({ browser, marker }) => {
        await withSettings(ANON_ON, async () => {
          const board = await createBoard(marker)
          const post = await seedPost(board, { title: `${marker} capped`, voteCount: 0 })
          const control = await seedPost(board, { title: `${marker} under cap`, voteCount: 0 })
          const capped = `${marker}-capped`
          const under = `${marker}-under`
          const ipCapped = ipOf(capped)
          const ipUnder = ipOf(under)
          await seedAnonSessions(ipCapped, 50)
          await seedAnonSessions(ipUnder, 48)

          const voter = await mintCustomer({ anonymous: true })
          const token = await sessionFor(voter.userUuid, ipCapped)
          const ctx = await contextFor(browser, ipCapped, token)
          const refused = await fbFn(
            ctx.request,
            'publicPosts',
            'toggleVoteFn',
            { postId: post.id },
            {
              ip: ipCapped,
            }
          )
          expect(refused.error).toMatchObject({ code: 'RATE_LIMITED' })
          expect(await votesOf(post.uuid)).toEqual([])

          // 49 sessions (48 + this one) is still under the cap.
          const ok = await mintCustomer({ anonymous: true })
          const okToken = await sessionFor(ok.userUuid, ipUnder)
          const okCtx = await contextFor(browser, ipUnder, okToken)
          const allowed = await fbFn(
            okCtx.request,
            'publicPosts',
            'toggleVoteFn',
            { postId: control.id },
            {
              ip: ipUnder,
            }
          )
          expect(allowed.error).toBeUndefined()
          expect(await votesOf(control.uuid)).toEqual([ok.principalUuid])
        })
      }
    )

    /**
     * An anonymous visitor's votes (seeded) move to the account they sign in
     * to through the widget identify merge (previousToken), the sign-in path
     * that needs no magic link.
     */
    async function signInOverAnonymousVotes(
      request: import('@playwright/test').APIRequestContext,
      marker: string
    ) {
      const board = await createBoard(marker)
      const only = await seedPost(board, { title: `${marker} only anon`, voteCount: 0 })
      const both = await seedPost(board, { title: `${marker} both voted`, voteCount: 0 })
      const email = `${marker}-known@customers.example`
      const known = await mintCustomer({ email, externalId: email })
      const anon = await mintCustomer({ anonymous: true })
      await seedVotes(only, [anon.principalUuid])
      await seedVotes(both, [anon.principalUuid, known.principalUuid])
      const anonToken = await mintSessionToken(anon.userUuid)
      const ssoToken = signSsoToken({ id: email, email }, await widgetSecret(request))
      const res = await request.post('/api/widget/identify', {
        headers: {
          authorization: `Bearer ${anonToken}`,
          'x-e2e-client-ip': ipFor(marker, 'identify'),
        },
        data: { ssoToken, previousToken: anonToken },
      })
      expect(res.status(), await res.text()).toBe(200)
      return { only, both, known, anon }
    }

    test(
      'FBP-V-14 votes carry over when a visitor signs in to an existing account; a collision keeps one vote',
      { tag: ['@nightly', '@isolated'] },
      async ({ request, marker }) => {
        await withSettings({ widget_config: { enabled: true } }, async () => {
          const { only, both, known, anon } = await signInOverAnonymousVotes(request, marker)
          expect(await votesOf(only.uuid)).toEqual([known.principalUuid])
          expect(await votesOf(both.uuid)).toEqual([known.principalUuid])
          expect((await postRow(only.uuid)).vote_count).toBe(1)
          const [gone] = await supportDb()`SELECT 1 FROM principal WHERE id = ${anon.principalUuid}`
          expect(gone).toBeUndefined()
        })
      }
    )

    test(
      'FBP-V-14 after a vote collision the post count equals its distinct voters',
      {
        tag: ['@nightly', '@isolated', '@quarantine'],
        annotation: {
          type: 'quarantine',
          description:
            'FBP-B15: principal-repoint drops the colliding anonymous vote but merge-anonymous never recounts posts.vote_count',
        },
      },
      async ({ request, marker }) => {
        await withSettings({ widget_config: { enabled: true } }, async () => {
          const { both } = await signInOverAnonymousVotes(request, marker)
          expect(await votesOf(both.uuid)).toHaveLength(1)
          expect((await postRow(both.uuid)).vote_count).toBe(1)
        })
      }
    )
  })
})

// ---------------------------------------------------------------------------
// Anonymous session plumbing for the rate-limit journey
// ---------------------------------------------------------------------------

function ipOf(salt: string): string {
  const h = Buffer.from(salt).reduce((a, b) => (a * 31 + b) >>> 0, 7)
  return `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${(h % 250) + 1}`
}

/** `count` anonymous sessions created from `ip` in the last hour. */
async function seedAnonSessions(ip: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const anon = await mintCustomer({ anonymous: true })
    await sessionFor(anon.userUuid, ip)
  }
}

/** A session row for a user, recorded as minted from `ip`. */
async function sessionFor(userUuid: string, ip: string): Promise<string> {
  const token = randomUUID().replace(/-/g, '')
  await supportDb()`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent,
      scope, user_id, ip_address)
    VALUES (${randomUUID()}, ${new Date(Date.now() + 86_400_000)}, ${token}, NOW(), NOW(), 'support-e2e',
      'portal', ${userUuid}, ${ip})`
  return token
}
