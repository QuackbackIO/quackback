/**
 * Submitting a post from the portal: the composer, the server's refusals,
 * held posts, the author's edit and delete, uploads and the post.created
 * webhook.
 *
 * Journeys: FBP-S-01
 */
import { test, expect } from '../../support/fixtures'
import { generateId } from '@quackback/ids'
import { supportDb } from '../../support/db'
import {
  cardFor,
  createBoard,
  fbFn,
  portalCustomer,
  postByTitle,
  startPost,
  status,
  titleBox,
  toastWith,
  typeDetails,
} from '../../product/feedback-portal'

test.describe('portal submit', () => {
  test(
    'FBP-S-01 a signed-in customer submits a post: published with their vote, subscribed, toast, card in the feed',
    { tag: '@smoke' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(`/?board=${board.slug}`)
      const title = `${marker} dark mode please`
      await startPost(page, title)
      await expect(page.getByLabel(`Posting to ${board.name}`)).toBeVisible()
      await typeDetails(page, 'My eyes hurt at night')
      await page.getByRole('button', { name: 'Post', exact: true }).click()

      const toast = toastWith(page, 'Feedback submitted')
      await expect(toast).toBeVisible()
      // The card appears without a reload, and the composer reset.
      await expect(cardFor(page, title)).toBeVisible()
      await expect(titleBox(page)).toHaveValue('')

      // The row: published, Open, one vote (the author's), the author subscribed.
      const row = await postByTitle(board, title)
      const open = await status('open')
      expect(row).toMatchObject({
        moderation_state: 'published',
        status_id: open.uuid,
        vote_count: 1,
        principal_id: cass.principalUuid,
      })
      expect(String(row?.content)).toContain('My eyes hurt at night')
      const postUuid = row?.id as string
      const votes =
        await supportDb()`SELECT principal_id FROM post_votes WHERE post_id = ${postUuid}`
      expect(votes.map((v) => v.principal_id)).toEqual([cass.principalUuid])
      const subs =
        await supportDb()`SELECT principal_id, reason, notify_comments, notify_status_changes
        FROM post_subscriptions WHERE post_id = ${postUuid}`
      expect(subs).toEqual([
        {
          principal_id: cass.principalUuid,
          reason: 'author',
          notify_comments: true,
          notify_status_changes: true,
        },
      ])

      // View in the toast opens the post.
      await toast.getByRole('button', { name: 'View' }).click()
      await expect(page).toHaveURL(new RegExp(`/b/${board.slug}/posts/post_`))
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    }
  )

  test(
    'FBP-S-04 the server refuses bad input and unknown or deleted boards',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const gone = await createBoard(marker, { suffix: 'gone' })
      await supportDb()`UPDATE boards SET deleted_at = now() WHERE id = ${gone.uuid}`
      const cass = await portalCustomer(browser, marker)
      const create = (data: Record<string, unknown>) =>
        fbFn(cass.request, 'publicPosts', 'createPublicPostFn', { boardId: board.id, ...data })

      // The schema refuses before the handler runs.
      for (const data of [
        { title: '' },
        { title: 'x'.repeat(201) },
        { title: `${marker} long`, content: 'y'.repeat(10_001) },
      ]) {
        const res = await create(data)
        expect(res.value, JSON.stringify(data).slice(0, 60)).toBeUndefined()
        expect(res.error?.message).toMatch(/Title is required|too_big|at most|200|10000/i)
      }
      // A whitespace title trims to empty inside createPost.
      const blank = await create({ title: '   ' })
      expect(blank.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Title is required' })

      // An unknown board and a soft-deleted board look the same: not found.
      for (const boardId of [gone.id, generateId('board')]) {
        const res = await create({ boardId, title: `${marker} nowhere` })
        expect(res.error, boardId).toMatchObject({ code: 'BOARD_NOT_FOUND' })
      }
      // Nothing was written for any refusal.
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM posts
        WHERE board_id IN (${board.uuid}, ${gone.uuid})`
      expect(n).toBe(0)
      // And a good one goes through (the refusals above were about the input).
      const ok = await create({ title: `${marker} fine` })
      expect(ok.error).toBeUndefined()
      expect(ok.value).toMatchObject({ title: `${marker} fine`, voteCount: 1 })
    }
  )
})
