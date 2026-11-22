/**
 * The author's own edit and delete of a post, and the refusals.
 *
 * D13: a customer can edit or delete their own post until the team acts on it
 * (a status change off the default, a public team reply, a merge), and once
 * the team has acted the window stays closed. Their own auto-vote and other
 * customers' comments leave it open; another customer's vote closes delete
 * only, so their vote is not lost.
 *
 * Journeys: FBP-S-17 FBP-S-18 FBP-S-19 FBP-S-20
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { bodyOf, deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import { mintCustomer } from '../../support/widget-portal'
import {
  cardFor,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  postRow,
  seedComment,
  seedPost,
  seedVotes,
  status,
  uuid,
  visitor,
  type PortalCustomer,
  type TestBoard,
} from '../../product/feedback-portal'

interface Perms {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

/** A post the customer wrote through the portal, still carrying their auto-vote. */
async function ownPost(cass: PortalCustomer, board: TestBoard, title: string) {
  const created = await fbFn<{ id: string }>(cass.request, 'publicPosts', 'createPublicPostFn', {
    boardId: board.id,
    title,
    content: 'first words',
  })
  const id = created.value?.id as string
  return { id, uuid: uuid(id), title, board }
}

/** A public reply from a teammate: the team has acted on the post. */
const teamReply = (post: { uuid: string }, teammateUuid: string) =>
  seedComment(post as Parameters<typeof seedComment>[0], {
    content: 'Thanks, we are on it',
    principalUuid: teammateUuid,
    isTeamMember: true,
  })

const perms = async (cass: Pick<PortalCustomer, 'request'>, postId: string) =>
  (await fbFn<Perms>(cass.request, 'publicPosts', 'getPostPermissionsFn', { postId })).value

