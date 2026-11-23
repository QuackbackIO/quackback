/**
 * The provider fake seam (src/lib/server/e2e-harness/provider-fake.ts): behind
 * the harness gate the app's Slack client and every provider fetch reach the
 * local provider fake (e2e/support/stand-ins/fake-provider.ts) instead of the
 * real provider, so a hook that runs is observable and never leaves the
 * machine.
 *
 * The connect route (`/api/e2e/integrations/connect`) is proven in
 * seam-integration-connect.spec.ts; this file uses it to get a Slack row.
 */
import { test, expect } from '../../support/fixtures'
import { connectIntegration, fakeProvider } from '../../support/fake-provider-client'
import { callServerFn, personApi } from '../../support/server-fns'
import { createBoard, createPost, workspaceApi } from '../../product/rest'

test(
  'a Slack hook for a new post is delivered to the provider fake',
  { tag: '@core' },
  async ({ playwright, request, baseURL, people, marker }) => {
    const { integrationId } = await connectIntegration(request, { type: 'slack' })
    const api = await workspaceApi(playwright, baseURL, people)
    const board = await createBoard(api, marker)
    const admin = await personApi(playwright, 'admin')
    // The Slack row is shared by every test: this test's channel carries its
    // marker and hears only its own board.
    const channelId = `C${marker}`
    const added = await callServerFn(admin, 'addNotificationChannelFn', {
      integrationId,
      channelId,
      events: ['post.created'],
      boardIds: [board.id],
    })
    expect(added.ok, added.error).toBe(true)

    try {
      const post = await createPost(api, board.id, `${marker} wants dark mode`)

      const [delivery] = await fakeProvider.waitForRequests({
        contains: channelId,
        host: 'slack.com',
      })
      expect(delivery.method).toBe('POST')
      expect(delivery.path).toBe('/api/chat.postMessage')
      expect(delivery.headers.authorization).toBe('Bearer slack-e2e-token')
      const message = delivery.json as { channel: string; text: string }
      expect(message.channel).toBe(channelId)
      expect(message.text).toContain(post.title)
    } finally {
      await callServerFn(admin, 'removeNotificationChannelFn', { integrationId, channelId })
      await admin.dispose()
    }
  }
)
