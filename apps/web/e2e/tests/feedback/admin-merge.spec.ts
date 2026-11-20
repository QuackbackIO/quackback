/**
 * Merging duplicate feedback from the team side: merge into another, merge
 * others into this, unmerge, AI merge suggestions and their counts.
 *
 * Journeys: FBA-M-01, FBA-M-02, FBA-M-05, FBA-M-08, FBA-M-09, FBA-M-11, FBA-M-14, FBA-M-16,
 * FBA-M-18, FBA-M-19
 */
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { bellsFor } from '../../support/bells'
import { emailLogFor, mailTo, waitForMail } from '../../support/mailpit'
import { runSweep } from '../../support/sweeps'
import { bodyOf, deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import {
  inboxTitles,
  makeBoard,
  makePost,
  openInbox,
  openPost,
  portalCustomer,
  postRow,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  activityTypes,
  pickMergeAction,
  seedSuggestion,
  suggestionRow,
  vote,
  waitForMergeRecheck,
} from '../../product/feedback-admin-merge'

test(
  'FBA-M-01 merging a post into another from the modal makes it a duplicate with deduplicated votes',
  { tag: '@smoke' },
  async ({ playwright, browser, baseURL, people, asPerson, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.merged'])
    const both = await portalCustomer(browser, marker, { name: `Both ${marker}` })
    const dupOnly = await portalCustomer(browser, marker, { name: `Dup ${marker}` })
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} canonical ask` })
      const duplicate = await makePost(api, { boardId: board.id, title: `${marker} duplicate ask` })
      await vote(both.api, canonical.id)
      await vote(both.api, duplicate.id)
      await vote(dupOnly.api, duplicate.id)

      const admin = await asPerson('admin')
      await openPost(admin, duplicate.id, duplicate.title)
      await pickMergeAction(admin, 'into another')
      const search = admin.getByPlaceholder('Search for similar feedback…')
      await expect(search).toHaveValue(duplicate.title)
      await search.fill(canonical.title)
      await admin
        .locator('button', { has: admin.locator('h3', { hasText: canonical.title }) })
        .click()
      await expect(admin.getByRole('alertdialog')).toContainText('Votes will be combined')
      await admin.getByRole('alertdialog').getByRole('button', { name: 'Merge' }).click()
      await expect(admin.getByText('Post merged successfully')).toBeVisible()

      const dupRow = await postRow(duplicate.id)
      expect(dupRow?.canonical_post_id).toBe(uuid(canonical.id))
      expect(dupRow?.merged_at).toBeTruthy()
      expect(dupRow?.merged_by_principal_id).toBe(uuid(people.people.admin.principalId))
      // Distinct people across both posts: the admin (author of both), and the two customers.
      await expect.poll(async () => (await postRow(canonical.id))?.vote_count).toBe(3)
      expect(await activityTypes(canonical.id)).toContain('post.merged_in')
      expect(await activityTypes(duplicate.id)).toContain('post.merged_away')

      const [delivery] = await deliveriesOf(marker, 'post.merged', duplicate.id)
      const data = bodyOf<{
        duplicatePost: { id: string; boardId: string }
        canonicalPost: { id: string }
      }>(delivery).data
      expect(data.duplicatePost.id).toBe(duplicate.id)
      expect(data.duplicatePost.boardId).toBe(board.id)
      expect(data.canonicalPost.id).toBe(canonical.id)

      await waitForMergeRecheck(canonical.id)

      // The duplicate leaves the inbox; the canonical lists it under Merged Feedback.
      await openInbox(admin, { board: [board.id] })
      await expect.poll(() => inboxTitles(admin, marker)).toEqual([canonical.title])
      await openPost(admin, canonical.id, canonical.title)
      await expect(admin.getByText('Merged Feedback (1)')).toBeVisible()
      await expect(admin.getByRole('dialog').getByText(duplicate.title)).toBeVisible()
      await openPost(admin, duplicate.id)
      await expect(admin.getByText(/This feedback has been merged into/)).toBeVisible()
    } finally {
      await unsubscribe(hooks, hook)
      await both.close()
      await dupOnly.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)

test(
  'FBA-M-02 merge into this ticks several searched posts and merges them all',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} main` })
      const one = await makePost(api, { boardId: board.id, title: `${marker} copy one` })
      const two = await makePost(api, { boardId: board.id, title: `${marker} copy two` })

      const admin = await asPerson('admin')
      await openPost(admin, canonical.id, canonical.title)
      await pickMergeAction(admin, 'into this')
      await admin.getByPlaceholder('Search for similar feedback…').fill(marker)
      for (const p of [one, two]) {
        await admin.getByRole('button', { name: new RegExp(p.title) }).click()
      }
      await admin.getByRole('button', { name: 'Merge 2 posts' }).click()
      await expect(admin.getByText('Merged 2 posts')).toBeVisible()
      for (const p of [one, two]) {
        expect((await postRow(p.id))?.canonical_post_id).toBe(uuid(canonical.id))
        expect(await activityTypes(p.id)).toContain('post.merged_away')
      }
      const mergedIn = (await activityTypes(canonical.id)).filter((t) => t === 'post.merged_in')
      expect(mergedIn).toHaveLength(2)
      await openPost(admin, canonical.id, canonical.title)
      await expect(admin.getByText('Merged Feedback (2)')).toBeVisible()
    } finally {
      await api.dispose()
    }
  }
)

