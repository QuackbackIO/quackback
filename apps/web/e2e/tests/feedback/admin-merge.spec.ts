/**
 * Merging duplicate feedback from the team side: merge into another, merge
 * others into this, unmerge, AI merge suggestions and their counts.
 *
 * Journeys: FBA-M-01
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { bodyOf, deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import {
  inboxTitles,
  makeBoard,
  makePost,
  openInbox,
  openPost,
  portalCustomer,
  postRow,
  uuid,
} from '../../product/feedback-admin'
import {
  activityTypes,
  pickMergeAction,
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
