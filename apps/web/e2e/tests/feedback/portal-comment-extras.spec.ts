/**
 * Around a comment: emoji reactions, @-mentions in posts, how comment bodies
 * render, and the comment.created webhook.
 *
 * Journeys: FBP-C-14, FBP-C-15, FBP-C-17, FBP-C-19, FBP-C-20, FBP-C-24
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { mentionDoc } from '../../support/access-bells'
import { waitForEventHandled } from '../../support/bells'
import {
  hooksApi,
  subscribe as subscribeHook,
  unsubscribe,
  deliveriesOf,
  bodyOf,
} from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import { mailText } from '../../support/email-journeys'
import {
  adminRest,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  seedPost,
  uuid,
} from '../../product/feedback-portal'
import {
  adminSession,
  approveComment,
  commentEl,
  commentFn,
  mailFor,
  mailsFor,
  notificationsOf,
  waitForComment,
} from '../../product/feedback-portal-notify'

interface Reaction {
  emoji: string
  count: number
  hasReacted: boolean
}

test.describe('portal comment extras', () => {
  test(
    'FBP-C-14 reactions: add, duplicate is a no-op, remove twice, single emoji only, no notification',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const author = await portalCustomer(browser, marker, { suffix: 'author' })
      const cass = await portalCustomer(browser, marker)
      const text = `${marker} react to me`
      expect((await commentFn(author.request, post, text)).error).toBeUndefined()
      const row = await waitForComment(post.uuid, text)
      const react = (name: string, emoji: string) =>
        fbFn<{ added: boolean; reactions: Reaction[] }>(cass.request, 'comments', name, {
          commentId: row.typeId,
          emoji,
        })

      const first = await react('addReactionFn', '👍')
      expect(first.value).toMatchObject({
        added: true,
        reactions: [{ emoji: '👍', count: 1, hasReacted: true }],
      })
      const again = await react('addReactionFn', '👍')
      expect(again.value).toMatchObject({ added: false, reactions: [{ emoji: '👍', count: 1 }] })
      // The author sees the chip with the count.
      await author.page.goto(postPath(post))
      await expect(commentEl(author.page, row.typeId)).toContainText('👍')
      await expect(commentEl(author.page, row.typeId)).toContainText('1')

      for (const bad of ['hello', '👍'.repeat(20)]) {
        const res = await react('addReactionFn', bad)
        expect(res.value, bad).toBeUndefined()
        expect(res.error?.message).toContain('A reaction must be a single emoji')
      }
      const removed = await react('removeReactionFn', '👍')
      expect(removed.value).toMatchObject({ added: false, reactions: [] })
      expect((await react('removeReactionFn', '👍')).error).toBeUndefined()
      expect(
        await supportDb()`SELECT 1 FROM post_comment_reactions WHERE comment_id = ${row.id as string}`
      ).toHaveLength(0)
      // A reaction notifies nobody.
      expect(await notificationsOf(author.principalUuid, post.uuid)).toHaveLength(0)
    }
  )

  test(
    'FBP-C-15 a customer the board refuses comments cannot react either, nor on a read-only board',
    {
      tag: '@nightly',
    },
    async ({ browser, people, marker }) => {
      const teamOnly = await createBoard(marker, { suffix: 'team', access: { comment: 'team' } })
      const ro = await createBoard(marker, { suffix: 'ro' })
      const p1 = await seedPost(teamOnly, { title: `${marker} team-comment` })
      const p2 = await seedPost(ro, { title: `${marker} read-only` })
      const admin = await adminSession(browser, people, marker)
      const c1 = await commentFn(admin.request, p1, `${marker} team words`)
      const c2 = await commentFn(admin.request, p2, `${marker} older words`)
      await supportDb()`UPDATE boards SET read_only = true WHERE id = ${ro.uuid}`
      const cass = await portalCustomer(browser, marker)
      // Control: commenting is refused on both.
      expect((await commentFn(cass.request, p1, `${marker} x`)).error).toBeDefined()
      expect((await commentFn(cass.request, p2, `${marker} x`)).error).toBeDefined()
      for (const id of [c1.value?.comment.id, c2.value?.comment.id]) {
        const res = await fbFn(cass.request, 'comments', 'addReactionFn', {
          commentId: id,
          emoji: '👍',
        })
        expect(res.error, String(id)).toMatchObject({ statusCode: 403 })
      }
    }
  )

  test(
    'FBP-C-15 with anonymous interaction off, an anonymous session cannot react',
    {
      tag: ['@nightly', '@isolated'],
    },
    async ({ browser, people, marker }) => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
      await withSettings({ portal_config: { 'features.allowAnonymous': false } }, async () => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} post` })
        const admin = await adminSession(browser, people, marker)
        const c = await commentFn(admin.request, post, `${marker} words`)
        const anon = await portalCustomer(browser, marker, { anonymous: true })
        expect((await commentFn(anon.request, post, `${marker} x`)).error).toBeDefined()
        const res = await fbFn(anon.request, 'comments', 'addReactionFn', {
          commentId: c.value?.comment.id,
          emoji: '👍',
        })
        expect(res.error).toMatchObject({ statusCode: 403 })
      })
    }
  )

  test(
    'FBP-C-17 a teammate mentions a customer in a post: bell and email; no notice to self or to someone who cannot see it',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const hidden = await createBoard(marker, { suffix: 'hidden', access: { view: 'team' } })
      const cass = await portalCustomer(browser, marker, { name: `Cass ${marker.slice(-6)}` })
      const blind = await portalCustomer(browser, marker, { suffix: 'blind' })
      const admin = await adminSession(browser, people, marker)
      const adminP = people.people.admin
      const title = `${marker} roadmap thoughts`
      const created = await fbFn<{ id: string }>(
        admin.request,
        'publicPosts',
        'createPublicPostFn',
        {
          boardId: board.id,
          title,
          content: 'see',
          contentJson: mentionDoc('Hey', [
            { principalId: cass.principalId, name: cass.name },
            { principalId: adminP.principalId, name: adminP.displayName },
          ]),
        }
      )
      expect(created.error).toBeUndefined()
      const hiddenPost = await fbFn<{ id: string }>(
        admin.request,
        'publicPosts',
        'createPublicPostFn',
        {
          boardId: hidden.id,
          title: `${marker} secret plans`,
          content: 'see',
          contentJson: mentionDoc('Hey', [{ principalId: blind.principalId, name: blind.name }]),
        }
      )
      expect(hiddenPost.error).toBeUndefined()

      // The mentioned customer: an email and a bell.
      const mail = await mailFor(cass.email, `mentioned you in "${title}"`)
      const body = mailText(mail)
      expect(body).toContain('View Feedback')
      expect(body).toContain('because you were mentioned')
      const postUuid = (await supportDb()`SELECT id FROM posts WHERE title = ${title}`)[0]
        .id as string
      await expect
        .poll(async () => (await notificationsOf(cass.principalUuid, postUuid)).length)
        .toBe(1)
      const [bell] = await notificationsOf(cass.principalUuid, postUuid)
      expect(bell).toMatchObject({ type: 'post_mentioned', body: title })
      expect(bell.title).toMatch(/mentioned you in a post$/)

      // Nobody else: not the mentioner (self-mention), not the customer who
      // cannot see the hidden board.
      const hiddenUuid = (
        await supportDb()`SELECT id FROM posts WHERE title = ${`${marker} secret plans`}`
      )[0].id as string
      await waitForEventHandled(hiddenPost.value?.id as string, { type: 'post.mentioned' }).catch(
        () => waitForEventHandled(hiddenPost.value?.id as string)
      )
      expect(await notificationsOf(blind.principalUuid, hiddenUuid)).toHaveLength(0)
      expect(await mailsFor(blind.email)).toHaveLength(0)
      expect(await notificationsOf(uuid(adminP.principalId), postUuid)).toHaveLength(0)
    }
  )

  test(
    'FBP-C-19 a customer cannot make the system notify someone by crafting a mention in a post',
    {
      tag: '@nightly',
    },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const admin = people.people.admin
      const title = `${marker} crafted`
      const res = await fbFn<{ id: string }>(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title,
        content: 'hi',
        contentJson: mentionDoc('Psst', [
          { principalId: admin.principalId, name: admin.displayName },
        ]),
      })
      expect(res.error).toBeUndefined()
      const postId = res.value?.id as string
      // Everything the post set off has run.
      await waitForEventHandled(postId, { type: 'post.created' })
      const postUuid = (await supportDb()`SELECT id FROM posts WHERE title = ${title}`)[0]
        .id as string
      await expect
        .poll(async () =>
          (await notificationsOf(uuid(admin.principalId), postUuid)).map((n) => n.type)
        )
        .toEqual([])
      expect(await mailsFor(admin.email, `mentioned you in "${title}"`)).toHaveLength(0)
    }
  )

  test(
    'FBP-C-20 comment bodies render safely: no script, no javascript: link, customer external images cleared',
    { tag: '@nightly' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const admin = await adminSession(browser, people, marker)
      const evil = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `${marker} click me`,
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
              { type: 'text', text: ' <script>window.__pwned=1</script>' },
            ],
          },
          { type: 'image', attrs: { src: 'https://images.example.org/cass.png' } },
        ],
      }
      const c = await commentFn(cass.request, post, `${marker} click me`, { contentJson: evil })
      expect(c.error).toBeUndefined()
      const teamImg = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `${marker} team pic` }] },
          { type: 'image', attrs: { src: 'https://images.example.org/team.png' } },
        ],
      }
      const t = await commentFn(admin.request, post, `${marker} team pic`, { contentJson: teamImg })
      expect(t.error).toBeUndefined()

      const v = await portalCustomer(browser, marker, { suffix: 'viewer' })
      await v.page.goto(postPath(post))
      const mine = commentEl(v.page, c.value?.comment.id as string)
      await expect(mine).toContainText(`${marker} click me`)
      await expect(mine.locator('a[href^="javascript:"]')).toHaveCount(0)
      await expect(mine.locator('script')).toHaveCount(0)
      expect(await v.page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined()
      await expect(mine.locator('img[src*="images.example.org"]')).toHaveCount(0)
      const team = commentEl(v.page, t.value?.comment.id as string)
      await expect(team.locator('img[src="https://images.example.org/team.png"]')).toHaveCount(1)
    }
  )

  test(
    'FBP-C-24 comment.created carries the comment and post refs, once; a private team note is never delivered',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribeHook(api, marker, ['comment.created'])
      try {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} post` })
        const cass = await portalCustomer(browser, marker, { name: 'Webhook Cass' })
        const text = `${marker} hooked`
        const res = await commentFn(cass.request, post, text)
        expect(res.error).toBeUndefined()
        const id = res.value?.comment.id as string
        const [d] = await deliveriesOf(marker, 'comment.created', id)
        const data = bodyOf<Record<string, Record<string, unknown>>>(d).data
        expect(data.comment).toMatchObject({
          id,
          content: text,
          authorName: 'Webhook Cass',
          authorEmail: cass.email,
          isPrivate: false,
        })
        expect(data.post).toMatchObject({
          id: post.id,
          title: post.title,
          boardId: board.id,
          boardSlug: board.slug,
        })

        // A private team note is never sent to webhooks (webhook.resolver.ts
        // private-comment guard), although the event itself is recorded.
        const admin = await adminSession(browser, people, marker)
        const note = await commentFn(admin.request, post, `${marker} internal`, { isPrivate: true })
        const noteId = note.value?.comment.id as string
        expect(await waitForEventHandled(noteId, { type: 'comment.created' })).toBe(
          'comment.created'
        )
        // A later public comment is delivered, so the sink was listening.
        const later = await commentFn(cass.request, post, `${marker} later`)
        const laterId = later.value?.comment.id as string
        await deliveriesOf(marker, 'comment.created', laterId)
        const all = await sink.deliveries(marker)
        expect(all.filter((x) => x.body.includes(id))).toHaveLength(1)
        expect(all.filter((x) => x.body.includes(noteId))).toHaveLength(0)
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-C-24 an edit that holds a published comment again does not fire comment.created again on approval',
    { tag: ['@core', '@isolated'] },
    async ({ browser, playwright, baseURL, people, marker }) => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
      await withSettings({ portal_config: { 'moderationDefault.holdLinks': true } }, async () => {
        const api = await hooksApi(playwright, baseURL, people, marker)
        const hook = await subscribeHook(api, marker, ['comment.created'])
        try {
          const board = await createBoard(marker)
          const post = await seedPost(board, { title: `${marker} post` })
          const cass = await portalCustomer(browser, marker)
          const res = await commentFn(cass.request, post, `${marker} plain`)
          const id = res.value?.comment.id as string
          await deliveriesOf(marker, 'comment.created', id)
          const linked = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `${marker} now with a link`,
                    marks: [{ type: 'link', attrs: { href: 'https://elsewhere.example/x' } }],
                  },
                ],
              },
            ],
          }
          const edit = await fbFn(cass.request, 'comments', 'userEditCommentFn', {
            commentId: id,
            content: `${marker} now with a link`,
            contentJson: linked,
          })
          expect(edit.error).toBeUndefined()
          const [row] = await supportDb()`SELECT moderation_state FROM post_comments
            WHERE id = ${(await waitForComment(post.uuid, `${marker} now with a link`)).id as string}`
          expect(row.moderation_state).toBe('pending')
          await approveComment(await adminRest(playwright, marker), id)
          await expect
            .poll(async () => {
              const [r] = await supportDb()`SELECT moderation_state FROM post_comments
                WHERE content = ${`${marker} now with a link`}`
              return r?.moderation_state
            })
            .toBe('published')
          await waitForEventHandled(id).catch(() => undefined)
          const all = (await sink.deliveries(marker)).filter((x) => x.body.includes(id))
          expect(all).toHaveLength(1)
        } finally {
          await unsubscribe(api, hook)
        }
      })
    }
  )
})
