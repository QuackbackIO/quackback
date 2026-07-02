/**
 * Changelog-visibility schema registrations: org-level defaults + per-segment
 * overrides that gate which changelog categories/products portal users see.
 *
 * Feedback-plane resource, role-gated (team read, admin write) rather than
 * scope-gated.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import { UnauthorizedErrorSchema } from './common'

const ChangelogVisibilityConfigSchema = z.object({
  restrictCategories: z.boolean().optional(),
  allowedCategoryIds: z.array(TypeIdSchema).max(500).optional(),
  restrictProducts: z.boolean().optional(),
  allowedProductIds: z.array(TypeIdSchema).max(500).optional(),
})

const SegmentVisibilityOverrideSchema = z.object({
  segmentId: TypeIdSchema,
  config: ChangelogVisibilityConfigSchema,
})

registerPath('/changelog/visibility', {
  get: {
    tags: ['Changelog Visibility'],
    summary: 'Read org-level changelog visibility config',
    responses: {
      200: {
        description: 'Org visibility config',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChangelogVisibilityConfigSchema, 'Config'),
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
    tags: ['Changelog Visibility'],
    summary: 'Replace org-level changelog visibility config (admin)',
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: asSchema(ChangelogVisibilityConfigSchema) },
      },
    },
    responses: {
      200: {
        description: 'Updated config',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChangelogVisibilityConfigSchema, 'Config'),
          },
        },
      },
    },
  },
})

registerPath('/changelog/visibility/segments', {
  get: {
    tags: ['Changelog Visibility'],
    summary: 'List every per-segment visibility override',
    responses: {
      200: {
        description: 'Segment overrides',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.array(SegmentVisibilityOverrideSchema.extend({ segmentName: z.string() })),
              'Overrides'
            ),
          },
        },
      },
    },
  },
})

registerPath('/changelog/visibility/segments/{segmentId}', {
  get: {
    tags: ['Changelog Visibility'],
    summary: 'Read one per-segment override',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Override',
        content: {
          'application/json': {
            schema: createItemResponseSchema(SegmentVisibilityOverrideSchema, 'Override'),
          },
        },
      },
      404: { description: 'Override not found' },
    },
  },
  put: {
    tags: ['Changelog Visibility'],
    summary: 'Upsert one per-segment override (admin)',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: asSchema(ChangelogVisibilityConfigSchema) },
      },
    },
    responses: {
      200: {
        description: 'Upserted override',
        content: {
          'application/json': {
            schema: createItemResponseSchema(SegmentVisibilityOverrideSchema, 'Override'),
          },
        },
      },
    },
  },
  delete: {
    tags: ['Changelog Visibility'],
    summary: 'Remove one per-segment override (admin)',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Removed' } },
  },
})
