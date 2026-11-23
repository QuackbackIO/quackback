/**
 * Following a post: the subscription bell on the post page, the automatic
 * subscriptions, the gates on the subscription calls and merged families.
 *
 * Journeys: FBP-N-01, FBP-N-02, FBP-N-03, FBP-N-04
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  adminRest,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  restPost,
  seedPost,
  visitor,
} from '../../product/feedback-portal'
import {
  commentFn,
  mailFor,
  mailsFor,
  notificationsOf,
  setStatus,
  subscribe,
  subscriptionOf,
  subscriptionsOf,
} from '../../product/feedback-portal-notify'

test.describe('portal subscriptions', () => {
  test(
    'FBP-N-01 the post bell: status changes only, unsubscribe, all activity; the choice reads back on reload',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(postPath(post))
      const bell = (name: string) => page.getByRole('button', { name, exact: true })
      const pick = async (from: string, item: string | RegExp) => {
        await expect(async () => {
          await bell(from).click()
          await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 20_000 })
        await page.getByRole('menuitem', { name: item }).click()
      }

      await pick('Subscribe to notifications', /^Status changes/)
      await expect(bell('Subscribed to status changes only')).toBeVisible()
      await expect
        .poll(() => subscriptionOf(post.uuid, cass.principalUuid))
        .toEqual({ reason: 'manual', notify_comments: false, notify_status_changes: true })
      await page.reload()
      await expect(bell('Subscribed to status changes only')).toBeVisible()

      await pick('Subscribed to status changes only', /^Unsubscribe/)
      await expect(bell('Subscribe to notifications')).toBeVisible()
      await expect.poll(() => subscriptionOf(post.uuid, cass.principalUuid)).toBeNull()

      await pick('Subscribe to notifications', /^All activity/)
      await expect(bell('Subscribed to all activity')).toBeVisible()
      await expect
        .poll(() => subscriptionOf(post.uuid, cass.principalUuid))
        .toEqual({ reason: 'manual', notify_comments: true, notify_status_changes: true })
    }
  )

  test(
    'FBP-N-02 posting, commenting and voting subscribe the customer once, without asking',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const commented = await seedPost(board, { title: `${marker} commented` })
      const voted = await seedPost(board, { title: `${marker} voted` })
      const quiet = await seedPost(board, { title: `${marker} quiet` })
      const cass = await portalCustomer(browser, marker)

      const created = await fbFn<{ id: string }>(
        cass.request,
        'publicPosts',
        'createPublicPostFn',
        { boardId: board.id, title: `${marker} mine` }
      )
      expect(created.error).toBeUndefined()
      expect((await commentFn(cass.request, commented, `${marker} hello`)).error).toBeUndefined()
      expect(
        (await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: voted.id })).error
      ).toBeUndefined()
      const [mine] = await supportDb()`SELECT id FROM posts WHERE title = ${`${marker} mine`}`
      const all = { notify_comments: true, notify_status_changes: true }
      expect(await subscriptionOf(mine.id as string, cass.principalUuid)).toEqual({
        reason: 'author',
        ...all,
      })
      expect(await subscriptionOf(commented.uuid, cass.principalUuid)).toEqual({
        reason: 'comment',
        ...all,
      })
      expect(await subscriptionOf(voted.uuid, cass.principalUuid)).toEqual({
        reason: 'vote',
        ...all,
      })
      // Repeats never duplicate.
      expect((await commentFn(cass.request, commented, `${marker} again`)).error).toBeUndefined()
      expect(await subscriptionsOf(commented.uuid)).toHaveLength(1)

      // A status-only follower who later comments stays status-only.
      await subscribe(quiet.uuid, cass.principalUuid, { comments: false, status: true })
      expect((await commentFn(cass.request, quiet, `${marker} chiming in`)).error).toBeUndefined()
      expect(await subscriptionOf(quiet.uuid, cass.principalUuid)).toEqual({
        reason: 'manual',
        notify_comments: false,
        notify_status_changes: true,
      })
    }
  )

  test(
    'FBP-N-03 subscription calls need a session and a visible post, and never read another person',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const hidden = await createBoard(marker, { suffix: 'hidden', access: { view: 'team' } })
      const post = await seedPost(board, { title: `${marker} post` })
      const secret = await seedPost(hidden, { title: `${marker} secret` })
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })

      for (const name of [
        'subscribeToPostFn',
        'unsubscribeFromPostFn',
        'fetchSubscriptionStatus',
      ] as const) {
        const res = await fbFn(cass.request, 'subscriptions', name, { postId: secret.id })
        expect(res.error, name).toMatchObject({ code: 'POST_NOT_FOUND', statusCode: 404 })
      }
      const level = await fbFn(cass.request, 'subscriptions', 'updateSubscriptionLevelFn', {
        postId: secret.id,
        level: 'all',
      })
      expect(level.error).toMatchObject({ code: 'POST_NOT_FOUND' })
      expect(await subscriptionsOf(secret.uuid)).toHaveLength(0)

      // No session.
      const v = await visitor(browser, marker)
      const anon = await fbFn(v.request, 'subscriptions', 'subscribeToPostFn', { postId: post.id })
      expect(anon.error).toMatchObject({ message: 'Authentication required' })

      // Another person's subscription is not found, even when it exists.
      await subscribe(post.uuid, other.principalUuid)
      const peek = await fbFn(cass.request, 'portal', 'fetchSubscriptionStatus', {
        principalId: other.principalId,
        postId: post.id,
      })
      expect(peek.error).toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND', statusCode: 404 })
      // Their own reads fine.
      const own = await fbFn<{ level: string }>(cass.request, 'portal', 'fetchSubscriptionStatus', {
        principalId: cass.principalId,
        postId: post.id,
      })
      expect(own.value).toMatchObject({ level: 'none' })

      // The stored reason is the caller's choice.
      const chosen = await fbFn(cass.request, 'subscriptions', 'subscribeToPostFn', {
        postId: post.id,
        reason: 'vote',
        level: 'status_only',
      })
      expect(chosen.error).toBeUndefined()
      expect(await subscriptionOf(post.uuid, cass.principalUuid)).toEqual({
        reason: 'vote',
        notify_comments: false,
        notify_status_changes: true,
      })
    }
  )

  test(
    'FBP-N-04 a merged family notifies its follower once, and one unsubscribe leaves the family',
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const a = await seedPost(board, { title: `${marker} keeper` })
      const b = await seedPost(board, { title: `${marker} dup` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(a.uuid, cass.principalUuid)
      await subscribe(b.uuid, cass.principalUuid)
      const api = await adminRest(playwright, marker)
      await restPost(api, `/posts/${b.id}/merge`, { canonicalPostId: a.id })
      await setStatus(api, a, 'planned')

      await mailFor(cass.email, 'A post you follow is now Planned')
      await expect
        .poll(async () =>
          (await notificationsOf(cass.principalUuid)).filter(
            (n) => n.type === 'post_status_changed'
          )
        )
        .toHaveLength(1)
      expect(await mailsFor(cass.email, 'A post you follow is now')).toHaveLength(1)

      // The bell on the merged-away post reads the family level.
      const status = await fbFn<{ level: string }>(
        cass.request,
        'subscriptions',
        'fetchSubscriptionStatus',
        { postId: b.id }
      )
      expect(status.value).toMatchObject({ level: 'all' })
      const off = await fbFn(cass.request, 'subscriptions', 'unsubscribeFromPostFn', {
        postId: b.id,
      })
      expect(off.error).toBeUndefined()
      expect(await subscriptionOf(a.uuid, cass.principalUuid)).toBeNull()
      expect(await subscriptionOf(b.uuid, cass.principalUuid)).toBeNull()
    }
  )
})
