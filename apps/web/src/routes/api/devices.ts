import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@/lib/server/auth/session'
import { toSessionScope } from '@/lib/shared/roles'
import { db, principal, eq } from '@/lib/server/db'
import {
  registerDevice,
  unregisterDevice,
  type PushPlatform,
} from '@/lib/server/domains/push-devices/push-device.service'

const PLATFORMS: readonly PushPlatform[] = ['ios', 'android']

/**
 * POST /api/devices — register the caller's push token.
 * Session-authed (cookie). Widget/portal Bearers cannot bind a push token
 * to a teammate principal. No extra role gate: the consumer only delivers
 * to admin/member principals.
 */
export async function handleRegisterDevice(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (toSessionScope(session.session?.scope) !== 'dashboard') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    platform?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const platform = body?.platform
  if (!token || typeof platform !== 'string' || !PLATFORMS.includes(platform as PushPlatform)) {
    return Response.json({ error: 'Invalid token or platform' }, { status: 400 })
  }

  const p = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id),
    columns: { id: true },
  })
  if (!p) {
    return Response.json({ error: 'No principal for user' }, { status: 403 })
  }

  await registerDevice({ principalId: p.id, token, platform: platform as PushPlatform })
  return new Response(null, { status: 204 })
}

/** DELETE /api/devices — unregister a push token (logout / rotation). */
export async function handleUnregisterDevice(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (toSessionScope(session.session?.scope) !== 'dashboard') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 400 })
  }

  const p = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id),
    columns: { id: true },
  })
  if (!p) {
    return Response.json({ error: 'No principal for user' }, { status: 403 })
  }

  // Scope the delete to the caller's principal so an agent can only unregister
  // their own device, never another's by token alone (IDOR guard).
  await unregisterDevice({ principalId: p.id, token })
  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/devices')({
  server: {
    handlers: {
      POST: ({ request }) => handleRegisterDevice(request),
      DELETE: ({ request }) => handleUnregisterDevice(request),
    },
  },
})
