/**
 * Webhook management schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import { asSchema, createItemResponseSchema, registerPath, TypeIdSchema } from '../openapi'
import { TimestampSchema, ValidationErrorSchema } from './common'

const WebhookSchema = z.object({
  id: TypeIdSchema.meta({ example: 'webhook_01h455vb4pex5vsknk084sn02q' }),
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  boardIds: z.array(TypeIdSchema),
  status: z.enum(['active', 'disabled']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema.optional(),
})

const WebhookCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  boardIds: z.array(TypeIdSchema).optional(),
})

const WebhookUpdateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  boardIds: z.array(TypeIdSchema).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

registerPath('/webhooks', {
  get: {
    tags: ['Webhooks'],
    summary: 'List webhooks',
    responses: {
      200: {
        description: 'Webhooks',
        content: {
          'application/json': { schema: asSchema(z.object({ data: z.array(WebhookSchema) })) },
        },
      },
    },
  },
  post: {
    tags: ['Webhooks'],
    summary: 'Create a webhook',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(WebhookCreateSchema) } },
    },
    responses: {
      201: {
        description: 'Webhook created; signing secret is returned once',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              WebhookSchema.extend({ secret: z.string() }),
              'Webhook'
            ),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})

registerPath('/webhooks/{webhookId}', {
  get: {
    tags: ['Webhooks'],
    summary: 'Get a webhook',
    parameters: [{ name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Webhook' } },
  },
  patch: {
    tags: ['Webhooks'],
    summary: 'Update a webhook',
    parameters: [{ name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(WebhookUpdateSchema) } },
    },
    responses: { 200: { description: 'Updated webhook' } },
  },
  delete: {
    tags: ['Webhooks'],
    summary: 'Delete a webhook',
    parameters: [{ name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/webhooks/{webhookId}/rotate', {
  post: {
    tags: ['Webhooks'],
    summary: 'Rotate a webhook signing secret',
    parameters: [{ name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'New signing secret',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ id: TypeIdSchema, secret: z.string(), rotatedAt: TimestampSchema }),
              'Rotated secret'
            ),
          },
        },
      },
    },
  },
})

registerPath('/webhooks/{webhookId}/test', {
  post: {
    tags: ['Webhooks'],
    summary: 'Deliver a sample payload to a webhook',
    parameters: [{ name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ eventType: z.string().min(1) })),
        },
      },
    },
    responses: { 200: { description: 'Test delivery outcome' } },
  },
})

registerPath('/webhooks/sample-payloads', {
  get: {
    tags: ['Webhooks'],
    summary: 'List sample webhook payloads',
    responses: {
      200: {
        description: 'Sample payloads keyed by event type',
        content: {
          'application/json': {
            schema: asSchema(z.object({ data: z.record(z.string(), z.unknown()) })),
          },
        },
      },
    },
  },
})

registerPath('/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver', {
  post: {
    tags: ['Webhooks'],
    summary: 'Redeliver a stored webhook delivery',
    parameters: [
      { name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'deliveryId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: { description: 'Redelivery outcome' },
      422: { description: 'Original payload is unavailable' },
    },
  },
})
