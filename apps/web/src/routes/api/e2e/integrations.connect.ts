import { createFileRoute } from '@tanstack/react-router'
import { harnessNotFound, isE2eHarnessEnabled } from '@/lib/server/e2e-harness/gate'

/**
 * Test-only: connect an integration with a test token through the app's own
 * install path, skipping the provider's OAuth screens. Body:
 * `{ "type": "<integration>", "accessToken"?, "config"?, "secrets"?, "principalId"?,
 * "reuseExisting"? }` (reuseExisting: answer with the provider's active row
 * when there is one, instead of reconnecting).
 * Answers `{ ok, integrationId, integrationType }`. 404 unless the e2e harness
 * gate is open (see lib/server/e2e-harness/gate.ts).
 */
export async function handleE2eIntegrationConnect(request: Request): Promise<Response> {
  if (!isE2eHarnessEnabled()) return harnessNotFound()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const { connectE2eIntegration } = await import('@/lib/server/e2e-harness/integrations')
  const outcome = await connectE2eIntegration(body)
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status })
  return Response.json(outcome)
}

export const Route = createFileRoute('/api/e2e/integrations/connect')({
  server: {
    handlers: {
      POST: ({ request }) => handleE2eIntegrationConnect(request),
    },
  },
})
