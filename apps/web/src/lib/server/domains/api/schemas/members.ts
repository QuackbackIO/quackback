/**
 * Members API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import {
  PersonLanguageSchema,
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
  language: PersonLanguageSchema,
})

// Request body schemas
const UpdateMemberRoleSchema = z
  .object({
    role: z.enum(['admin', 'member']).meta({ description: 'New role for the member' }),
    roleId: TypeIdSchema.optional().meta({
      description:
        "Custom role to grant (from the roles table). Requires role='member'; the Owner preset is rejected.",
    }),
  })
  .meta({ description: 'Update member role request body' })

type PathMethods = Parameters<typeof registerPath>[1]

/**
 * Register a team-member operation at its real `/principals` path and at the
 * deprecated `/members` alias, which serves the same handlers.
 */
function registerMemberPath(suffix: string, methods: PathMethods) {
  registerPath(`/principals${suffix}`, methods)
  const aliased = Object.fromEntries(
    Object.entries(methods).map(([method, operation]) => [
      method,
      {
        ...(operation as object),
        deprecated: true,
        description:
          `Deprecated alias of ${method.toUpperCase()} /principals${suffix}; use that path instead. ` +
          ((operation as { description?: string }).description ?? ''),
      },
    ])
  ) as PathMethods
  registerPath(`/members${suffix}`, aliased)
}

// Error response schemas
const ForbiddenErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .meta({ description: 'Forbidden error' })

const SeatLimitErrorSchema = z
  .object({
    error: z.literal('tier_limit_exceeded'),
    limit: z.literal('maxTeamSeats'),
    message: z.string(),
    current: z.number().optional(),
    max: z.number().optional(),
    needed: z.number().meta({ description: 'Seats the request needs' }),
    free: z.number().meta({ description: 'Seats free on the plan' }),
  })
  .meta({ description: 'Seat limit error' })

// Register GET /principals (and the deprecated /members alias)
registerMemberPath('', {
  get: {
    tags: ['Members'],
    summary: 'List team members',
    description: 'Returns all team members (admin and member roles) in the workspace',
    responses: {
      200: {
        description: 'List of team members',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(TeamMemberSchema) }),
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

// Register GET /principals/{principalId} (and the deprecated /members alias)
registerMemberPath('/{principalId}', {
  get: {
    tags: ['Members'],
    summary: 'Get a team member',
    description: 'Get a single team member by ID',
    parameters: [
      {
        name: 'principalId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Principal ID',
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

// Register PATCH /principals/{principalId} (and the deprecated /members alias)
registerMemberPath('/{principalId}', {
  patch: {
    tags: ['Members'],
    summary: 'Update a team member',
    description:
      "Update a team member's role, or add a portal user to the team by giving them a role. " +
      'A portal user must have signed in (a provider account or a portal session); they join ' +
      'at once and take a seat. Only an admin key grants the admin role or changes an admin. Cannot modify your own role.',
    parameters: [
      {
        name: 'principalId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Principal ID',
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
      402: {
        description: 'Adding a portal user needs a seat and none is free',
        content: { 'application/json': { schema: SeatLimitErrorSchema } },
      },
      403: {
        description:
          'Cannot modify own role or last admin, or the role is above what the key may grant (GRANT_CEILING)',
        content: { 'application/json': { schema: ForbiddenErrorSchema } },
      },
      404: {
        description: 'Team member not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /principals/{principalId} (and the deprecated /members alias)
registerMemberPath('/{principalId}', {
  delete: {
    tags: ['Members'],
    summary: 'Remove a team member',
    description:
      'Remove a team member from the workspace (converts them to a portal user). Cannot remove yourself or the last admin; only an admin key removes an admin.',
    parameters: [
      {
        name: 'principalId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Principal ID',
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
