/**
 * Feedback AI, team side: duplicate suggestions, summaries, embeddings,
 * auto-tagging, similar posts and Track as feedback.
 *
 * Journeys: FBA-M-13, FBA-AI-01, FBA-AI-02, FBA-AI-04, FBA-AI-05, FBA-AI-06, FBA-AI-08,
 * FBA-AI-11, FBA-AI-12, FBA-AI-15, FBA-AI-16
 * (FBA-AI-09 is in admin-ai.serial.spec.ts; FBA-AI-14 is proved with
 * FBA-X-15 in admin-import-export.spec.ts.)
 *
 * The fake AI answers by marker: every prompt the app builds for a post carries
 * its title, so each test scripts its own marker. A tag with an AI rule makes
 * every new post in the workspace call the fake AI, so those tests are
 * @isolated and delete their tag in finally.
 */
import type { Locator, Page } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { personApi, callServerFn } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { fakeAi } from '../../support/fake-ai-client'
import { ISOLATED, openInboxThread } from '../../support/automation'
import { seedConv } from '../../support/access'
import { mintCustomer } from '../../support/widget-portal'
import {
  makeBoard,
  makePost,
  makeTag,
  openInbox,
  openPost,
  uuid,
} from '../../product/feedback-admin'
import { tagNamesOf, waitForEmbedding } from '../../product/feedback-admin-ai'

const sql = () => supportDb()

/** The post's AI summary once one is stored. */
async function waitForSummary(postId: string, timeoutMs = 20_000) {
  return pollFor(
    `summary of ${postId}`,
    async () => {
      const [row] = await sql()`SELECT summary_json, summary_model, summary_updated_at,
          summary_comment_count FROM posts WHERE id = ${uuid(postId)}`
      return row?.summary_json ? row : undefined
    },
    { timeoutMs }
  )
}

test(
  'FBA-M-13 two posts with the same text get one pending suggestion with the model reasoning, newer post as source',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const title = `${marker} export to spreadsheet`
    const content = `Please let us export ${marker} rows to a spreadsheet.`
    const first = await makePost(api, { boardId: board.id, title, content })
    // Let the first post's own duplicate check finish before scripting the answer.
    await pollFor(
      'first merge check',
      async () => {
        const [r] = await sql()`SELECT merge_checked_at FROM posts WHERE id = ${uuid(first.id)}`
        return r?.merge_checked_at ?? undefined
      },
      { timeoutMs: 20_000 }
    )
    await fakeAi.script({
      marker,
      json: {
        results: [
          {
            candidatePostId: first.id,
            isDuplicate: true,
            confidence: 0.92,
            reasoning: `Both ask for spreadsheet export ${marker}`,
          },
        ],
      },
    })
    const second = await makePost(api, { boardId: board.id, title, content })

    const suggestions = await pollFor(
      'merge suggestion',
      async () => {
        const rows = await sql()`SELECT * FROM post_merge_suggestions
          WHERE source_post_id IN (${uuid(first.id)}, ${uuid(second.id)})
             OR target_post_id IN (${uuid(first.id)}, ${uuid(second.id)})`
        return rows.length > 0 ? rows : undefined
      },
      { timeoutMs: 25_000 }
    )
    // Give a late duplicate check the chance to add a second row; there must be one.
    await new Promise((r) => setTimeout(r, 1_500))
    const all = await sql()`SELECT * FROM post_merge_suggestions
      WHERE source_post_id IN (${uuid(first.id)}, ${uuid(second.id)})
         OR target_post_id IN (${uuid(first.id)}, ${uuid(second.id)})`
    expect(all).toHaveLength(1)
    const [s] = suggestions
    expect(s).toMatchObject({
      source_post_id: uuid(second.id),
      target_post_id: uuid(first.id),
      status: 'pending',
      llm_confidence: 0.92,
      llm_reasoning: `Both ask for spreadsheet export ${marker}`,
    })
    expect(Number(s.vector_score)).toBeGreaterThan(0.99)

    // The team sees it in the post's suggestions panel.
    const listed = await callServerFn<unknown>(
      api,
      'getMergeSuggestionsForPostFn',
      { postId: second.id },
      { method: 'GET' }
    )
    expect(listed.ok, listed.raw).toBe(true)
    expect(JSON.stringify(listed.data)).toContain(first.id)
    await fakeAi.clear(marker)
    await api.dispose()
  }
)

