/**
 * Feedback notifications as the team causes them: status, comment, mention
 * and owner bells and emails, preferences, unsubscribe links, redaction, and
 * the actions that must notify nobody.
 *
 * Every follower is a fresh customer or teammate, so the bells and emails
 * found by their principal or address belong to this test alone. Absences
 * are asserted only after every event about the post has been handled.
 *
 * Journeys: FBA-N-01 N-02 N-03 N-04 N-05 N-07 N-09 N-10 N-11 N-12 N-14 N-15
 * N-16 N-17 N-19 N-20 N-21 N-22 N-23
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { bellsFor, waitForBells } from '../../support/bells'
import { emailLogFor, getMailHeaders } from '../../support/mailpit'
import { mintCustomer } from '../../support/widget-portal'
import {
  customerPost,
  makeBoard,
  makePost,
  openPost,
  portalCustomer,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  allEventsHandled,
  anonymousVisitor,
  eventHandled,
  fn,
  followedPost,
  mailsWith,
  subscriptionsOf,
  unsubscribeLink,
  waitForMails,
} from '../../product/feedback-admin-notify'

/** The status email's subject to the post's author, and to everyone else who follows it. */
const STATUS_SUBJECT = 'Your feedback is now'
const FOLLOWER_STATUS_SUBJECT = 'A post you follow is now'

/** email_log rows of one type to an address. */
async function logged(address: string, type: string) {
  return (await emailLogFor(address)).filter((r) => r.email_type === type)
}

/** A fresh admin teammate and a request context signed in as them. */
async function teammateApi(
  newTeammate: (o: { roleKey: string; name?: string }) => Promise<{
    principalId: string
    email: string
    name: string
    api: (p: never) => Promise<APIRequestContext>
  }>,
  playwright: unknown,
  name?: string
) {
  const mate = await newTeammate({ roleKey: 'admin', name })
  const api = await mate.api(playwright as never)
  return { ...mate, api }
}

test(
  'FBA-N-01 a status change emails the author and the voter, never the teammate who made it',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await newTeammate({ roleKey: 'admin', name: `Actor ${marker}` })
    const actorApi = await actor.api(playwright)
    const fp = await followedPost(actorApi, browser, marker)
    try {
      // The teammate follows the post too (a commenter), yet is the actor.
      await fn(actorApi, 'createCommentFn', { postId: fp.postId, content: 'Looking into it' })
      await eventHandled(fp.postId, 'comment.created')

      const page = await actor.newPage(browser)
      await openPost(page, fp.postId, fp.title)
      const dialog = page.getByRole('dialog')
      // The sidebar's Status row (the comment box has its own status picker).
      const statusRow = dialog.getByText('Status', { exact: true }).locator('..')
      await statusRow.getByRole('button', { name: 'Open', exact: true }).click()
      await page.getByRole('button', { name: 'In Progress', exact: true }).click()
      await expect(
        statusRow.getByRole('button', { name: 'In Progress', exact: true })
      ).toBeVisible()
      await eventHandled(fp.postId, 'post.status_changed')

      // Only the author is told it is "your feedback"; the voter follows the post.
      for (const [follower, subject, prefix, reason] of [
        [
          fp.author,
          'Your feedback is now In Progress!',
          STATUS_SUBJECT,
          'You received this email because you submitted this feedback.',
        ],
        [
          fp.voter,
          'A post you follow is now In Progress',
          FOLLOWER_STATUS_SUBJECT,
          'You received this email because you follow this post.',
        ],
      ] as const) {
        const mails = await waitForMails(follower.email, prefix)
        expect(mails).toHaveLength(1)
        const [mail] = mails
        expect(mail.Subject).toBe(subject)
        expect(mail.Text).toContain(fp.title)
        expect(mail.Text).toContain('Open → In Progress')
        expect(mail.Text).toContain(`/b/${fp.board.slug}/posts/${fp.postId}`)
        expect(mail.Text).toContain(reason)
        expect(unsubscribeLink(mail)).toMatch(/\/unsubscribe\?token=[0-9a-f-]{36}$/)
        const headers = await getMailHeaders(mail.ID)
        expect(headers['List-Unsubscribe']?.[0]).toContain('/unsubscribe?token=')
        expect(await logged(follower.email, 'StatusChangeEmail')).toMatchObject([
          { status: 'sent', subject },
        ])
      }
      expect(await logged(actor.email, 'StatusChangeEmail')).toEqual([])
    } finally {
      await fp.close()
      await actorApi.dispose()
    }
  }
)

