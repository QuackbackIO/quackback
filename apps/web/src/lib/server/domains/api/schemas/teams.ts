/**
 * Teams schema registrations: teams CRUD, archive/unarchive, and membership.
 *
 * Config-plane resource, scope-gated with the `team.*` permissions: the API key
 * must carry the scope AND the calling principal must hold the permission.
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
import { TimestampSchema, NullableTimestampSchema, UnauthorizedErrorSchema } from './common'

const TeamSchema = z.object({
  id: TypeIdSchema.meta({ example: 'team_01h455vb4pex5vsknk084sn02q' }),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  shortLabel: z.string().nullable(),
  color: z.string().nullable(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const TeamMemberSchema = z.object({
  teamId: TypeIdSchema,
  principalId: TypeIdSchema,
  role: z.enum(['lead', 'member']),
  createdAt: TimestampSchema,
})

registerPath('/teams', {
  get: {
    tags: ['Teams'],
    summary: 'List teams',
    description:
      'Requires the `team.view` scope/permission. Pass `?includeArchived=true` to include archived teams.',
    parameters: [
      {
        name: 'includeArchived',
        in: 'query',
        schema: asSchema(z.enum(['true', 'false']).optional()),
      },
    ],
    responses: {
      200: {
        description: 'Teams',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(TeamSchema, 'Teams') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: { description: 'team.view permission required' },
    },
  },
  post: {
    tags: ['Teams'],
    summary: 'Create a team',
    description: 'Requires the `team.manage` scope/permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
              name: z.string().min(1).max(200),
              description: z.string().max(1000).nullable().optional(),
              shortLabel: z.string().max(40).nullable().optional(),
              color: z.string().max(16).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Team created',
        content: { 'application/json': { schema: createItemResponseSchema(TeamSchema, 'Team') } },
      },
      403: { description: 'team.manage permission required' },
    },
  },
})

registerPath('/teams/{teamId}', {
  get: {
    tags: ['Teams'],
    summary: 'Get a team',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Team',
        content: { 'application/json': { schema: createItemResponseSchema(TeamSchema, 'Team') } },
      },
      404: { description: 'Team not found' },
    },
  },
  patch: {
    tags: ['Teams'],
    summary: 'Update a team',
    description: 'Requires the `team.manage` scope/permission.',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200).optional(),
              description: z.string().max(1000).nullable().optional(),
              shortLabel: z.string().max(40).nullable().optional(),
              color: z.string().max(16).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Teams'],
    summary: 'Archive a team (use POST /unarchive to restore)',
    description: 'Requires the `team.manage` scope/permission.',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Archived' } },
  },
})

registerPath('/teams/{teamId}/unarchive', {
  post: {
    tags: ['Teams'],
    summary: 'Restore an archived team',
    description: 'Requires the `team.manage` scope/permission.',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: createItemResponseSchema(TeamSchema, 'Team') } },
      },
      404: { description: 'Team not found' },
    },
  },
})

registerPath('/teams/{teamId}/members', {
  get: {
    tags: ['Teams'],
    summary: 'List team members',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Members',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TeamMemberSchema, 'Members'),
          },
        },
      },
    },
  },
  post: {
    tags: ['Teams'],
    summary: 'Add or update a team member',
    description: 'Requires the `team.manage` scope/permission.',
    parameters: [{ name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              principalId: TypeIdSchema,
              role: z.enum(['lead', 'member']).optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Member added',
        content: {
          'application/json': { schema: createItemResponseSchema(TeamMemberSchema, 'Member') },
        },
      },
    },
  },
})

registerPath('/teams/{teamId}/members/{principalId}', {
  delete: {
    tags: ['Teams'],
    summary: 'Remove a team member',
    description: 'Requires the `team.manage` scope/permission.',
    parameters: [
      { name: 'teamId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Removed' } },
  },
})
