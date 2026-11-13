/**
 * Posts API Schema Registrations — subscribers (who follows a post's thread)
 *
 * Reading the subscribers rides post.view_private; subscribing or
 * unsubscribing someone rides post.vote_on_behalf. Only someone with an
 * account who can see the post can be subscribed.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createRequestBodySchema, asSchema } from '../openapi'
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const SUBSCRIBER_REASONS = ['author', 'vote', 'comment', 'manual', 'owner', 'added'] as const

export const PostSubscriberSchema = z.object({
  principalId: TypeIdSchema.meta({ example: 'principal_01h455vb4pex5vsknk084sn02q' }),
  displayName: z.string().nullable().meta({ example: 'Ada Lovelace' }),
  email: z.string().nullable().meta({ example: 'ada@example.com' }),
  avatarUrl: z.string().nullable(),
  isTeamMember: z.boolean().meta({ example: false }),
  reason: z.enum(SUBSCRIBER_REASONS).meta({
    description:
      'Why they follow the post: author, vote, comment, manual (followed it themselves), owner (assigned to it) or added (by a teammate)',
    example: 'added',
  }),
  level: z.enum(['all', 'status_only']).meta({
    description: 'all: comments and status changes; status_only: status changes only',
    example: 'all',
  }),
  canView: z.boolean().meta({
    description:
      'False for someone who can no longer see the post: they stay subscribed but are not notified',
    example: true,
  }),
  createdAt: TimestampSchema,
})

const SubscriberListSchema = z
  .object({ data: z.array(PostSubscriberSchema) })
  .meta({ description: "Everyone subscribed to the post's thread" })

const AddSubscriberBodySchema = createRequestBodySchema({
  principalId: TypeIdSchema.meta({
    description: 'Someone with an account who can see the post',
    example: 'principal_01h455vb4pex5vsknk084sn02q',
  }),
  level: z.enum(['all', 'status_only']).optional().meta({
    description: 'What they are notified about; all by default',
    example: 'all',
  }),
})

const postIdParam = {
  name: 'postId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Post ID',
}

const unauthorized = {
  description: 'Unauthorized',
  content: { 'application/json': { schema: UnauthorizedErrorSchema } },
}
const notFound = {
  description: 'Post not found',
  content: { 'application/json': { schema: NotFoundErrorSchema } },
}

registerPath('/posts/{postId}/subscribers', {
  get: {
    tags: ['Posts'],
    summary: "List a post's subscribers",
    description:
      "Everyone who follows the post's thread (the post and the posts merged into it), with why and at what level.",
    parameters: [postIdParam],
    responses: {
      200: {
        description: 'Subscribers',
        content: { 'application/json': { schema: SubscriberListSchema } },
      },
      401: unauthorized,
      404: notFound,
    },
  },
  post: {
    tags: ['Posts'],
    summary: 'Subscribe someone to a post',
    description:
      'Subscribe someone to the post, so they get its comments and status changes. They must have an account and be able to see the post. They are notified that they were subscribed. Subscribing someone who already follows the thread changes nothing.',
    parameters: [postIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(AddSubscriberBodySchema) } },
    },
    responses: {
      200: {
        description: 'Already subscribed; the subscribers, unchanged',
        content: { 'application/json': { schema: SubscriberListSchema } },
      },
      201: {
        description: 'Subscribed; the subscribers after the change',
        content: { 'application/json': { schema: SubscriberListSchema } },
      },
      400: {
        description: 'Validation error: the principal has no account, or cannot see the post',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: unauthorized,
      404: notFound,
    },
  },
})

registerPath('/posts/{postId}/subscribers/{principalId}', {
  delete: {
    tags: ['Posts'],
    summary: 'Unsubscribe someone from a post',
    description:
      "Unsubscribe someone from the post's thread, whatever made them follow it. Succeeds whether or not they were subscribed.",
    parameters: [
      postIdParam,
      {
        name: 'principalId',
        in: 'path' as const,
        required: true,
        schema: { type: 'string' as const },
        description: "The subscriber's principal ID",
      },
    ],
    responses: {
      204: { description: 'Not subscribed' },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: unauthorized,
      404: notFound,
    },
  },
})
