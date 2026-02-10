import type { PrincipalId, UserId, WorkspaceId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Role } from '@/lib/server/auth'
import { db, session, principal, eq, and, gt } from '@/lib/server/db'

export interface WidgetAuthContext {
  settings: {
    id: WorkspaceId
    slug: string
    name: string
  }
  user: {
    id: UserId
    email: string
    name: string
    image: string | null
  }
  principal: {
    id: PrincipalId
    role: Role
  }
}

/** Returns widget auth context from `Authorization: Bearer <token>`, or null if invalid/expired. */
export async function getWidgetSession(): Promise<WidgetAuthContext | null> {
  const headers = getRequestHeaders()
  const authHeader = headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  if (!token) return null

  const sessionRecord = await db.query.session.findFirst({
    where: and(eq(session.token, token), gt(session.expiresAt, new Date())),
    with: { user: true },
  })

  if (!sessionRecord?.user) return null

  const userId = sessionRecord.userId as UserId

  const { getSettings } = await import('./workspace')
  const appSettings = await getSettings()
  if (!appSettings) return null

  let principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, userId),
  })

  if (!principalRecord) {
    const [created] = await db
      .insert(principal)
      .values({
        id: generateId('principal'),
        userId,
        role: 'user',
        displayName: sessionRecord.user.name,
        avatarUrl: sessionRecord.user.image ?? null,
        createdAt: new Date(),
      })
      .returning()
    principalRecord = created
  }

  return {
    settings: {
      id: appSettings.id as WorkspaceId,
      slug: appSettings.slug,
      name: appSettings.name,
    },
    user: {
      id: userId,
      email: sessionRecord.user.email,
      name: sessionRecord.user.name,
      image: sessionRecord.user.image ?? null,
    },
    principal: {
      id: principalRecord.id as PrincipalId,
      role: principalRecord.role as Role,
    },
  }
}
