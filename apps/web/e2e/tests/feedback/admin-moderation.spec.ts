/**
 * Moderation from the team side: held posts and comments, the queue, approve
 * and reject, board overrides, the workspace policy and the counts.
 *
 * Shared tests hold content with their own board's moderation override; the
 * workspace-wide switches are `@isolated`.
 *
 * Journeys: FBA-Q-05, FBA-I-23, FBA-P-38, FBA-Q-03, FBA-Q-04, FBA-Q-06, FBA-Q-07, FBA-Q-09,
 * FBA-Q-10, FBA-Q-11, FBA-Q-15, FBA-Q-14, FBA-Q-08; isolated: FBA-Q-01, FBA-Q-02, FBA-Q-13
 */
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { bellsFor, waitForEventHandled } from '../../support/bells'
import { fakeAi } from '../../support/fake-ai-client'
import { emailLogFor, mailTo, waitForEmailLog, waitForMail } from '../../support/mailpit'
import { deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import {
  inboxTitles,
  makeBoard,
  makePost,
  openInbox,
  openPost,
  portalCustomer,
  postRow,
  uuid,
} from '../../product/feedback-admin'
import {
  auditActions,
  comment,
  commentRow,
  decide,
  heldPost,
  queueRow,
  setBoardModeration,
  vote,
} from '../../product/feedback-admin-merge'
import { sink } from '../../support/webhook-sink-client'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { waitForHydration } from '../../utils/helpers'

test(
  'FBA-Q-05 approving a held post publishes it and only then announces it',
  { tag: '@smoke' },
  async ({ playwright, browser, baseURL, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.created'])
    const customer = await portalCustomer(browser, marker, { name: `Held ${marker}` })
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} held idea`
      const postId = await heldPost(api, customer, board.id, title, `Body of ${marker}`)
      expect((await postRow(postId))?.moderation_state).toBe('pending')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.held')

      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      const row = queueRow(admin, title)
      await expect(row).toContainText(`by Held ${marker} in ${board.name}`)
      // Nothing announced while held: no webhook, and none of the post.created AI
      // hooks (the embedding). The hourly summary sweep is not a post.created
      // hook and does pick up held posts, so chat requests are not asserted here.
      expect((await sink.deliveries(marker)).filter((d) => d.body.includes(postId))).toEqual([])
      expect(await fakeAi.requests({ contains: title, endpoint: 'embeddings' })).toEqual([])

      await decide(row, 'Approve')
      await expect(row).toHaveCount(0)
      expect((await postRow(postId))?.moderation_state).toBe('published')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.approved')
      await deliveriesOf(marker, 'post.created', postId)
      await fakeAi.waitForRequests({ contains: title, endpoint: 'embeddings' })
      // The author is told the decision once: one email and one bell, nothing more.
      await waitForEmailLog(customer.email, { email_type: 'ModerationDecisionEmail' })
      await waitForEventHandled(postId, { type: 'post.approved' })
      await waitForEventHandled(postId, { type: 'post.created' })
      expect(
        (await emailLogFor(customer.email)).map((r) => [r.email_type, r.subject, r.status])
      ).toEqual([['ModerationDecisionEmail', 'Your post is now public', 'sent']])
      expect(
        (await bellsFor(customer.principalId, postId)).map((b) => [b.type, b.title, b.body])
      ).toEqual([['post_moderated', 'Your post is now public', title]])
    } finally {
      await unsubscribe(hooks, hook)
      await customer.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)

test(
  'FBA-I-23 a held post is listed in the inbox for the team, under a pending banner',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} waiting idea`
      await heldPost(api, customer, board.id, title)
      const admin = await asPerson('admin')
      await openInbox(admin, { board: [board.id] })
      await expect.poll(() => inboxTitles(admin, marker)).toEqual([title])
      await expect(admin.getByText(/\d+ (item is|items are) pending moderation/)).toBeVisible()
      await expect(admin.getByRole('link', { name: /Review/ })).toHaveAttribute(
        'href',
        '/admin/feedback/moderation'
      )
      await expect(admin.getByRole('link', { name: /Feedback/ }).first()).toContainText(
        /\d+ waiting for review/
      )
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-P-38 the post modal approves or rejects a held post from its banner',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const kept = await heldPost(api, customer, board.id, `${marker} keep me`)
      const dropped = await heldPost(api, customer, board.id, `${marker} drop me`)
      const admin = await asPerson('admin')

      await openPost(admin, kept, `${marker} keep me`)
      const dialog = admin.getByRole('dialog')
      await expect(dialog.getByText('Pending approval')).toBeVisible()
      await decide(dialog, 'Approve')
      await expect(admin.getByText('Post approved')).toBeVisible()
      await expect.poll(async () => (await postRow(kept))?.moderation_state).toBe('published')

      await openPost(admin, dropped, `${marker} drop me`)
      await decide(dialog, 'Reject')
      await expect(admin.getByText('Post rejected')).toBeVisible()
      await expect.poll(async () => (await postRow(dropped))?.deleted_at).toBeTruthy()
      // Still pending underneath (reject is a soft delete), but no banner any more.
      await openPost(admin, dropped)
      expect((await postRow(dropped))?.moderation_state).toBe('pending')
      await expect(dialog.getByText('Pending approval')).toHaveCount(0)

      // The author hears each decision once: one email and one bell apiece.
      // A rejected post is gone, so its bell carries no link to it.
      await waitForEventHandled(kept, { type: 'post.approved' })
      await waitForEventHandled(dropped, { type: 'post.rejected' })
      await expect
        .poll(async () => (await mailTo(customer.email)).map((m) => m.Subject).sort())
        .toEqual(['Your post is now public', 'Your post was not published'])
      const bells = await bellsFor(customer.principalId)
      expect(bells.map((b) => [b.type, b.title, b.body]).sort()).toEqual([
        ['post_moderated', 'Your post is now public', `${marker} keep me`],
        ['post_moderated', 'Your post was not published', `${marker} drop me`],
      ])
      expect(JSON.stringify(bells.find((b) => b.body === `${marker} drop me`))).not.toContain(
        dropped
      )
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-03 a held post is pending, subscribed for its author and announced to nobody',
  { tag: '@core' },
  async ({ playwright, browser, baseURL, people, marker }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.created'])
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const postId = await heldPost(api, customer, board.id, `${marker} held`)
      expect((await postRow(postId))?.moderation_state).toBe('pending')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.held')
      const subs = await supportDb()`SELECT reason FROM post_subscriptions
        WHERE post_id = ${uuid(postId)} AND principal_id = ${customer.principalUuid}`
      expect(subs.map((s) => s.reason)).toEqual(['author'])

      // A teammate's post on the same board is never held, and is announced.
      const team = await makePost(api, { boardId: board.id, title: `${marker} team post` })
      expect((await postRow(team.id))?.moderation_state).toBe('published')
      await deliveriesOf(marker, 'post.created', team.id)
      expect((await sink.deliveries(marker)).filter((d) => d.body.includes(postId))).toEqual([])
    } finally {
      await unsubscribe(hooks, hook)
      await customer.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)

test(
  'FBA-Q-04 the queue lists pending posts and comments with author, board and links',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker, { name: `Queue ${marker}` })
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} queued post`
      const postId = await heldPost(api, customer, board.id, title, `Content of ${marker}`)
      const open = await makePost(api, { boardId: board.id, title: `${marker} open post` })
      await setBoardModeration(api, board.id, { comments: 'on' })
      const commentText = `${marker} queued comment`
      const commentId = await comment(customer.api, open.id, commentText)

      const admin = await asPerson('admin')
      await admin.goto('/admin/moderation')
      await expect(admin).toHaveURL(/\/admin\/feedback\/moderation/)
      await expect(admin.getByRole('heading', { name: /Pending posts \(\d+\)/ })).toBeVisible()
      await expect(admin.getByRole('heading', { name: /Pending comments \(\d+\)/ })).toBeVisible()
      const postItem = queueRow(admin, title)
      await expect(postItem).toContainText(`by Queue ${marker} in ${board.name}`)
      await expect(postItem).toContainText(`Content of ${marker}`)
      await expect(postItem.getByRole('link', { name: title })).toHaveAttribute(
        'href',
        `/admin/feedback?post=${postId}`
      )
      const commentItem = queueRow(admin, commentText)
      await expect(commentItem).toContainText(`on ${open.title}`)
      await expect(commentItem).toContainText(`in ${board.name}`)
      await expect(commentItem).toContainText(`by Queue ${marker}`)
      await expect(commentItem.getByRole('link').first()).toHaveAttribute(
        'href',
        new RegExp(`#comment-${commentId}$`)
      )
      await postItem.getByRole('link', { name: title }).click()
      await expect(admin.getByRole('dialog').getByText(title).first()).toBeVisible()
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-04 a test customer held post is left out of the queue, as it is of the counts',
  {
    tag: '@core',
  },
  async ({ playwright, browser, newTeammate, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    // Each teammate owns at most one test customer: use a teammate of this test.
    const owner = await newTeammate({ roleKey: 'contributor' })
    try {
      await supportDb()`UPDATE principal SET test_owner_principal_id = ${uuid(owner.principalId)}
                        WHERE id = ${customer.principalUuid}`
      const board = await makeBoard(api, marker)
      const title = `${marker} test customer post`
      await heldPost(api, customer, board.id, title)
      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      await expect(
        admin.getByRole('heading', { name: /Pending posts|Nothing to review/ }).first()
      ).toBeVisible()
      await expect(queueRow(admin, title), 'test customer item listed').toHaveCount(0)
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-06 rejecting a held post soft-deletes it; restoring puts it back in the queue',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} to reject`
      const postId = await heldPost(api, customer, board.id, title)
      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      await decide(queueRow(admin, title), 'Reject')
      await expect(queueRow(admin, title)).toHaveCount(0)
      const row = await postRow(postId)
      expect(row?.deleted_at).toBeTruthy()
      expect(row?.deleted_by_principal_id).toBeNull()
      expect(row?.moderation_state).toBe('pending')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.rejected')
      const [audit] = await supportDb()`SELECT metadata, after_value FROM audit_log
        WHERE target_id IN (${postId}, ${uuid(postId)}) AND event_type = 'post.moderation.rejected'`
      expect(JSON.stringify(audit)).not.toMatch(/"reason":"[^"]/)

      const restored = await callServerFn(api, 'restorePostFn', { id: postId })
      expect(restored.ok, restored.raw).toBe(true)
      await admin.reload()
      await expect(queueRow(admin, title)).toHaveCount(1)
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-07 approving something already handled is refused and the queue says so',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} handled twice`
      const postId = await heldPost(api, customer, board.id, title)
      const open = await makePost(api, { boardId: board.id, title: `${marker} open` })
      await setBoardModeration(api, board.id, { comments: 'on' })
      const commentId = await comment(customer.api, open.id, `${marker} comment`)

      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      await expect(queueRow(admin, title)).toHaveCount(1)
      // Someone else approves it meanwhile.
      expect((await callServerFn(api, 'approvePostFn', { postId })).ok).toBe(true)
      const again = await callServerFn(api, 'approvePostFn', { postId })
      expect(again.ok).toBe(false)
      expect(again.code).toBe('POST_NOT_PENDING')
      expect(again.error).toContain('Post is not awaiting review')
      expect((await callServerFn(api, 'approveCommentFn', { commentId })).ok).toBe(true)
      const commentAgain = await callServerFn(api, 'rejectCommentFn', { commentId })
      expect(commentAgain.code).toBe('COMMENT_NOT_PENDING')

      await decide(queueRow(admin, title), 'Approve')
      await expect(
        admin.getByText('This item was already handled. Refreshing the queue.')
      ).toBeVisible()
      await expect(queueRow(admin, title)).toHaveCount(0)
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-09 approving a held comment publishes it, counts it and tells the subscribers',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const commenter = await portalCustomer(browser, marker)
    const follower = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const post = await makePost(api, { boardId: board.id, title: `${marker} discussed` })
      await vote(follower.api, post.id)
      await setBoardModeration(api, board.id, { comments: 'on' })
      const text = `${marker} held remark`
      const commentId = await comment(commenter.api, post.id, text)
      expect((await commentRow(commentId)).moderation_state).toBe('pending')
      expect((await postRow(post.id))?.comment_count).toBe(0)
      const subs = await supportDb()`SELECT reason FROM post_subscriptions
        WHERE post_id = ${uuid(post.id)} AND principal_id = ${commenter.principalUuid}`
      expect(subs.map((s) => s.reason)).toEqual(['comment'])

      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      await decide(queueRow(admin, text), 'Approve')
      await expect(queueRow(admin, text)).toHaveCount(0)
      expect((await commentRow(commentId)).moderation_state).toBe('published')
      expect((await postRow(post.id))?.comment_count).toBe(1)
      await expect.poll(() => auditActions(commentId)).toContain('comment.moderation.approved')
      await waitForMail({ to: follower.email, subject: post.title })
      await expect.poll(async () => (await bellsFor(follower.principalId, post.id)).length).toBe(1)
      // The commenter is the actor of the announce and hears nothing of it; the
      // team's decision reaches them once, as one email and one bell.
      await waitForMail({ to: commenter.email, subject: 'Your comment is now public' })
      await waitForEventHandled(commentId, { type: 'comment.approved' })
      await waitForEventHandled(commentId, { type: 'comment.created' })
      expect((await mailTo(commenter.email)).map((m) => m.Subject)).toEqual([
        'Your comment is now public',
      ])
      expect(
        (await bellsFor(commenter.principalId, post.id)).map((b) => [b.type, b.title, b.body])
      ).toEqual([['post_moderated', 'Your comment is now public', post.title]])
      expect((await mailTo(follower.email)).map((m) => m.Subject)).toEqual([
        expect.stringContaining(post.title),
      ])
    } finally {
      await commenter.close()
      await follower.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-10 rejecting a held comment soft-deletes it; restoring returns it to the queue',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const commenter = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const post = await makePost(api, { boardId: board.id, title: `${marker} thread` })
      await setBoardModeration(api, board.id, { comments: 'on' })
      const text = `${marker} rejected remark`
      const commentId = await comment(commenter.api, post.id, text)

      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      await decide(queueRow(admin, text), 'Reject')
      await expect(queueRow(admin, text)).toHaveCount(0)
      expect((await commentRow(commentId)).deleted_at).toBeTruthy()
      expect((await postRow(post.id))?.comment_count).toBe(0)
      await expect.poll(() => auditActions(commentId)).toContain('comment.moderation.rejected')

      const restored = await callServerFn(api, 'restoreCommentFn', { commentId })
      expect(restored.ok, restored.raw).toBe(true)
      expect((await commentRow(commentId)).moderation_state).toBe('pending')
      expect((await postRow(post.id))?.comment_count).toBe(0)
      await admin.reload()
      await expect(queueRow(admin, text)).toHaveCount(1)
    } finally {
      await commenter.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-11 the board Moderation tab overrides a rule, autosaves and audits it',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const admin = await asPerson('admin')
      await admin.goto(`/admin/settings/boards/${board.slug}?tab=moderation`)
      await expect(admin.getByText('Inheriting all workspace defaults.')).toBeVisible()
      for (const label of [
        'Require approval for anonymous posts',
        'Require approval for signed-in posts',
        'Require approval for new comments',
      ]) {
        const group = admin.getByRole('radiogroup', { name: label })
        await expect(group.getByRole('radio', { name: /^Inherit \((On|Off)\)$/ })).toBeChecked()
        await expect(group.getByRole('radio', { name: 'On', exact: true })).toBeVisible()
        await expect(group.getByRole('radio', { name: 'Off', exact: true })).toBeVisible()
      }
      const anonOn = admin
        .getByRole('radiogroup', { name: 'Require approval for anonymous posts' })
        .getByRole('radio', { name: 'On', exact: true })
      await waitForHydration(anonOn)
      await anonOn.click()
      await expect(anonOn).toBeChecked()
      await expect(admin.getByText(/overrides\s+some workspace/)).toBeVisible()
      await expect(admin.getByText('Override', { exact: true })).toBeVisible()
      await expect
        .poll(async () => {
          const [row] = await supportDb()`SELECT access FROM boards WHERE id = ${uuid(board.id)}`
          const access = typeof row.access === 'string' ? JSON.parse(row.access) : row.access
          return access.moderation
        })
        .toEqual({ anonPosts: 'on', signedPosts: 'inherit', comments: 'inherit' })
      await expect.poll(() => auditActions(board.id)).toContain('board.access.changed')
      await admin.reload()
      await expect(
        admin
          .getByRole('radiogroup', { name: 'Require approval for anonymous posts' })
          .getByRole('radio', { name: 'On', exact: true })
      ).toBeChecked()
      await expect(admin.getByRole('link', { name: 'review queue' })).toHaveAttribute(
        'href',
        '/admin/feedback/moderation'
      )
    } finally {
      await api.dispose()
    }
  }
)

