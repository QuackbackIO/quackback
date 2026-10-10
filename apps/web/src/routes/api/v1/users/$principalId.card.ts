/**
 * GET /api/v1/users/:principalId/card
 *
 * Hover-card payload for an @-mention chip. Mirrors the suggest endpoint's
 * auth pattern: session-authenticated only, anonymous and service principals
 * are rejected so the user directory is never enumerable from a public iframe.
 *
 * Returns a small subset of the principal record: no email, no metadata —
 * just what the chip overlay needs to render. 404 when the principal has
 * been deleted; the client suppresses the popover in that case (plain-text
 * fallback).
 */
import { createFileRoute } from '@tanstack/react-router'
import type { PrincipalId, UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, principal, user, eq } from '@/lib/server/db'
import { resolveUserAvatarUrl } from '@/lib/server/domains/principals/principal-display'

interface PrincipalCardBody {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: string
  joinedAt: string
}

// Uploaded key first, then OAuth/external URL — same as the admin sidebar.
// User-row fields beat the principal mirror so stale `avatar_*` copies
// (pre-syncPrincipalProfile rows) still show the current picture.

export async function handlePrincipalCard({
  request,
  params,
}: {
  request: Request
  params: { principalId: string }
}): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Caller must be a real human user — anonymous portal voters and service
  // (API key) principals never get to read individual principal records.
  const callerPrincipal = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { id: true, type: true },
  })
  if (!callerPrincipal || callerPrincipal.type !== 'user') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targetId = params.principalId as PrincipalId
  const [row] = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      avatarKey: principal.avatarKey,
      role: principal.role,
      createdAt: principal.createdAt,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, targetId))
    .limit(1)

  if (!row) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  const body: PrincipalCardBody = {
    principalId: row.id,
    displayName: row.displayName ?? '',
    avatarUrl: resolveUserAvatarUrl({
      userImage: row.userImage,
      userImageKey: row.userImageKey,
      principalAvatarUrl: row.avatarUrl,
      principalAvatarKey: row.avatarKey,
    }),
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
  }

  return Response.json(body, { status: 200 })
}

export const Route = createFileRoute('/api/v1/users/$principalId/card')({
  server: {
    handlers: {
      GET: handlePrincipalCard,
    },
  },
})
