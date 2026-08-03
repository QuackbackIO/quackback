/**
 * Admin / RBAC schema registrations: organizations, contacts, teams,
 * audit events, scoped API keys, webhook delivery audit log.
 *
 * Phase 1, 2, 6, 7 backend.
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

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

const OrganizationSchema = z.object({
  id: TypeIdSchema.meta({ example: 'org_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  domain: z.string().nullable(),
  externalId: z.string().nullable(),
  website: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/organizations', {
  get: {
    tags: ['Organizations'],
    summary: 'List organizations',
    parameters: [
      { name: 'search', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
    ],
    responses: {
      200: {
        description: 'Organizations',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(OrganizationSchema, 'Organizations'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  post: {
    tags: ['Organizations'],
    summary: 'Create an organization',
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/organizations/{organizationId}', {
  get: {
    tags: ['Organizations'],
    summary: 'Get organization',
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 200: { description: 'Organization' } },
  },
  patch: {
    tags: ['Organizations'],
    summary: 'Update organization',
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Organizations'],
    summary: 'Archive organization',
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Archived' } },
  },
})

registerPath('/organizations/{organizationId}/contacts', {
  get: {
    tags: ['Organizations'],
    summary: 'List contacts for an organization',
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 200: { description: 'Contacts' } },
  },
})

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const ContactSchema = z.object({
  id: TypeIdSchema.meta({ example: 'contact_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  externalId: z.string().nullable(),
  organizationId: TypeIdSchema.nullable(),
  avatarUrl: z.string().nullable(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/contacts', {
  get: {
    tags: ['Contacts'],
    summary: 'List contacts',
    parameters: [
      { name: 'q', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'email', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'organizationId', in: 'query', schema: asSchema(TypeIdSchema.optional()) },
    ],
    responses: {
      200: {
        description: 'Contacts',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(ContactSchema, 'Contacts') },
        },
      },
    },
  },
  post: {
    tags: ['Contacts'],
    summary: 'Create a contact',
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/contacts/{contactId}', {
  get: {
    tags: ['Contacts'],
    summary: 'Get contact',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Contact' } },
  },
  patch: {
    tags: ['Contacts'],
    summary: 'Update contact',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Contacts'],
    summary: 'Archive contact',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Archived' } },
  },
})

registerPath('/contacts/{contactId}/links', {
  post: {
    tags: ['Contacts'],
    summary: 'Link contact to a portal user',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 201: { description: 'Linked' } },
  },
  delete: {
    tags: ['Contacts'],
    summary: 'Unlink contact from a portal user',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Unlinked' } },
  },
})

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

const AuditEventSchema = z.object({
  id: TypeIdSchema.meta({ example: 'audit_01h455vb4pex5vsknk084sn02q' }),
  principalId: TypeIdSchema.nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  source: z.enum(['web', 'api', 'integration', 'system', 'mcp']),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  diff: z.unknown(),
  createdAt: TimestampSchema,
})

registerPath('/audit-events', {
  get: {
    tags: ['Audit'],
    summary: 'List audit events',
    parameters: [
      { name: 'principalId', in: 'query', schema: asSchema(TypeIdSchema.optional()) },
      { name: 'action', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'actionPrefix', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'targetType', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'targetId', in: 'query', schema: asSchema(z.string().optional()) },
      {
        name: 'source',
        in: 'query',
        schema: asSchema(z.enum(['web', 'api', 'integration', 'system', 'mcp']).optional()),
      },
      { name: 'from', in: 'query', schema: asSchema(z.string().datetime().optional()) },
      { name: 'to', in: 'query', schema: asSchema(z.string().datetime().optional()) },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(200).optional()),
      },
    ],
    responses: {
      200: {
        description: 'Audit events',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(AuditEventSchema, 'Audit events'),
          },
        },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// API Keys (scoped)
// ---------------------------------------------------------------------------

const ApiKeySchema = z.object({
  id: TypeIdSchema.meta({ example: 'apikey_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  allowedTeamIds: z.array(TypeIdSchema),
  allowedInboxIds: z.array(TypeIdSchema),
  compatLegacyFullAccess: z.boolean(),
  compatAcknowledgedAt: NullableTimestampSchema,
  lastIp: z.string().nullable(),
  lastUserAgent: z.string().nullable(),
  rotatedAt: NullableTimestampSchema,
  expiresAt: NullableTimestampSchema,
  revokedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  lastUsedAt: NullableTimestampSchema,
})

registerPath('/api-keys', {
  get: {
    tags: ['API Keys'],
    summary: 'List API keys',
    responses: {
      200: {
        description: 'API keys',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(ApiKeySchema, 'API keys') },
        },
      },
    },
  },
  post: {
    tags: ['API Keys'],
    summary: 'Create a scoped API key',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200),
              expiresAt: z.string().datetime().nullable().optional(),
              scopes: z.array(z.string()).optional(),
              allowedTeamIds: z.array(TypeIdSchema).optional(),
              allowedInboxIds: z.array(TypeIdSchema).optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'API key created (plaintext returned ONCE)',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              ApiKeySchema.extend({ plaintextKey: z.string() }),
              'API key + plaintext'
            ),
          },
        },
      },
    },
  },
})

registerPath('/api-keys/{apiKeyId}', {
  get: {
    tags: ['API Keys'],
    summary: 'Get API key',
    parameters: [{ name: 'apiKeyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'API key' } },
  },
  patch: {
    tags: ['API Keys'],
    summary: 'Update API key (name + scopes + allow-lists)',
    parameters: [{ name: 'apiKeyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['API Keys'],
    summary: 'Revoke API key',
    parameters: [{ name: 'apiKeyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Revoked' } },
  },
})

registerPath('/api-keys/{apiKeyId}/rotate', {
  post: {
    tags: ['API Keys'],
    summary: 'Rotate API key (returns new plaintext)',
    parameters: [{ name: 'apiKeyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Rotated' } },
  },
})

registerPath('/api-keys/{apiKeyId}/acknowledge-legacy', {
  post: {
    tags: ['API Keys'],
    summary: 'Acknowledge legacy unscoped status',
    parameters: [{ name: 'apiKeyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Acknowledged' } },
  },
})

// ---------------------------------------------------------------------------
// Webhook deliveries (Phase 7)
// ---------------------------------------------------------------------------

const WebhookDeliverySchema = z.object({
  id: TypeIdSchema.meta({ example: 'wh_deliv_01h455vb4pex5vsknk084sn02q' }),
  webhookId: TypeIdSchema,
  eventId: z.string(),
  eventType: z.string(),
  attemptNumber: z.number(),
  status: z.enum(['queued', 'success', 'failed_retryable', 'failed_terminal', 'blocked_ssrf']),
  httpStatus: z.number().nullable(),
  errorMessage: z.string().nullable(),
  requestUrl: z.string(),
  requestPayloadBytes: z.number(),
  responseBodySnippet: z.string().nullable(),
  latencyMs: z.number().nullable(),
  signatureTimestamp: z.number(),
  attemptedAt: TimestampSchema,
  nextRetryAt: NullableTimestampSchema,
})

registerPath('/webhooks/{webhookId}/deliveries', {
  get: {
    tags: ['Webhooks'],
    summary: 'List delivery attempts for a webhook',
    parameters: [
      { name: 'webhookId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      {
        name: 'status',
        in: 'query',
        schema: asSchema(
          z
            .enum(['queued', 'success', 'failed_retryable', 'failed_terminal', 'blocked_ssrf'])
            .optional()
        ),
      },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'cursorAttemptedAt', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'cursorId', in: 'query', schema: asSchema(z.string().optional()) },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(200).optional()),
      },
    ],
    responses: {
      200: {
        description: 'Delivery attempts (newest first)',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(WebhookDeliverySchema, 'Deliveries'),
          },
        },
      },
    },
  },
})