test(
  'FBA-N-02 a status change gives every follower but the actor a bell with the move and the link',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(actor.api, 'createCommentFn', { postId: fp.postId, content: 'On the list' })
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await eventHandled(fp.postId, 'post.status_changed')
      for (const follower of [fp.author, fp.voter]) {
        const bells = (await bellsFor(follower.principalId, fp.postId)).filter(
          (b) => b.type === 'post_status_changed'
        )
        expect(bells).toHaveLength(1)
        expect(bells[0]).toMatchObject({
          title: 'Status changed to Planned',
          body: `"${fp.title}" moved from Open to Planned`,
          metadata: {
            postTitle: fp.title,
            boardSlug: fp.board.slug,
            previousStatus: 'Open',
            newStatus: 'Planned',
          },
        })
        expect(String(bells[0].metadata?.postUrl)).toMatch(
          new RegExp(`/b/${fp.board.slug}/posts/${fp.postId}$`)
        )
      }
      const actorBells = await bellsFor(actor.principalId, fp.postId)
      expect(actorBells.filter((b) => b.type === 'post_status_changed')).toEqual([])
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-03 a team comment emails the followers who want comments, with a preview and a link to it',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    test.setTimeout(60_000)
    const actor = await newTeammate({ roleKey: 'admin', name: `Commenter ${marker}` })
    const actorApi = await actor.api(playwright)
    const fp = await followedPost(actorApi, browser, marker)
    try {
      // The voter only wants status changes.
      await fn(fp.voter.api, 'updateSubscriptionLevelFn', {
        postId: fp.postId,
        level: 'status_only',
      })
      const text = `${'We have shipped a first version of this. '.repeat(6)}END-OF-COMMENT`
      const page = await actor.newPage(browser)
      await openPost(page, fp.postId, fp.title)
      // The comment editor loads on first focus: click it, then type into
      // the real ProseMirror surface inside the comment form.
      const form = page
        .getByRole('dialog')
        .locator('form')
        .filter({ has: page.getByRole('button', { name: 'Comment', exact: true }) })
      await form.getByRole('textbox').first().click()
      const editor = form.locator('.ProseMirror[contenteditable="true"]')
      await expect(editor).toBeVisible()
      // The editor can still be initialising on the first keystrokes: refill
      // until it holds the whole text.
      await expect(async () => {
        await editor.fill(text)
        await expect(editor).toHaveText(text, { timeout: 1_000 })
      }).toPass({ timeout: 10_000 })
      await page.getByRole('dialog').getByRole('button', { name: 'Comment', exact: true }).click()
      await eventHandled(fp.postId, 'comment.created')

      const [comment] = await supportDb()`
        SELECT id FROM post_comments WHERE post_id = ${uuid(fp.postId)} ORDER BY created_at DESC LIMIT 1`
      const { fromUuid } = await import('@quackback/ids')
      const commentId = fromUuid('post_comment', String(comment.id))

      const [mail] = await waitForMails(fp.author.email, `New comment on "${fp.title}"`)
      expect(mail.Text).toContain(`${actor.name} (Team) commented on your feedback`)
      expect(mail.Text).toContain(text.slice(0, 150))
      expect(await commentContent(fp.postId)).toBe(text)
      expect(mail.Text).not.toContain('END-OF-COMMENT')
      expect(mail.Text).toContain(`/b/${fp.board.slug}/posts/${fp.postId}#comment-${commentId}`)
      expect(await logged(fp.author.email, 'NewCommentEmail')).toHaveLength(1)
      // Status-only follower and the commenter hear nothing.
      expect(await logged(fp.voter.email, 'NewCommentEmail')).toEqual([])
      expect(await logged(actor.email, 'NewCommentEmail')).toEqual([])
    } finally {
      await fp.close()
      await actorApi.dispose()
    }
  }
)

