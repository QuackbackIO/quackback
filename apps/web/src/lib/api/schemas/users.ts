/**
 * Portal Users API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import { TimestampSchema, UnauthorizedErrorSchema, NotFoundErrorSchema } from './common'

// Portal User list item schema
const PortalUserListItemSchema = z.object({
  memberId: TypeIdSchema.meta({ description: 'Member ID' }),
  userId: z.string().meta({ description: 'User ID' }),
  name: z.string().nullable().meta({ example: 'Jane Doe' }),
  email: z.string().meta({ example: 'jane@example.com' }),
  image: z.string().nullable().meta({ description: 'Profile image URL' }),
  emailVerified: z.boolean().meta({ description: 'Whether email is verified' }),
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
    tags: ['Members'],
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
        name: 'sort',
        in: 'query',
        schema: { type: 'string', enum: ['newest', 'oldest', 'most_active', 'name'] },
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

// Register GET /users/{memberId}
registerPath('/users/{memberId}', {
  get: {
    tags: ['Members'],
    summary: 'Get a portal user',
    description: 'Get detailed information about a portal user, including their activity',
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

// Register DELETE /users/{memberId}
registerPath('/users/{memberId}', {
  delete: {
    tags: ['Members'],
    summary: 'Remove a portal user',
    description: 'Remove a portal user from the workspace',
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