test.describe('portal author actions', () => {
  test(
    'FBP-S-18 edit refusals carry a typed code and the same reason the permission check gives',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const cass = await portalCustomer(browser, marker, { suffix: 'author' })
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const stranger = await mintCustomer({ email: `${marker}-s@customers.example` })
      const teammate = await mintCustomer({ email: `${marker}-t@customers.example` })
      await supportDb()`UPDATE principal SET role = 'member' WHERE id = ${teammate.principalUuid}`
      const edit = (who: PortalCustomer, postId: string, title = `${marker} edited`) =>
        fbFn(who.request, 'publicPosts', 'userEditPostFn', { postId, title, content: 'x' })

      // Someone else's post.
      const mine = await ownPost(cass, board, `${marker} mine`)
      expect((await edit(other, mine.id)).error).toMatchObject({
        code: 'EDIT_NOT_ALLOWED',
        message: 'You can only edit your own posts',
      })
      // Reviewed by the team (status moved off the default).
      const reviewed = await ownPost(cass, board, `${marker} reviewed`)
      await supportDb()`UPDATE posts SET status_id = ${(await status('planned')).uuid} WHERE id = ${reviewed.uuid}`
      // Replied to by the team.
      const replied = await ownPost(cass, board, `${marker} replied`)
      await teamReply(replied, teammate.principalUuid)
      // Voted by someone else: that does not close the window.
      const voted = await ownPost(cass, board, `${marker} voted`)
      await seedVotes({ ...voted }, [stranger.principalUuid])
      expect(await perms(cass, voted.id)).toMatchObject({
        canEdit: true,
        canDelete: false,
        deleteReason: 'Cannot delete posts other people have voted on',
      })
      // Deleted.
      const deleted = await ownPost(cass, board, `${marker} deleted`)
      await supportDb()`UPDATE posts SET deleted_at = now() WHERE id = ${deleted.uuid}`

      for (const [post, reason] of [
        [reviewed, 'Cannot edit posts that have been reviewed by the team'],
        [replied, 'Cannot edit posts the team has replied to'],
      ] as const) {
        expect((await perms(cass, post.id))?.editReason, post.title).toBe(reason)
        expect((await edit(cass, post.id)).error, post.title).toMatchObject({
          code: 'EDIT_NOT_ALLOWED',
          message: reason,
        })
        expect((await postRow(post.uuid)).title, post.title).toBe(post.title)
      }
      expect((await edit(cass, deleted.id)).error?.code).toMatch(/EDIT_NOT_ALLOWED|POST_NOT_FOUND/)

      // A post the caller cannot see is not found, before any ownership check.
      const hidden = await seedPost(teamBoard, {
        title: `${marker} hidden`,
        authorPrincipalUuid: cass.principalUuid,
      })
      expect((await edit(cass, hidden.id)).error).toMatchObject({ code: 'POST_NOT_FOUND' })
      // The schema bounds the title.
      expect((await edit(cass, mine.id, 'x'.repeat(201))).error).toBeDefined()
      // No session: authentication required.
      const anon = await visitor(browser, marker)
      const res = await fbFn(anon.request, 'publicPosts', 'userEditPostFn', {
        postId: mine.id,
        title: `${marker} anon`,
        content: '',
      })
      expect(res.error).toBeDefined()
      expect((await postRow(mine.uuid)).title).toBe(mine.title)
    }
  )

  test(
    'FBP-S-20 the author deletes their post: soft delete, activity, webhook, gone from the feed',
    { tag: '@core' },
    async ({ browser, marker, playwright, baseURL, people }) => {
      const board = await createBoard(marker)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['post.deleted'])
      try {
        const cass = await portalCustomer(browser, marker, { suffix: 'author' })
        const other = await portalCustomer(browser, marker, { suffix: 'other' })
        const teammate = await mintCustomer({ email: `${marker}-t@customers.example` })
        await supportDb()`UPDATE principal SET role = 'member' WHERE id = ${teammate.principalUuid}`
        const post = await ownPost(cass, board, `${marker} to delete`)
        const keep = await ownPost(cass, board, `${marker} keep`)
        // Not someone else's.
        expect(
          (await fbFn(other.request, 'publicPosts', 'userDeletePostFn', { postId: post.id })).error
        ).toMatchObject({
          code: 'DELETE_NOT_ALLOWED',
          message: 'You can only delete your own posts',
        })

        const res = await fbFn(cass.request, 'publicPosts', 'userDeletePostFn', { postId: post.id })
        expect(res.error).toBeUndefined()
        const row = await postRow(post.uuid)
        expect(row.deleted_at).not.toBeNull()
        expect(row.deleted_by_principal_id).toBe(cass.principalUuid)
        // The activity row is written after the response (fire and forget).
        await expect
          .poll(
            async () =>
              (
                await supportDb()`SELECT 1 FROM post_activity
            WHERE post_id = ${post.uuid} AND type = 'post.deleted'`
              ).length
          )
          .toBe(1)
        const [d] = await deliveriesOf(marker, 'post.deleted', post.id)
        expect(bodyOf(d).data).toMatchObject({ post: { id: post.id, boardSlug: board.slug } })

        await cass.page.goto(`/?board=${board.slug}`)
        await expect(cardFor(cass.page, keep.title)).toBeVisible()
        await expect(cardFor(cass.page, post.title)).toHaveCount(0)
        expect((await cass.page.goto(postPath(post)))?.status()).toBe(404)

        // A second delete is refused.
        expect(
          (await fbFn(cass.request, 'publicPosts', 'userDeletePostFn', { postId: post.id })).error
        ).toBeDefined()
        // Another customer's vote closes delete, so their vote is not lost.
        const voted = await ownPost(cass, board, `${marker} voted`)
        await seedVotes({ ...voted }, [other.principalUuid])
        expect(
          (await fbFn(cass.request, 'publicPosts', 'userDeletePostFn', { postId: voted.id })).error
        ).toMatchObject({
          code: 'DELETE_NOT_ALLOWED',
          message: 'Cannot delete posts other people have voted on',
        })
        expect((await postRow(voted.uuid)).deleted_at).toBeNull()
        // A post the team replied to cannot be deleted, even once the reply is gone.
        const replied = await ownPost(cass, board, `${marker} replied`)
        const reply = await teamReply(replied, teammate.principalUuid)
        await supportDb()`UPDATE post_comments SET deleted_at = now() WHERE id = ${reply.uuid}`
        expect(
          (await fbFn(cass.request, 'publicPosts', 'userDeletePostFn', { postId: replied.id }))
            .error
        ).toMatchObject({
          code: 'DELETE_NOT_ALLOWED',
          message: 'Cannot delete posts the team has replied to',
        })
        expect((await postRow(replied.uuid)).deleted_at).toBeNull()
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-S-17 the author of a fresh post can edit and delete it despite their own vote',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const created = await fbFn<{ id: string }>(
        cass.request,
        'publicPosts',
        'createPublicPostFn',
        {
          boardId: board.id,
          title: `${marker} fresh`,
        }
      )
      const id = created.value?.id as string
      expect((await postRow(uuid(id))).vote_count).toBe(1)
      expect(await perms(cass, id)).toMatchObject({ canEdit: true, canDelete: true })
      await cass.page.goto(postPath({ id, board }))
      await expect(
        cass.page.getByRole('heading', { level: 1, name: `${marker} fresh` })
      ).toBeVisible()
      const menu = cass.page.getByRole('button', { name: 'Post actions' })
      await expect(async () => {
        await menu.click()
        await expect(cass.page.getByRole('menuitem', { name: 'Edit' })).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 20_000 })
      await expect(cass.page.getByRole('menuitem', { name: 'Edit' })).not.toHaveAttribute(
        'data-disabled',
        /.*/
      )
      await expect(cass.page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    }
  )

  test(
    'FBP-S-17 the author edits their post until the team replies, whoever else comments',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker, { suffix: 'author' })
      const stranger = await mintCustomer({ email: `${marker}-s@customers.example` })
      const teammate = await mintCustomer({ email: `${marker}-t@customers.example` })
      await supportDb()`UPDATE principal SET role = 'member' WHERE id = ${teammate.principalUuid}`
      const post = await ownPost(cass, board, `${marker} draft title`)
      const res = await fbFn<{ title: string }>(cass.request, 'publicPosts', 'userEditPostFn', {
        postId: post.id,
        title: `${marker} better title`,
        content: 'second words',
      })
      expect(res.error).toBeUndefined()
      expect((await postRow(post.uuid)).title).toBe(`${marker} better title`)
      // Another customer's comment leaves the window open.
      await seedComment(post, { content: 'hello', principalUuid: stranger.principalUuid })
      expect(
        (
          await fbFn(cass.request, 'publicPosts', 'userEditPostFn', {
            postId: post.id,
            title: `${marker} still mine`,
            content: 'x',
          })
        ).error
      ).toBeUndefined()
      // A team reply closes it, with its reason.
      await teamReply(post, teammate.principalUuid)
      expect(
        (
          await fbFn(cass.request, 'publicPosts', 'userEditPostFn', {
            postId: post.id,
            title: `${marker} again`,
            content: 'x',
          })
        ).error
      ).toMatchObject({
        code: 'EDIT_NOT_ALLOWED',
        message: 'Cannot edit posts the team has replied to',
      })
    }
  )

  test.describe('content holds (workspace switch)', () => {
    test.beforeEach(() => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
    })

    test(
      'FBP-S-19 an author edit that adds an external link puts a published post back in the queue',
      { tag: ['@nightly', '@isolated'] },
      async ({ browser, marker }) => {
        await withSettings(
          {
            portal_config: {
              'moderationDefault.holdLinks': true,
              'features.allowEditAfterEngagement': true,
            },
          },
          async () => {
            const board = await createBoard(marker)
            const cass = await portalCustomer(browser, marker, { suffix: 'author' })
            const post = await ownPost(cass, board, `${marker} linkless`)
            expect((await postRow(post.uuid)).moderation_state).toBe('published')
            const res = await fbFn(cass.request, 'publicPosts', 'userEditPostFn', {
              postId: post.id,
              title: post.title,
              content: 'see https://example.com/thing',
              contentJson: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'see this',
                        marks: [{ type: 'link', attrs: { href: 'https://example.com/thing' } }],
                      },
                    ],
                  },
                ],
              },
            })
            expect(res.error).toBeUndefined()
            expect((await postRow(post.uuid)).moderation_state).toBe('pending')
            const [audit] = await supportDb()`SELECT metadata FROM audit_log
            WHERE event_type = 'post.moderation.held' AND target_id = ${post.id}`
            expect(audit?.metadata).toMatchObject({ previouslyPublished: true })
            const other = await portalCustomer(browser, marker, { suffix: 'other' })
            const list = await fbFn<{ items: { id: string }[] }>(
              other.request,
              'publicPosts',
              'listPublicPostsFn',
              {
                boardSlug: board.slug,
              }
            )
            expect(list.value?.items.map((p) => p.id)).toEqual([])
          }
        )
      }
    )
  })
})
