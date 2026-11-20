/**
 * Comments on the portal: writing, replying, the tiers and rules that refuse
 * a comment, private and held comments, the author's edit and delete, and
 * the counts.
 *
 * Journeys: FBP-C-01, FBP-C-02, FBP-C-03, FBP-C-04, FBP-C-05, FBP-C-06,
 * FBP-C-07, FBP-C-08, FBP-C-09, FBP-C-11, FBP-C-13, FBP-C-16, FBP-C-21,
 * FBP-C-22, FBP-C-23
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import {
  hooksApi,
  subscribe as subscribeHook,
  unsubscribe,
  deliveriesOf,
  bodyOf,
} from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import {
  adminRest,
  createBoard,
  fbFn,
  portalCustomer,
  postPath,
  postRow,
  restPost,
  seedComment,
  seedPost,
  status,
  untilAnonymousAllowed,
  visitor,
} from '../../product/feedback-portal'
import {
  adminSession,
  approveComment,
  commentEl,
  commentFn,
  subscriptionOf,
  waitForComment,
  writeComment,
} from '../../product/feedback-portal-notify'

/** The post detail as a viewer's server function answer, as text. */
async function detailText(request: Parameters<typeof fbFn>[0], postId: string): Promise<string> {
  const res = await fbFn(request, 'portal', 'fetchPublicPostDetail', { postId })
  expect(res.error).toBeUndefined()
  return JSON.stringify(res.value)
}

/** Ids of the rendered comments, in page order. */
function renderedCommentIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('[id^="comment-post_comment_"]')
    .evaluateAll((els) => els.map((e) => e.id.replace(/^comment-/, '')))
}