test(
  "FBA-Q-15 a customer's held post never sends an @-mention notice, before or after approval",
  { tag: '@core' },
  async ({ playwright, browser, newTeammate, marker }) => {
    // Customers get no mention picker, so a mention node in their post is a
    // crafted request and notifies nobody (FBP-B22). A teammate's mention of
    // the same person, sent last, is the control that the notices ran.
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    const mate = await newTeammate({ roleKey: 'admin', principalRole: 'admin' })
    const mentionDoc = (text: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text },
            { type: 'mention', attrs: { id: mate.principalId, label: mate.name } },
          ],
        },
      ],
    })
    try {
      const board = await makeBoard(api, marker)
      await setBoardModeration(api, board.id, { signedPosts: 'on' })
      const res = await callServerFn<{ id: string }>(customer.api, 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} mentions a teammate`,
        content: `Hello ${mate.name}`,
        contentJson: mentionDoc('Hello '),
      })
      expect(res.ok, res.raw).toBe(true)
      const postId = res.data.id
      expect((await postRow(postId))?.moderation_state).toBe('pending')
      expect((await callServerFn(api, 'approvePostFn', { postId })).ok).toBe(true)
      expect((await postRow(postId))?.moderation_state).toBe('published')

      const control = await callServerFn<{ id: string }>(api, 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} team mention`,
        content: `Hi ${mate.name}`,
        contentJson: mentionDoc('Hi '),
      })
      expect(control.ok, control.raw).toBe(true)
      await expect
        .poll(async () => (await bellsFor(mate.principalId, control.data.id)).length)
        .toBe(1)
      await waitForMail({ to: mate.email })

      expect(await bellsFor(mate.principalId, postId)).toEqual([])
      expect(await mailTo(mate.email)).toHaveLength(1)
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  "FBA-Q-16 a teammate's post filed for a customer still tells the people it mentions",
  { tag: '@core' },
  async ({ playwright, browser, newTeammate, marker }) => {
    // The post is the customer's, but the teammate wrote the text, so its
    // mention notifies (FBP-B22 judges who wrote the text).
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    const alice = await newTeammate({ roleKey: 'admin', principalRole: 'admin' })
    try {
      const board = await makeBoard(api, marker)
      const res = await callServerFn<{ id: string }>(api, 'createPostFn', {
        boardId: board.id,
        title: `${marker} filed for a customer`,
        content: `Over to ${alice.name}`,
        authorPrincipalId: customer.principalId,
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Over to ' },
                { type: 'mention', attrs: { id: alice.principalId, label: alice.name } },
              ],
            },
          ],
        },
      })
      expect(res.ok, res.raw).toBe(true)
      const postId = res.data.id
      expect((await postRow(postId))?.principal_id).toBe(customer.principalUuid)
      await expect.poll(async () => (await bellsFor(alice.principalId, postId)).length).toBe(1)
      await waitForMail({ to: alice.email })
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