test(
  'FBA-N-04 a comment gives followers a bell naming the commenter, with a preview and the comment link',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright, `Team ${marker}`)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      const customerText = `${'x'.repeat(160)} tail`
      const { comment } = await fn<{ comment: { id: string } }>(fp.voter.api, 'createCommentFn', {
        postId: fp.postId,
        content: customerText,
      })
      const [bell] = await waitForBells(fp.author.principalId, fp.postId, (rows) =>
        rows.some((r) => r.type === 'comment_created')
      )
      expect(bell).toMatchObject({
        type: 'comment_created',
        title: `${fp.voter.name} commented`,
        body: `${customerText.slice(0, 147)}...`,
        metadata: { commenterName: fp.voter.name, isTeamMember: false },
      })
      const [row] = await supportDb()`SELECT comment_id FROM in_app_notifications
        WHERE principal_id = ${uuid(fp.author.principalId)} AND type = 'comment_created'`
      expect(row.comment_id).toBe(uuid(comment.id))

      await fn(actor.api, 'createCommentFn', { postId: fp.postId, content: 'Team answer' })
      const teamBells = await waitForBells(fp.author.principalId, fp.postId, (rows) =>
        rows.some((r) => r.type === 'comment_created' && r.body === 'Team answer')
      )
      const teamBell = teamBells.find((r) => r.body === 'Team answer')!
      expect(teamBell.title).toBe(`${actor.name} (team) commented`)
      expect(teamBell.metadata).toMatchObject({ commenterName: actor.name, isTeamMember: true })
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-05 a private comment reaches teammates who follow the post and no customer',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const writer = await teammateApi(newTeammate, playwright)
    const follower = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(writer.api, browser, marker)
    try {
      await fn(follower.api, 'subscribeToPostFn', { postId: fp.postId })
      await fn(writer.api, 'createCommentFn', {
        postId: fp.postId,
        content: `${marker} internal note`,
        isPrivate: true,
      })
      await eventHandled(fp.postId, 'comment.created')
      const bells = await waitForBells(follower.principalId, fp.postId, (r) => r.length > 0)
      expect(bells.map((b) => b.type)).toEqual(['comment_created'])
      await waitForMails(follower.email, `New comment on "${fp.title}"`)
      for (const customer of [fp.author, fp.voter]) {
        expect(await bellsFor(customer.principalId, fp.postId)).toEqual([])
        expect(await logged(customer.email, 'NewCommentEmail')).toEqual([])
      }
      expect(await bellsFor(writer.principalId, fp.postId)).toEqual([])
    } finally {
      await fp.close()
      await writer.api.dispose()
      await follower.api.dispose()
    }
  }
)

test(
  'FBA-N-07 pause-all stops email but not bells; a matrix switch stops only its own channel',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    const author = fp.author
    const change = async (slug: string) => {
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug(slug),
      })
      await allEventsHandled(fp.postId)
    }
    const statusBells = async () =>
      (await bellsFor(author.principalId, fp.postId)).filter(
        (b) => b.type === 'post_status_changed'
      ).length
    const statusMails = async () => (await logged(author.email, 'StatusChangeEmail')).length
    try {
      await fn(author.api, 'updateNotificationPreferencesFn', { emailMuted: true })
      await change('under_review')
      expect([await statusBells(), await statusMails()]).toEqual([1, 0])

      await fn(author.api, 'updateNotificationPreferencesFn', {
        emailMuted: false,
        matrix: { post_status_changed: { inApp: true, email: false } },
      })
      await change('planned')
      expect([await statusBells(), await statusMails()]).toEqual([2, 0])

      await fn(author.api, 'updateNotificationPreferencesFn', {
        matrix: { post_status_changed: { inApp: false, email: true } },
      })
      await change('in_progress')
      expect([await statusBells(), await statusMails()]).toEqual([2, 1])

      // The voter never touched their preferences: defaults are all on.
      expect(await logged(fp.voter.email, 'StatusChangeEmail')).toHaveLength(3)
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-09 a follower with only a placeholder address gets the bell and no email',
  { tag: '@nightly' },
  async ({ playwright, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const board = await makeBoard(actor.api, marker)
    const post = await makePost(actor.api, { boardId: board.id, title: `${marker} anon vote` })
    const visitor = await anonymousVisitor()
    try {
      await fn(actor.api, 'proxyVoteFn', { postId: post.id, voterPrincipalId: visitor.principalId })
      expect((await subscriptionsOf(post.id)).map((s) => s.principal_id)).toContain(
        visitor.principalUuid
      )
      await fn(actor.api, 'changePostStatusFn', {
        id: post.id,
        statusId: await statusIdBySlug('planned'),
      })
      await eventHandled(post.id, 'post.status_changed')
      const bells = await bellsFor(visitor.principalId, post.id)
      expect(bells.map((b) => b.type)).toEqual(['post_status_changed'])
      expect(await emailLogFor(visitor.email)).toEqual([])
    } finally {
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-10 once the board is restricted or deleted, customers who follow hear nothing more',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const teamFollower = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(teamFollower.api, 'subscribeToPostFn', { postId: fp.postId })
      const teamOnly = await makeBoard(actor.api, `${marker}-private`, { preset: 'private' })
      const [{ access }] =
        await supportDb()`SELECT access FROM boards WHERE id = ${uuid(teamOnly.id)}`
      await fn(actor.api, 'updateBoardAccessFn', { boardId: fp.board.id, access })

      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await eventHandled(fp.postId, 'post.status_changed')
      // The teammate can still see the post and is told; the customers are not.
      await waitForBells(teamFollower.principalId, fp.postId, (r) => r.length === 1)
      for (const customer of [fp.author, fp.voter]) {
        expect(await bellsFor(customer.principalId, fp.postId)).toEqual([])
        expect(await logged(customer.email, 'StatusChangeEmail')).toEqual([])
      }

      await fn(actor.api, 'deleteBoardFn', { id: fp.board.id })
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('in_progress'),
      }).catch(() => undefined)
      await allEventsHandled(fp.postId)
      expect(await bellsFor(teamFollower.principalId, fp.postId)).toHaveLength(1)
      expect(await logged(teamFollower.email, 'StatusChangeEmail')).toHaveLength(1)
    } finally {
      await fp.close()
      await actor.api.dispose()
      await teamFollower.api.dispose()
    }
  }
)

