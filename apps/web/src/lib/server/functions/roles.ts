/**
 * Server functions for custom-role CRUD (Settings → Members → Roles).
 * Reads ride member.view (the roles tab is part of the team roster surface);
 * every write is the first live consumer of role.manage.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { isValidTypeId, type RoleId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import { actorFromAuth } from '@/lib/server/audit/log'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { ValidationError } from '@/lib/shared/errors'
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  type RoleEditor,
} from '@/lib/server/domains/roles/role.service'

const roleIdSchema = z.string().refine((v) => isValidTypeId(v, 'role'), 'Invalid role id')

const createRoleSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(280).nullable().optional(),
  permissionKeys: z.array(z.string().max(64)).max(256).optional(),
  duplicateFromRoleId: roleIdSchema.optional(),
})

const updateRoleSchema = z.object({
  roleId: roleIdSchema,
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(280).nullable().optional(),
  // Bounded: the catalogue is the ceiling, and keys are short dotted names.
  permissionKeys: z.array(z.string().max(64)).max(256).optional(),
})

const deleteRoleSchema = z.object({
  roleId: roleIdSchema,
  reassignToRoleId: roleIdSchema.optional(),
})

function editorFromAuth(auth: Awaited<ReturnType<typeof requireAuth>>): RoleEditor {
  return {
    principalId: auth.principal.id,
    permissions: (auth.permissions ?? []) as PermissionKey[],
  }
}

export const listRolesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const [roles, limits] = await Promise.all([
    listRoles(),
    import('@/lib/server/domains/settings/tier-limits.service').then((m) => m.getTierLimits()),
  ])
  // The cap ships so the roles tab can render the plan banner; null (the OSS
  // default) renders nothing.
  return { roles, maxCustomRoles: limits.maxCustomRoles }
})

export const createRoleFn = createServerFn({ method: 'POST' })
  .validator(createRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.ROLE_MANAGE })
    return createRole(
      {
        name: data.name,
        description: data.description,
        permissionKeys: data.permissionKeys as PermissionKey[] | undefined,
        duplicateFromRoleId: data.duplicateFromRoleId as RoleId | undefined,
      },
      editorFromAuth(auth),
      { actor: actorFromAuth(auth), headers: getRequestHeaders() }
    )
  })

export const updateRoleFn = createServerFn({ method: 'POST' })
  .validator(updateRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.ROLE_MANAGE })
    return updateRole(
      data.roleId as RoleId,
      {
        name: data.name,
        description: data.description,
        permissionKeys: data.permissionKeys as PermissionKey[] | undefined,
      },
      editorFromAuth(auth),
      { actor: actorFromAuth(auth), headers: getRequestHeaders() }
    )
  })

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .validator(deleteRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.ROLE_MANAGE })
    if (data.reassignToRoleId === data.roleId) {
      throw new ValidationError('VALIDATION_ERROR', 'Cannot reassign a role to itself')
    }
    return deleteRole(
      data.roleId as RoleId,
      { reassignToRoleId: data.reassignToRoleId as RoleId | undefined },
      editorFromAuth(auth),
      { actor: actorFromAuth(auth), headers: getRequestHeaders() }
    )
  })
