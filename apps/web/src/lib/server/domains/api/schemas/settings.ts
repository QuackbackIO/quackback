/**
 * Settings schema registrations: workspace feature flags and help-center
 * configuration. Both surfaces are gated by `admin.manage_settings`.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, createItemResponseSchema, asSchema } from '../openapi'
import { UnauthorizedErrorSchema } from './common'

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FeatureFlagsSchema = z.object({
  helpCenter: z.boolean(),
  aiFeedbackExtraction: z.boolean(),
  tickets: z.boolean(),
  supportInbox: z.boolean(),
  linkPreviews: z.boolean(),
})

registerPath('/settings/features', {
  get: {
    tags: ['Settings'],
    summary: 'Read workspace feature flags',
    responses: {
      200: {
        description: 'Feature flags',
        content: {
          'application/json': {
            schema: createItemResponseSchema(FeatureFlagsSchema, 'Feature flags'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  patch: {
    tags: ['Settings'],
    summary: 'Toggle workspace feature flags',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(FeatureFlagsSchema.partial()),
        },
      },
    },
    responses: {
      200: {
        description: 'Updated feature flags',
        content: {
          'application/json': {
            schema: createItemResponseSchema(FeatureFlagsSchema, 'Feature flags'),
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

// ---------------------------------------------------------------------------
// Help-center configuration
// ---------------------------------------------------------------------------

const HelpCenterConfigSchema = z.object({
  enabled: z.boolean(),
  homepageTitle: z.string().nullable(),
  homepageDescription: z.string().nullable(),
})

registerPath('/settings/help-center', {
  get: {
    tags: ['Settings'],
    summary: 'Read help-center configuration',
    responses: {
      200: {
        description: 'Help-center configuration',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterConfigSchema, 'Help-center configuration'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  patch: {
    tags: ['Settings'],
    summary: 'Update help-center configuration',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              enabled: z.boolean().optional(),
              homepageTitle: z.string().min(1).max(200).optional(),
              homepageDescription: z.string().max(500).optional(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Updated help-center configuration',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterConfigSchema, 'Help-center configuration'),
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