test(
  'FBA-N-11 assigning an owner gives only the new owner a bell, and no email',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const assigner = await teammateApi(newTeammate, playwright)
    const ownerB = await teammateApi(newTeammate, playwright)
    const ownerC = await teammateApi(newTeammate, playwright)
    const board = await makeBoard(assigner.api, marker)
    const post = await makePost(assigner.api, { boardId: board.id, title: `${marker} owned` })
    const ownerBells = async (who: { principalId: string }) =>
      (await bellsFor(who.principalId, post.id)).filter((b) => b.type === 'post_owner_assigned')
    try {
      await fn(assigner.api, 'setPostOwnerFn', { id: post.id, ownerId: ownerB.principalId })
      const [bell] = await waitForBells(ownerB.principalId, post.id, (r) => r.length > 0)
      expect(bell).toMatchObject({ type: 'post_owner_assigned', title: 'You were assigned a post' })

      // Self-assignment: the event fires, nobody gets a bell.
      await fn(assigner.api, 'setPostOwnerFn', { id: post.id, ownerId: assigner.principalId })
      await allEventsHandled(post.id)
      await expect
        .poll(async () => {
          const rows = await supportDb()`SELECT 1 FROM events
            WHERE type = 'post.owner_assigned' AND payload::text LIKE ${`%${post.id}%`}
              AND payload::text LIKE ${`%"ownerPrincipalId": "${assigner.principalId}"%`}`
          return rows.length
        })
        .toBe(1)
      await allEventsHandled(post.id)
      expect(await ownerBells(assigner)).toEqual([])

      await fn(assigner.api, 'setPostOwnerFn', { id: post.id, ownerId: ownerC.principalId })
      await waitForBells(ownerC.principalId, post.id, (r) => r.length === 1)
      await allEventsHandled(post.id)
      expect(await ownerBells(ownerB)).toHaveLength(1)
      for (const who of [ownerB, ownerC, assigner]) {
        expect(await emailLogFor(who.email)).toEqual([])
      }
    } finally {
      for (const a of [assigner, ownerB, ownerC]) await a.api.dispose()
    }
  }
)

