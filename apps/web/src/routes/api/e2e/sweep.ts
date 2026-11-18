import { createFileRoute } from '@tanstack/react-router'
import { harnessNotFound, isE2eHarnessEnabled } from '@/lib/server/e2e-harness/gate'

/**
 * Test-only: run one background sweep now, optionally as of a later time.
 * Body: `{ "job": "<sweep name>", "asOf"?: "<ISO-8601>" }`. 404 unless the
 * e2e harness gate is open (see lib/server/e2e-harness/gate.ts).
 */
export async function handleE2eSweep(request: Request): Promise<Response> {
  if (!isE2eHarnessEnabled()) return harnessNotFound()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const { runE2eSweep } = await import('@/lib/server/e2e-harness/sweeps')
  const outcome = await runE2eSweep(body)
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status })
  return Response.json(outcome)
}

export const Route = createFileRoute('/api/e2e/sweep')({
  server: {
    handlers: {
      POST: ({ request }) => handleE2eSweep(request),
    },
  },
})