test.describe('portal comments', () => {
  test(
    'FBP-C-01 a signed-in customer comments: row, count, subscription, top of the thread, comment.created',
    { tag: '@smoke' },
    async ({ browser, playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribeHook(api, marker, ['comment.created'])
      try {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} post` })
        const author = await portalCustomer(browser, marker, { suffix: 'older' })
        const older = await seedComment(post, {
          content: `${marker} an older comment`,
          principalUuid: author.principalUuid,
          createdAt: new Date(Date.now() - 60_000),
        })
        const cass = await portalCustomer(browser, marker)
        await cass.page.goto(postPath(post))
        const text = `${marker} I need this too`
        await writeComment(cass.page, text)

        const row = await waitForComment(post.uuid, text)
        await expect(commentEl(cass.page, row.typeId)).toContainText(text)
        await expect(cass.page.getByRole('heading', { name: '2 Comments' })).toBeVisible()
        // Newest first: the new comment sits above the older one.
        const ids = await renderedCommentIds(cass.page)
        expect(ids.indexOf(row.typeId)).toBeGreaterThanOrEqual(0)
        expect(ids.indexOf(row.typeId)).toBeLessThan(ids.indexOf(older.id))
        expect(row).toMatchObject({
          principal_id: cass.principalUuid,
          moderation_state: 'published',
          is_private: false,
          is_team_member: false,
          parent_id: null,
        })
        expect((await postRow(post.uuid)).comment_count).toBe(2)
        expect(await subscriptionOf(post.uuid, cass.principalUuid)).toMatchObject({
          reason: 'comment',
          notify_comments: true,
          notify_status_changes: true,
        })
        const [d] = await deliveriesOf(marker, 'comment.created', row.typeId)
        const body = bodyOf<{ comment: { id: string }; post: { id: string } }>(d)
        expect(body.data.comment).toMatchObject({ id: row.typeId })
        expect(body.data.post).toMatchObject({ id: post.id })
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-C-02 a reply nests under its parent; the server checks the parent',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const other = await seedPost(board, { title: `${marker} other` })
      const cass = await portalCustomer(browser, marker)
      const parent = await seedComment(post, {
        content: `${marker} parent`,
        principalUuid: cass.principalUuid,
      })
      await cass.page.goto(postPath(post))
      const parentEl = commentEl(cass.page, parent.id)
      await expect(parentEl).toContainText(`${marker} parent`)
      await parentEl.getByTestId('reply-button').first().click()
      const text = `${marker} a reply`
      await writeComment(cass.page, text, { scope: parentEl, button: 'Reply' })

      const reply = await waitForComment(post.uuid, text)
      expect(reply.parent_id).toBe(parent.uuid)
      // Rendered inside the parent's element (nested), and counted.
      await expect(parentEl.locator(`[id="comment-${reply.typeId}"]`)).toContainText(text)
      await expect(cass.page.getByRole('heading', { name: '2 Comments' })).toBeVisible()
      expect((await postRow(post.uuid)).comment_count).toBe(2)

      // The parent must exist and belong to the same post.
      const missing = await commentFn(cass.request, post, `${marker} orphan`, {
        parentId: generateId('post_comment'),
      })
      expect(missing.error).toMatchObject({ code: 'INVALID_PARENT' })
      const foreign = await commentFn(cass.request, other, `${marker} wrong post`, {
        parentId: parent.id,
      })
      expect(foreign.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Parent comment belongs to a different post',
      })
      // A reply to a deleted parent is accepted.
      await supportDb()`UPDATE post_comments SET deleted_at = now() WHERE id = ${parent.uuid}`
      const late = await commentFn(cass.request, post, `${marker} late reply`, {
        parentId: parent.id,
      })
      expect(late.error).toBeUndefined()
    }
  )

  test(
    'FBP-C-03 a signed-out visitor on an authenticated-comment board is asked to sign in',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { access: { comment: 'authenticated' } })
      const post = await seedPost(board, { title: `${marker} post` })
      const v = await visitor(browser, marker)
      await v.page.goto(postPath(post))
      await expect(v.page.getByText('Sign in to comment')).toBeVisible()
      await expect(v.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      await expect(v.page.getByTestId('comment-form-editor')).toHaveCount(0)
    }
  )

  test(
    'FBP-C-03 with the anonymous switch on, a visitor comments anonymously on an anonymous-tier board',
    { tag: ['@core', '@isolated'] },
    async ({ browser, marker }) => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
      await withSettings({ portal_config: { 'features.allowAnonymous': true } }, async () => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} post` })
        const v = await visitor(browser, marker)
        await untilAnonymousAllowed(v.request, board)
        await v.page.goto(postPath(post))
        await expect(v.page.getByText('Posting anonymously')).toBeVisible()
        const text = `${marker} anonymous thought`
        await writeComment(v.page, text)
        const row = await waitForComment(post.uuid, text)
        const [p] = await supportDb()`SELECT type FROM principal WHERE id = ${row.principal_id}`
        expect(p.type).toBe('anonymous')
        await expect(commentEl(v.page, row.typeId)).toContainText(text)
      })
    }
  )

  test(
    'FBP-C-03 with the anonymous switch off, an anonymous comment is refused with the code votes and posts use',
    {
      tag: ['@core', '@isolated', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B04: comments.ts:84 throws ANONYMOUS_NOT_ENABLED; votes and posts throw ANONYMOUS_NOT_ALLOWED',
      },
    },
    async ({ browser, marker }) => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
      await withSettings({ portal_config: { 'features.allowAnonymous': false } }, async () => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} post` })
        const anon = await portalCustomer(browser, marker, { anonymous: true })
        const res = await commentFn(anon.request, post, `${marker} refused`)
        expect(res.error).toMatchObject({ statusCode: 403 })
        expect(
          await supportDb()`SELECT 1 FROM post_comments WHERE post_id = ${post.uuid}`
        ).toHaveLength(0)
        expect(res.error?.code).toBe('ANONYMOUS_NOT_ALLOWED')
      })
    }
  )

  test(
    'FBP-C-04 the board comment tier refuses customers: no-access copy, 403 reasons, team bypass',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const segBoard = await createBoard(marker, {
        suffix: 'seg',
        access: { comment: 'segments', segments: { comment: [generateId('segment')] } },
      })
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { comment: 'team' } })
      const segPost = await seedPost(segBoard, { title: `${marker} seg` })
      const teamPost = await seedPost(teamBoard, { title: `${marker} team` })
      const cass = await portalCustomer(browser, marker)

      const seg = await commentFn(cass.request, segPost, `${marker} no`)
      expect(seg.error).toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'Only specific groups can comment on this board',
      })
      const team = await commentFn(cass.request, teamPost, `${marker} no`)
      expect(team.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only team members can comment on this board',
      })
      // The signed-in customer is told they have no access (not to sign in).
      await cass.page.goto(postPath(teamPost))
      await expect(
        cass.page.getByText("You don't have access to comment on this board")
      ).toBeVisible()
      await expect(cass.page.getByText('Sign in to comment')).toHaveCount(0)

      // The team passes every tier.
      const admin = await adminSession(browser, people, marker)
      const ok = await commentFn(admin.request, teamPost, `${marker} team says hi`)
      expect(ok.error).toBeUndefined()
      expect(
        await supportDb()`SELECT 1 FROM post_comments
          WHERE post_id IN (${segPost.uuid}, ${teamPost.uuid}) AND principal_id = ${cass.principalUuid}`
      ).toHaveLength(0)
    }
  )

  test(
    'FBP-C-05 author-only reply policy: only the post author and the team reply',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker, { access: { replyPolicy: 'author-only' } })
      const author = await portalCustomer(browser, marker, { suffix: 'author' })
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const post = await seedPost(board, {
        title: `${marker} post`,
        authorPrincipalUuid: author.principalUuid,
      })
      const denied = await commentFn(other.request, post, `${marker} other says`)
      expect(denied.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only the post author and team members can reply on this board',
      })
      const section = await fbFn<{ canComment: boolean; replyPolicy: string }>(
        other.request,
        'portal',
        'getCommentsSectionDataFn',
        { postId: post.id }
      )
      expect(section.value).toMatchObject({ canComment: false, replyPolicy: 'author-only' })
      await other.page.goto(postPath(post))
      await expect(
        other.page.getByText('Only the post author and team members can reply on this board')
      ).toBeVisible()

      expect((await commentFn(author.request, post, `${marker} author says`)).error).toBeUndefined()
      const admin = await adminSession(browser, people, marker)
      expect((await commentFn(admin.request, post, `${marker} team says`)).error).toBeUndefined()
      const authorSection = await fbFn<{ canComment: boolean }>(
        author.request,
        'portal',
        'getCommentsSectionDataFn',
        { postId: post.id }
      )
      expect(authorSection.value?.canComment).toBe(true)
    }
  )

  test(
    'FBP-C-06 locked, merged and read-only posts refuse customer comments; the team may still comment',
    { tag: '@core' },
    async ({ browser, playwright, people, marker }) => {
      const board = await createBoard(marker)
      const ro = await createBoard(marker, { suffix: 'ro', readOnly: true })
      const locked = await seedPost(board, { title: `${marker} locked` })
      const dup = await seedPost(board, { title: `${marker} dup` })
      const canonical = await seedPost(board, { title: `${marker} canonical` })
      const roPost = await seedPost(ro, { title: `${marker} ro` })
      const cass = await portalCustomer(browser, marker)
      const mine = await seedComment(locked, {
        content: `${marker} mine before the lock`,
        principalUuid: cass.principalUuid,
      })
      await supportDb()`UPDATE posts SET is_comments_locked = true WHERE id = ${locked.uuid}`
      const api = await adminRest(playwright, marker)
      await restPost(api, `/posts/${dup.id}/merge`, { canonicalPostId: canonical.id })

      expect((await commentFn(cass.request, locked, `${marker} refused`)).error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Comments are locked on this post',
      })
      expect((await commentFn(cass.request, dup, `${marker} refused`)).error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'This post was merged into another post',
      })
      expect((await commentFn(cass.request, roPost, `${marker} refused`)).error).toMatchObject({
        code: 'BOARD_READ_ONLY',
        statusCode: 403,
      })
      expect(
        await supportDb()`SELECT 1 FROM post_comments WHERE content = ${`${marker} refused`}`
      ).toHaveLength(0)
      // The UI says why.
      await cass.page.goto(postPath(locked))
      await expect(cass.page.getByText('Comments are locked on this post')).toBeVisible()
      await cass.page.goto(postPath(roPost))
      await expect(
        cass.page.getByText("This board isn't taking new feedback right now.")
      ).toBeVisible()

      // The team bypasses the lock and the merge.
      const admin = await adminSession(browser, people, marker)
      expect(
        (await commentFn(admin.request, locked, `${marker} team on locked`)).error
      ).toBeUndefined()
      expect(
        (await commentFn(admin.request, dup, `${marker} team on merged`)).error
      ).toBeUndefined()

      // Editing an existing comment on a locked post is still allowed.
      const edit = await fbFn(cass.request, 'comments', 'userEditCommentFn', {
        commentId: mine.id,
        content: `${marker} edited after the lock`,
      })
      expect(edit.error).toBeUndefined()
    }
  )

  test(
    'FBP-C-07 comment validation: empty, whitespace, too long, unknown post',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const empty = await commentFn(cass.request, post, '')
      expect(empty.value).toBeUndefined()
      expect(empty.error).toBeDefined()
      expect((await commentFn(cass.request, post, '   ')).error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Content is required',
      })
      const long = await commentFn(cass.request, post, 'x'.repeat(5_001))
      expect(long.value).toBeUndefined()
      expect(long.error).toBeDefined()
      expect(
        (await commentFn(cass.request, { id: generateId('post') }, `${marker} gone`)).error
      ).toMatchObject({ code: 'POST_NOT_FOUND' })
      // Exactly 5,000 characters is fine, and angle brackets render as text.
      expect((await commentFn(cass.request, post, 'y'.repeat(5_000))).error).toBeUndefined()
      const odd = `${marker} <b>not bold</b> & 🦆`
      expect((await commentFn(cass.request, post, odd)).error).toBeUndefined()
      await cass.page.goto(postPath(post))
      await expect(cass.page.getByText(odd)).toBeVisible()
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM post_comments
        WHERE post_id = ${post.uuid}`
      expect(n).toBe(2)
    }
  )

  test(
    'FBP-C-08 customers neither see nor write private team comments',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const admin = await adminSession(browser, people, marker)
      const note = await commentFn(admin.request, post, `${marker} secret note`, {
        isPrivate: true,
      })
      expect(note.error).toBeUndefined()
      const open = await commentFn(admin.request, post, `${marker} public answer`)
      expect(open.error).toBeUndefined()
      const cass = await portalCustomer(browser, marker)

      const text = await detailText(cass.request, post.id)
      expect(text).toContain(`${marker} public answer`)
      expect(text).not.toContain('secret note')
      expect((await postRow(post.uuid)).comment_count).toBe(1)
      await cass.page.goto(postPath(post))
      await expect(cass.page.getByText(`${marker} public answer`)).toBeVisible()
      await expect(cass.page.getByText(`${marker} secret note`)).toHaveCount(0)

      const own = await commentFn(cass.request, post, `${marker} sneaky`, { isPrivate: true })
      expect(own.error).toMatchObject({
        code: 'PRIVATE_COMMENT_FORBIDDEN',
        message: 'Only team members can post private comments',
      })
      const reply = await commentFn(cass.request, post, `${marker} sneaky reply`, {
        parentId: note.value?.comment.id,
      })
      expect(reply.error).toMatchObject({ code: 'PRIVATE_COMMENT_FORBIDDEN' })
      const react = await fbFn(cass.request, 'comments', 'addReactionFn', {
        commentId: note.value?.comment.id,
        emoji: '👍',
      })
      expect(react.error).toMatchObject({ code: 'COMMENT_NOT_FOUND' })
      // The team's reply to a private comment is private too.
      const teamReply = await commentFn(admin.request, post, `${marker} team reply`, {
        parentId: note.value?.comment.id,
      })
      expect(teamReply.error).toBeUndefined()
      const [row] = await supportDb()`SELECT is_private FROM post_comments
        WHERE content = ${`${marker} team reply`}`
      expect(row.is_private).toBe(true)
    }
  )

  test(
    'FBP-C-09 a held comment shows to its author only, fires nothing, and approval releases it',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, marker }) => {
      const hookApi = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribeHook(hookApi, marker, ['comment.created'])
      try {
        const board = await createBoard(marker, { access: { moderation: { comments: 'on' } } })
        const post = await seedPost(board, { title: `${marker} post` })
        const cass = await portalCustomer(browser, marker, { suffix: 'author' })
        const other = await portalCustomer(browser, marker, { suffix: 'other' })
        const text = `${marker} held words`
        expect((await commentFn(cass.request, post, text)).error).toBeUndefined()
        const row = await waitForComment(post.uuid, text)
        expect(row.moderation_state).toBe('pending')
        expect((await postRow(post.uuid)).comment_count).toBe(0)
        expect(await subscriptionOf(post.uuid, cass.principalUuid)).toMatchObject({
          reason: 'comment',
        })
        expect(await detailText(cass.request, post.id)).toContain(text)
        expect(await detailText(other.request, post.id)).not.toContain(text)
        await cass.page.goto(postPath(post))
        await expect(commentEl(cass.page, row.typeId)).toContainText(text)
        await other.page.goto(postPath(post))
        await expect(other.page.getByText(text)).toHaveCount(0)
        expect(
          (await sink.deliveries(marker)).filter((x) => x.body.includes(row.typeId))
        ).toHaveLength(0)

        // Approval publishes it, counts it and only now fires comment.created, once.
        const api = await adminRest(playwright, marker)
        await approveComment(api, row.typeId)
        const [d] = await deliveriesOf(marker, 'comment.created', row.typeId)
        expect(bodyOf<{ comment: { id: string } }>(d).data.comment.id).toBe(row.typeId)
        expect((await postRow(post.uuid)).comment_count).toBe(1)
        expect(await detailText(other.request, post.id)).toContain(text)
        expect(
          (await sink.deliveries(marker)).filter((x) => x.body.includes(row.typeId))
        ).toHaveLength(1)
      } finally {
        await unsubscribe(hookApi, hook)
      }
    }
  )

  test(
    'FBP-C-09 the author of a held comment is not told that customers cannot see it',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B06: inline-moderation-actions.tsx:39-42 shows moderator copy to the author (comment-thread.tsx:808)',
      },
    },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { access: { moderation: { comments: 'on' } } })
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const text = `${marker} held words`
      expect((await commentFn(cass.request, post, text)).error).toBeUndefined()
      const row = await waitForComment(post.uuid, text)
      await cass.page.goto(postPath(post))
      const el = commentEl(cass.page, row.typeId)
      await expect(el).toContainText(text)
      await expect(el.getByText(/pending|review/i).first()).toBeVisible()
      await expect(el.getByText(/Customers cannot see/)).toHaveCount(0)
    }
  )

  test(
    'FBP-C-11 the author edits a comment: (edited), history kept, locked once the team replies',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const first = `${marker} first words`
      expect((await commentFn(cass.request, post, first)).error).toBeUndefined()
      const row = await waitForComment(post.uuid, first)
      await cass.page.goto(postPath(post))
      const el = commentEl(cass.page, row.typeId)
      await expect(el).toContainText(first)
      const edit = el.getByRole('button', { name: 'Edit', exact: true }).first()
      const editor = el
        .getByTestId('edit-comment-editor')
        .locator('.ProseMirror[contenteditable="true"]')
      await expect(async () => {
        await edit.click()
        await expect(editor).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await expect(editor).toContainText(first)
      await editor.click()
      await cass.page.keyboard.press('ControlOrMeta+a')
      await editor.pressSequentially(`${marker} better words`)
      await el.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(el).toContainText(`${marker} better words`)
      await expect(el.getByText('(edited)')).toBeVisible()
      const [after] = await supportDb()`SELECT content, updated_at FROM post_comments
        WHERE id = ${row.id}`
      expect(after.content).toBe(`${marker} better words`)
      expect(after.updated_at).not.toBeNull()
      const history = await supportDb()`SELECT previous_content FROM post_comment_edit_history
        WHERE comment_id = ${row.id}`
      expect(history.map((h) => h.previous_content)).toEqual([first])

      // Someone else cannot edit it.
      const theirs = await fbFn(other.request, 'comments', 'userEditCommentFn', {
        commentId: row.typeId,
        content: `${marker} hijack`,
      })
      expect(theirs.error).toMatchObject({
        code: 'EDIT_NOT_ALLOWED',
        message: 'You can only edit your own comments',
      })
      // Once a teammate replies, the author can no longer edit.
      const admin = await adminSession(browser, people, marker)
      expect(
        (await commentFn(admin.request, post, `${marker} team reply`, { parentId: row.typeId }))
          .error
      ).toBeUndefined()
      const lockedEdit = await fbFn(cass.request, 'comments', 'userEditCommentFn', {
        commentId: row.typeId,
        content: `${marker} too late`,
      })
      expect(lockedEdit.error).toMatchObject({
        code: 'EDIT_NOT_ALLOWED',
        statusCode: 403,
        message: 'Cannot edit comments that have received team member replies',
      })
      const [still] = await supportDb()`SELECT content FROM post_comments WHERE id = ${row.id}`
      expect(still.content).toBe(`${marker} better words`)
    }
  )

  test(
    'FBP-C-11 after a teammate replies, the author is no longer offered Edit or Delete',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B17: comment-thread.tsx:436-437 shows Edit/Delete to the author regardless of the team-reply lock',
      },
    },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const text = `${marker} my words`
      expect((await commentFn(cass.request, post, text)).error).toBeUndefined()
      const row = await waitForComment(post.uuid, text)
      const admin = await adminSession(browser, people, marker)
      expect(
        (await commentFn(admin.request, post, `${marker} team reply`, { parentId: row.typeId }))
          .error
      ).toBeUndefined()
      // The server knows: no edit, no delete.
      const perms = await fbFn<{ canEdit: boolean; canDelete: boolean }>(
        cass.request,
        'comments',
        'getCommentPermissionsFn',
        { commentId: row.typeId }
      )
      expect(perms.value).toEqual({ canEdit: false, canDelete: false })
      await cass.page.goto(postPath(post))
      const el = commentEl(cass.page, row.typeId)
      await expect(el).toContainText(text)
      // Count the comment's own buttons: the team reply has none for this customer.
      await expect(el.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
      await expect(el.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    }
  )

  test(
    'FBP-C-13 the author deletes comments: placeholder with replies, gone without, count, refusals',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const leafText = `${marker} lonely leaf`
      const parentText = `${marker} parent with a reply`
      expect((await commentFn(cass.request, post, leafText)).error).toBeUndefined()
      expect((await commentFn(cass.request, post, parentText)).error).toBeUndefined()
      const leaf = await waitForComment(post.uuid, leafText)
      const parent = await waitForComment(post.uuid, parentText)
      expect(
        (
          await commentFn(other.request, post, `${marker} customer reply`, {
            parentId: parent.typeId,
          })
        ).error
      ).toBeUndefined()
      expect((await postRow(post.uuid)).comment_count).toBe(3)

      // Someone else cannot delete it.
      expect(
        (await fbFn(other.request, 'comments', 'userDeleteCommentFn', { commentId: leaf.typeId }))
          .error
      ).toMatchObject({
        code: 'DELETE_NOT_ALLOWED',
        message: 'You can only delete your own comments',
      })

      await cass.page.goto(postPath(post))
      for (const c of [leaf, parent]) {
        const el = commentEl(cass.page, c.typeId)
        const dialog = cass.page.getByRole('alertdialog')
        await expect(async () => {
          await el.getByRole('button', { name: 'Delete', exact: true }).first().click()
          await expect(dialog.getByText('Delete this comment?')).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 20_000 })
        await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(dialog).toBeHidden()
      }
      await expect.poll(async () => (await postRow(post.uuid)).comment_count).toBe(1)
      const rows = await supportDb()`SELECT deleted_at, deleted_by_principal_id FROM post_comments
        WHERE id IN (${leaf.id as string}, ${parent.id as string})`
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.deleted_at).not.toBeNull()
        expect(r.deleted_by_principal_id).toBe(cass.principalUuid)
      }
      // Another viewer: the parent with a reply stays as a placeholder, the leaf is gone.
      await other.page.goto(postPath(post))
      await expect(commentEl(other.page, parent.typeId)).toContainText('[deleted]')
      await expect(other.page.getByText(`${marker} customer reply`)).toBeVisible()
      await expect(commentEl(other.page, leaf.typeId)).toHaveCount(0)
      await expect(other.page.getByText(parentText)).toHaveCount(0)

      // A comment with a team reply can no longer be deleted by its author.
      const keep = `${marker} answered`
      expect((await commentFn(cass.request, post, keep)).error).toBeUndefined()
      const kept = await waitForComment(post.uuid, keep)
      const admin = await adminSession(browser, people, marker)
      expect(
        (await commentFn(admin.request, post, `${marker} team answer`, { parentId: kept.typeId }))
          .error
      ).toBeUndefined()
      expect(
        (await fbFn(cass.request, 'comments', 'userDeleteCommentFn', { commentId: kept.typeId }))
          .error
      ).toMatchObject({
        code: 'DELETE_NOT_ALLOWED',
        message: 'Cannot delete comments that have received team member replies',
      })
    }
  )

  test(
    'FBP-C-16 customers see the Team badge, the status-change chip and the Pinned badge, and no Pin button',
    { tag: '@nightly' },
    async ({ browser, people, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const admin = await adminSession(browser, people, marker)
      const planned = await status('planned')
      const res = await commentFn(admin.request, post, `${marker} we are on it`, {
        statusId: planned.id,
      })
      expect(res.error).toBeUndefined()
      const id = res.value?.comment.id as string
      const pin = await fbFn(admin.request, 'comments', 'pinCommentFn', { commentId: id })
      expect(pin.error).toBeUndefined()
      const cass = await portalCustomer(browser, marker)
      await cass.page.goto(postPath(post))
      const el = commentEl(cass.page, id).first()
      await expect(el).toContainText(`${marker} we are on it`)
      await expect(el.getByLabel(/ Member$/).first()).toBeVisible()
      await expect(el.getByText('changed status to')).toBeVisible()
      await expect(el.getByText('Planned').first()).toBeVisible()
      await expect(el.getByText(/Pinned/).first()).toBeVisible()
      await expect(cass.page.getByRole('button', { name: 'Pin', exact: true })).toHaveCount(0)
    }
  )

  test(
    'FBP-C-21 after the board turns team-only, the author can no longer edit, delete or react',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const text = `${marker} mine`
      expect((await commentFn(cass.request, post, text)).error).toBeUndefined()
      const row = await waitForComment(post.uuid, text)
      // Control: before the flip, reacting works.
      expect(
        (
          await fbFn(cass.request, 'comments', 'addReactionFn', {
            commentId: row.typeId,
            emoji: '🎉',
          })
        ).error
      ).toBeUndefined()
      await supportDb()`UPDATE boards SET access = jsonb_set(access, '{view}', '"team"')
        WHERE id = ${board.uuid}`
      for (const [name, data] of [
        ['userEditCommentFn', { commentId: row.typeId, content: `${marker} changed` }],
        ['userDeleteCommentFn', { commentId: row.typeId }],
        ['addReactionFn', { commentId: row.typeId, emoji: '👍' }],
      ] as const) {
        const res = await fbFn(cass.request, 'comments', name, data)
        expect(res.error, name).toMatchObject({ statusCode: 404 })
      }
      const [still] = await supportDb()`SELECT content, deleted_at FROM post_comments
        WHERE id = ${row.id as string}`
      expect(still).toEqual({ content: text, deleted_at: null })
    }
  )

  test(
    'FBP-C-22 comment_count counts public, published, undeleted comments only',
    { tag: '@core' },
    async ({ browser, people, marker }) => {
      const held = await createBoard(marker, { access: { moderation: { comments: 'on' } } })
      const post = await seedPost(held, { title: `${marker} post` })
      const cass = await portalCustomer(browser, marker)
      const admin = await adminSession(browser, people, marker)
      // A team comment is never held; a private one is never counted.
      expect((await commentFn(admin.request, post, `${marker} public team`)).error).toBeUndefined()
      expect(
        (await commentFn(admin.request, post, `${marker} private`, { isPrivate: true })).error
      ).toBeUndefined()
      // The customer's is held.
      expect((await commentFn(cass.request, post, `${marker} held`)).error).toBeUndefined()
      const extra = await commentFn(admin.request, post, `${marker} doomed`)
      expect((await postRow(post.uuid)).comment_count).toBe(2)
      const del = await fbFn(admin.request, 'comments', 'userDeleteCommentFn', {
        commentId: extra.value?.comment.id,
      })
      expect(del.error).toBeUndefined()
      expect((await postRow(post.uuid)).comment_count).toBe(1)
      // Another customer's heading counts what they can see: the one public comment.
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      await other.page.goto(postPath(post))
      await expect(other.page.getByRole('heading', { name: /^1 Comment$/ })).toBeVisible()
    }
  )

  test(
    'FBP-C-23 a signed-out visitor reads the thread newest first, with names and no editor or Edit',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} post` })
      const a = await portalCustomer(browser, marker, { suffix: 'a', name: 'Alma Early' })
      const b = await portalCustomer(browser, marker, { suffix: 'b', name: 'Bert Late' })
      const old = await seedComment(post, {
        content: `${marker} early`,
        principalUuid: a.principalUuid,
        createdAt: new Date(Date.now() - 3 * 3600_000),
      })
      const recent = await seedComment(post, {
        content: `${marker} late`,
        principalUuid: b.principalUuid,
        createdAt: new Date(Date.now() - 60_000),
      })
      const v = await visitor(browser, marker)
      await v.page.goto(postPath(post))
      await expect(v.page.getByRole('heading', { name: '2 Comments' })).toBeVisible()
      const ids = await renderedCommentIds(v.page)
      expect(ids.indexOf(recent.id)).toBeGreaterThanOrEqual(0)
      expect(ids.indexOf(recent.id)).toBeLessThan(ids.indexOf(old.id))
      await expect(commentEl(v.page, old.id)).toContainText('Alma Early')
      await expect(commentEl(v.page, recent.id)).toContainText('Bert Late')
      await expect(v.page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
      await expect(v.page.getByTestId('comment-form-editor')).toHaveCount(0)
      // One comment reads in the singular.
      await supportDb()`UPDATE post_comments SET deleted_at = now() WHERE id = ${recent.uuid}`
      await supportDb()`UPDATE posts SET comment_count = 1 WHERE id = ${post.uuid}`
      await v.page.reload()
      await expect(v.page.getByRole('heading', { name: /^1 Comment$/ })).toBeVisible()
    }
  )
})