test(
  'FBA-AI-06 a comment brings an AI summary that the post modal shows',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, {
      boardId: board.id,
      title: `${marker} faster sync`,
      content: 'Sync takes minutes.',
    })
    // Only the summary input carries the comment text, so script on it.
    const commentMarker = `${marker}-sumc`
    await fakeAi.script({
      marker: commentMarker,
      json: {
        summary: `Customers want faster sync ${marker}`,
        keyQuotes: ['Sync takes minutes.'],
        nextSteps: ['Profile the sync job'],
      },
    })
    const comment = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `We see this too ${commentMarker}`,
    })
    expect(comment.ok, comment.raw).toBe(true)

    const row = await waitForSummary(post.id)
    expect(row.summary_json).toEqual({
      summary: `Customers want faster sync ${marker}`,
      keyQuotes: ['Sync takes minutes.'],
      nextSteps: ['Profile the sync job'],
    })
    expect(row.summary_model).toBe('fake-chat')
    expect(row.summary_comment_count).toBe(1)
    const [req] = await fakeAi.waitForRequests({ contains: commentMarker, endpoint: 'chat' })
    expect(req.text).toContain(`# ${marker} faster sync`)
    expect(req.text).toContain(`[Team]: We see this too ${commentMarker}`)

    const admin = await asPerson('admin')
    await openPost(admin, post.id, `${marker} faster sync`)
    const dialog = admin.getByRole('dialog')
    await expect(dialog.getByText('AI Summary')).toBeVisible()
    await expect(dialog.getByText(`Customers want faster sync ${marker}`)).toBeVisible()
    await expect(dialog.getByText('Profile the sync job')).toBeVisible()
    await fakeAi.clear(commentMarker)
    await api.dispose()
  }
)

test(
  'FBA-AI-08 the summary input leaves out private team notes',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'summary.service.ts:149 reads every non-deleted comment, private notes included, into the summary prompt (see e2e/QUARANTINE.md)',
    },
  },
  async ({ playwright, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} private note post` })
    const note = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `Internal only ${marker}-secret`,
      isPrivate: true,
    })
    expect(note.ok, note.raw).toBe(true)
    const publicMarker = `${marker}-pub`
    const reply = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `Public reply ${publicMarker}`,
    })
    expect(reply.ok, reply.raw).toBe(true)
    // The summary run for the public comment.
    const [req] = await fakeAi.waitForRequests({ contains: publicMarker, endpoint: 'chat' })
    expect(req.text).not.toContain(`${marker}-secret`)
    await api.dispose()
  }
)

test(
  'FBA-AI-11 a post is embedded on create and re-embedded and re-checked on edit',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} original title` })
    const before = await waitForEmbedding(post.id)
    expect(before.embedding_model).toBe('fake-embedding')
    const [embedReq] = await fakeAi.waitForRequests({
      contains: `${marker} original title`,
      endpoint: 'embeddings',
    })
    // Title twice, then details.
    expect(embedReq.text.split(`${marker} original title`).length - 1).toBeGreaterThanOrEqual(2)
    await pollFor(
      'first merge check',
      async () => {
        const [r] = await sql()`SELECT merge_checked_at FROM posts WHERE id = ${uuid(post.id)}`
        return r?.merge_checked_at ?? undefined
      },
      { timeoutMs: 20_000 }
    )

    const edit = await callServerFn(api, 'updatePostFn', {
      id: post.id,
      title: `${marker} edited title`,
    })
    expect(edit.ok, edit.raw).toBe(true)
    await fakeAi.waitForRequests({ contains: `${marker} edited title`, endpoint: 'embeddings' })
    const after = await pollFor(
      're-embedded',
      async () => {
        const [r] = await sql()`SELECT embedding_updated_at, merge_checked_at FROM posts
        WHERE id = ${uuid(post.id)}`
        return r &&
          (r.embedding_updated_at as Date).getTime() >
            (before.embedding_updated_at as Date).getTime()
          ? r
          : undefined
      },
      { timeoutMs: 20_000 }
    )
    // The duplicate check ran again after the new embedding.
    await pollFor(
      're-checked',
      async () => {
        const [r] = await sql()`SELECT merge_checked_at FROM posts WHERE id = ${uuid(post.id)}`
        return r?.merge_checked_at &&
          (r.merge_checked_at as Date).getTime() >= (after.embedding_updated_at as Date).getTime()
          ? r
          : undefined
      },
      { timeoutMs: 20_000 }
    )
    await api.dispose()
  }
)

