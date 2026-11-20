/**
 * In-app notifications for a customer: the rows status changes and comments
 * write, held comments, the preferences page, the header bell, the
 * notifications page, redaction, mark read and archive.
 *
 * Journeys: FBP-N-06, FBP-N-08, FBP-N-10, FBP-N-15, FBP-N-16, FBP-N-25,
 * FBP-N-26, FBP-N-27, FBP-N-28, FBP-N-29, FBP-N-30, FBP-N-31
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  adminRest,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  seedPost,
  visitor,
} from '../../product/feedback-portal'
import {
  approveComment,
  commentFn,
  eventHandled,
  mailFor,
  mailsFor,
  notificationsOf,
  seedNotification,
  setPreferences,
  setStatus,
  subscribe,
} from '../../product/feedback-portal-notify'

interface Listed {
  id: string
  type: string
  title: string
  body: string | null
  postId: string | null
  commentId: string | null
  readAt: string | null
  post: unknown
}
interface ListResult {
  notifications: Listed[]
  total: number
  unreadCount: number
  hasMore: boolean
}

function list(request: Parameters<typeof fbFn>[0], data: Record<string, unknown> = {}) {
  return fbFn<ListResult>(request, 'notifications', 'getNotificationsFn', data)
}

test.describe('portal notifications', () => {
  test(
    'FBP-N-06 a status change writes the subscriber an unread bell that links to the post',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await expect
        .poll(async () => (await notificationsOf(cass.principalUuid, post.uuid)).length)
        .toBe(1)
      const [row] = await notificationsOf(cass.principalUuid, post.uuid)
      expect(row).toMatchObject({
        type: 'post_status_changed',
        title: 'Status changed to Planned',
        read_at: null,
      })
      expect(row.body).toContain(post.title)
      expect(row.metadata).toMatchObject({
        postTitle: post.title,
        boardSlug: board.slug,
        previousStatus: 'Open',
        newStatus: 'Planned',
      })
      expect(String((row.metadata as { postUrl: string }).postUrl)).toMatch(
        new RegExp(`${postPath(post)}$`)
      )
      const listed = await list(cass.request)
      expect(listed.value?.notifications[0]).toMatchObject({
        type: 'post_status_changed',
        postId: post.id,
        readAt: null,
      })
      expect(listed.value?.unreadCount).toBe(1)
    }
  )

  test(
    'FBP-N-08 a new comment writes a bell titled by the commenter, anchored to the comment',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const dana = await portalCustomer(browser, marker, { suffix: 'dana', name: 'Dana Bell' })
      await subscribe(post.uuid, cass.principalUuid)
      const res = await commentFn(dana.request, post, `${marker} ding`)
      const commentId = res.value?.comment.id as string
      await expect
        .poll(async () => (await notificationsOf(cass.principalUuid, post.uuid)).length)
        .toBe(1)
      const [row] = await notificationsOf(cass.principalUuid, post.uuid)
      expect(row).toMatchObject({ type: 'comment_created', title: 'Dana Bell commented' })
      expect(String((row.metadata as { postUrl: string }).postUrl)).toMatch(
        new RegExp(`${postPath(post)}#comment-${commentId}$`)
      )
      const listed = await list(cass.request)
      expect(listed.value?.notifications[0]).toMatchObject({ commentId, postId: post.id })
      // The commenter gets none for her own comment.
      expect(await notificationsOf(dana.principalUuid, post.uuid)).toHaveLength(0)
    }
  )

  test(
    'FBP-N-10 a held comment sends nothing until a moderator approves it',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker, { access: { moderation: { comments: 'on' } } })
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const dana = await portalCustomer(browser, marker, { suffix: 'dana' })
      await subscribe(post.uuid, cass.principalUuid)
      const res = await commentFn(dana.request, post, `${marker} held`)
      const commentId = res.value?.comment.id as string
      // Control first: a held reject never notifies, an approval does. Nothing yet.
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM events
        WHERE type = 'comment.created' AND payload::text LIKE ${`%${commentId}%`}`
      expect(n).toBe(0)
      expect(await notificationsOf(cass.principalUuid, post.uuid)).toHaveLength(0)
      expect(await mailsFor(cass.email)).toHaveLength(0)

      await approveComment(await adminRest(playwright, marker), commentId)
      await mailFor(cass.email, `New comment on "${post.title}"`)
      await eventHandled(commentId, 'comment.created')
      expect((await notificationsOf(cass.principalUuid, post.uuid)).map((r) => r.type)).toEqual([
        'comment_created',
      ])
      expect(await notificationsOf(dana.principalUuid, post.uuid)).toHaveLength(0)
    }
  )

  test(
    'FBP-N-15 the preferences page saves Pause all email and a per-type email switch at once',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto('/settings/preferences')
      await expect(page.getByText("Choose what you're notified about and how")).toBeVisible()
      const pause = page.getByRole('switch', { name: 'Pause all email notifications' })
      await expect(async () => {
        await pause.click()
        await expect(pause).toBeChecked({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      const prefs = async () =>
        (
          await supportDb()`SELECT email_muted, matrix FROM notification_preferences
            WHERE principal_id = ${cass.principalUuid}`
        )[0]
      await expect.poll(async () => (await prefs())?.email_muted).toBe(true)

      const commentEmail = page.getByRole('switch', { name: 'New comment - Email' })
      await expect(commentEmail).toBeChecked()
      await commentEmail.click()
      await expect(commentEmail).not.toBeChecked()
      await expect.poll(async () => (await prefs())?.matrix?.comment_created?.email).toBe(false)

      await page.reload()
      await expect(
        page.getByRole('switch', { name: 'Pause all email notifications' })
      ).toBeChecked()
      await expect(page.getByRole('switch', { name: 'New comment - Email' })).not.toBeChecked()

      // Signed out: sent away from the page.
      const v = await visitor(browser, marker)
      await v.page.goto('/settings/preferences')
      await expect(v.page).not.toHaveURL(/\/settings\/preferences/)
    }
  )

  test(
    'FBP-N-16 turning off in-app status notices stops the bell but not the email',
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      const set = await setPreferences(cass.request, {
        matrix: { post_status_changed: { inApp: false } },
      })
      expect(set.error).toBeUndefined()
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await mailFor(cass.email, 'Your feedback is now Planned')
      await eventHandled(post.id, 'post.status_changed')
      expect(await notificationsOf(cass.principalUuid, post.uuid)).toHaveLength(0)
      expect((await list(cass.request)).value?.unreadCount).toBe(0)
    }
  )

  test(
    'FBP-N-25 the header bell shows the unread count, lists rows, marks all read and links to the page',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const cass = await portalCustomer(browser, marker)
      await seedNotification(cass.principalUuid, { title: `${marker} first bell` })
      await seedNotification(cass.principalUuid, { title: `${marker} second bell` })
      const page = cass.page
      await page.goto('/')
      const bell = page.getByRole('button', { name: 'Notifications (2 unread)' })
      await expect(bell).toBeVisible()
      await expect(async () => {
        await bell.click()
        await expect(page.getByText(`${marker} second bell`)).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await expect(page.getByText(`${marker} first bell`)).toBeVisible()
      await page.getByRole('button', { name: 'Mark all read' }).click()
      await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
      await expect
        .poll(async () =>
          (await notificationsOf(cass.principalUuid)).every((n) => n.read_at !== null)
        )
        .toBe(true)
      await page.getByRole('link', { name: 'View all' }).click()
      await expect(page).toHaveURL(/\/notifications/)

      // No bell for a signed-out visitor.
      const v = await visitor(browser, marker)
      await v.page.goto('/')
      await expect(v.page.getByRole('heading').first()).toBeVisible()
      await expect(v.page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0)
    }
  )

  test(
    'FBP-N-26 the notifications page: sign-in redirect, All and Unread tabs, day groups, Load more',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const v = await visitor(browser, marker)
      await v.page.goto('/notifications')
      await expect(v.page).toHaveURL(/auth=signin/)
      expect(decodeURIComponent(v.page.url())).toContain('callbackUrl=/notifications')

      const cass = await portalCustomer(browser, marker)
      const now = Date.now()
      // 31 earlier read rows, one unread today.
      for (let i = 0; i < 31; i++) {
        await seedNotification(cass.principalUuid, {
          title: `${marker} old ${i}`,
          createdAt: new Date(now - (3 + i / 100) * 86_400_000),
          readAt: new Date(),
        })
      }
      await seedNotification(cass.principalUuid, { title: `${marker} fresh` })
      const page = cass.page
      await page.goto('/notifications')
      await expect(page.getByText("Updates on posts you've subscribed to")).toBeVisible()
      await expect(page.getByText('Today', { exact: true })).toBeVisible()
      await expect(page.getByText('Earlier', { exact: true })).toBeVisible()
      await expect(page.getByText(`${marker} fresh`)).toBeVisible()
      // 30 a page: the oldest arrives with Load more.
      await expect(page.getByText(`${marker} old 30`, { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Load more' }).click()
      await expect(page.getByText(`${marker} old 30`, { exact: true })).toBeVisible()

      await page.getByRole('tab', { name: /Unread/ }).click()
      await expect(page).toHaveURL(/filter=unread/)
      await expect(page.getByText(`${marker} fresh`)).toBeVisible()
      await expect(page.getByText(`${marker} old 0`, { exact: true })).toHaveCount(0)
    }
  )

  test(
    'FBP-N-27 a bell about a post you can no longer see keeps its place but says nothing',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} soon gone` })
      const visible = await seedPost(board, { title: `${marker} still here` })
      const cass = await portalCustomer(browser, marker)
      await seedNotification(cass.principalUuid, {
        title: `Status changed to Planned`,
        body: `"${post.title}" moved from Open to Planned`,
        postUuid: post.uuid,
        metadata: { postTitle: post.title, boardSlug: board.slug },
      })
      await seedNotification(cass.principalUuid, {
        title: `Status changed to Planned`,
        body: `"${visible.title}" moved from Open to Planned`,
        postUuid: visible.uuid,
        metadata: { postTitle: visible.title, boardSlug: board.slug },
      })
      await supportDb()`UPDATE posts SET deleted_at = now() WHERE id = ${post.uuid}`
      const res = await list(cass.request)
      const rows = res.value?.notifications ?? []
      expect(rows).toHaveLength(2)
      const hidden = rows.find((r) => r.postId === post.id || r.title === 'Notification')
      expect(hidden).toMatchObject({
        title: 'Notification',
        body: 'This activity is no longer visible to you.',
      })
      expect(JSON.stringify(hidden)).not.toContain('soon gone')
      expect(JSON.stringify(rows)).toContain('still here')
      expect(res.value?.unreadCount).toBe(2)
    }
  )

  test(
    'FBP-N-28 opening a status notification marks it read and goes to the post',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} target post` })
      const cass = await portalCustomer(browser, marker)
      const n = await seedNotification(cass.principalUuid, {
        title: `${marker} open me`,
        body: `"${post.title}" moved from Open to Planned`,
        postUuid: post.uuid,
        metadata: { postTitle: post.title, boardSlug: board.slug },
      })
      await cass.page.goto('/notifications')
      const row = cass.page.getByText(`${marker} open me`)
      await expect(async () => {
        await row.click()
        await expect(cass.page).toHaveURL(new RegExp(postPath(post)), { timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await expect(cass.page.getByRole('heading', { level: 1, name: post.title })).toBeVisible()
      await expect
        .poll(
          async () =>
            (await supportDb()`SELECT read_at FROM in_app_notifications WHERE id = ${n.uuid}`)[0]
              .read_at
        )
        .not.toBeNull()
    }
  )

  test(
    'FBP-N-29 mark read and mark all read touch only your own unread, unarchived rows',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const a = await seedNotification(cass.principalUuid, { title: `${marker} a` })
      await seedNotification(cass.principalUuid, { title: `${marker} b` })
      const archived = await seedNotification(cass.principalUuid, {
        title: `${marker} archived`,
        archivedAt: new Date(),
      })
      const theirs = await seedNotification(other.principalUuid, { title: `${marker} theirs` })
      const mark = (id: string) =>
        fbFn(cass.request, 'notifications', 'markNotificationAsReadFn', { notificationId: id })

      expect((await mark(a.id)).error).toBeUndefined()
      expect((await mark(a.id)).error).toBeUndefined()
      expect((await mark(theirs.id)).error).toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' })
      const [t] =
        await supportDb()`SELECT read_at FROM in_app_notifications WHERE id = ${theirs.uuid}`
      expect(t.read_at).toBeNull()
      expect((await list(cass.request)).value?.unreadCount).toBe(1)

      expect(
        (await fbFn(cass.request, 'notifications', 'markAllNotificationsAsReadFn')).error
      ).toBeUndefined()
      const count = await fbFn<{ count: number }>(cass.request, 'notifications', 'getUnreadCountFn')
      expect(count.value?.count).toBe(0)
      const [arch] =
        await supportDb()`SELECT read_at FROM in_app_notifications WHERE id = ${archived.uuid}`
      expect(arch.read_at).toBeNull()
      expect((await list(other.request)).value?.unreadCount).toBe(1)
    }
  )

  test(
    'FBP-N-30 archive one row, then archive all read after confirming',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const one = await seedNotification(cass.principalUuid, { title: `${marker} archive me` })
      await seedNotification(cass.principalUuid, {
        title: `${marker} read one`,
        readAt: new Date(),
      })
      await seedNotification(cass.principalUuid, { title: `${marker} unread one` })
      const theirs = await seedNotification(other.principalUuid, { title: `${marker} theirs` })
      expect(
        (
          await fbFn(cass.request, 'notifications', 'archiveNotificationFn', {
            notificationId: theirs.id,
          })
        ).error
      ).toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' })

      const page = cass.page
      await page.goto('/notifications')
      const row = page.getByText(`${marker} archive me`)
      await expect(row).toBeVisible()
      // The archive button of that row only (a retry never reaches another row).
      const archive = page
        .locator('.group')
        .filter({ hasText: `${marker} archive me` })
        .getByRole('button', { name: 'Archive notification' })
      await expect(async () => {
        if ((await row.count()) > 0) {
          await row.hover()
          await archive.click({ timeout: 1_000 })
        }
        await expect(row).toHaveCount(0, { timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await expect
        .poll(
          async () =>
            (
              await supportDb()`SELECT archived_at FROM in_app_notifications WHERE id = ${one.uuid}`
            )[0].archived_at
        )
        .not.toBeNull()

      await page.getByRole('button', { name: 'More notification actions' }).click()
      await page.getByRole('menuitem', { name: 'Archive all read' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog.getByText('Archive all read notifications?')).toBeVisible()
      await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(page.getByText(`${marker} read one`)).toHaveCount(0)
      await expect(page.getByText(`${marker} unread one`)).toBeVisible()
      const archivedRows = async () =>
        (
          await supportDb()`SELECT title, archived_at IS NOT NULL AS archived
            FROM in_app_notifications WHERE principal_id = ${cass.principalUuid} ORDER BY title`
        ).map((r) => [r.title, r.archived])
      await expect.poll(archivedRows).toEqual([
        [`${marker} archive me`, true],
        [`${marker} read one`, true],
        [`${marker} unread one`, false],
      ])
    }
  )

  test(
    'FBP-N-31 the list pages by limit and offset, filters unread, and refuses out-of-range limits',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const cass = await portalCustomer(browser, marker)
      const now = Date.now()
      for (let i = 0; i < 45; i++) {
        await seedNotification(cass.principalUuid, {
          title: `${marker} n${i}`,
          createdAt: new Date(now - i * 60_000),
          readAt: i % 3 === 0 ? new Date() : null,
        })
      }
      const p1 = await list(cass.request, { limit: 30, offset: 0 })
      expect(p1.value).toMatchObject({ total: 45, unreadCount: 30, hasMore: true })
      expect(p1.value?.notifications).toHaveLength(30)
      expect(p1.value?.notifications[0].title).toBe(`${marker} n0`)
      const p2 = await list(cass.request, { limit: 30, offset: 30 })
      expect(p2.value).toMatchObject({ total: 45, hasMore: false })
      expect(p2.value?.notifications).toHaveLength(15)
      const unread = await list(cass.request, { unreadOnly: true, limit: 100 })
      expect(unread.value).toMatchObject({ total: 30, unreadCount: 30 })
      expect(unread.value?.notifications.every((n) => n.readAt === null)).toBe(true)
      const def = await list(cass.request)
      expect(def.value?.notifications).toHaveLength(20)
      for (const limit of [0, 101]) {
        const bad = await list(cass.request, { limit })
        expect(bad.value, String(limit)).toBeUndefined()
        expect(bad.error).toBeDefined()
      }
    }
  )
})