test(
  'FBA-M-05 unmerge restores the duplicate with its own votes and fires post.unmerged',
  { tag: '@core' },
  async ({ playwright, browser, baseURL, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.unmerged'])
    const voter = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} keeper` })
      const duplicate = await makePost(api, { boardId: board.id, title: `${marker} returner` })
      await vote(voter.api, duplicate.id)
      const merged = await callServerFn(api, 'mergePostFn', {
        duplicatePostId: duplicate.id,
        canonicalPostId: canonical.id,
      })
      expect(merged.ok, merged.raw).toBe(true)
      await expect.poll(async () => (await postRow(canonical.id))?.vote_count).toBe(2)

      const admin = await asPerson('admin')
      await openPost(admin, canonical.id, canonical.title)
      await expect(admin.getByText('Merged Feedback (1)')).toBeVisible()
      await admin
        .getByRole('dialog')
        .locator('button:visible', { hasText: 'Unmerge' })
        .first()
        .click()
      await expect(admin.getByRole('alertdialog')).toContainText('Unmerge this post?')
      await admin.getByRole('alertdialog').getByRole('button', { name: 'Unmerge' }).click()
      await expect(admin.getByText('Post unmerged successfully')).toBeVisible()

      const row = await postRow(duplicate.id)
      expect(row?.canonical_post_id).toBeNull()
      expect(row?.merged_at).toBeNull()
      expect(row?.merged_by_principal_id).toBeNull()
      expect(row?.vote_count).toBe(2)
      await expect.poll(async () => (await postRow(canonical.id))?.vote_count).toBe(1)
      expect(await activityTypes(canonical.id)).toContain('post.unmerged')
      expect(await activityTypes(duplicate.id)).toContain('post.unmerged')
      const [delivery] = await deliveriesOf(marker, 'post.unmerged', duplicate.id)
      const data = bodyOf<{ post: { id: string }; formerCanonicalPost: { id: string } }>(
        delivery
      ).data
      expect(data.post.id).toBe(duplicate.id)
      expect(data.formerCanonicalPost.id).toBe(canonical.id)

      await openInbox(admin, { board: [board.id] })
      await expect
        .poll(async () => (await inboxTitles(admin, marker)).sort())
        .toEqual([canonical.title, duplicate.title].sort())

      // Unmerging a post that is not merged is refused.
      const again = await callServerFn(api, 'unmergePostFn', { postId: duplicate.id })
      expect(again.ok).toBe(false)
      expect(again.code).toBe('NOT_MERGED')
    } finally {
      await unsubscribe(hooks, hook)
      await voter.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)

test(
  "FBA-M-08 voters of a duplicate get the canonical's status email once each",
  { tag: '@core' },
  async ({ playwright, browser, marker }) => {
    const api = await personApi(playwright, 'admin')
    const dupOnly = await portalCustomer(browser, marker)
    const both = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} target` })
      const duplicate = await makePost(api, { boardId: board.id, title: `${marker} source` })
      await vote(dupOnly.api, duplicate.id)
      await vote(both.api, duplicate.id)
      await vote(both.api, canonical.id)
      const merged = await callServerFn(api, 'mergePostFn', {
        duplicatePostId: duplicate.id,
        canonicalPostId: canonical.id,
      })
      expect(merged.ok, merged.raw).toBe(true)

      const changed = await callServerFn(api, 'changePostStatusFn', {
        id: canonical.id,
        statusId: await statusIdBySlug('planned'),
      })
      expect(changed.ok, changed.raw).toBe(true)
      for (const person of [dupOnly, both]) {
        await waitForMail({ to: person.email, subject: 'Your feedback is now Planned' })
        await expect
          .poll(async () => (await bellsFor(person.principalId, canonical.id)).length)
          .toBe(1)
      }
      // Give a second copy time to arrive, then count.
      await new Promise((r) => setTimeout(r, 2_000))
      for (const person of [dupOnly, both]) {
        const mails = (await mailTo(person.email)).filter((m) => m.Subject.includes('Planned'))
        expect(mails, person.email).toHaveLength(1)
        expect(await bellsFor(person.principalId, canonical.id)).toHaveLength(1)
      }
    } finally {
      await dupOnly.close()
      await both.close()
      await api.dispose()
    }
  }
)

