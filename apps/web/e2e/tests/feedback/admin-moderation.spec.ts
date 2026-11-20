/**
 * Moderation from the team side: held posts and comments, the queue, approve
 * and reject, board overrides, the workspace policy and the counts.
 *
 * Shared tests hold content with their own board's moderation override; the
 * workspace-wide switches are `@isolated`.
 *
 * Journeys: FBA-Q-05
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { fakeAi } from '../../support/fake-ai-client'
import { emailLogFor } from '../../support/mailpit'
import { deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import { makeBoard, portalCustomer, postRow } from '../../product/feedback-admin'
import { auditActions, heldPost, queueRow } from '../../product/feedback-admin-merge'
import { sink } from '../../support/webhook-sink-client'

test(
  'FBA-Q-05 approving a held post publishes it and only then announces it',
  { tag: '@smoke' },
  async ({ playwright, browser, baseURL, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.created'])
    const customer = await portalCustomer(browser, marker, { name: `Held ${marker}` })
    try {
      const board = await makeBoard(api, marker)
      const title = `${marker} held idea`
      const postId = await heldPost(api, customer, board.id, title, `Body of ${marker}`)
      expect((await postRow(postId))?.moderation_state).toBe('pending')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.held')

      const admin = await asPerson('admin')
      await admin.goto('/admin/feedback/moderation')
      const row = queueRow(admin, title)
      await expect(row).toContainText(`by Held ${marker} in ${board.name}`)
      // Nothing announced while held: no webhook, no AI work on the post.
      expect((await sink.deliveries(marker)).filter((d) => d.body.includes(postId))).toEqual([])
      expect(
        (await fakeAi.requests({ contains: title })).map(
          (r) => `${r.endpoint}: ${r.text.slice(0, 160)}`
        )
      ).toEqual([])

      await row.getByRole('button', { name: 'Approve' }).click()
      await expect(row).toHaveCount(0)
      expect((await postRow(postId))?.moderation_state).toBe('published')
      await expect.poll(() => auditActions(postId)).toContain('post.moderation.approved')
      await deliveriesOf(marker, 'post.created', postId)
      await fakeAi.waitForRequests({ contains: title })
      // The author is told nothing about the decision.
      expect(await emailLogFor(customer.email)).toEqual([])
    } finally {
      await unsubscribe(hooks, hook)
      await customer.close()
      await api.dispose()
      await hooks.dispose()
    }
  }
)
