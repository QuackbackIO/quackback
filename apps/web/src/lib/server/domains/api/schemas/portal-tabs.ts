/**
 * Portal-tab schema registrations: org-level portal tab visibility defaults +
 * per-segment overrides.
 *
 * Config-plane resource, scope-gated with the `portal.manage` permission
 * (config scopes `read:config` / `write:config`). All tabs are optional
 * booleans — an absent key falls back to the org/segment default.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import { UnauthorizedErrorSchema } from './common'

const PortalTabConfigSchema = z.object({
  feedback: z.boolean().optional(),
  roadmap: z.boolean().optional(),
  changelog: z.boolean().optional(),
  myTickets: z.boolean().optional(),
  helpCenter: z.boolean().optional(),
  support: z.boolean().optional(),
})

const SegmentTabOverrideSchema = z.object({
  segmentId: TypeIdSchema,
  segmentName: z.string(),
  overrides: PortalTabConfigSchema,
})

registerPath('/portal-tabs', {
  get: {
    tags: ['Portal Tabs'],
    summary: 'Read org-level portal tab config',
    responses: {
      200: {
        description: 'Org portal tab config',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PortalTabConfigSchema, 'Config'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  put: {
    tags: ['Portal Tabs'],
    summary: 'Replace org-level portal tab config',
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: asSchema(PortalTabConfigSchema) },
      },
    },
    responses: {
      200: {
        description: 'Updated config',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PortalTabConfigSchema, 'Config'),
          },
        },
      },
    },
  },
})

registerPath('/portal-tabs/segments', {
  get: {
    tags: ['Portal Tabs'],
    summary: 'List every per-segment portal tab override',
    responses: {
      200: {
        description: 'Segment overrides',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.array(SegmentTabOverrideSchema), 'Overrides'),
          },
        },
      },
    },
  },
})

registerPath('/portal-tabs/segments/{segmentId}', {
  get: {
    tags: ['Portal Tabs'],
    summary: 'Read one per-segment portal tab override',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Override',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PortalTabConfigSchema, 'Override'),
          },
        },
      },
      404: { description: 'Override not found' },
    },
  },
  put: {
    tags: ['Portal Tabs'],
    summary: 'Upsert one per-segment portal tab override',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: asSchema(PortalTabConfigSchema) },
      },
    },
    responses: {
      200: {
        description: 'Upserted override',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PortalTabConfigSchema, 'Override'),
          },
        },
      },
    },
  },
  delete: {
    tags: ['Portal Tabs'],
    summary: 'Remove one per-segment portal tab override (revert to org defaults)',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Removed' } },
  },
})
