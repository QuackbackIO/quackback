/**
 * Principal/user search server functions.
 *
 * Powers every "people" picker in the agent/admin UI (assignee, team-add,
 * escalation recipients, contact↔user link). Returns a thin row optimised for
 * combobox rendering — id, name, email, role, avatar.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, UserId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { db, eq, and, or, ilike, inArray, notInArray, desc, principal, user } from '@/lib/server/db'

const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>

export interface PrincipalSearchRow {
  id: PrincipalId
  displayName: string | null
  email: string | null
  role: string
  avatarUrl: string | null
  type: string
  userId: UserId | null
}

export const searchPrincipalsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      query: z.string().max(200).optional(),
      roleFilter: z.array(z.string().max(32)).optional(),
      excludeIds: z.array(principalIdSchema).max(200).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
  )
  .handler(async ({ data }): Promise<PrincipalSearchRow[]> => {
    // Any authenticated team member can search principals — UI requires it
    // for picker controls. The result set is read-only (id/name/email/role).
    await requireAuth({ roles: ['admin', 'member', 'user'] })

    const limit = data.limit ?? 20
    const trimmed = data.query?.trim() ?? ''

    const filters = []

    if (data.roleFilter && data.roleFilter.length > 0) {
      filters.push(inArray(principal.role, data.roleFilter))
    }
    if (data.excludeIds && data.excludeIds.length > 0) {
      filters.push(notInArray(principal.id, data.excludeIds))
    }
    if (trimmed.length > 0) {
      const pattern = `%${trimmed}%`
      const textMatch = or(
        ilike(principal.displayName, pattern),
        ilike(user.email, pattern),
        ilike(user.name, pattern)
      )
      if (textMatch) filters.push(textMatch)
    }

    const where = filters.length > 0 ? and(...filters) : undefined

    const rows = await db
      .select({
        id: principal.id,
        displayName: principal.displayName,
        avatarUrl: principal.avatarUrl,
        role: principal.role,
        type: principal.type,
        userId: principal.userId,
        userEmail: user.email,
        userName: user.name,
      })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(where)
      .orderBy(desc(principal.createdAt))
      .limit(limit)

    return rows.map((r) => ({
      id: r.id as PrincipalId,
      displayName: r.displayName ?? r.userName ?? null,
      email: r.userEmail ?? null,
      role: r.role,
      avatarUrl: r.avatarUrl,
      type: r.type,
      userId: (r.userId as UserId | null) ?? null,
    }))
  })

export const getPrincipalsByIdsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ids: z.array(principalIdSchema).min(1).max(200) }))
  .handler(async ({ data }): Promise<PrincipalSearchRow[]> => {
    await requireAuth({ roles: ['admin', 'member', 'user'] })
    const rows = await db
      .select({
        id: principal.id,
        displayName: principal.displayName,
        avatarUrl: principal.avatarUrl,
        role: principal.role,
        type: principal.type,
        userId: principal.userId,
        userEmail: user.email,
        userName: user.name,
      })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(inArray(principal.id, data.ids))

    return rows.map((r) => ({
      id: r.id as PrincipalId,
      displayName: r.displayName ?? r.userName ?? null,
      email: r.userEmail ?? null,
      role: r.role,
      avatarUrl: r.avatarUrl,
      type: r.type,
      userId: (r.userId as UserId | null) ?? null,
    }))
  })