// ---------------------------------------------------------------------------
// Workspace-wide moderation switches: product-isolated job only.
// ---------------------------------------------------------------------------

test(
  'FBA-Q-01 the approval switches map to the workspace policy, persist and are audited',
  { tag: ['@core', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, 'runs in product-isolated')
    await withSettings(
      { portal_config: { 'moderationDefault.requireApproval': 'none' } },
      async () => {
        const since = new Date()
        const policy = async () => {
          const [row] = await supportDb()`SELECT portal_config FROM settings LIMIT 1`
          return JSON.parse(String(row.portal_config)).moderationDefault?.requireApproval
        }
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/moderation')
        const anonymous = admin.locator('#moderate-anonymous')
        const signedIn = admin.locator('#moderate-authenticated')
        await waitForHydration(anonymous)
        await expect(anonymous).not.toBeChecked()
        await expect(signedIn).not.toBeChecked()

        await anonymous.click()
        await expect.poll(policy).toBe('anonymous')
        await expect(signedIn).toBeEnabled()
        await signedIn.click()
        await expect.poll(policy).toBe('all')
        await admin.reload()
        await expect(admin.locator('#moderate-anonymous')).toBeChecked()
        await expect(admin.locator('#moderate-authenticated')).toBeChecked()
        await waitForHydration(admin.locator('#moderate-anonymous'))
        await admin.locator('#moderate-anonymous').click()
        await expect.poll(policy).toBe('authenticated')

        // Audit rows are written after the save answers: wait for all three.
        const audits = async () =>
          (
            await supportDb()`SELECT after_value FROM audit_log
              WHERE event_type = 'moderation.default.changed' AND occurred_at >= ${since}
              ORDER BY occurred_at`
          ).map((a) => JSON.stringify(a.after_value).match(/none|anonymous|authenticated|all/)?.[0])
        await expect.poll(audits).toEqual(['anonymous', 'all', 'authenticated'])
        await expect(admin.getByRole('link', { name: 'Open queue' })).toHaveAttribute(
          'href',
          '/admin/feedback/moderation'
        )
      }
    )
  }
)

