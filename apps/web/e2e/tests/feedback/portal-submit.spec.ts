/**
 * Submitting a post from the portal: the composer, the server's refusals,
 * held posts, the author's edit and delete, uploads and the post.created
 * webhook.
 *
 * Journeys: FBP-S-01
 */
import { test, expect } from '../../support/fixtures'
import { fromUuid, generateId } from '@quackback/ids'
import { supportDb } from '../../support/db'
import { sink } from '../../support/webhook-sink-client'
import {
  bodyOf,
  deliveriesOf,
  expectSigned,
  hooksApi,
  subscribe,
  unsubscribe,
} from '../../support/webhooks'
import {
  adminRest,
  cardFor,
  createBoard,
  fbFn,
  portalCustomer,
  postByTitle,
  postPath,
  postRow,
  restPost,
  seedPost,
  startPost,
  status,
  titleBox,
  toastWith,
  typeDetails,
  uuid,
  visitor,
  wordFor,
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

  test(
    'FBP-S-02 a title alone posts; details keep a heading; Ctrl+Enter submits; Escape resets',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(`/?board=${board.slug}`)

      // Escape discards what was typed.
      await startPost(page, `${marker} discarded`)
      await titleBox(page).press('Escape')
      await expect(page.getByLabel(/^Posting to/)).toBeHidden()
      await expect(titleBox(page)).toHaveValue('')

      // A title alone.
      const bare = `${marker} title only`
      await startPost(page, bare)
      await page.getByRole('button', { name: 'Post', exact: true }).click()
      await expect(cardFor(page, bare)).toBeVisible()
      const bareRow = await postByTitle(board, bare)
      // No details: the stored text is empty (the editor may leave an empty document).
      expect(bareRow?.content).toBe('')
      expect(JSON.stringify(bareRow?.content_json ?? {})).not.toMatch(/"text"/)

      // Details with a heading, submitted from the keyboard.
      const rich = `${marker} with heading`
      await startPost(page, rich)
      await typeDetails(page, '# Big idea')
      await page.keyboard.press('Enter')
      await page.keyboard.type('the body line')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(cardFor(page, rich)).toBeVisible()
      const richRow = await postByTitle(board, rich)
      expect(String(richRow?.content)).toContain('# Big idea')
      await page.goto(postPath({ id: fromUuid('post', richRow?.id as string), board }))
      await expect(page.getByRole('heading', { name: 'Big idea' })).toBeVisible()
      await expect(page.getByText('the body line')).toBeVisible()
    }
  )

  test(
    'FBP-S-03 the composer refuses locally: no title, details too long; nothing reaches the server',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      const creates: string[] = []
      page.on('request', (r) => {
        if (r.url().includes('/_serverFn/') && r.method() === 'POST') creates.push(r.url())
      })
      await page.goto(`/?board=${board.slug}`)
      await startPost(page, '   ')
      const post = page.getByRole('button', { name: 'Post', exact: true })
      await post.click()
      await expect(page.getByText('Please add a title')).toBeVisible()

      await titleBox(page).fill(`${marker} too long`)
      await typeDetails(page, 'x')
      // 10,001 characters in one go (typing them would take minutes).
      await page.evaluate((n) => {
        const el = document.querySelector('.ProseMirror[contenteditable="true"]')
        const data = new DataTransfer()
        data.setData('text/plain', 'y'.repeat(n))
        el?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
      }, 10_001)
      await post.click()
      await expect(page.getByText('Keep the details under 10,000 characters.')).toBeVisible()
      expect(creates).toEqual([])
      expect(await postByTitle(board, `${marker} too long`)).toBeNull()
      // The title box caps input at 200 characters.
      await expect(titleBox(page)).toHaveAttribute('maxlength', '200')
    }
  )

  test(
    'FBP-S-08 the composer reads the submit tier: sign in, no access, or open',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const signedIn = await createBoard(marker, {
        suffix: 'auth',
        access: { submit: 'authenticated' },
      })
      const teamOnly = await createBoard(marker, { suffix: 'team', access: { submit: 'team' } })

      // A signed-out visitor on an authenticated-submit board is asked to sign in.
      const anon = await visitor(browser, marker)
      await anon.page.goto(`/?board=${signedIn.slug}`)
      await startPost(anon.page, `${marker} anon try`)
      await expect(anon.page.getByRole('button', { name: 'Sign in to post' })).toBeVisible()
      // The Post button is disabled; the keyboard submit explains why.
      await expect(anon.page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
      await titleBox(anon.page).press('ControlOrMeta+Enter')
      await expect(anon.page.getByText('Please sign in to submit feedback')).toBeVisible()

      // A customer on a team-submit board has no access, in the UI and on the server.
      const cass = await portalCustomer(browser, marker)
      await cass.page.goto(`/?board=${teamOnly.slug}`)
      await startPost(cass.page, `${marker} cust try`)
      await expect(cass.page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
      await titleBox(cass.page).press('ControlOrMeta+Enter')
      await expect(
        cass.page.getByText("You don't have access to post on this board").first()
      ).toBeVisible()
      const res = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: teamOnly.id,
        title: `${marker} crafted`,
      })
      expect(res.error).toMatchObject({
        code: 'POST_CREATE_DENIED',
        message: 'Only team members can submit on this board',
      })
      // The same customer can post on the authenticated board.
      const ok = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: signedIn.id,
        title: `${marker} allowed`,
      })
      expect(ok.error).toBeUndefined()
      expect(await postByTitle(teamOnly, `${marker} crafted`)).toBeNull()
    }
  )

  test(
    'FBP-S-10 board custom fields: required in the composer, revalidated on the server, stored by key',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, {
        customFields: [
          {
            key: 'plan',
            label: 'Your plan',
            type: 'select',
            required: true,
            options: ['Free', 'Pro'],
          },
          { key: 'seats', label: 'Seats', type: 'number', required: false },
        ],
      })
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(`/?board=${board.slug}`)
      const title = `${marker} with fields`
      await startPost(page, title)
      await page.getByRole('button', { name: 'Post', exact: true }).click()
      await expect(page.getByText('Your plan is required')).toBeVisible()
      expect(await postByTitle(board, title)).toBeNull()

      await page.getByRole('radiogroup', { name: 'Your plan' }).getByText('Pro').click()
      await page.getByLabel('Seats').fill('12')
      await page.getByRole('button', { name: 'Post', exact: true }).click()
      await expect(cardFor(page, title)).toBeVisible()
      expect((await postByTitle(board, title))?.custom_field_values).toEqual({
        plan: 'Pro',
        seats: 12,
      })

      // The server revalidates: a bad option is refused, unknown keys are dropped.
      const bad = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} crafted bad`,
        customFields: { plan: 'Enterprise' },
      })
      expect(bad.error).toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(bad.error?.message).toMatch(/not a valid option/)
      const missing = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} crafted missing`,
      })
      expect(missing.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Your plan is required',
      })
      const extra = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} crafted extra`,
        customFields: { plan: 'Free', sneaky: 'value' },
      })
      expect(extra.error).toBeUndefined()
      expect((await postByTitle(board, `${marker} crafted extra`))?.custom_field_values).toEqual({
        plan: 'Free',
      })
    }
  )

  test(
    'FBP-S-11 typing a title lists similar posts the viewer can see, each opening in a new tab',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const hidden = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const twin = await seedPost(board, { title: `${word} export to spreadsheet`, voteCount: 4 })
      await seedPost(hidden, { title: `${word} export to spreadsheet hidden` })
      const cass = await portalCustomer(browser, marker)
      const page = cass.page
      await page.goto(`/?board=${board.slug}`)
      // Under 5 characters nothing is looked up.
      await startPost(page, word.slice(0, 4))
      await page.waitForTimeout(800)
      await expect(page.getByText('Similar posts')).toBeHidden()

      await titleBox(page).fill(`${word} export spreadsheet`)
      await expect(page.getByText('Similar posts')).toBeVisible()
      const link = page.locator('a[target="_blank"]').filter({ hasText: twin.title })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', postPath(twin))
      await expect(link).toHaveAttribute('target', '_blank')
      // The team-only board's post never shows.
      await expect(page.getByText(`${word} export to spreadsheet hidden`)).toBeHidden()
    }
  )

  test(
    'FBP-S-14 a held post: the author sees it, others do not, no post.created, toast still says submitted',
    { tag: '@core' },
    async ({ browser, marker, playwright, baseURL, people }) => {
      const board = await createBoard(marker, { access: { moderation: { signedPosts: 'on' } } })
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['post.created'])
      try {
        const cass = await portalCustomer(browser, marker, { suffix: 'author' })
        const page = cass.page
        await page.goto(`/?board=${board.slug}`)
        const title = `${marker} needs review`
        await startPost(page, title)
        await page.getByRole('button', { name: 'Post', exact: true }).click()
        await expect(toastWith(page, 'Feedback submitted')).toBeVisible()
        await expect(cardFor(page, title)).toBeVisible()
        await expect(cardFor(page, title).getByText('Pending review')).toBeVisible()

        const row = await postByTitle(board, title)
        expect(row).toMatchObject({ moderation_state: 'pending', vote_count: 1 })
        const postUuid = row?.id as string
        const postId = fromUuid('post', postUuid)
        const [sub] = await supportDb()`SELECT reason FROM post_subscriptions
          WHERE post_id = ${postUuid} AND principal_id = ${cass.principalUuid}`
        expect(sub?.reason).toBe('author')
        const [audit] = await supportDb()`SELECT metadata FROM audit_log
          WHERE event_type = 'post.moderation.held' AND target_id = ${postId}`
        expect(audit?.metadata).toMatchObject({ previouslyPublished: false })

        // Another customer and a signed-out visitor see nothing of it.
        const other = await portalCustomer(browser, marker, { suffix: 'other' })
        const anon = await visitor(browser, marker)
        for (const who of [other, anon]) {
          const list = await fbFn<{ items: { id: string }[] }>(
            who.request,
            'publicPosts',
            'listPublicPostsFn',
            { boardSlug: board.slug }
          )
          expect(list.value?.items.map((p) => p.id)).toEqual([])
          const res = await who.page.goto(postPath({ id: postId, board }))
          expect(res?.status()).toBe(404)
          await expect(who.page.getByRole('heading', { name: title })).toBeHidden()
        }
        // A published control post on the same hook proves the sink is live.
        const control = await fbFn<{ id: string }>(
          other.request,
          'publicPosts',
          'createPublicPostFn',
          {
            boardId: (await createBoard(marker, { suffix: 'open' })).id,
            title: `${marker} control`,
          }
        )
        await deliveriesOf(marker, 'post.created', control.value?.id as string)
        const forHeld = (await sink.deliveries(marker)).filter((d) => d.body.includes(postId))
        expect(forHeld).toEqual([])
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-S-16 approving a held post publishes it and fires post.created as the author; rejecting hides it from the author too',
    { tag: '@core' },
    async ({ browser, marker, playwright, baseURL, people }) => {
      const board = await createBoard(marker, { access: { moderation: { signedPosts: 'on' } } })
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['post.created'])
      try {
        const cass = await portalCustomer(browser, marker, { suffix: 'author' })
        const make = async (title: string) =>
          (
            await fbFn<{ id: string }>(cass.request, 'publicPosts', 'createPublicPostFn', {
              boardId: board.id,
              title,
            })
          ).value?.id as string
        const keepId = await make(`${marker} keep`)
        const dropId = await make(`${marker} drop`)
        const admin = await adminRest(playwright, marker)

        await restPost(admin, `/moderation/posts/${keepId}/approve`)
        const [delivery] = await deliveriesOf(marker, 'post.created', keepId)
        expect(bodyOf(delivery).data).toMatchObject({
          post: { id: keepId, title: `${marker} keep` },
        })
        expect(delivery.body).toContain(cass.email)
        expect((await postRow(uuid(keepId))).moderation_state).toBe('published')
        const anon = await visitor(browser, marker)
        const list = await fbFn<{ items: { id: string }[] }>(
          anon.request,
          'publicPosts',
          'listPublicPostsFn',
          {
            boardSlug: board.slug,
          }
        )
        expect(list.value?.items.map((p) => p.id)).toEqual([keepId])

        // A second approve is a conflict.
        const again = await admin.post(`/api/v1/moderation/posts/${keepId}/approve`)
        expect(again.status()).toBe(409)

        await restPost(admin, `/moderation/posts/${dropId}/reject`, { reason: 'spam' })
        expect((await postRow(uuid(dropId))).deleted_at).not.toBeNull()
        await cass.page.goto(postPath({ id: dropId, board }))
        await expect(cass.page.getByRole('heading', { name: `${marker} drop` })).toBeHidden()
        await expect(cass.page.getByText(/not found/i).first()).toBeVisible()
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )

  test(
    'FBP-S-21 a read-only board shows its posts, takes no post or vote, and says so neutrally',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { readOnly: true })
      const post = await seedPost(board, { title: `${marker} archived idea`, voteCount: 3 })
      const cass = await portalCustomer(browser, marker)
      await cass.page.goto(`/?board=${board.slug}`)
      await expect(cardFor(cass.page, post.title)).toBeVisible()
      await expect(
        cass.page.getByText("This board isn't taking new feedback right now.")
      ).toBeVisible()
      await expect(titleBox(cass.page)).toBeHidden()
      await expect(
        cardFor(cass.page, post.title).getByRole('button', { name: '3 votes, voting closed' })
      ).toBeVisible()

      const res = await fbFn(cass.request, 'publicPosts', 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} crafted`,
      })
      expect(res.error).toMatchObject({ code: 'BOARD_READ_ONLY' })
      expect(res.error?.message).not.toMatch(/plan|upgrade/i)
      const vote = await fbFn(cass.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
      expect(vote.error).toMatchObject({ code: 'BOARD_READ_ONLY' })
      expect((await postRow(post.uuid)).vote_count).toBe(3)
    }
  )

  test(
    'FBP-S-25 post.created fires once with the post and its author',
    { tag: '@core' },
    async ({ browser, marker, playwright, baseURL, people }) => {
      const board = await createBoard(marker)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['post.created'])
      try {
        const cass = await portalCustomer(browser, marker, { name: 'Wren Webhook' })
        const res = await fbFn<{ id: string }>(cass.request, 'publicPosts', 'createPublicPostFn', {
          boardId: board.id,
          title: `${marker} hooked`,
          content: 'Some **bold** words',
        })
        const id = res.value?.id as string
        const [d] = await deliveriesOf(marker, 'post.created', id)
        expectSigned(d, hook.secret)
        const body = bodyOf<Record<string, unknown>>(d)
        expect(body.type).toBe('post.created')
        expect(body.data).toMatchObject({
          post: {
            id,
            title: `${marker} hooked`,
            boardId: board.id,
            boardSlug: board.slug,
            voteCount: 1,
            authorEmail: cass.email,
            authorName: 'Wren Webhook',
          },
        })
        // Exactly one, even after the relay has had time for a second.
        await new Promise((r) => setTimeout(r, 1500))
        expect(await deliveriesOf(marker, 'post.created', id)).toHaveLength(1)
      } finally {
        await unsubscribe(api, hook)
      }
    }
  )
})
