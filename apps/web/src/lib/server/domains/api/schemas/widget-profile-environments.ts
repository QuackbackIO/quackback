/**
 * Widget environment profile routes that identify the application in the path.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, createItemResponseSchema, registerPath, TypeIdSchema } from '../openapi'
import { NullableTimestampSchema, TimestampSchema, ValidationErrorSchema } from './common'

const WidgetEnvironmentProfileSchema = z.object({
  id: TypeIdSchema.meta({ example: 'widget_profile_01h455vb4pex5vsknk084sn02q' }),
  applicationId: TypeIdSchema,
  environment: z.string(),
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

const UpsertWidgetEnvironmentProfileSchema = z.object({
  id: TypeIdSchema.optional(),
  environment: z.string().min(1).max(80),
  displayName: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  allowedOrigins: z.array(z.string().min(1).max(300)).optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
  contentFilters: z.record(z.string(), z.unknown()).optional(),
  supportConfig: z.record(z.string(), z.unknown()).optional(),
})

registerPath('/widget-profiles/{applicationId}/environments', {
  post: {
    tags: ['Widget Profiles'],
    summary: 'Create a widget environment profile for an application',
    parameters: [
      { name: 'applicationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpsertWidgetEnvironmentProfileSchema) } },
    },
    responses: {
      201: {
        description: 'Environment profile created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(WidgetEnvironmentProfileSchema, 'Profile'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
  put: {
    tags: ['Widget Profiles'],
    summary: 'Create or update a widget environment profile for an application',
    parameters: [
      { name: 'applicationId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpsertWidgetEnvironmentProfileSchema) } },
    },
    responses: {
      200: {
        description: 'Environment profile upserted',
        content: {
          'application/json': {
            schema: createItemResponseSchema(WidgetEnvironmentProfileSchema, 'Profile'),
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
