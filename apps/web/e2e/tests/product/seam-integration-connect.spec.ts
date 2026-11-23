/**
 * The connect route seam (`POST /api/e2e/integrations/connect`, behind the
 * harness gate): an integration connected with a test token through the app's
 * own install path, then one sync run against the provider fake.
 *
 * One integration row per provider per workspace, so tests that connect the
 * same provider share it; each test tells its own work apart by a destination
 * id (channel, team) that carries its marker.
 */
import { test, expect } from '../../support/fixtures'
import { connectIntegration, fakeProvider } from '../../support/fake-provider-client'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor, supportDb } from '../../support/db'
import { createBoard, createPost, workspaceApi } from '../../product/rest'

test(
  'a Linear integration connected with a test token creates an issue for a new post',
  { tag: '@core' },
  async ({ playwright, request, baseURL, people, marker }) => {
    const accessToken = 'linear-e2e-token'
    const { integrationId, integrationType } = await connectIntegration(request, {
      type: 'linear',
      accessToken,
    })
    expect(integrationType).toBe('linear')

    // The install path stored it as a real connect would: active, encrypted
    // token, a service principal, the provider's config.
    const [row] = await supportDb()<
      { status: string; secrets: string; principal_id: string | null; config: unknown }[]
    >`SELECT status, secrets, principal_id, config FROM integrations WHERE integration_type = 'linear'`
    expect(row.status).toBe('active')
    expect(row.secrets).not.toContain(accessToken)
    expect(row.principal_id).not.toBeNull()
    expect(row.config).toMatchObject({ orgId: 'org-fake' })

    const api = await workspaceApi(playwright, baseURL, people)
    const board = await createBoard(api, marker)
    const teamId = `team-${marker}`
    const admin = await personApi(playwright, 'admin')
    const added = await callServerFn(admin, 'addNotificationChannelFn', {
      integrationId,
      channelId: teamId,
      events: ['post.created'],
      boardIds: [board.id],
    })
    expect(added.ok, added.error).toBe(true)

    try {
      const post = await createPost(api, board.id, `${marker} export to CSV`)

      // One sync: the issueCreate mutation reached the fake with this team.
      const [call] = await fakeProvider.waitForRequests({
        contains: teamId,
        host: 'api.linear.app',
      })
      expect(call.path).toBe('/graphql')
      expect(call.headers.authorization).toBe(`Bearer ${accessToken}`)
      const sent = call.json as { query: string; variables: { input: Record<string, unknown> } }
      expect(sent.query).toContain('issueCreate')
      expect(sent.variables.input).toMatchObject({ teamId, title: post.title })

      // ...and the app recorded the issue the fake answered with.
      const op = await pollFor('the Linear sync operation to succeed', async () => {
        const [found] = await supportDb()<{ state: string; remote_id: string | null }[]>`
          SELECT state, remote_id FROM integration_sync_operations
          WHERE provider = 'linear' AND source_type = 'post' AND source_id = ${post.id}`
        return found?.state === 'succeeded' ? found : null
      })
      expect(op.remote_id).toMatch(/^00000000-0000-4000-8000-/)
    } finally {
      await callServerFn(admin, 'removeNotificationChannelFn', { integrationId, channelId: teamId })
      await admin.dispose()
    }
  }
)

test(
  'the connect route refuses an integration type the app does not have',
  { tag: '@core' },
  async ({ request }) => {
    const res = await request.post('/api/e2e/integrations/connect', {
      data: { type: 'not-a-provider', accessToken: 'x' },
    })
    expect(res.status()).toBe(400)
  }
)
