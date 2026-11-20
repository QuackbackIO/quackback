/**
 * The emails a customer receives about feedback they follow: status changes,
 * new comments and mentions; who is left out; preferences; and the
 * unsubscribe links (page and one-click).
 *
 * Journeys: FBP-N-05, FBP-N-07, FBP-N-09, FBP-N-11, FBP-N-12, FBP-N-13,
 * FBP-N-14, FBP-N-17, FBP-N-18, FBP-N-19, FBP-N-20, FBP-N-21, FBP-N-23,
 * FBP-N-24
 */
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { blockPrincipal, mailText } from '../../support/email-journeys'
import { linksIn } from '../../support/mailpit'
import { mentionDoc } from '../../support/access-bells'
import {
  hooksApi,
  subscribe as subscribeHook,
  unsubscribe as unsubscribeHook,
  deliveriesOf,
  bodyOf,
} from '../../support/webhooks'
import {
  adminRest,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  restPost,
  seedPost,
  status,
  uuid,
  visitor,
} from '../../product/feedback-portal'
import {
  adminSession,
  commentFn,
  eventHandled,
  listUnsubscribeUrl,
  mailFor,
  mailsFor,
  notificationsOf,
  setPreferences,
  setStatus,
  subscribe,
  subscriptionOf,
  tokenOf,
} from '../../product/feedback-portal-notify'

/** Bells of a type for a person about a post. */
async function bellsOfType(principalUuid: string, postUuid: string, type: string) {
  return (await notificationsOf(principalUuid, postUuid)).filter((n) => n.type === type)
}

