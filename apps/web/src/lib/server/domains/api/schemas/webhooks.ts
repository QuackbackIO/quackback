/**
 * Webhooks API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import { TimestampSchema, NullableTimestampSchema } from './common'
import { errorResponses } from './errors'

const WebhookEventSchema = z.enum(WEBHOOK_EVENTS).meta({ example: 'post.created' })

const webhookFields = {
  id: TypeIdSchema.meta({
    description: 'Webhook ID',
    example: 'webhook_01h455vb4pex5vsknk084sn02q',
  }),
  url: z.string().url().meta({ example: 'https://example.com/hooks/quackback' }),
  events: z.array(WebhookEventSchema).meta({ description: 'Events delivered to this webhook' }),
  boardIds: z
    .array(TypeIdSchema)
    .nullable()
    .meta({ description: 'Board IDs the webhook is limited to, null for all boards' }),
  status: z
    .enum(['active', 'disabled'])
    .meta({ description: 'Deliveries stop while a webhook is disabled' }),
  failureCount: z.number().int().meta({ description: 'Consecutive failed deliveries' }),
  lastTriggeredAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}

const WebhookListItemSchema = z.object(webhookFields)

const WebhookSchema = z.object({
  ...webhookFields,
  lastError: z
    .string()
    .nullable()
    .meta({ description: 'Error from the most recent failed delivery' }),
})

const CreatedWebhookSchema = z.object({
  id: webhookFields.id,
  url: webhookFields.url,
  secret: z.string().meta({
    description: 'Signing secret. Returned only on creation, store it now.',
  }),
  events: webhookFields.events,
  boardIds: webhookFields.boardIds,
  status: webhookFields.status,
  createdAt: TimestampSchema,
})

const RotatedSecretSchema = z.object({
  id: webhookFields.id,
  secret: z.string().meta({ description: 'New signing secret. Returned only once.' }),
  rotatedAt: TimestampSchema,
})

const CreateWebhookBodySchema = createRequestBodySchema({
  url: z.string().url().meta({ description: 'Endpoint that receives event deliveries' }),
  events: z.array(WebhookEventSchema).min(1).meta({ description: 'Events to deliver' }),
  boardIds: z.array(TypeIdSchema).optional().meta({
    description: 'Limit deliveries to events from these boards. Omit for all boards.',
  }),
})

const UpdateWebhookBodySchema = createRequestBodySchema({
  url: z.string().url().optional(),
  events: z.array(WebhookEventSchema).min(1).optional(),
  boardIds: z.array(TypeIdSchema).nullable().optional().meta({
    description: 'Board IDs to limit to, null to deliver events from all boards',
  }),
  status: z.enum(['active', 'disabled']).optional(),
})

const webhookIdParam = {
  name: 'webhookId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Webhook ID',
} as const

registerPath('/webhooks', {
  get: {
    tags: ['Webhooks'],
    summary: 'List webhooks',
    description:
      'Returns every webhook. Signing secrets are never included. Requires the webhook.view permission and the read:settings scope.',
    responses: {
      200: {
        description: 'List of webhooks',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(WebhookListItemSchema) }),
          },
        },
      },
      ...errorResponses(403),
    },
  },
  post: {
    tags: ['Webhooks'],
    summary: 'Create a webhook',
    description:
      'Creates a webhook. The signing secret is returned once, in this response only. Requires the webhook.manage permission and the write:settings scope. Each event needs its own read scope on the key (read:feedback for feedback, changelog and status page events; read:chat for conversation, message and ticket events) and its view permission on the creator of the key (post.view_private, conversation.view, ticket.view, status_page.publish), or the request is refused with 403.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateWebhookBodySchema) } },
    },
    responses: {
      201: {
        description: 'Webhook created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(CreatedWebhookSchema, 'Created webhook'),
          },
        },
      },
      ...errorResponses(400, 403),
    },
  },
})

registerPath('/webhooks/{webhookId}', {
  get: {
    tags: ['Webhooks'],
    summary: 'Get a webhook',
    description: 'Requires the webhook.view permission and the read:settings scope.',
    parameters: [webhookIdParam],
    responses: {
      200: {
        description: 'Webhook details',
        content: {
          'application/json': { schema: createItemResponseSchema(WebhookSchema, 'Webhook') },
        },
      },
      ...errorResponses(400, 403, 404),
    },
  },
  patch: {
    tags: ['Webhooks'],
    summary: 'Update a webhook',
    description:
      'Requires the webhook.manage permission and the write:settings scope. Changing events or the URL re-checks event access: new events, or for a URL change the events the webhook already carries. Each event needs its own read scope on the key (read:feedback for feedback, changelog and status page events; read:chat for conversation, message and ticket events) and its view permission on the creator of the key (post.view_private, conversation.view, ticket.view, status_page.publish), or the request is refused with 403.',
    parameters: [webhookIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateWebhookBodySchema) } },
    },
    responses: {
      200: {
        description: 'Webhook updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(WebhookSchema, 'Updated webhook'),
          },
        },
      },
      ...errorResponses(400, 403, 404),
    },
  },
  delete: {
    tags: ['Webhooks'],
    summary: 'Delete a webhook',
    description: 'Requires the webhook.manage permission and the write:settings scope.',
    parameters: [webhookIdParam],
    responses: {
      204: { description: 'Webhook deleted' },
      ...errorResponses(400, 403, 404),
    },
  },
})

registerPath('/webhooks/{webhookId}/rotate', {
  post: {
    tags: ['Webhooks'],
    summary: 'Rotate a webhook signing secret',
    description:
      'Generates a new signing secret and returns it once. Deliveries are signed with the new secret immediately. Requires the webhook.manage permission and the write:settings scope.',
    parameters: [webhookIdParam],
    responses: {
      200: {
        description: 'New signing secret',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RotatedSecretSchema, 'Rotated secret'),
          },
        },
      },
      ...errorResponses(400, 403, 404),
    },
  },
})