test(
  "FBA-M-09 merging and unmerging notify neither the duplicate's author nor its voters",
  { tag: '@nightly' },
  async ({ playwright, browser, baseURL, people, marker }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.merged', 'post.unmerged'])
    const author = await portalCustomer(browser, marker)
    const voter = await portalCustomer(browser, marker)
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} canonical` })
      const res = await callServerFn<{ id: string }>(author.api, 'createPublicPostFn', {
        boardId: board.id,
        title: `${marker} customer duplicate`,
        content: '',
      })
      expect(res.ok, res.raw).toBe(true)
      const duplicateId = res.data.id
      await vote(voter.api, duplicateId)

      const merged = await callServerFn(api, 'mergePostFn', {
        duplicatePostId: duplicateId,
        canonicalPostId: canonical.id,
      })
      expect(merged.ok, merged.raw).toBe(true)
      await deliveriesOf(marker, 'post.merged', duplicateId)
      expect((await callServerFn(api, 'unmergePostFn', { postId: duplicateId })).ok).toBe(true)
      await deliveriesOf(marker, 'post.unmerged', duplicateId)

      // Quiet period: the webhooks above went out through the same event fan-out.
      await new Promise((r) => setTimeout(r, 2_000))
      for (const person of [author, voter]) {
        expect(await emailLogFor(person.email)).toEqual([])
        expect(await mailTo(person.email)).toEqual([])
        expect(await bellsFor(person.principalId)).toEqual([])
      }
    } finally {
      await unsubscribe(hooks, hook)
      await author.close()
      await voter.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)

test(
  'FBA-M-11 accepting a merge suggestion needs post.merge, like merging by hand',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'acceptSuggestionFn gates on suggestion.manage only and merges without post.merge (functions/feedback.ts:29)',
    },
  },
  async ({ playwright, newTeammate, marker }) => {
    const api = await personApi(playwright, 'admin')
    const roleKey = await createRole(marker, [
      'post.view_private',
      'suggestion.view',
      'suggestion.manage',
    ])
    const mate = await newTeammate({ roleKey })
    const mateApi = await mate.api(playwright)
    try {
      const board = await makeBoard(api, marker)
      const canonical = await makePost(api, { boardId: board.id, title: `${marker} kept` })
      const duplicate = await makePost(api, { boardId: board.id, title: `${marker} merged` })
      const byHand = await callServerFn(mateApi, 'mergePostFn', {
        duplicatePostId: duplicate.id,
        canonicalPostId: canonical.id,
      })
      expect(byHand.ok).toBe(false)
      expect((await postRow(duplicate.id))?.canonical_post_id).toBeNull()

      const suggestionId = await seedSuggestion(duplicate.id, canonical.id)
      const accepted = await callServerFn(mateApi, 'acceptSuggestionFn', { id: suggestionId })
      const after = await postRow(duplicate.id)
      expect(after?.canonical_post_id, 'merged without post.merge').toBeNull()
      expect(accepted.ok).toBe(false)
      expect((await suggestionRow(suggestionId)).status).toBe('pending')
    } finally {
      await mateApi.dispose()
      await api.dispose()
    }
  }
)

test(
  'FBA-M-14 the Similar posts card merges in either direction or dismisses',
  { tag: '@core' },
  async ({ playwright, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const open = await makePost(api, { boardId: board.id, title: `${marker} open one` })
      const other = await makePost(api, { boardId: board.id, title: `${marker} other one` })
      const third = await makePost(api, { boardId: board.id, title: `${marker} third one` })
      const fourth = await makePost(api, { boardId: board.id, title: `${marker} fourth one` })
      // Stored as "open is a duplicate of other"; Merge into this keeps the open post.
      const first = await seedSuggestion(open.id, other.id, { reasoning: `${marker} same ask` })
      const dismissed = await seedSuggestion(third.id, open.id)

      const admin = await asPerson('admin')
      await openPost(admin, open.id, open.title)
      const dialog = admin.getByRole('dialog')
      await expect(dialog.getByText('Similar posts')).toBeVisible()
      await expect(dialog.getByText(`${marker} same ask`)).toBeVisible()

      const thirdRow = dialog
        .locator('div:visible', { hasText: third.title })
        .filter({ has: admin.getByRole('button', { name: 'Dismiss' }) })
        .last()
      await thirdRow.getByRole('button', { name: 'Dismiss' }).click()
      await expect(admin.getByText('Suggestion dismissed')).toBeVisible()
      await expect.poll(async () => (await suggestionRow(dismissed)).status).toBe('dismissed')
      expect((await suggestionRow(dismissed)).resolved_by_principal_id).toBe(
        uuid(people.people.admin.principalId)
      )
      expect((await suggestionRow(first)).status).toBe('pending')

      await dialog.locator('button[aria-label="Merge"]:visible').click()
      await admin.getByRole('menuitem', { name: 'Merge into this' }).click()
      await expect(admin.getByText('Posts merged')).toBeVisible()
      await expect
        .poll(async () => (await postRow(other.id))?.canonical_post_id)
        .toBe(uuid(open.id))
      expect((await postRow(open.id))?.canonical_post_id).toBeNull()
      expect((await suggestionRow(first)).status).toBe('accepted')

      // Merge into that: the open post goes into the other one.
      await seedSuggestion(fourth.id, third.id)
      await openPost(admin, third.id, third.title)
      await dialog.locator('button[aria-label="Merge"]:visible').click()
      await admin.getByRole('menuitem', { name: 'Merge into that' }).click()
      await expect(admin.getByText('Posts merged')).toBeVisible()
      await expect
        .poll(async () => (await postRow(third.id))?.canonical_post_id)
        .toBe(uuid(fourth.id))

      // No pending suggestion left: no card.
      await openPost(admin, fourth.id, fourth.title)
      await expect(dialog.getByText('Similar posts')).toHaveCount(0)
    } finally {
      await api.dispose()
    }
  }
)

test(
  'FBA-M-16 suggestion accept and dismiss refuse bad, unknown and resolved ids',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const a = await makePost(api, { boardId: board.id, title: `${marker} a` })
      const b = await makePost(api, { boardId: board.id, title: `${marker} b` })
      for (const fn of ['acceptSuggestionFn', 'dismissSuggestionFn']) {
        const bad = await callServerFn(api, fn, { id: 'post_123' })
        expect(bad.data, fn).toEqual({ success: false, error: 'Invalid merge suggestion id' })
      }
      const resolved = await seedSuggestion(a.id, b.id, { status: 'dismissed' })
      const unknown = await seedSuggestion(b.id, a.id)
      await supportDb()`DELETE FROM post_merge_suggestions WHERE id = ${uuid(unknown)}`
      for (const id of [resolved, unknown]) {
        const res = await callServerFn(api, 'acceptSuggestionFn', { id })
        expect(res.ok, id).toBe(false)
        expect(res.code, id).toBe('SUGGESTION_NOT_FOUND')
      }
      // Dismissing again is a silent no-op: success, and the row is unchanged.
      const again = await callServerFn(api, 'dismissSuggestionFn', { id: resolved })
      expect(again.ok, again.raw).toBe(true)
      expect((await suggestionRow(resolved)).resolved_by_principal_id).toBeNull()
      expect((await postRow(a.id))?.canonical_post_id).toBeNull()
    } finally {
      await api.dispose()
    }
  }
)

test(
  'FBA-M-18 the merge sweep checks posts with an embedding and no recent check',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const post = await makePost(api, { boardId: board.id, title: `${marker} sweep me` })
      const sql = supportDb()
      const hasEmbedding = async () =>
        (await sql`SELECT embedding IS NOT NULL AS has FROM posts WHERE id = ${uuid(post.id)}`)[0]
          .has
      await expect.poll(hasEmbedding, { timeout: 20_000 }).toBe(true)
      await sql`UPDATE posts SET merge_checked_at = NULL WHERE id = ${uuid(post.id)}`
      // A stale pending suggestion expires on the same pass.
      const other = await makePost(api, { boardId: board.id, title: `${marker} stale pair` })
      const stale = await seedSuggestion(other.id, post.id, {
        createdAt: new Date(Date.now() - 31 * 24 * 3600_000),
      })

      await runSweep(request, 'merge-sweep')
      expect((await postRow(post.id))?.merge_checked_at).toBeTruthy()
      expect((await suggestionRow(stale)).status).toBe('expired')
    } finally {
      await api.dispose()
    }
  }
)

test(
  'FBA-M-19 pending duplicate counts per post and in total',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    try {
      const board = await makeBoard(api, marker)
      const make = (n: string) => makePost(api, { boardId: board.id, title: `${marker} ${n}` })
      const [a, b, c, lone] = [
        await make('a'),
        await make('b'),
        await make('c'),
        await make('lone'),
      ]
      await seedSuggestion(a.id, b.id)
      await seedSuggestion(c.id, a.id)
      const counts = await callServerFn<Array<{ postId: string; count: number }>>(
        api,
        'fetchMergeSuggestionCountsForPostsFn',
        { postIds: [a.id, b.id, c.id, lone.id] }
      )
      expect(counts.ok, counts.raw).toBe(true)
      const byPost = Object.fromEntries(counts.data.map((r) => [r.postId, r.count]))
      expect(byPost).toEqual({ [a.id]: 2, [b.id]: 1, [c.id]: 1 })

      const summary = await callServerFn<{ count: number }>(
        api,
        'fetchMergeSuggestionSummaryFn',
        undefined,
        { method: 'GET' }
      )
      expect(summary.ok, summary.raw).toBe(true)
      // Other tests add suggestions too: the total includes at least our two.
      expect(summary.data.count).toBeGreaterThanOrEqual(2)
    } finally {
      await api.dispose()
    }
  }
)
