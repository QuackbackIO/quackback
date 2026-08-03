/**
 * Segments schema registrations: audience segments + membership mutations.
 *
 * Config-plane resource, scope-gated with the `segment.*` permissions: the API
 * key must carry the scope AND the calling principal must hold the permission.
 * Membership mutations are addressed by segment `slug` and accept a batch of
 * principal IDs, returning the actual applied counts.
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
import { TimestampSchema, UnauthorizedErrorSchema } from './common'

const SegmentConditionSchema = z.object({
  attribute: z.string(),
  operator: z.enum([
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'contains',
    'starts_with',
    'ends_with',
    'in',
    'is_set',
    'is_not_set',
  ]),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
  metadataKey: z.string().optional(),
})

const SegmentRulesSchema = z.object({
  match: z.enum(['all', 'any']),
  conditions: z.array(SegmentConditionSchema),
})

const SegmentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'segment_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  type: z.enum(['manual', 'dynamic']),
  color: z.string().nullable(),
  rules: SegmentRulesSchema.nullable(),
  evaluationSchedule: z.unknown(),
  weightConfig: z.unknown(),
  memberCount: z.number().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/segments', {
  get: {
    tags: ['Segments'],
    summary: 'List audience segments (with member counts)',
    description: 'Requires the `segment.view` scope/permission.',
    responses: {
      200: {
        description: 'Segments',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(SegmentSchema, 'Segments') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: { description: 'segment.view permission required' },
    },
  },
  post: {
    tags: ['Segments'],
    summary: 'Create a segment (manual or dynamic)',
    description: 'Requires the `segment.manage` scope/permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1),
              description: z.string().optional(),
              type: z.enum(['manual', 'dynamic']),
              color: z.string().optional(),
              rules: SegmentRulesSchema.optional(),
              evaluationSchedule: z.unknown().optional(),
              weightConfig: z.unknown().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Segment created',
        content: {
          'application/json': { schema: createItemResponseSchema(SegmentSchema, 'Segment') },
        },
      },
      403: { description: 'segment.manage permission required' },
    },
  },
})

registerPath('/segments/{segmentId}', {
  get: {
    tags: ['Segments'],
    summary: 'Get a segment',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Segment',
        content: {
          'application/json': { schema: createItemResponseSchema(SegmentSchema, 'Segment') },
        },
      },
      404: { description: 'Segment not found' },
    },
  },
  patch: {
    tags: ['Segments'],
    summary: 'Update a segment',
    description: 'Requires the `segment.manage` scope/permission.',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).optional(),
              description: z.string().nullable().optional(),
              color: z.string().optional(),
              rules: SegmentRulesSchema.nullable().optional(),
              evaluationSchedule: z.unknown().optional(),
              weightConfig: z.unknown().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Segments'],
    summary: 'Soft-delete a segment',
    description: 'Requires the `segment.manage` scope/permission.',
    parameters: [{ name: 'segmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/segments/{slug}/members', {
  post: {
    tags: ['Segments'],
    summary: 'Add principals to a segment (by slug)',
    description:
      'Batch add up to 1000 principal IDs. Unknown / soft-deleted principals are reported back in `failed`.',
    parameters: [{ name: 'slug', in: 'path', required: true, schema: asSchema(z.string()) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ principalIds: z.array(TypeIdSchema).min(1).max(1000) })),
        },
      },
    },
    responses: {
      200: {
        description: 'Result counts',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ added: z.number(), failed: z.array(z.string()) }),
              'Add result'
            ),
          },
        },
      },
      404: { description: 'Segment not found' },
    },
  },
  delete: {
    tags: ['Segments'],
    summary: 'Remove principals from a segment (by slug)',
    description:
      'Batch remove up to 1000 principal IDs. Unknown / failed principals are reported back in `failed`.',
    parameters: [{ name: 'slug', in: 'path', required: true, schema: asSchema(z.string()) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ principalIds: z.array(TypeIdSchema).min(1).max(1000) })),
        },
      },
    },
    responses: {
      200: {
        description: 'Result counts',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ removed: z.number(), failed: z.array(z.string()) }),
              'Remove result'
            ),
          },
        },
      },
      404: { description: 'Segment not found' },
    },
  },
})
