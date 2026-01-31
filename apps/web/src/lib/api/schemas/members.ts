/**
 * Members API Schema Registrations
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
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Team Member schema
const TeamMemberSchema = z.object({
  id: TypeIdSchema.meta({ description: 'Member ID', example: 'member_01h455vb4pex5vsknk084sn02q' }),
  userId: TypeIdSchema.meta({ description: 'User ID' }),
  role: z.enum(['admin', 'member']).meta({ description: 'Member role' }),
  name: z.string().nullable().meta({ example: 'John Doe' }),
  email: z.string().meta({ example: 'john@example.com' }),
  image: z.string().nullable().meta({ description: 'Profile image URL' }),
  createdAt: TimestampSchema,
})

// Team Member list item (simplified)
const TeamMemberListItemSchema = z.object({
  id: TypeIdSchema,
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
})

// Request body schemas
const UpdateMemberRoleSchema = z
  .object({
    role: z.enum(['admin', 'member']).meta({ description: 'New role for the member' }),
  })
  .meta({ description: 'Update member role request body' })

// Error response schemas
const ForbiddenErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .meta({ description: 'Forbidden error' })

// Register GET /members
registerPath('/members', {
  get: {
    tags: ['Members'],
    summary: 'List team members',
    description: 'Returns all team members (admin and member roles) in the workspace',
    responses: {
      200: {
        description: 'List of team members',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TeamMemberListItemSchema, 'List of team members'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /members/{memberId}
registerPath('/members/{memberId}', {
  get: {
    tags: ['Members'],
    summary: 'Get a team member',
    description: 'Get a single team member by ID',
    parameters: [
      {
        name: 'memberId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Member ID',
      },
    ],
    responses: {
      200: {
        description: 'Team member details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TeamMemberSchema, 'Team member details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Team member not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /members/{memberId}
registerPath('/members/{memberId}', {
  patch: {
    tags: ['Members'],
    summary: 'Update a team member',
    description: "Update a team member's role. Cannot modify your own role.",
    parameters: [
      {
        name: 'memberId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Member ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateMemberRoleSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Team member updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TeamMemberSchema, 'Updated team member'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: {
        description: 'Cannot modify own role or last admin',
        content: { 'application/json': { schema: ForbiddenErrorSchema } },
      },
      404: {
        description: 'Team member not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /members/{memberId}
registerPath('/members/{memberId}', {
  delete: {
    tags: ['Members'],
    summary: 'Remove a team member',
    description:
      'Remove a team member from the workspace (converts them to a portal user). Cannot remove yourself or the last admin.',
    parameters: [
      {
        name: 'memberId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Member ID',
      },
    ],
    responses: {
      204: { description: 'Team member removed' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: {
        description: 'Cannot remove self or last admin',
        content: { 'application/json': { schema: ForbiddenErrorSchema } },
      },
      404: {
        description: 'Team member not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
