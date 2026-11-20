/**
 * Feedback in the widget: search, submitting and voting, the refusals the
 * widget shows, and the user menu counts.
 *
 * The widget server functions take any session token as their Bearer, so the
 * api journeys run in the shared shards; the browser journeys need the widget
 * switched on (off on a fresh workspace) and run in product-isolated.
 *
 * Journeys: FBP-W-03 FBP-W-05 FBP-W-07 FBP-W-12
 */
import type { FrameLocator, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import {
  mintCustomer,
  mintSessionToken,
  openWidget,
  signSsoToken,
  widgetSecret,
} from '../../support/widget-portal'
import {
  createBoard,
  fbFn,
  ipFor,
  postByTitle,
  seedComment,
  seedPost,
  seedVotes,
  wordFor,
  type TestBoard,
} from '../../product/feedback-portal'

const WIDGET_ON = { widget_config: { enabled: true, 'tabs.feedback': true } }

/** A fresh customer with a widget Bearer token. */
async function widgetCustomer(marker: string, suffix = 'w') {
  const customer = await mintCustomer({ email: `${marker}-${suffix}@customers.example` })
  return { ...customer, bearer: await mintSessionToken(customer.userUuid) }
}

interface Stats {
  ideas: number
  votes: number
  comments: number
}

test.describe('widget feedback', () => {
  test(
    'FBP-W-03 widget search finds posts by keyword, scoped to what the caller may see',
    { tag: '@core' },
    async ({ request, marker }) => {
      const word = wordFor(marker)
      const open = await createBoard(marker, { suffix: 'open' })
      const team = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const visible = await seedPost(open, { title: `${word} keyboard shortcuts` })
      await seedPost(team, { title: `${word} keyboard team` })
      await seedPost(open, { title: `${word} keyboard held`, moderationState: 'pending' })
      const res = await request.get(`/api/widget/search?q=${word}&limit=20`, {
        headers: { 'x-e2e-client-ip': ipFor(marker) },
      })
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { data: { posts: Array<{ id: string }> } }
      expect(body.data.posts.map((p) => p.id)).toEqual([visible.id])
      // An empty query answers no posts.
      const empty = await request.get('/api/widget/search?q=', {
        headers: { 'x-e2e-client-ip': ipFor(marker) },
      })
      expect(((await empty.json()) as { data: { posts: unknown[] } }).data.posts).toEqual([])
    }
  )

  test(
    'FBP-W-07 widget submit: a read-only board refuses, a holding board takes the post as pending',
    { tag: '@core' },
    async ({ request, marker }) => {
      const readOnly = await createBoard(marker, { suffix: 'ro', readOnly: true })
      const holding = await createBoard(marker, {
        suffix: 'hold',
        access: { moderation: { signedPosts: 'on' } },
      })
      const w = await widgetCustomer(marker)
      const refused = await fbFn(
        request,
        'widgetPosts',
        'widgetCreatePublicPostFn',
        { boardId: readOnly.id, title: `${marker} ro` },
        { bearer: w.bearer }
      )
      expect(refused.error).toMatchObject({ code: 'BOARD_READ_ONLY' })
      const held = await fbFn<{ id: string }>(
        request,
        'widgetPosts',
        'widgetCreatePublicPostFn',
        { boardId: holding.id, title: `${marker} held` },
        { bearer: w.bearer }
      )
      expect(held.error).toBeUndefined()
      expect(await postByTitle(holding, `${marker} held`)).toMatchObject({
        moderation_state: 'pending',
        principal_id: w.principalUuid,
      })
      // Without a session the widget cannot post.
      const none = await fbFn(request, 'widgetPosts', 'widgetCreatePublicPostFn', {
        boardId: holding.id,
        title: `${marker} nobody`,
      })
      expect(none.error).toBeDefined()
    }
  )

  test(
    'FBP-W-12 the widget user menu counts the person posts, votes and comments',
    { tag: '@nightly' },
    async ({ request, marker }) => {
      const board = await createBoard(marker)
      const w = await widgetCustomer(marker)
      const mine = await seedPost(board, {
        title: `${marker} mine`,
        authorPrincipalUuid: w.principalUuid,
      })
      const other = await seedPost(board, { title: `${marker} other` })
      await seedVotes(mine, [w.principalUuid])
      await seedVotes(other, [w.principalUuid])
      await seedComment(other, { content: 'nice', principalUuid: w.principalUuid })
      const stats = await fbFn<Stats>(request, 'widgetUser', 'widgetGetUserStatsFn', undefined, {
        bearer: w.bearer,
      })
      expect(stats.value).toEqual({ ideas: 1, votes: 2, comments: 1 })
    }
  )

  test(
    'FBP-W-12 the widget counts agree with the public profile: no held posts, no votes on deleted posts',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B29: runGetUserStats counts held posts, votes on soft-deleted posts and every undeleted comment',
      },
    },
    async ({ request, marker }) => {
      const board = await createBoard(marker)
      const w = await widgetCustomer(marker)
      await seedPost(board, { title: `${marker} live`, authorPrincipalUuid: w.principalUuid })
      await seedPost(board, {
        title: `${marker} held`,
        authorPrincipalUuid: w.principalUuid,
        moderationState: 'pending',
      })
      const gone = await seedPost(board, { title: `${marker} gone` })
      await seedVotes(gone, [w.principalUuid])
      await supportDb()`UPDATE posts SET deleted_at = now() WHERE id = ${gone.uuid}`
      const stats = await fbFn<Stats>(request, 'widgetUser', 'widgetGetUserStatsFn', undefined, {
        bearer: w.bearer,
      })
      expect(stats.value).toMatchObject({ ideas: 1, votes: 0 })
    }
  )

  test.describe('the widget in a browser', () => {
    test.beforeEach(() => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
    })

    /** Open the widget identified as a fresh customer, on its Feedback home. */
    async function identifiedWidget(page: Page, marker: string) {
      const email = `${marker}-id@customers.example`
      const ssoToken = signSsoToken(
        { id: email, email, name: 'Wid Get' },
        await widgetSecret(page.request)
      )
      const widget = await openWidget(page, { ssoToken })
      return { widget, email }
    }

    /** Type a post into the widget composer on `board` and submit it. */
    async function submitInWidget(widget: FrameLocator, board: TestBoard, title: string) {
      const box = widget.getByRole('textbox', { name: 'Feedback title' })
      await box.click()
      await box.fill(title)
      const picker = widget.getByRole('combobox').first()
      await picker.click()
      await widget.getByRole('option', { name: board.name }).click()
      await widget.getByRole('button', { name: 'Post', exact: true }).click()
    }

    test(
      'FBP-W-05 an identified customer votes and submits a post from the widget',
      { tag: ['@smoke', '@isolated'] },
      async ({ page, marker }) => {
        await withSettings(WIDGET_ON, async () => {
          const word = wordFor(marker)
          const board = await createBoard(marker)
          const target = await seedPost(board, { title: `${word} vote target`, voteCount: 2 })
          const { widget, email } = await identifiedWidget(page, marker)
          // Find the post by its word and vote on it.
          const search = widget.getByRole('button', { name: 'Search posts' })
          await search.click()
          await widget
            .getByRole('searchbox', { name: 'Search popular posts' })
            .or(widget.getByRole('textbox', { name: 'Search popular posts' }))
            .fill(word)
          const row = widget.locator('[data-testid="vote-button"]').first()
          await expect(widget.getByText(target.title)).toBeVisible()
          await row.click()
          await expect(row).toHaveAttribute('aria-pressed', 'true')
          await expect
            .poll(
              async () =>
                (await supportDb()`SELECT vote_count FROM posts WHERE id = ${target.uuid}`)[0]
                  .vote_count
            )
            .toBe(3)
          await widget.getByRole('button', { name: 'Close search' }).click()

          const title = `${word} widget idea`
          await submitInWidget(widget, board, title)
          await expect(widget.getByText('Thanks for your feedback!')).toBeVisible()
          await expect(widget.getByText(title)).toBeVisible()
          const row2 = await postByTitle(board, title)
          const [author] =
            await supportDb()`SELECT u.email FROM principal p JOIN "user" u ON u.id = p.user_id
            WHERE p.id = ${row2?.principal_id as string}`
          expect(author.email).toBe(email)
          expect(row2).toMatchObject({ moderation_state: 'published', vote_count: 1 })
        })
      }
    )

    test(
      'FBP-W-07 a board with a required custom field tells the widget visitor what is missing',
      {
        tag: ['@core', '@isolated', '@quarantine'],
        annotation: {
          type: 'quarantine',
          description:
            'FBP-B28: the widget composer never sends customFields, the server refuses the required field and the widget shows "Network error. Please try again."',
        },
      },
      async ({ page, marker }) => {
        await withSettings(WIDGET_ON, async () => {
          const board = await createBoard(marker, {
            customFields: [{ key: 'plan', label: 'Your plan', type: 'text', required: true }],
          })
          const { widget } = await identifiedWidget(page, marker)
          await submitInWidget(widget, board, `${marker} needs a field`)
          await expect(widget.getByText('Your plan')).toBeVisible()
          await expect(widget.getByText('Network error. Please try again.')).toHaveCount(0)
        })
      }
    )

    test(
      'FBP-W-07 a held widget post is confirmed as waiting for review',
      {
        tag: ['@core', '@isolated'],
      },
      async ({ page, marker }) => {
        await withSettings(WIDGET_ON, async () => {
          const board = await createBoard(marker, { access: { moderation: { signedPosts: 'on' } } })
          const { widget } = await identifiedWidget(page, marker)
          await submitInWidget(widget, board, `${marker} held in widget`)
          await expect(widget.getByText('Thanks for your feedback!')).toBeVisible()
          await expect(widget.getByText(/review/i).first()).toBeVisible()
        })
      }
    )
  })
})