test(
  'FBA-Q-02 content review holds customer posts and comments with images or external links',
  { tag: ['@core', '@isolated'] },
  async ({ playwright, browser, baseURL, marker }) => {
    test.skip(!ISOLATED, 'runs in product-isolated')
    await withSettings(
      {
        portal_config: {
          'moderationDefault.holdImages': true,
          'moderationDefault.holdLinks': true,
        },
      },
      async () => {
        const api = await personApi(playwright, 'admin')
        const customer = await portalCustomer(browser, marker)
        try {
          const board = await makeBoard(api, marker)
          const submit = async (title: string, content: string, contentJson?: unknown) => {
            const res = await callServerFn<{ id: string }>(customer.api, 'createPublicPostFn', {
              boardId: board.id,
              title,
              content,
              ...(contentJson ? { contentJson } : {}),
            })
            expect(res.ok, res.raw).toBe(true)
            return res.data.id
          }
          const heldReason = async (id: string) => {
            const [row] = await supportDb()`SELECT metadata FROM audit_log
              WHERE target_id IN (${id}, ${uuid(id)}) AND event_type LIKE '%.moderation.held'`
            return row ? (row.metadata as { reason?: string }).reason : undefined
          }

          const linked = await submit(`${marker} link`, 'See https://example.org/page for more')
          expect((await postRow(linked))?.moderation_state).toBe('pending')
          await expect.poll(() => heldReason(linked)).toBe('links')

          const own = await submit(`${marker} own link`, `See ${baseURL}/roadmap for more`)
          expect((await postRow(own))?.moderation_state).toBe('published')

          const image = await submit(`${marker} image`, 'A picture', {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'A picture' }] },
              { type: 'image', attrs: { src: 'https://example.org/shot.png' } },
            ],
          })
          expect((await postRow(image))?.moderation_state).toBe('pending')
          await expect.poll(() => heldReason(image)).toBe('images')

          const open = await makePost(api, { boardId: board.id, title: `${marker} open` })
          const commentId = await comment(customer.api, open.id, 'Look at https://example.org/x')
          expect((await commentRow(commentId)).moderation_state).toBe('pending')
          await expect.poll(() => heldReason(commentId)).toBe('links')

          // Team content is never held.
          const team = await makePost(api, {
            boardId: board.id,
            title: `${marker} team link`,
            content: 'https://example.org/team',
          })
          expect((await postRow(team.id))?.moderation_state).toBe('published')
        } finally {
          await customer.close()
          await api.dispose()
        }
      }
    )
  }
)