test.describe('portal emails', () => {
  test(
    'FBP-N-05 a status change emails the subscriber: subject, from-to, link, unsubscribe header and token',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const created = await fbFn<{ id: string }>(
        cass.request,
        'publicPosts',
        'createPublicPostFn',
        { boardId: board.id, title: `${marker} faster exports` }
      )
      const post = {
        id: created.value?.id as string,
        board,
        uuid: uuid(created.value?.id as string),
      }
      await setStatus(await adminRest(playwright, marker), post, 'in_progress')

      const mail = await mailFor(cass.email, 'Your feedback is now In Progress!')
      const text = mailText(mail)
      expect(text).toContain('Open')
      expect(text).toContain('In Progress')
      expect(text).toContain('View Feedback')
      expect(text).toContain('Unsubscribe from this post')
      expect(text).toContain('Manage notification preferences')
      expect(linksIn(mail).some((l) => l.endsWith(postPath(post)))).toBe(true)
      expect(linksIn(mail).some((l) => l.endsWith('/settings/preferences'))).toBe(true)
      const unsub = await listUnsubscribeUrl(mail)
      expect(unsub).toMatch(/\/unsubscribe\?token=[0-9a-f-]{36}$/)
      const [token] = await supportDb()`SELECT action, post_id, principal_id, used_at,
          expires_at > now() + interval '29 days' AS long_lived
        FROM unsubscribe_tokens WHERE token = ${tokenOf(unsub)}`
      expect(token).toMatchObject({
        action: 'unsubscribe_post',
        post_id: post.uuid,
        principal_id: cass.principalUuid,
        used_at: null,
        long_lived: true,
      })
      await eventHandled(post.id, 'post.status_changed')
      expect(await mailsFor(cass.email, 'Your feedback is now')).toHaveLength(1)
    }
  )

  test(
    'FBP-N-07 a new comment emails subscribers other than its author, linking to the comment',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} dark mode` })
      const cass = await portalCustomer(browser, marker)
      const dana = await portalCustomer(browser, marker, { suffix: 'dana', name: 'Dana Commenter' })
      await subscribe(post.uuid, cass.principalUuid)
      const res = await commentFn(dana.request, post, `${marker} me too please`)
      const commentId = res.value?.comment.id as string

      const mail = await mailFor(cass.email, `New comment on "${post.title}"`)
      const text = mailText(mail)
      expect(text).toContain('Dana Commenter commented')
      expect(text).toContain('me too please')
      expect(text).toContain('View Comment')
      expect(linksIn(mail).some((l) => l.endsWith(`${postPath(post)}#comment-${commentId}`))).toBe(
        true
      )
      await listUnsubscribeUrl(mail)
      // A team reply marks the commenter as team.
      const admin = await adminSession(browser, people, marker)
      const team = await commentFn(admin.request, post, `${marker} on it`, { parentId: commentId })
      const teamMail = await pollTeamMail(cass.email, post.title)
      expect(mailText(teamMail)).toContain('(Team)')
      await eventHandled(team.value?.comment.id as string, 'comment.created')
      // The commenter is never emailed about her own comment.
      expect(await mailsFor(dana.email, `New comment on "${post.title}"`)).toHaveLength(1)
      expect(mailText((await mailsFor(dana.email, `New comment on`))[0])).toContain('(Team)')
    }
  )

  test(
    'FBP-N-09 a private team note never emails or bells a subscribed customer',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      const admin = await adminSession(browser, people, marker)
      const note = await commentFn(admin.request, post, `${marker} internal only`, {
        isPrivate: true,
      })
      await eventHandled(note.value?.comment.id as string, 'comment.created')
      // Control: a public team comment right after does reach her.
      const open = await commentFn(admin.request, post, `${marker} public reply`)
      await eventHandled(open.value?.comment.id as string, 'comment.created')
      const mails = await mailsFor(cass.email, 'New comment on')
      expect(mails).toHaveLength(1)
      expect(mailText(mails[0])).toContain('public reply')
      expect(mailText(mails[0])).not.toContain('internal only')
      const bells = await bellsOfType(cass.principalUuid, post.uuid, 'comment_created')
      expect(bells).toHaveLength(1)
      expect(bells[0].comment_id).toBe(uuid(open.value?.comment.id as string))
    }
  )

  test(
    'FBP-N-11 a team comment that also changes the status sends a comment notice and a status notice',
    { tag: '@nightly' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      const admin = await adminSession(browser, people, marker)
      const planned = await status('planned')
      const res = await commentFn(admin.request, post, `${marker} planned it`, {
        statusId: planned.id,
      })
      expect(res.error).toBeUndefined()
      await mailFor(cass.email, `New comment on "${post.title}"`)
      await mailFor(cass.email, 'A post you follow is now Planned')
      await expect
        .poll(async () =>
          (await notificationsOf(cass.principalUuid, post.uuid)).map((n) => n.type).sort()
        )
        .toEqual(['comment_created', 'post_status_changed'])
      const [row] = await supportDb()`SELECT status_change_to_id FROM post_comments
        WHERE id = ${uuid(res.value?.comment.id as string)}`
      expect(row.status_change_to_id).toBe(planned.uuid)
    }
  )

  test(
    'FBP-N-12 a subscriber who can no longer see the post gets nothing; a teammate still does',
    { tag: '@core' },
    async ({ browser, playwright, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const agentB = people.people.agentB
      await subscribe(post.uuid, cass.principalUuid)
      await subscribe(post.uuid, uuid(agentB.principalId))
      await supportDb()`UPDATE boards SET access = jsonb_set(access, '{view}', '"team"')
        WHERE id = ${board.uuid}`
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await eventHandled(post.id, 'post.status_changed')
      // The teammate subscriber is notified (control).
      expect(
        await bellsOfType(uuid(agentB.principalId), post.uuid, 'post_status_changed')
      ).toHaveLength(1)
      expect(await bellsOfType(cass.principalUuid, post.uuid, 'post_status_changed')).toHaveLength(
        0
      )
      expect(await mailsFor(cass.email)).toHaveLength(0)
    }
  )

  test(
    'FBP-N-13 a status-only subscriber gets status notices but no comment ones',
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const all = await portalCustomer(browser, marker, { suffix: 'all' })
      const statusOnly = await portalCustomer(browser, marker, { suffix: 'status' })
      const commenter = await portalCustomer(browser, marker, { suffix: 'commenter' })
      await subscribe(post.uuid, all.principalUuid)
      await subscribe(post.uuid, statusOnly.principalUuid, { comments: false })
      const c = await commentFn(commenter.request, post, `${marker} hi`)
      await eventHandled(c.value?.comment.id as string, 'comment.created')
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await eventHandled(post.id, 'post.status_changed')
      expect(await mailsFor(all.email, 'New comment on')).toHaveLength(1)
      expect(await mailsFor(all.email, 'A post you follow is now Planned')).toHaveLength(1)
      expect(await mailsFor(statusOnly.email, 'New comment on')).toHaveLength(0)
      expect(await mailsFor(statusOnly.email, 'A post you follow is now Planned')).toHaveLength(1)
      expect(
        (await notificationsOf(statusOnly.principalUuid, post.uuid)).map((n) => n.type)
      ).toEqual(['post_status_changed'])
    }
  )

  test(
    'FBP-N-14 preferences: Pause all email silences email but not the bell; a per-type email switch; empty writes refused',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const paused = await portalCustomer(browser, marker, { suffix: 'paused' })
      const noComments = await portalCustomer(browser, marker, { suffix: 'nocomments' })
      const commenter = await portalCustomer(browser, marker, { suffix: 'commenter' })
      for (const p of [paused, noComments]) await subscribe(post.uuid, p.principalUuid)
      expect((await setPreferences(paused.request, { emailMuted: true })).error).toBeUndefined()
      expect(
        (
          await setPreferences(noComments.request, {
            matrix: { comment_created: { email: false } },
          })
        ).error
      ).toBeUndefined()
      const empty = await setPreferences(paused.request, {})
      expect(empty.error).toMatchObject({
        code: 'NO_FIELDS_TO_UPDATE',
        message: 'No fields to update',
      })

      const c = await commentFn(commenter.request, post, `${marker} hi`)
      await eventHandled(c.value?.comment.id as string, 'comment.created')
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await eventHandled(post.id, 'post.status_changed')

      expect(await mailsFor(paused.email)).toHaveLength(0)
      expect(
        (await notificationsOf(paused.principalUuid, post.uuid)).map((n) => n.type).sort()
      ).toEqual(['comment_created', 'post_status_changed'])
      expect(await mailsFor(noComments.email, 'New comment on')).toHaveLength(0)
      expect(await mailsFor(noComments.email, 'A post you follow is now Planned')).toHaveLength(1)
    }
  )

  test(
    'FBP-N-17 opening the unsubscribe link changes nothing; confirming unsubscribes; the link then reads as used',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      const url = await listUnsubscribeUrl(
        await mailFor(cass.email, 'A post you follow is now Planned')
      )
      const token = tokenOf(url)
      const path = `/unsubscribe?token=${token}`
      const v = await visitor(browser, marker)
      // A mail scanner prefetch, then a real open: nothing written.
      expect((await v.request.get(path)).status()).toBe(200)
      await v.page.goto(path)
      await expect(v.page.getByText('Unsubscribe from this post?')).toBeVisible()
      await expect(v.page.getByText(post.title)).toBeVisible()
      expect(await subscriptionOf(post.uuid, cass.principalUuid)).not.toBeNull()
      const [before] =
        await supportDb()`SELECT used_at FROM unsubscribe_tokens WHERE token = ${token}`
      expect(before.used_at).toBeNull()

      await v.page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
      await expect(v.page.getByText('Done')).toBeVisible()
      await expect(
        v.page.getByText('You will not get more notifications about this post.')
      ).toBeVisible()
      await expect(v.page.getByRole('link', { name: 'View post' })).toBeVisible()
      expect(await subscriptionOf(post.uuid, cass.principalUuid)).toBeNull()
      const [after] =
        await supportDb()`SELECT used_at FROM unsubscribe_tokens WHERE token = ${token}`
      expect(after.used_at).not.toBeNull()

      await v.page.reload()
      await expect(v.page.getByText('This link was already used')).toBeVisible()
      await v.page.goto('/unsubscribe?token=not-a-token')
      await expect(v.page.getByText('This link is not valid')).toBeVisible()
      await v.page.goto('/unsubscribe')
      await expect(v.page.getByText('This link is incomplete')).toBeVisible()
    }
  )

  test(
    'FBP-N-17 a link that was never issued is not called expired',
    {
      tag: '@core',
    },
    async ({ browser, marker }) => {
      const v = await visitor(browser, marker)
      await v.page.goto(`/unsubscribe?token=${randomUUID()}`)
      await expect(v.page.getByRole('heading').first()).toBeVisible()
      await expect(v.page.getByText('This link has expired')).toHaveCount(0)
    }
  )

  test(
    'FBP-N-18 one-click POST unsubscribes without cookies and answers uniformly',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      const token = tokenOf(
        await listUnsubscribeUrl(await mailFor(cass.email, 'A post you follow is now Planned'))
      )
      const v = await visitor(browser, marker)
      const oneClick = (t: string, form?: Record<string, string>) =>
        v.request.post(`/unsubscribe?token=${t}`, form ? { form } : {})

      const noBody = await oneClick(token)
      expect(noBody.status()).toBe(400)
      expect(await noBody.text()).toContain('Expected List-Unsubscribe=One-Click')
      const wrong = await oneClick(token, { 'List-Unsubscribe': 'nope' })
      expect(wrong.status()).toBe(400)
      expect(await subscriptionOf(post.uuid, cass.principalUuid)).not.toBeNull()

      const ok = await oneClick(token, { 'List-Unsubscribe': 'One-Click' })
      expect(ok.status()).toBe(200)
      expect(await subscriptionOf(post.uuid, cass.principalUuid)).toBeNull()
      // Used, unknown and malformed tokens: the same 200, no effect.
      for (const t of [token, randomUUID(), 'garbage']) {
        const res = await oneClick(t, { 'List-Unsubscribe': 'One-Click' })
        expect(res.status(), t).toBe(200)
      }
    }
  )

  test(
    'FBP-N-19 a mention email unsubscribe link asks to turn off all email and pauses email, not bells',
    { tag: '@core' },
    async ({ browser, playwright, people, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const admin = await adminSession(browser, people, marker)
      const title = `${marker} mention me`
      const created = await fbFn<{ id: string }>(
        admin.request,
        'publicPosts',
        'createPublicPostFn',
        {
          boardId: board.id,
          title,
          content: 'hey',
          contentJson: mentionDoc('Hey', [{ principalId: cass.principalId, name: cass.name }]),
        }
      )
      const mail = await mailFor(cass.email, `mentioned you in "${title}"`)
      const url = await listUnsubscribeUrl(mail)
      const v = await visitor(browser, marker)
      await v.page.goto(new URL(url).pathname + new URL(url).search)
      await expect(v.page.getByText('Turn off all email?')).toBeVisible()
      await v.page.getByRole('button', { name: 'Turn off all email' }).click()
      await expect(v.page.getByText(/All email is off/)).toBeVisible()
      const [prefs] = await supportDb()`SELECT email_muted FROM notification_preferences
        WHERE principal_id = ${cass.principalUuid}`
      expect(prefs.email_muted).toBe(true)

      // Later status changes on a post she follows: a bell, no email.
      const post = { id: created.value?.id as string, uuid: uuid(created.value?.id as string) }
      await subscribe(post.uuid, cass.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await eventHandled(post.id, 'post.status_changed')
      expect(await bellsOfType(cass.principalUuid, post.uuid, 'post_status_changed')).toHaveLength(
        1
      )
      expect(await mailsFor(cass.email, 'A post you follow is now')).toHaveLength(0)
    }
  )

  test(
    'FBP-N-19 the mention email does not label an unsubscribe-all link as "Unsubscribe from this post"',
    {
      tag: '@core',
    },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const admin = await adminSession(browser, people, marker)
      const title = `${marker} mention label`
      await fbFn(admin.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title,
        content: 'hey',
        contentJson: mentionDoc('Hey', [{ principalId: cass.principalId, name: cass.name }]),
      })
      const mail = await mailFor(cass.email, `mentioned you in "${title}"`)
      const [token] = await supportDb()`SELECT action FROM unsubscribe_tokens
        WHERE token = ${tokenOf(await listUnsubscribeUrl(mail))}`
      expect(token.action).toBe('unsubscribe_all')
      expect(mailText(mail)).not.toContain('Unsubscribe from this post')
    }
  )

  test(
    'FBP-N-20 after the post unsubscribe link, neither email nor bell arrives for that post',
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      await subscribe(post.uuid, cass.principalUuid)
      await subscribe(post.uuid, other.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      const token = tokenOf(
        await listUnsubscribeUrl(await mailFor(cass.email, 'A post you follow is now Planned'))
      )
      const v = await visitor(browser, marker)
      await v.page.goto(`/unsubscribe?token=${token}`)
      await v.page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
      await expect(v.page.getByText('Done')).toBeVisible()
      const c = await commentFn(other.request, post, `${marker} later news`)
      await eventHandled(c.value?.comment.id as string, 'comment.created')
      expect(await mailsFor(cass.email, 'New comment on')).toHaveLength(0)
      expect(await bellsOfType(cass.principalUuid, post.uuid, 'comment_created')).toHaveLength(0)
    }
  )

  test(
    'FBP-N-20 the post unsubscribe page does not promise that only email stops',
    {
      tag: '@nightly',
    },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      await subscribe(post.uuid, cass.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      const token = tokenOf(
        await listUnsubscribeUrl(await mailFor(cass.email, 'A post you follow is now Planned'))
      )
      const v = await visitor(browser, marker)
      await v.page.goto(`/unsubscribe?token=${token}`)
      await expect(v.page.getByText('Unsubscribe from this post?')).toBeVisible()
      await expect(v.page.getByText(/email updates/)).toHaveCount(0)
    }
  )

  test(
    'FBP-N-21 a blocked person gets no feedback email; the bell is still written',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const blocked = await portalCustomer(browser, marker, { suffix: 'blocked' })
      const fine = await portalCustomer(browser, marker, { suffix: 'fine' })
      await subscribe(post.uuid, blocked.principalUuid)
      await subscribe(post.uuid, fine.principalUuid)
      await blockPrincipal(blocked.principalUuid)
      await setStatus(await adminRest(playwright, marker), post, 'planned')
      await mailFor(fine.email, 'A post you follow is now Planned')
      await eventHandled(post.id, 'post.status_changed')
      expect(await mailsFor(blocked.email)).toHaveLength(0)
      expect(
        await bellsOfType(blocked.principalUuid, post.uuid, 'post_status_changed')
      ).toHaveLength(1)
    }
  )

  test(
    'FBP-N-23 nobody is notified of their own comment or status change',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const created = await fbFn<{ id: string }>(
        cass.request,
        'publicPosts',
        'createPublicPostFn',
        {
          boardId: board.id,
          title: `${marker} mine`,
        }
      )
      const post = { id: created.value?.id as string, uuid: uuid(created.value?.id as string) }
      await subscribe(post.uuid, other.principalUuid)
      const c = await commentFn(cass.request, post, `${marker} my own note`)
      await eventHandled(c.value?.comment.id as string, 'comment.created')
      expect(await mailsFor(other.email, 'New comment on')).toHaveLength(1)
      expect(await mailsFor(cass.email)).toHaveLength(0)
      expect(await notificationsOf(cass.principalUuid, post.uuid)).toHaveLength(0)

      // A teammate who follows the post changes its status: not notified; the author is.
      const admin = await adminSession(browser, people, marker)
      await subscribe(post.uuid, admin.principalUuid)
      const planned = await status('planned')
      const res = await commentFn(admin.request, post, `${marker} planned`, {
        statusId: planned.id,
      })
      expect(res.error).toBeUndefined()
      await mailFor(cass.email, 'Your feedback is now Planned')
      await eventHandled(post.id, 'post.status_changed')
      expect(await notificationsOf(admin.principalUuid, post.uuid)).toHaveLength(0)
    }
  )

  test(
    "FBP-N-24 merging sends customers nothing; the next status change reaches the duplicate's follower once",
    { tag: '@nightly' },
    async ({ browser, playwright, baseURL, people, marker }) => {
      const hookApi = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribeHook(hookApi, marker, ['post.merged'])
      try {
        const board = await createBoard(marker)
        const a = await seedPost(board, { title: `${marker} keeper` })
        const b = await seedPost(board, { title: `${marker} dup` })
        const cass = await portalCustomer(browser, marker)
        await subscribe(b.uuid, cass.principalUuid)
        const api = await adminRest(playwright, marker)
        await restPost(api, `/posts/${b.id}/merge`, { canonicalPostId: a.id })
        const [d] = await deliveriesOf(marker, 'post.merged', b.id)
        const data = bodyOf<Record<string, { id: string }>>(d).data
        expect(data.duplicatePost.id).toBe(b.id)
        expect(data.canonicalPost.id).toBe(a.id)
        await eventHandled(b.id, 'post.merged')
        expect(await mailsFor(cass.email)).toHaveLength(0)
        expect(await notificationsOf(cass.principalUuid)).toHaveLength(0)

        await setStatus(api, a, 'planned')
        await mailFor(cass.email, 'A post you follow is now Planned')
        await eventHandled(a.id, 'post.status_changed')
        expect(await mailsFor(cass.email)).toHaveLength(1)
        expect(await notificationsOf(cass.principalUuid)).toHaveLength(1)
      } finally {
        await unsubscribeHook(hookApi, hook)
      }
    }
  )
})

/** The "(Team)" comment mail (the second one) to `to` about `title`. */
async function pollTeamMail(to: string, title: string) {
  let found: Awaited<ReturnType<typeof mailsFor>>[number] | undefined
  await expect
    .poll(
      async () => {
        found = (await mailsFor(to, `New comment on "${title}"`)).find((m) =>
          mailText(m).includes('(Team)')
        )
        return !!found
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  return found as NonNullable<typeof found>
}
