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
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

interface PrincipalCardBody {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: string
  joinedAt: string
}

// Resolve in the order: principal own avatar → linked user image. The
// user fallback covers principal rows that pre-date syncPrincipalProfile
// being wired into every avatar-upload path, or any other gap where the
// principal mirror drifted from the source-of-truth user record.
function resolveCardAvatar(opts: {
  principalAvatarKey: string | null
  principalAvatarUrl: string | null
  userImageKey: string | null | undefined
  userImage: string | null | undefined
}): string | null {
  if (opts.principalAvatarKey) {
    const s3Url = getPublicUrlOrNull(opts.principalAvatarKey)
    if (s3Url) return s3Url
  }
  if (opts.principalAvatarUrl) return opts.principalAvatarUrl
  if (opts.userImageKey) {
    const s3Url = getPublicUrlOrNull(opts.userImageKey)
    if (s3Url) return s3Url
  }
  return opts.userImage ?? null
}

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
    avatarUrl: resolveCardAvatar({
      principalAvatarKey: row.avatarKey,
      principalAvatarUrl: row.avatarUrl,
      userImageKey: row.userImageKey,
      userImage: row.userImage,
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
