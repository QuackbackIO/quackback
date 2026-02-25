/**
 * Portal Users API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Shared attributes schema
const UserAttributesSchema = z
  .record(z.string(), z.unknown())
  .meta({ description: 'User attributes (must be configured in Settings > User Attributes)' })

// Portal User list item schema
const PortalUserListItemSchema = z.object({
  principalId: TypeIdSchema.meta({ description: 'Principal ID' }),
  userId: z.string().meta({ description: 'User ID' }),
  name: z.string().nullable().meta({ example: 'Jane Doe' }),
  email: z.string().meta({ example: 'jane@example.com' }),
  image: z.string().nullable().meta({ description: 'Profile image URL' }),
  emailVerified: z.boolean().meta({ description: 'Whether email is verified' }),
  attributes: UserAttributesSchema,
  joinedAt: TimestampSchema.meta({ description: 'When the user joined' }),
  postCount: z.number().meta({ description: 'Number of posts created' }),
  commentCount: z.number().meta({ description: 'Number of comments made' }),
  voteCount: z.number().meta({ description: 'Number of votes cast' }),
})

// Engaged post schema (for user detail)
const EngagedPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  statusId: TypeIdSchema.nullable(),
  statusName: z.string().nullable(),
  statusColor: z.string(),
  voteCount: z.number(),
  commentCount: z.number(),
  boardSlug: z.string(),
  boardName: z.string(),
  authorName: z.string().nullable(),
  createdAt: TimestampSchema,
  engagementTypes: z.array(z.enum(['authored', 'commented', 'voted'])),
  engagedAt: TimestampSchema,
})

// Portal User detail schema
const PortalUserDetailSchema = PortalUserListItemSchema.extend({
  createdAt: TimestampSchema.meta({ description: 'Account creation date' }),
  engagedPosts: z.array(EngagedPostSchema).meta({ description: 'Posts the user has engaged with' }),
})

// Identify user response schema
const IdentifyUserResponseSchema = z.object({
  principalId: TypeIdSchema.meta({ description: 'Principal ID' }),
  userId: z.string().meta({ description: 'User ID' }),
  name: z.string().meta({ example: 'Jane Doe' }),
  email: z.string().meta({ example: 'jane@example.com' }),
  image: z.string().nullable().meta({ description: 'Profile image URL' }),
  emailVerified: z.boolean().meta({ description: 'Whether email is verified' }),
  externalId: z.string().nullable().meta({ description: 'Customer-provided external user ID' }),
  attributes: UserAttributesSchema,
  createdAt: TimestampSchema.meta({ description: 'Account creation date' }),
  created: z
    .boolean()
    .meta({ description: 'true if new user was created, false if existing was updated' }),
})

const UpdateUserResponseSchema = IdentifyUserResponseSchema.omit({ created: true })

// Response schemas
const PortalUsersListResponseSchema = z
  .object({
    data: z.object({
      items: z.array(PortalUserListItemSchema),
      total: z.number(),
      hasMore: z.boolean(),
      page: z.number(),
      limit: z.number(),
    }),
  })
  .meta({ description: 'Paginated portal users response' })

// Register GET /users
registerPath('/users', {
  get: {
    tags: ['Users'],
    summary: 'List portal users',
    description: 'Returns a paginated list of portal users (public feedback submitters)',
    parameters: [
      {
        name: 'search',
        in: 'query',
        schema: { type: 'string' },
        description: 'Search by name or email',
      },
      {
        name: 'verified',
        in: 'query',
        schema: { type: 'string', enum: ['true', 'false'] },
        description: 'Filter by email verification status',
      },
      {
        name: 'dateFrom',
        in: 'query',
        schema: { type: 'string', format: 'date-time' },
        description: 'Filter by join date (from)',
      },
      {
        name: 'dateTo',
        in: 'query',
        schema: { type: 'string', format: 'date-time' },
        description: 'Filter by join date (to)',
      },
      {
        name: 'segmentIds',
        in: 'query',
        schema: { type: 'string' },
        description: 'Comma-separated segment IDs to filter by (OR logic)',
      },
      {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          enum: [
            'newest',
            'oldest',
            'most_active',
            'most_posts',
            'most_comments',
            'most_votes',
            'name',
          ],
        },
        description: 'Sort order',
      },
      {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', default: 1 },
        description: 'Page number',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page',
      },
    ],
    responses: {
      200: {
        description: 'List of portal users',
        content: {
          'application/json': {
            schema: asSchema(PortalUsersListResponseSchema),
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

// Register POST /users/identify
registerPath('/users/identify', {
  post: {
    tags: ['Users'],
    summary: 'Identify (create or update) a user',
    description:
      'Create a new portal user or update an existing one by email. ' +
      'User attributes must be configured in Settings > User Attributes before they can be set.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              email: z
                .string()
                .email()
                .meta({ description: 'User email (used for lookup/creation)' }),
              name: z.string().optional().meta({ description: 'Display name' }),
              image: z.string().url().optional().meta({ description: 'Profile image URL' }),
              emailVerified: z
                .boolean()
                .optional()
                .meta({ description: 'Email verification status' }),
              externalId: z
                .string()
                .optional()
                .meta({ description: "Your system's user ID for cross-referencing" }),
              attributes: UserAttributesSchema.optional(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Existing user updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(IdentifyUserResponseSchema, 'Updated user'),
          },
        },
      },
      201: {
        description: 'New user created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(IdentifyUserResponseSchema, 'Created user'),
          },
        },
      },
      400: {
        description: 'Validation error (invalid attributes)',
        content: { 'application/json': { schema: asSchema(ValidationErrorSchema) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /users/{principalId}
registerPath('/users/{principalId}', {
  get: {
    tags: ['Users'],
    summary: 'Get a portal user',
    description: 'Get detailed information about a portal user, including their activity',
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
        description: 'Portal user details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PortalUserDetailSchema, 'Portal user details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Portal user not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /users/{principalId}
registerPath('/users/{principalId}', {
  patch: {
    tags: ['Users'],
    summary: 'Update a portal user',
    description:
      "Update a portal user's profile and attributes. " +
      'User attributes must be configured in Settings > User Attributes before they can be set.',
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
          schema: asSchema(
            z.object({
              name: z.string().optional().meta({ description: 'Display name' }),
              image: z
                .string()
                .url()
                .nullable()
                .optional()
                .meta({ description: 'Profile image URL' }),
              emailVerified: z
                .boolean()
                .optional()
                .meta({ description: 'Email verification status' }),
              externalId: z
                .string()
                .nullable()
                .optional()
                .meta({ description: "Your system's user ID (null to unset)" }),
              attributes: UserAttributesSchema.optional(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Updated portal user',
        content: {
          'application/json': {
            schema: createItemResponseSchema(UpdateUserResponseSchema, 'Updated user'),
          },
        },
      },
      400: {
        description: 'Validation error (invalid attributes)',
        content: { 'application/json': { schema: asSchema(ValidationErrorSchema) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Portal user not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /users/{principalId}
registerPath('/users/{principalId}', {
  delete: {
    tags: ['Users'],
    summary: 'Remove a portal user',
    description: 'Remove a portal user from the workspace',
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
      204: { description: 'Portal user removed' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Portal user not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