test(
  'FBA-Q-13 the pending count in the sidebar and banner follows approvals down to zero',
  { tag: ['@nightly', '@isolated'] },
  async ({ playwright, browser, asPerson, marker }) => {
    test.skip(!ISOLATED, 'runs in product-isolated')
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const first = await heldPost(api, customer, board.id, `${marker} first`)
      const second = await heldPost(api, customer, board.id, `${marker} second`)
      const admin = await asPerson('admin')
      const shown = async () => {
        await openInbox(admin, { board: [board.id] })
        await expect(admin.getByRole('heading', { name: 'Feedback' }).first()).toBeVisible()
        const banner = admin.getByText(/(item is|items are) pending moderation/)
        if ((await banner.count()) === 0) return 0
        return Number((await banner.innerText()).match(/^(\d+)/)?.[1])
      }
      const start = await shown()
      expect(start).toBeGreaterThanOrEqual(2)
      await expect(admin.getByRole('link', { name: /Feedback/ }).first()).toContainText(
        `${start} waiting for review`
      )
      expect((await callServerFn(api, 'approvePostFn', { postId: first })).ok).toBe(true)
      expect(await shown()).toBe(start - 1)
      expect((await callServerFn(api, 'approvePostFn', { postId: second })).ok).toBe(true)
      expect(await shown()).toBe(start - 2)
    } finally {
      await customer.close()
      await api.dispose()
    }
  }
)