/** Tiptap content mentioning each principal by id. */
function mentionDoc(text: string, mentions: Array<{ id: string; label: string }>) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${text} ` },
          ...mentions.flatMap((m) => [
            { type: 'mention', attrs: { id: m.id, label: m.label } },
            { type: 'text', text: ' ' },
          ]),
        ],
      },
    ],
  }
}

test(
  'FBA-N-12 a mention in a post tells the people mentioned who can see it, never the author',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const author = await teammateApi(newTeammate, playwright, `Mentioner ${marker}`)
    const mate = await teammateApi(newTeammate, playwright)
    const customer = await mintCustomer({ email: `${marker}-m@customers.example` })
    const visitor = await anonymousVisitor()
    const board = await makeBoard(author.api, marker)
    const title = `${marker} mentions`
    const people = [
      { id: customer.principalId, label: customer.name },
      { id: mate.principalId, label: mate.name },
      { id: visitor.principalId, label: 'Visitor' },
      { id: author.principalId, label: author.name },
    ]
    const doc = mentionDoc('Please look', people)
    try {
      const post = await fn<{ id: string }>(author.api, 'createPostFn', {
        boardId: board.id,
        title,
        content: 'Please look',
        contentJson: doc,
      })
      const [mail] = await waitForMails(customer.email, `mentioned you in "${title}"`)
      expect(mail.Subject).toBe(`${author.name} mentioned you in "${title}"`)
      expect(mail.Text).toContain('View feedback')
      for (const who of [customer, mate]) {
        const [bell] = await waitForBells(who.principalId, undefined, (rows) =>
          rows.some((r) => r.type === 'post_mentioned' && r.body === title)
        )
        expect(bell).toMatchObject({ title: `${author.name} mentioned you in a post` })
      }
      await allEventsHandled(post.id)
      expect(await logged(mate.email, 'PostMentionEmail')).toHaveLength(1)
      expect(await bellsFor(visitor.principalId)).toEqual([])
      expect(await bellsFor(author.principalId)).toEqual([])
      expect(await emailLogFor(author.email)).toEqual([])

      // On a team-only board the customer cannot see the post: nothing.
      const hidden = await makeBoard(author.api, `${marker}-team`, { preset: 'private' })
      const hiddenPost = await fn<{ id: string }>(author.api, 'createPostFn', {
        boardId: hidden.id,
        title: `${marker} hidden mention`,
        content: 'Psst',
        contentJson: mentionDoc('Psst', [people[0]]),
      })
      await allEventsHandled(hiddenPost.id)
      expect(
        (await bellsFor(customer.principalId)).filter((b) => b.body === `${marker} hidden mention`)
      ).toEqual([])
      expect(await mailsWith(customer.email, 'hidden mention')).toEqual([])
    } finally {
      await author.api.dispose()
      await mate.api.dispose()
    }
  }
)

test(
  'FBA-N-14 the notifications page lists feedback bells, marks read on click, and archives read ones',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const watcher = await newTeammate({ roleKey: 'admin' })
    const watcherApi = await watcher.api(playwright)
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(watcherApi, 'subscribeToPostFn', { postId: fp.postId })
      for (const n of [1, 2, 3]) {
        await fn(fp.voter.api, 'createCommentFn', { postId: fp.postId, content: `${marker} c${n}` })
      }
      await waitForBells(watcher.principalId, fp.postId, (r) => r.length === 3)

      const page = await watcher.newPage(browser)
      await page.goto('/admin/notifications')
      await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
      const rows = page.getByRole('link').filter({ hasText: `${marker} followed idea` })
      await expect(rows).toHaveCount(3)
      // Newest first.
      await expect(rows.first()).toContainText(`${marker} c3`)
      await expect(page.getByRole('tab', { name: /Unread\s*3/ })).toBeVisible()

      await rows.filter({ hasText: `${marker} c1 ·` }).click()
      await expect(page).toHaveURL(new RegExp(`${fp.postId}`))
      await expect
        .poll(
          async () =>
            (await bellsFor(watcher.principalId, fp.postId)).filter((b) => b.read_at).length,
          { timeout: 15_000 }
        )
        .toBe(1)

      await page.goto('/admin/notifications')
      await page.getByRole('button', { name: 'Mark all as read' }).click()
      await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
      await page.getByRole('tab', { name: 'Unread' }).click()
      await expect(page.getByText('No unread notifications.')).toBeVisible()

      await page.getByRole('tab', { name: 'All' }).click()
      await page.getByRole('button', { name: 'More notification actions' }).click()
      await page.getByRole('menuitem', { name: 'Archive all read' }).click()
      await expect(page.getByText('Archive all read notifications?')).toBeVisible()
      await page.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(page.getByText('No notifications yet')).toBeVisible()
      await expect
        .poll(async () =>
          (await bellsFor(watcher.principalId, fp.postId)).filter((b) => b.archived_at === null)
        )
        .toEqual([])
    } finally {
      await fp.close()
      await watcherApi.dispose()
      await actor.api.dispose()
    }
  }
)

interface NotificationsPage {
  notifications: Array<{
    title: string
    body: string | null
    postId: string | null
    post: unknown
    params: unknown
  }>
  unreadCount: number
}

test(
  'FBA-N-15 a bell about a deleted post is redacted, and readable again once restored',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    const mine = async () =>
      (
        await fn<NotificationsPage>(fp.author.api, 'getNotificationsFn', {}, { method: 'GET' })
      ).notifications.filter((n) => n.postId === fp.postId)
    try {
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await waitForBells(fp.author.principalId, fp.postId, (r) => r.length === 1)
      expect(await mine()).toMatchObject([
        { title: 'Status changed to Planned', post: { id: fp.postId } },
      ])

      await fn(actor.api, 'deletePostFn', { id: fp.postId })
      expect(await mine()).toMatchObject([
        { title: 'Notification', body: 'This activity is no longer visible to you.', post: null },
      ])

      await fn(actor.api, 'restorePostFn', { id: fp.postId })
      expect(await mine()).toMatchObject([
        { title: 'Status changed to Planned', post: { id: fp.postId } },
      ])
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-15 the unread badge leaves out bells redacted because the post was deleted',
  {
    tag: '@core',
  },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await waitForBells(fp.author.principalId, fp.postId, (r) => r.length === 1)
      // Before: the author's only bell is unread, and both counts say 1.
      const before = await fn<{ count: number }>(fp.author.api, 'getUnreadCountFn', undefined, {
        method: 'GET',
      })
      expect(before.count).toBe(1)

      await fn(actor.api, 'deletePostFn', { id: fp.postId })
      const after = await fn<{ count: number }>(fp.author.api, 'getUnreadCountFn', undefined, {
        method: 'GET',
      })
      expect(after.count).toBe(0)
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-16 Settings > Notifications shows the feedback rows and saves a switch',
  { tag: '@core' },
  async ({ browser, newTeammate }) => {
    const mate = await newTeammate({ roleKey: 'admin' })
    const page = await mate.newPage(browser)
    await page.goto('/admin/settings/notifications')
    await expect(page.getByRole('tab', { name: 'Feedback' })).toBeVisible()
    for (const label of [
      'Status changed',
      'New comment',
      'Mentioned in a post',
      'Mentioned in a comment',
      'Post assigned',
    ]) {
      await expect(page.getByRole('switch', { name: `${label} - In-app` })).toBeVisible()
      await expect(page.getByRole('switch', { name: `${label} - Email` })).toBeVisible()
    }
    const statusEmail = page.getByRole('switch', { name: 'Status changed - Email' })
    await expect(statusEmail).toBeChecked()
    await statusEmail.click()
    await expect
      .poll(
        async () => {
          const [row] = await supportDb()`SELECT matrix FROM notification_preferences
          WHERE principal_id = ${uuid(mate.principalId)}`
          return (row?.matrix as Record<string, Record<string, boolean>> | undefined)
            ?.post_status_changed?.email
        },
        { timeout: 15_000 }
      )
      .toBe(false)
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Status changed - Email' })).not.toBeChecked()

    await page.getByRole('switch', { name: 'Pause all email notifications' }).click()
    await expect
      .poll(
        async () => {
          const [row] = await supportDb()`SELECT email_muted FROM notification_preferences
          WHERE principal_id = ${uuid(mate.principalId)}`
          return row?.email_muted
        },
        { timeout: 15_000 }
      )
      .toBe(true)
  }
)

test(
  'FBA-N-17 each follower gets their own unsubscribe link; preview changes nothing, confirming unsubscribes once',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    const visitorApi = await personApiAnon(playwright)
    try {
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      const [authorMail] = await waitForMails(fp.author.email, STATUS_SUBJECT)
      const [voterMail] = await waitForMails(fp.voter.email, FOLLOWER_STATUS_SUBJECT)
      const tokenOf = (link: string) => new URL(link).searchParams.get('token')!
      const authorToken = tokenOf(unsubscribeLink(authorMail))
      expect(authorToken).not.toBe(tokenOf(unsubscribeLink(voterMail)))
      const [row] = await supportDb()`SELECT action, expires_at, used_at FROM unsubscribe_tokens
        WHERE token = ${authorToken}`
      expect(row.action).toBe('unsubscribe_post')
      const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29)
      expect(days).toBeLessThanOrEqual(30)

      const preview = await callServerFn(
        visitorApi,
        'previewUnsubscribeTokenFn',
        { token: authorToken },
        { method: 'GET' }
      )
      expect(preview.data).toMatchObject({ status: 'confirm', action: 'unsubscribe_post' })
      expect((await subscriptionsOf(fp.postId)).map((s) => s.principal_id)).toContain(
        fp.author.principalUuid
      )

      const done = await fn<{ success: boolean }>(visitorApi, 'processUnsubscribeTokenFn', {
        token: authorToken,
      })
      expect(done.success).toBe(true)
      const left = (await subscriptionsOf(fp.postId)).map((s) => s.principal_id)
      expect(left).not.toContain(fp.author.principalUuid)
      expect(left).toContain(fp.voter.principalUuid)

      const again = await fn<{ success: boolean; error?: string }>(
        visitorApi,
        'processUnsubscribeTokenFn',
        { token: authorToken }
      )
      expect(again).toMatchObject({ success: false, error: 'used' })
      const [spent] =
        await supportDb()`SELECT used_at FROM unsubscribe_tokens WHERE token = ${authorToken}`
      expect(spent.used_at).not.toBeNull()

      // The next status change reaches the voter only.
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('in_progress'),
      })
      await eventHandled(fp.postId, 'post.status_changed')
      await waitForMails(fp.voter.email, FOLLOWER_STATUS_SUBJECT, 2)
      expect(await logged(fp.author.email, 'StatusChangeEmail')).toHaveLength(1)
    } finally {
      await fp.close()
      await actor.api.dispose()
      await visitorApi.dispose()
    }
  }
)

/** A signed-out request context (unsubscribe links are opened from a mail client). */
async function personApiAnon(playwright: {
  request: { newContext: (o: object) => Promise<APIRequestContext> }
}) {
  const { supportEnv } = await import('../../support/env')
  return playwright.request.newContext({ baseURL: supportEnv().baseUrl })
}

test(
  'FBA-N-19 Comment & mark sends a comment mail and a status mail, never one combined',
  { tag: '@nightly' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(actor.api, 'createCommentFn', {
        postId: fp.postId,
        content: 'Shipping it',
        statusId: await statusIdBySlug('complete'),
      })
      await eventHandled(fp.postId, 'post.status_changed')
      await allEventsHandled(fp.postId)
      const types = await eventTypesAboutPost(fp.postId)
      expect(types.indexOf('comment.created')).toBeLessThan(types.indexOf('post.status_changed'))
      expect((await logged(fp.author.email, 'NewCommentEmail')).length).toBe(1)
      expect((await logged(fp.author.email, 'StatusChangeEmail')).length).toBe(1)
      const bells = await bellsFor(fp.author.principalId, fp.postId)
      expect(bells.map((b) => b.type).sort()).toEqual(['comment_created', 'post_status_changed'])
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

async function eventTypesAboutPost(postId: string): Promise<string[]> {
  const rows = await supportDb()<{ type: string }[]>`
    SELECT type FROM events WHERE payload::text LIKE ${`%${postId}%`} ORDER BY id`
  return rows.map((r) => r.type)
}

test(
  'FBA-N-20 a voter whose vote a teammate removed still hears about status changes',
  { tag: '@nightly' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await fn(actor.api, 'removeVoteFn', {
        postId: fp.postId,
        voterPrincipalId: fp.voter.principalId,
      })
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM post_votes
        WHERE post_id = ${uuid(fp.postId)} AND principal_id = ${fp.voter.principalUuid}`
      expect(n).toBe(0)
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await waitForMails(fp.voter.email, FOLLOWER_STATUS_SUBJECT)
      await waitForBells(fp.voter.principalId, fp.postId, (r) => r.length === 1)
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-21 merge, board move, ETA, tags and lock notify no follower; a status change does',
  { tag: '@nightly' },
  async ({ playwright, browser, marker, newTeammate }) => {
    test.setTimeout(60_000)
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      const other = await makeBoard(actor.api, `${marker}-other`)
      const canonical = await makePost(actor.api, {
        boardId: other.id,
        title: `${marker} canonical`,
      })
      const dup = await customerPost(fp.author, { boardId: fp.board.id, title: `${marker} dup` })
      await fn(actor.api, 'changePostBoardFn', { id: fp.postId, boardId: other.id })
      await fn(actor.api, 'setPostEtaFn', { id: fp.postId, eta: '2027-03-01T00:00:00.000Z' })
      const tagRes = await callServerFn<{ id: string }>(actor.api, 'createPostTagFn', {
        name: `${marker}-tag`,
        color: '#123456',
      })
      await fn(actor.api, 'updatePostTagsFn', { id: fp.postId, tagIds: [tagRes.data.id] })
      await fn(actor.api, 'toggleCommentsLockFn', { id: fp.postId, locked: true })
      await fn(actor.api, 'mergePostFn', { duplicatePostId: dup.id, canonicalPostId: canonical.id })
      await fn(actor.api, 'unmergePostFn', { postId: dup.id })
      await allEventsHandled(fp.postId)
      await allEventsHandled(dup.id)
      for (const customer of [fp.author, fp.voter]) {
        expect(await bellsFor(customer.principalId)).toEqual([])
        expect(await emailLogFor(customer.email)).toEqual([])
      }

      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await waitForBells(fp.voter.principalId, fp.postId, (r) => r.length === 1)
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  "FBA-N-22 a test customer's post notifies none of its followers",
  { tag: '@nightly' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const actor = await teammateApi(newTeammate, playwright)
    const fp = await followedPost(actor.api, browser, marker)
    try {
      await supportDb()`UPDATE principal SET test_owner_principal_id = ${uuid(actor.principalId)}
        WHERE id = ${fp.author.principalUuid}`
      // A control post the voter also follows, changed afterwards: once its
      // bell lands, the earlier event about the test post has had its turn.
      const control = await makePost(actor.api, {
        boardId: fp.board.id,
        title: `${marker} control`,
      })
      await fn(fp.voter.api, 'toggleVoteFn', { postId: control.id })
      await fn(actor.api, 'changePostStatusFn', {
        id: fp.postId,
        statusId: await statusIdBySlug('planned'),
      })
      await fn(actor.api, 'changePostStatusFn', {
        id: control.id,
        statusId: await statusIdBySlug('planned'),
      })
      await waitForBells(fp.voter.principalId, control.id, (r) => r.length === 1)
      await waitForMails(fp.voter.email, FOLLOWER_STATUS_SUBJECT)
      await allEventsHandled(control.id)
      // The only status mail the voter got is the control's.
      expect(await logged(fp.voter.email, 'StatusChangeEmail')).toHaveLength(1)
      expect(await bellsFor(fp.voter.principalId, fp.postId)).toEqual([])
      expect(await bellsFor(fp.author.principalId)).toEqual([])
      expect(await emailLogFor(fp.author.email)).toEqual([])
    } finally {
      await fp.close()
      await actor.api.dispose()
    }
  }
)

