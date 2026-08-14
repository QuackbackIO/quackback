import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { parsePlgEventInput } from '@/lib/shared/plg-events'
import { emitPlgEvent } from '@/lib/server/plg-events'

export async function handlePlgEvent(request: Request): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > 2_048) {
    return new Response(null, { status: 204 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return new Response(null, { status: 204 })
  }
  const event = parsePlgEventInput(raw)
  if (!event) return new Response(null, { status: 204 })

  try {
    const auth = await requireAuth()
    await emitPlgEvent(event, {
      workspaceId: auth.settings.id,
      principalId: auth.principal.id,
    })
  } catch {
    // A missing/expired session is expected on a best-effort client beacon.
  }
  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/plg-events')({
  server: { handlers: { POST: ({ request }) => handlePlgEvent(request) } },
})
