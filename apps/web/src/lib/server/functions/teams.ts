/**
 * Teams server functions.
 *
 * All write actions are gated by the ADMIN_MANAGE_USERS permission and emit
 * an audit event so the admin trail captures team membership changes.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, TeamId } from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  createTeam,
  updateTeam,
  archiveTeam,
  unarchiveTeam,
  getTeam,
  listTeams,
  addMember,
  removeMember,
  listMembers,
  type TeamRole,
} from '@/lib/server/domains/teams'
import { recordEvent } from '@/lib/server/domains/audit'

const teamIdSchema = z.string().min(1) as z.ZodType<TeamId>
const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>

export const listTeamsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ includeArchived: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    return listTeams({ includeArchived: data.includeArchived })
  })

export const getTeamFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ teamId: teamIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    return getTeam(data.teamId)
  })

export const createTeamFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string().min(1).max(64),
      name: z.string().min(1).max(120),
      description: z.string().max(500).nullable().optional(),
      shortLabel: z.string().max(8).nullable().optional(),
      color: z.string().max(16).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    const team = await createTeam(data, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.created',
      targetType: 'team',
      targetId: team.id,
      diff: { after: { slug: team.slug, name: team.name } },
    })
    return team
  })

export const updateTeamFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      teamId: teamIdSchema,
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).nullable().optional(),
      shortLabel: z.string().max(8).nullable().optional(),
      color: z.string().max(16).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    const before = await getTeam(data.teamId)
    const team = await updateTeam(data.teamId, data, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.updated',
      targetType: 'team',
      targetId: team.id,
      diff: {
        before: before
          ? {
              name: before.name,
              description: before.description,
              shortLabel: before.shortLabel,
              color: before.color,
            }
          : undefined,
        after: {
          name: team.name,
          description: team.description,
          shortLabel: team.shortLabel,
          color: team.color,
        },
      },
    })
    return team
  })

export const archiveTeamFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ teamId: teamIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    await archiveTeam(data.teamId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.archived',
      targetType: 'team',
      targetId: data.teamId,
    })
    return { ok: true as const }
  })

export const unarchiveTeamFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ teamId: teamIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    await unarchiveTeam(data.teamId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.unarchived',
      targetType: 'team',
      targetId: data.teamId,
    })
    return { ok: true as const }
  })

export const listTeamMembersFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ teamId: teamIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    return listMembers(data.teamId)
  })

export const addTeamMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      teamId: teamIdSchema,
      principalId: principalIdSchema,
      role: z.enum(['lead', 'member']).default('member'),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    const membership = await addMember(data.teamId, data.principalId, data.role as TeamRole)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.member_added',
      targetType: 'team',
      targetId: data.teamId,
      diff: { after: { principalId: data.principalId, role: data.role } },
    })
    return membership
  })

export const removeTeamMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ teamId: teamIdSchema, principalId: principalIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS)
    await removeMember(data.teamId, data.principalId)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'team.member_removed',
      targetType: 'team',
      targetId: data.teamId,
      diff: { before: { principalId: data.principalId } },
    })
    return { ok: true as const }
  })