test(
  'FBA-N-23 a customer post and a customer vote notify no teammate',
  { tag: '@core' },
  async ({ playwright, browser, marker, newTeammate }) => {
    const owner = await teammateApi(newTeammate, playwright)
    const board = await makeBoard(owner.api, marker)
    const author = await portalCustomer(browser, `${marker}-a`)
    const voter = await portalCustomer(browser, `${marker}-v`)
    try {
      // A teammate who follows a post hears about comments and status, not votes.
      const teamPost = await makePost(owner.api, {
        boardId: board.id,
        title: `${marker} team post`,
      })
      const post = await customerPost(author, { boardId: board.id, title: `${marker} new idea` })
      await fn(voter.api, 'toggleVoteFn', { postId: post.id })
      await fn(voter.api, 'toggleVoteFn', { postId: teamPost.id })
      await allEventsHandled(post.id)
      await allEventsHandled(teamPost.id)
      expect(await eventTypesAboutPost(post.id)).toEqual(
        expect.arrayContaining(['post.created', 'post.voted'])
      )
      for (const id of [post.id, teamPost.id]) {
        const bells = await supportDb()`SELECT principal_id FROM in_app_notifications
          WHERE post_id = ${uuid(id)}`
        expect(bells).toEqual([])
      }
      expect(await emailLogFor(owner.email)).toEqual([])
    } finally {
      await author.close()
      await voter.close()
      await owner.api.dispose()
    }
  }
)

async function commentContent(postId: string): Promise<string> {
  const [row] = await supportDb()`SELECT content FROM post_comments
    WHERE post_id = ${uuid(postId)} ORDER BY created_at DESC LIMIT 1`
  return String(row?.content ?? '')
}
