/**
 * Roles & permissions admin server-fns.
 *
 * All gated by `requireAuth({ roles: ['admin'] })`. The actor's principal id
 * is propagated to the service for `grantedByPrincipalId` and audit events.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, RoleId, RoleAssignmentId, TeamId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  listRoles,
  getRoleWithPermissions,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  listAssignmentsForPrincipal,
  assignRole,
  revokeRoleAssignment,
} from '@/lib/server/domains/authz/role.service'
import { ALL_PERMISSIONS, type PermissionKey } from '@/lib/server/domains/authz/authz.permissions'

const roleIdSchema = z.string().min(1) as z.ZodType<RoleId>
const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>
const teamIdSchema = z.string().min(1) as z.ZodType<TeamId>
const assignmentIdSchema = z.string().min(1) as z.ZodType<RoleAssignmentId>

const permissionKeySchema = z.enum(ALL_PERMISSIONS as readonly [PermissionKey, ...PermissionKey[]])

const roleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'lowercase letters, digits, _ or - only')

export const listRolesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return listRoles()
})

export const getRoleFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: roleIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return getRoleWithPermissions(data.id)
  })

export const createRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      key: roleKeySchema,
      name: z.string().min(1).max(128),
      description: z.string().max(2000).optional().nullable(),
      permissionKeys: z.array(permissionKeySchema).max(128),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const id = await createRole({
      key: data.key,
      name: data.name,
      description: data.description ?? null,
      permissionKeys: data.permissionKeys,
      actorPrincipalId: auth.principal.id,
    })
    return { id }
  })

export const updateRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: roleIdSchema,
      name: z.string().min(1).max(128),
      description: z.string().max(2000).optional().nullable(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    await updateRole({
      id: data.id,
      name: data.name,
      description: data.description ?? null,
      actorPrincipalId: auth.principal.id,
    })
    return { ok: true as const }
  })

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: roleIdSchema }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    await deleteRole({ id: data.id, actorPrincipalId: auth.principal.id })
    return { ok: true as const }
  })

export const setRolePermissionsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      roleId: roleIdSchema,
      permissionKeys: z.array(permissionKeySchema).max(128),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    await setRolePermissions({
      roleId: data.roleId,
      permissionKeys: data.permissionKeys,
      actorPrincipalId: auth.principal.id,
    })
    return { ok: true as const }
  })

export const listAssignmentsForPrincipalFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ principalId: principalIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return listAssignmentsForPrincipal(data.principalId)
  })

export const assignRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalId: principalIdSchema,
      roleId: roleIdSchema,
      teamId: teamIdSchema.optional().nullable(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const id = await assignRole({
      principalId: data.principalId,
      roleId: data.roleId,
      teamId: data.teamId ?? null,
      actorPrincipalId: auth.principal.id,
    })
    return { id }
  })

export const revokeRoleAssignmentFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ assignmentId: assignmentIdSchema }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    await revokeRoleAssignment({
      assignmentId: data.assignmentId,
      actorPrincipalId: auth.principal.id,
    })
    return { ok: true as const }
  })