test(
  'FBA-Q-14 Settings > Feedback opens the first feedback settings page the viewer can open',
  { tag: '@nightly' },
  async ({ asPerson }) => {
    // The Feedback-off redirect half of this journey is FBA-I-03's (workspace-wide).
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/feedback')
    await expect(admin).toHaveURL(/\/admin\/settings\/boards/)
    await admin.goto('/admin/settings/moderation')
    await expect(admin.getByText('Signed-in posts')).toBeVisible()
  }
)

test(
  'FBA-Q-08 a teammate without post.approve cannot list, approve or reject, nor open the queue',
  { tag: '@core' },
  async ({ playwright, browser, newTeammate, marker }) => {
    const api = await personApi(playwright, 'admin')
    const customer = await portalCustomer(browser, marker)
    const roleKey = await createRole(marker, ['post.view_private', 'member.view'])
    const mate = await newTeammate({ roleKey })
    const mateApi = await mate.api(playwright)
    try {
      const board = await makeBoard(api, marker)
      const postId = await heldPost(api, customer, board.id, `${marker} out of reach`)
      const listed = await callServerFn(mateApi, 'listPendingPostsFn', undefined, { method: 'GET' })
      expect(listed.ok).toBe(false)
      for (const fn of ['approvePostFn', 'rejectPostFn']) {
        const res = await callServerFn(mateApi, fn, { postId })
        expect(res.ok, fn).toBe(false)
      }
      const row = await postRow(postId)
      expect(row?.moderation_state).toBe('pending')
      expect(row?.deleted_at).toBeNull()

      const page = await mate.newPage(browser)
      await page.goto('/admin/feedback/moderation')
      await expect(page).toHaveURL(/error=not_team_member/)
      await openInbox(page, { board: [board.id] })
      await expect.poll(() => inboxTitles(page, marker)).toEqual([`${marker} out of reach`])
      await expect(page.getByText(/pending moderation/)).toHaveCount(0)
      await expect(page.getByText(/waiting for review/)).toHaveCount(0)
    } finally {
      await mateApi.dispose()
      await customer.close()
      await api.dispose()
    }
  }
)
