/**
 * Widget-profile schema registrations: widget applications and their
 * per-environment profiles.
 *
 * A widget application is a stable public integration key for an external app;
 * each application can have one active profile per environment. Config-plane
 * resource, scope-gated with the `widget.view` / `widget.manage` permissions
 * (config scopes `read:config` / `write:config`).
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

const WidgetEnvironmentProfileSchema = z.object({
  id: TypeIdSchema.meta({ example: 'widget_profile_01h455vb4pex5vsknk084sn02q' }),
  applicationId: TypeIdSchema,
  environment: z.string().meta({ example: 'production' }),
  displayName: z.string(),
  enabled: z.boolean(),
  allowedOrigins: z.array(z.string()),
  configOverrides: z.record(z.string(), z.unknown()),
  contentFilters: z.record(z.string(), z.unknown()),
  supportConfig: z.record(z.string(), z.unknown()),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const WidgetApplicationSchema = z.object({
  id: TypeIdSchema.meta({ example: 'widget_app_01h455vb4pex5vsknk084sn02q' }),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  profiles: z.array(WidgetEnvironmentProfileSchema),
})

registerPath('/widget-profiles', {
  get: {
    tags: ['Widget Profiles'],
    summary: 'List widget applications (each with its environment profiles)',
    description: 'Requires the `widget.view` scope/permission.',
    responses: {
      200: {
        description: 'Widget applications',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(WidgetApplicationSchema, 'Applications'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: { description: 'widget.view permission required' },
    },
  },
  post: {
    tags: ['Widget Profiles'],
    summary: 'Create or update a widget application',
    description:
      'Requires the `widget.manage` scope/permission. When `id` is supplied the matching application is updated; otherwise a new one is created.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              id: TypeIdSchema.optional(),
              key: z.string().min(1).max(120),
              name: z.string().min(1).max(200),
              description: z.string().max(1000).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Application created or updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(WidgetApplicationSchema, 'Application'),
          },
        },
      },
      403: { description: 'widget.manage permission required' },
    },
  },
})

registerPath('/widget-profiles/environments', {
  post: {
    tags: ['Widget Profiles'],
    summary: 'Create or update a widget environment profile',
    description:
      'Requires the `widget.manage` scope/permission. When `id` is supplied the matching profile is updated; otherwise a new one is created. The environment is normalized and an absent `displayName` defaults to it.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              id: TypeIdSchema.optional(),
              applicationId: TypeIdSchema,
              environment: z.string().min(1).max(80),
              displayName: z.string().min(1).max(200).optional(),
              enabled: z.boolean().optional(),
              allowedOrigins: z.array(z.string().min(1).max(300)).optional(),
              configOverrides: z.record(z.string(), z.unknown()).optional(),
              contentFilters: z.record(z.string(), z.unknown()).optional(),
              supportConfig: z.record(z.string(), z.unknown()).optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Environment profile created or updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(WidgetEnvironmentProfileSchema, 'Profile'),
          },
        },
      },
      403: { description: 'widget.manage permission required' },
    },
  },
})