test(
  'FBA-AI-12 New post shows a similar existing post once the title is typed',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const title = `${marker} dark mode toggle`
    await makePost(api, { boardId: board.id, title })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    const dialog = admin.getByRole('dialog')
    const titleBox = dialog.getByPlaceholder("What's the feedback about?")
    // A click before hydration opens nothing; the dialog content loads lazily.
    await expect(async () => {
      await admin.getByRole('button', { name: 'New post' }).click({ timeout: 3_000 })
      await expect(titleBox).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    await titleBox.fill(title)
    await expect(dialog.getByText('Similar posts')).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(title, { exact: true })).toBeVisible()
  }
)

/** Open the Track as feedback dialog from a visitor message's actions menu. */
async function openTrackDialog(page: Page, message: string): Promise<Locator> {
  const bubble = page.getByText(message, { exact: true })
  await expect(bubble).toBeVisible({ timeout: 20_000 })
  await expect(async () => {
    await bubble.hover()
    await page.getByRole('button', { name: 'More actions' }).first().click({ timeout: 3_000 })
    await page.getByRole('menuitem', { name: /Track as feedback/ }).click({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Title')).toBeVisible()
  return dialog
}

test(
  'FBA-AI-15 Track as feedback creates a post by the visitor, tracked by the agent and linked to the conversation',
  { tag: '@core' },
  async ({ playwright, asPerson, people, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const visitor = await mintCustomer({
      email: `${marker}@visitor.example`,
      name: `Vera ${marker}`,
    })
    const conv = await seedConv({ marker, label: 'track', visitorPrincipalId: visitor.principalId })
    const admin = await asPerson('admin')
    await openInboxThread(admin, conv.id)
    const dialog = await openTrackDialog(admin, conv.messages[0])
    await dialog.getByRole('combobox').first().click()
    await admin.getByRole('option', { name: board.name }).click()
    const title = `${marker} tracked idea`
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: 'Track as feedback' }).click()
    await expect(admin.getByText('Post created from conversation')).toBeVisible()

    const [post] = await sql()`SELECT * FROM posts WHERE title = ${title}`
    expect(post).toMatchObject({
      board_id: uuid(board.id),
      principal_id: visitor.principalUuid,
      tracked_by_principal_id: uuid(people.people.admin.principalId),
      vote_count: 1,
    })
    expect(post.widget_metadata).toMatchObject({ source: 'live_chat', conversationId: conv.id })
    const subs = await sql()`SELECT principal_id FROM post_subscriptions WHERE post_id = ${post.id}`
    expect(subs.map((r) => r.principal_id)).toContain(visitor.principalUuid)
    const links = await sql()`SELECT integration_type, external_id FROM post_external_links
      WHERE post_id = ${post.id}`
    expect(links).toEqual([{ integration_type: 'live_chat', external_id: conv.id }])
    // A card for the post goes back into the thread.
    await expect
      .poll(async () => {
        const rows = await sql()`SELECT content, content_json FROM conversation_messages
          WHERE conversation_id = ${uuid(conv.id)} AND sender_type = 'agent'`
        return JSON.stringify(rows)
      })
      .toContain(fromUuid('post', String(post.id)))
  }
)

test(
  'FBA-AI-16 Upvote on a similar post adds the visitor vote and a private note quoting the message',
  { tag: '@core' },
  async ({ playwright, asPerson, people, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const existing = await makePost(api, { boardId: board.id, title: `${marker} existing ask` })
    await api.dispose()
    const visitor = await mintCustomer({
      email: `${marker}@visitor.example`,
      name: `Uma ${marker}`,
    })
    const conv = await seedConv({
      marker,
      label: 'upvote',
      visitorPrincipalId: visitor.principalId,
    })
    const admin = await asPerson('admin')
    await openInboxThread(admin, conv.id)
    const dialog = await openTrackDialog(admin, conv.messages[0])
    await dialog.getByLabel('Title').fill(existing.title)
    const similar = dialog.locator('div.flex.items-center', { hasText: existing.title })
    await similar.getByRole('button', { name: 'Upvote' }).click()
    await expect(admin.getByText('Upvoted existing post')).toBeVisible()

    const votes = await sql()`SELECT principal_id, source_type, added_by_principal_id
      FROM post_votes WHERE post_id = ${uuid(existing.id)} AND principal_id = ${visitor.principalUuid}`
    expect(votes).toEqual([
      {
        principal_id: visitor.principalUuid,
        source_type: 'live_chat',
        added_by_principal_id: uuid(people.people.admin.principalId),
      },
    ])
    const notes = await sql()`SELECT content, is_private FROM post_comments
      WHERE post_id = ${uuid(existing.id)}`
    expect(notes).toHaveLength(1)
    expect(notes[0].is_private).toBe(true)
    expect(String(notes[0].content)).toContain('Tracked from a support conversation:')
    expect(String(notes[0].content)).toContain(conv.messages[0])
    // No new post was made.
    expect(await sql()`SELECT 1 FROM posts WHERE title = ${existing.title}`).toHaveLength(1)
  }
)

test.describe('tag AI rules', () => {
  test.skip(!ISOLATED, 'runs in product-isolated')

  test(
    'FBA-AI-01 a new post is auto-tagged when the model names a tag with an AI rule',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, marker }) => {
      test.setTimeout(60_000)
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const tag = await makeTag(api, `Bug ${marker}`.slice(0, 50), {
        aiPrompt: 'Reports of something broken',
      })
      const other = await makeTag(api, `Plain ${marker}`.slice(0, 50))
      try {
        await fakeAi.script({
          marker: `${marker} crash`,
          json: { matches: [tag.name, 'Not A Tag', other.name.toUpperCase()] },
        })
        const post = await makePost(api, {
          boardId: board.id,
          title: `${marker} crash on save`,
          content: 'The app crashes.',
        })
        const assigned = await pollFor(
          'auto tag',
          async () => {
            const rows = await sql()`SELECT tag_id, auto_tagged FROM post_tag_assignments
            WHERE post_id = ${uuid(post.id)}`
            return rows.length > 0 ? rows : undefined
          },
          { timeoutMs: 20_000 }
        )
        expect(assigned).toEqual([{ tag_id: uuid(tag.id), auto_tagged: true }])
        const [req] = await fakeAi.waitForRequests({ contains: 'Reports of something broken' })
        expect(req.text).toContain(`"${tag.name}": Reports of something broken`)
        const [row] = await sql()`SELECT moderation_state FROM posts WHERE id = ${uuid(post.id)}`
        expect(row.moderation_state).toBe('published')
      } finally {
        await callServerFn(api, 'deletePostTagFn', { id: tag.id })
        await callServerFn(api, 'deletePostTagFn', { id: other.id })
        await api.dispose()
      }
    }
  )

  test(
    'FBA-AI-02 a model answer of the wrong shape or a failing model tags nothing and the post still publishes',
    { tag: ['@nightly', '@isolated'] },
    async ({ playwright, marker }) => {
      test.setTimeout(60_000)
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const tag = await makeTag(api, `Rule ${marker}`.slice(0, 50), { aiPrompt: 'Anything at all' })
      try {
        await fakeAi.script({ marker: `${marker} shape`, json: { matches: tag.name } })
        const wrongShape = await makePost(api, { boardId: board.id, title: `${marker} shape` })
        const failing = await makePost(api, {
          boardId: board.id,
          title: `${marker} fails [[fake-ai:fail]]`,
        })
        // Both posts were offered to the model, and neither got a tag.
        await fakeAi.waitForRequests({ contains: 'Anything at all', count: 2 })
        for (const post of [wrongShape, failing]) {
          const reqs = await fakeAi.requests({ contains: post.title, endpoint: 'chat' })
          expect(
            reqs.some((r) => r.text.includes('Anything at all')),
            post.title
          ).toBe(true)
        }
        await new Promise((r) => setTimeout(r, 1_000))
        for (const post of [wrongShape, failing]) {
          expect(await tagNamesOf(uuid(post.id)), post.title).toEqual([])
          const [row] = await sql()`SELECT moderation_state FROM posts WHERE id = ${uuid(post.id)}`
          expect(row.moderation_state).toBe('published')
        }
      } finally {
        await callServerFn(api, 'deletePostTagFn', { id: tag.id })
        await api.dispose()
      }
    }
  )

  test(
    'FBA-AI-05 the AI rule is set only by the server function and the tag dialog never changes it',
    { tag: ['@nightly', '@isolated'] },
    async ({ playwright, asPerson, marker }) => {
      const api = await personApi(playwright, 'admin')
      const tooLong = await callServerFn(api, 'createPostTagFn', {
        name: `Long ${marker}`.slice(0, 50),
        color: '#6b7280',
        aiPrompt: 'x'.repeat(501),
      })
      expect(tooLong.ok).toBe(false)
      const tag = await makeTag(api, `Rule ${marker}`.slice(0, 50), { aiPrompt: 'Keep me' })
      try {
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/tags')
        const dialog = admin.getByRole('dialog')
        // A click before hydration opens no menu; try again until the dialog shows.
        await expect(async () => {
          await admin.getByRole('button', { name: `Actions for ${tag.name}` }).click()
          await admin.getByRole('menuitem', { name: 'Edit' }).click({ timeout: 3_000 })
          await expect(dialog).toBeVisible({ timeout: 3_000 })
        }).toPass({ timeout: 30_000 })
        await expect(dialog.getByText(/prompt|AI rule/i)).toHaveCount(0)
        await dialog.getByPlaceholder('When to use this tag').fill(`Edited ${marker}`)
        await dialog.getByRole('button', { name: 'Save changes' }).click()
        await expect
          .poll(
            async () =>
              (
                await sql()`SELECT description, ai_prompt FROM post_tags
            WHERE id = ${uuid(tag.id)}`
              )[0]
          )
          .toEqual({ description: `Edited ${marker}`, ai_prompt: 'Keep me' })
      } finally {
        await callServerFn(api, 'deletePostTagFn', { id: tag.id })
        await api.dispose()
      }
    }
  )

  test(
    'FBA-AI-04 the AI auto-tagging card applies the rules to untagged posts of a board',
    { tag: ['@nightly', '@isolated'] },
    async ({ playwright, asPerson, marker }) => {
      test.setTimeout(90_000)
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const match = await makePost(api, { boardId: board.id, title: `${marker} backfill match` })
      const miss = await makePost(api, { boardId: board.id, title: `${marker} backfill miss` })
      const tag = await makeTag(api, `Rule ${marker}`.slice(0, 50), {
        aiPrompt: 'Matches backfill',
      })
      try {
        await fakeAi.script({ marker: `${marker} backfill match`, json: { matches: [tag.name] } })
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/tags')
        await expect(admin.getByText('AI auto-tagging')).toBeVisible({ timeout: 15_000 })
        await expect(async () => {
          await admin.getByRole('combobox').filter({ hasText: /board/i }).click()
          await admin.getByRole('option', { name: board.name }).click({ timeout: 3_000 })
        }).toPass({ timeout: 30_000 })
        await admin.getByRole('button', { name: 'Apply to untagged posts' }).click()
        await expect(admin.getByText('Tagged 1 of 2 untagged posts')).toBeVisible({
          timeout: 30_000,
        })
        expect(await tagNamesOf(uuid(match.id))).toEqual([tag.name])
        expect(await tagNamesOf(uuid(miss.id))).toEqual([])
      } finally {
        await callServerFn(api, 'deletePostTagFn', { id: tag.id })
        await api.dispose()
      }
    }
  )
})
