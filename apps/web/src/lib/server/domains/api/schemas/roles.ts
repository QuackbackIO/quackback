/**
 * RBAC schema registrations: roles + permissions, the permission catalogue, and
 * principal role assignments.
 *
 * All endpoints are gated by the `admin.manage_roles` scope/permission: the API
 * key must carry the scope AND the calling principal must hold the permission.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  asSchema,
} from '../openapi'
import { TimestampSchema, UnauthorizedErrorSchema } from './common'

const RoleSchema = z.object({
  id: TypeIdSchema.meta({ example: 'role_01h455vb4pex5vsknk084sn02q' }),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissionCount: z.number().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const RoleWithPermissionsSchema = RoleSchema.extend({
  permissionKeys: z.array(z.string()),
})

const RoleAssignmentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'role_asgn_01h455vb4pex5vsknk084sn02q' }),
  principalId: TypeIdSchema,
  roleId: TypeIdSchema,
  teamId: TypeIdSchema.nullable(),
})

registerPath('/roles', {
  get: {
    tags: ['RBAC'],
    summary: 'List roles (with permission counts)',
    description: 'Requires the `admin.manage_roles` scope/permission.',
    responses: {
      200: {
        description: 'Roles',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(RoleSchema, 'Roles') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: { description: 'admin.manage_roles permission required' },
    },
  },
  post: {
    tags: ['RBAC'],
    summary: 'Create a custom role',
    description: 'Requires the `admin.manage_roles` scope/permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              key: z.string().min(1).max(64),
              name: z.string().min(1).max(200),
              description: z.string().max(1000).nullable().optional(),
              permissionKeys: z.array(z.string()).max(200).optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Role created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoleWithPermissionsSchema, 'Role'),
          },
        },
      },
    },
  },
})

registerPath('/roles/{roleId}', {
  get: {
    tags: ['RBAC'],
    summary: 'Get a role with its permissions',
    parameters: [{ name: 'roleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Role',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoleWithPermissionsSchema, 'Role'),
          },
        },
      },
    },
  },
  patch: {
    tags: ['RBAC'],
    summary: 'Rename / re-describe a role',
    parameters: [{ name: 'roleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200),
              description: z.string().max(1000).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['RBAC'],
    summary: 'Delete a custom role (system roles are rejected)',
    parameters: [{ name: 'roleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/roles/{roleId}/permissions', {
  put: {
    tags: ['RBAC'],
    summary: "Replace a role's permission set",
    parameters: [{ name: 'roleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ permissionKeys: z.array(z.string()).max(200) })),
        },
      },
    },
    responses: {
      200: {
        description: 'Updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoleWithPermissionsSchema, 'Role'),
          },
        },
      },
    },
  },
})

registerPath('/permissions', {
  get: {
    tags: ['RBAC'],
    summary: 'List the RBAC permission catalogue',
    description:
      'Reference data: every permission key plus the category → keys grouping. Requires the `admin.manage_roles` scope/permission.',
    responses: {
      200: {
        description: 'Permission catalogue',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                permissions: z.array(z.string()),
                categories: z.record(z.string(), z.array(z.string())),
              }),
              'Catalogue'
            ),
          },
        },
      },
    },
  },
})

registerPath('/principals/{principalId}/roles', {
  get: {
    tags: ['RBAC'],
    summary: "List a principal's role assignments",
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Assignments',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(RoleAssignmentSchema, 'Assignments'),
          },
        },
      },
    },
  },
  post: {
    tags: ['RBAC'],
    summary: 'Assign a role to a principal (optionally team-scoped)',
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              roleId: TypeIdSchema,
              teamId: TypeIdSchema.nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Assigned',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoleAssignmentSchema, 'Assignment'),
          },
        },
      },
    },
  },
})

registerPath('/role-assignments/{assignmentId}', {
  delete: {
    tags: ['RBAC'],
    summary: 'Revoke a role assignment',
    parameters: [
      { name: 'assignmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Revoked' } },
  },
})
