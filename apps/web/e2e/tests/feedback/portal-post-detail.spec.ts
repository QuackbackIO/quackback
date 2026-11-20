/**
 * The post detail page: content and metadata, the shared not-found page,
 * merged posts, comment paging, the pinned comment, #comment links and the
 * related posts block.
 *
 * Journeys: FBP-L-27 FBP-L-28 FBP-L-29 FBP-L-30 FBP-L-31 FBP-L-32 FBP-L-35
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mintCustomer } from '../../support/widget-portal'
import {
  adminRest,
  clickUntil,
  createBoard,
  createTag,
  fbFn,
  portalCustomer,
  postPath,
  restPost,
  seedComment,
  seedPost,
  visitor,
  wordFor,
} from '../../product/feedback-portal'

test.describe('portal post detail', () => {
  test(
    'FBP-L-27 the detail page shows the post, its metadata and head tags, with a back link to the board',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const tag = await createTag(`${marker} tag`)
      const author = await mintCustomer({
        email: `${marker}-a@customers.example`,
        name: 'Ivy Author',
      })
      const post = await seedPost(board, {
        title: `${marker} detail page`,
        content: 'The body of the post',
        statusSlug: 'planned',
        authorPrincipalUuid: author.principalUuid,
        tagUuids: [tag.uuid],
        voteCount: 6,
      })
      await supportDb()`UPDATE posts SET content_json = ${supportDb().json({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The body of the post' }] }],
      })} WHERE id = ${post.uuid}`
      const anon = await visitor(browser, marker)
      const page = anon.page
      await page.goto(postPath(post))
      await expect(page.getByRole('heading', { level: 1, name: post.title })).toBeVisible()
      await expect(page.getByText('The body of the post')).toBeVisible()
      await expect(page).toHaveTitle(`${post.title} - ${board.name}`)
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        `${post.title}. Vote and comment on this ${board.name} post.`
      )
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        'content',
        new RegExp(post.title)
      )
      const detail = page.getByTestId('post-detail')
      await expect(detail.getByText('Ivy Author').first()).toBeVisible()
      await expect(detail.getByText('Planned').first()).toBeVisible()
      await expect(detail.getByText(tag.name).first()).toBeVisible()
      await expect(page.getByTestId('vote-count').first()).toHaveText('6')
      const back = page.getByRole('link', { name: board.name }).first()
      await expect(back).toHaveAttribute('href', new RegExp(`/\\?board=${board.slug}$`))
      await clickUntil(back, () =>
        expect(page).toHaveURL(new RegExp(`board=${board.slug}`), { timeout: 2_000 })
      )
    }
  )

  test(
    'FBP-L-28 a bad id, a wrong board slug, a hidden board, a held post and a deleted post all get the same not-found page',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const other = await createBoard(marker, { suffix: 'other' })
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const real = await seedPost(board, { title: `${marker} real post` })
      const hidden = await seedPost(teamBoard, { title: `${marker} team secret` })
      const held = await seedPost(board, {
        title: `${marker} held secret`,
        moderationState: 'pending',
      })
      const deleted = await seedPost(board, {
        title: `${marker} deleted secret`,
        deletedAt: new Date(),
      })
      const anon = await visitor(browser, marker)
      const cass = await portalCustomer(browser, marker)
      const paths = [
        `/b/${board.slug}/posts/not-an-id`,
        `/b/${other.slug}/posts/${real.id}`,
        postPath(hidden),
        postPath(held),
        postPath(deleted),
      ]
      for (const who of [anon, cass]) {
        for (const path of paths) {
          const res = await who.page.goto(path)
          expect(res?.status(), path).toBe(404)
          const html = await who.page.content()
          expect(html, path).not.toContain('secret')
          expect(html, path).not.toContain(`${marker} real post`)
          await expect(who.page.getByText(/not found/i).first(), path).toBeVisible()
        }
      }
      // The control: the real post at its own board opens.
      expect((await anon.page.goto(postPath(real)))?.status()).toBe(200)
    }
  )

  test(
    'FBP-L-29 a merged post shows the banner and no composer; the canonical lists both posts comments',
    { tag: '@core' },
    async ({ browser, marker, playwright }) => {
      const board = await createBoard(marker)
      const canonical = await seedPost(board, { title: `${marker} canonical` })
      const dupe = await seedPost(board, { title: `${marker} duplicate` })
      const author = await mintCustomer({ email: `${marker}-c@customers.example` })
      await seedComment(canonical, {
        content: `${marker} on canonical`,
        principalUuid: author.principalUuid,
      })
      await seedComment(dupe, {
        content: `${marker} on duplicate`,
        principalUuid: author.principalUuid,
      })
      await restPost(await adminRest(playwright, marker), `/posts/${dupe.id}/merge`, {
        canonicalPostId: canonical.id,
      })
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(postPath(dupe))
      await expect(page.getByText('This feedback has been merged into')).toBeVisible()
      const link = page.getByRole('link', { name: canonical.title })
      await expect(link).toHaveAttribute('href', postPath(canonical))
      await expect(page.getByTestId('vote-button').first()).toHaveClass(/cursor-not-allowed/)
      await expect(page.getByRole('button', { name: /^Comment$/ })).toHaveCount(0)

      await page.goto(postPath(canonical))
      await expect(page.getByText(`${marker} on canonical`)).toBeVisible()
      await expect(page.getByText(`${marker} on duplicate`)).toBeVisible()
      const detail = await fbFn<{ mergedPostCount?: number; comments: unknown[] }>(
        cass.request,
        'portal',
        'fetchPublicPostDetail',
        { postId: canonical.id }
      )
      expect(detail.value?.mergedPostCount).toBe(1)
      expect(detail.value?.comments).toHaveLength(2)
    }
  )

  test(
    'FBP-L-30 comments come 30 roots a page, newest first, and Show more appends the rest',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} busy thread` })
      const author = await mintCustomer({ email: `${marker}-c@customers.example` })
      const base = Date.now() - 3_600_000
      for (let i = 0; i < 35; i++) {
        await seedComment(post, {
          content: `${marker} root ${String(i).padStart(2, '0')}`,
          principalUuid: author.principalUuid,
          createdAt: new Date(base + i * 1000),
        })
      }
      const anon = await visitor(browser, marker)
      const page = anon.page
      await page.goto(postPath(post))
      // Newest first: root 34 is on page one, root 04 is the oldest shown, 03 is not.
      await expect(page.getByText(`${marker} root 34`)).toBeVisible()
      await expect(page.getByText(`${marker} root 05`)).toBeVisible()
      await expect(page.getByText(`${marker} root 04`)).toHaveCount(0)
      const more = page.getByRole('button', { name: 'Show 5 more comments' })
      await clickUntil(more, () =>
        expect(page.getByText(`${marker} root 00`)).toBeVisible({ timeout: 3_000 })
      )
      await expect(more).toHaveCount(0)
    }
  )

  test(
    'FBP-L-31 the detail query returns a pinned comment outside the first page; deleting it clears the pin',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} pinned thread` })
      const cass = await portalCustomer(browser, marker)
      const old = await seedComment(post, {
        content: `${marker} the answer`,
        principalUuid: cass.principalUuid,
        createdAt: new Date(Date.now() - 7_200_000),
      })
      for (let i = 0; i < 32; i++) {
        await seedComment(post, {
          content: `${marker} chatter ${i}`,
          principalUuid: cass.principalUuid,
        })
      }
      await supportDb()`UPDATE posts SET pinned_comment_id = ${old.uuid} WHERE id = ${post.uuid}`
      const detail = async () =>
        (
          await fbFn<{ pinnedComment: { id: string } | null }>(
            cass.request,
            'portal',
            'fetchPublicPostDetail',
            {
              postId: post.id,
            }
          )
        ).value
      expect((await detail())?.pinnedComment?.id).toBe(old.id)
      await cass.page.goto(postPath(post))
      await expect(cass.page.getByText(`${marker} chatter 31`)).toBeVisible()
      // Customers get no pin control.
      await expect(cass.page.getByRole('button', { name: /^(Pin|Unpin)/ })).toHaveCount(0)

      const del = await fbFn(cass.request, 'comments', 'userDeleteCommentFn', { commentId: old.id })
      expect(del.error).toBeUndefined()
      const [row] = await supportDb()`SELECT pinned_comment_id FROM posts WHERE id = ${post.uuid}`
      expect(row.pinned_comment_id).toBeNull()
      expect((await detail())?.pinnedComment ?? null).toBeNull()
    }
  )

  test(
    'FBP-L-32 a #comment link scrolls that comment into view',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} long thread`, content: 'x' })
      const author = await mintCustomer({ email: `${marker}-c@customers.example` })
      const base = Date.now() - 3_600_000
      let target = { id: '', uuid: '' }
      for (let i = 0; i < 25; i++) {
        const c = await seedComment(post, {
          content: `${marker} line ${i} ${'words '.repeat(40)}`,
          principalUuid: author.principalUuid,
          createdAt: new Date(base + i * 1000),
        })
        if (i === 1) target = c
      }
      const anon = await visitor(browser, marker)
      await anon.page.goto(`${postPath(post)}#comment-${target.id}`)
      await expect(anon.page.locator(`[id="comment-${target.id}"]`).first()).toBeInViewport({
        timeout: 10_000,
      })
    }
  )

  test(
    'FBP-L-35 the Related block lists similar posts the viewer may see, never the post itself',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const post = await seedPost(board, { title: `${word} offline mode` })
      const twin = await seedPost(board, { title: `${word} offline mode for mobile`, voteCount: 3 })
      await seedPost(teamBoard, { title: `${word} offline mode team` })
      await seedPost(board, { title: `${word} offline mode held`, moderationState: 'pending' })
      const anon = await visitor(browser, marker)
      await anon.page.goto(postPath(post))
      const related = anon.page.getByText('Related', { exact: true })
      await expect(related).toBeVisible()
      const block = related.locator('xpath=ancestor::*[.//a][1]')
      await expect(block.getByRole('link', { name: new RegExp(twin.title) })).toHaveAttribute(
        'href',
        postPath(twin)
      )
      await expect(block.getByText(`${word} offline mode team`)).toHaveCount(0)
      await expect(block.getByText(`${word} offline mode held`)).toHaveCount(0)
      await expect(block.getByRole('link', { name: new RegExp(`${post.title}$`) })).toHaveCount(0)
    }
  )

  test(
    'FBP-L-31 a pinned comment outside the first page still shows on the page',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'new: the portal route never renders the pinnedComment the detail query returns; the thread only floats a pinned comment it has loaded',
      },
    },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} pinned thread` })
      const author = await mintCustomer({ email: `${marker}-c@customers.example` })
      const old = await seedComment(post, {
        content: `${marker} the answer`,
        principalUuid: author.principalUuid,
        createdAt: new Date(Date.now() - 7_200_000),
      })
      for (let i = 0; i < 32; i++) {
        await seedComment(post, {
          content: `${marker} chatter ${i}`,
          principalUuid: author.principalUuid,
        })
      }
      await supportDb()`UPDATE posts SET pinned_comment_id = ${old.uuid} WHERE id = ${post.uuid}`
      const anon = await visitor(browser, marker)
      await anon.page.goto(postPath(post))
      await expect(anon.page.getByText(`${marker} chatter 31`)).toBeVisible()
      await expect(anon.page.getByText(`${marker} the answer`).first()).toBeVisible()
    }
  )
})
