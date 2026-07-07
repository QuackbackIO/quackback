/**
 * Status Page API Schema Registrations
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
import {
  TimestampSchema,
  NullableTimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const ComponentStatusSchema = z
  .enum([
    'operational',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'under_maintenance',
  ])
  .meta({ description: 'Component status', example: 'operational' })

const IncidentLifecycleStatusSchema = z
  .enum([
    'investigating',
    'identified',
    'monitoring',
    'resolved',
    'scheduled',
    'in_progress',
    'verifying',
    'completed',
  ])
  .meta({
    description:
      'Incident lifecycle (investigating|identified|monitoring|resolved) or maintenance lifecycle (scheduled|in_progress|verifying|completed), depending on `kind`.',
  })

const IncidentImpactSchema = z
  .enum(['none', 'minor', 'major', 'critical', 'maintenance'])
  .meta({ description: 'Incident impact severity' })

// Component schemas

const StatusComponentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'status_component_01h455vb4pex5vsknk084sn02q' }),
  groupId: TypeIdSchema.nullable(),
  name: z.string().meta({ example: 'API' }),
  description: z.string().nullable(),
  status: ComponentStatusSchema,
  position: z.number(),
  showUptime: z.boolean(),
  segmentIds: z.array(z.string()),
})

const PublicStatusComponentSchema = z.object({
  id: TypeIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: ComponentStatusSchema,
  showUptime: z.boolean(),
})

const CreateStatusComponentSchema = z
  .object({
    name: z.string().min(1).max(200).meta({ example: 'API' }),
    description: z.string().max(2000).nullable().optional(),
    groupId: z.string().nullable().optional().meta({ description: 'Status component group ID' }),
    status: ComponentStatusSchema.optional(),
    showUptime: z.boolean().optional(),
    segmentIds: z.array(z.string()).optional(),
  })
  .meta({ description: 'Create status component request body' })

const UpdateStatusComponentSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    groupId: z.string().nullable().optional(),
    showUptime: z.boolean().optional(),
    segmentIds: z.array(z.string()).optional(),
    status: ComponentStatusSchema.optional().meta({
      description:
        'Sets the live component status — the monitoring-tool automation hook (a Datadog/Pingdom/etc. webhook flips this directly).',
    }),
  })
  .meta({ description: 'Update status component request body (all fields optional)' })

// Incident schemas

const IncidentAffectedComponentSchema = z.object({
  componentId: z.string(),
  componentStatus: ComponentStatusSchema,
})

const IncidentUpdateSchema = z.object({
  id: TypeIdSchema,
  status: IncidentLifecycleStatusSchema,
  body: z.string(),
  createdAt: TimestampSchema,
})

const StatusIncidentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'status_incident_01h455vb4pex5vsknk084sn02q' }),
  kind: z.enum(['incident', 'maintenance']),
  title: z.string(),
  status: IncidentLifecycleStatusSchema,
  impact: IncidentImpactSchema,
  impactOverride: z.boolean(),
  scheduledStartAt: NullableTimestampSchema,
  scheduledEndAt: NullableTimestampSchema,
  autoStart: z.boolean(),
  autoComplete: z.boolean(),
  startedAt: TimestampSchema,
  resolvedAt: NullableTimestampSchema,
  backfilled: z.boolean(),
  notifiedAt: NullableTimestampSchema,
  createdBy: TypeIdSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  affectedComponents: z.array(
    z.object({
      componentId: TypeIdSchema,
      componentStatus: ComponentStatusSchema,
      name: z.string(),
      segmentIds: z.array(z.string()),
    })
  ),
  updates: z.array(IncidentUpdateSchema),
})

const CreateStatusIncidentSchema = z
  .object({
    kind: z.enum(['incident', 'maintenance']),
    title: z.string().min(1).max(200),
    status: IncidentLifecycleStatusSchema,
    impact: IncidentImpactSchema.optional(),
    impactOverride: z.boolean().optional(),
    affectedComponents: z.array(IncidentAffectedComponentSchema).min(1),
    body: z.string().min(1).meta({ description: 'Body of the first status update' }),
    scheduledStartAt: z.string().datetime().nullable().optional(),
    scheduledEndAt: z.string().datetime().nullable().optional(),
    autoStart: z.boolean().optional(),
    autoComplete: z.boolean().optional(),
    backfill: z
      .object({ startedAt: z.string().datetime(), resolvedAt: z.string().datetime() })
      .optional()
      .meta({ description: 'Creates the incident already resolved, historical; never notifies' }),
    notifySubscribers: z.boolean().optional().meta({ default: true }),
  })
  .meta({ description: 'Create status incident/maintenance request body' })

const PostIncidentUpdateSchema = z
  .object({
    status: IncidentLifecycleStatusSchema,
    body: z.string().min(1),
    skipRestore: z.boolean().optional().meta({
      description:
        'When the new status is terminal, skip restoring affected components to operational',
    }),
  })
  .meta({ description: 'Post an incident/maintenance lifecycle update' })

// Summary (public snapshot)

const StatusSummarySchema = z
  .object({
    status: ComponentStatusSchema.meta({ description: 'Worst-of status across all components' }),
    components: z.array(PublicStatusComponentSchema),
    activeIncidents: z.array(
      z.object({
        id: TypeIdSchema,
        kind: z.enum(['incident', 'maintenance']),
        title: z.string(),
        status: IncidentLifecycleStatusSchema,
        impact: IncidentImpactSchema,
        scheduledStartAt: NullableTimestampSchema,
        scheduledEndAt: NullableTimestampSchema,
        startedAt: TimestampSchema,
        resolvedAt: NullableTimestampSchema,
        affectedComponents: z.array(
          z.object({ id: TypeIdSchema, name: z.string(), componentStatus: ComponentStatusSchema })
        ),
        updates: z.array(IncidentUpdateSchema),
      })
    ),
  })
  .meta({ description: 'Public status page snapshot' })

// Register GET /status/summary
registerPath('/status/summary', {
  get: {
    tags: ['Status'],
    summary: 'Get the status page summary',
    description:
      'Top-level status, all components, and active incidents — the public page snapshot',
    responses: {
      200: {
        description: 'Status page summary',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusSummarySchema, 'Status summary'),
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

// Register GET /status/components
registerPath('/status/components', {
  get: {
    tags: ['Status'],
    summary: 'List status components',
    description: 'Returns all status components (grouped and ungrouped), flattened',
    responses: {
      200: {
        description: 'List of status components',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(
              StatusComponentSchema,
              'List of status components'
            ),
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

// Register POST /status/components
registerPath('/status/components', {
  post: {
    tags: ['Status'],
    summary: 'Create a status component',
    description: 'Create a new status component. Subject to the plan’s maxStatusComponents limit.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateStatusComponentSchema) } },
    },
    responses: {
      201: {
        description: 'Status component created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusComponentSchema, 'Created status component'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /status/components/{componentId}
registerPath('/status/components/{componentId}', {
  get: {
    tags: ['Status'],
    summary: 'Get a status component',
    parameters: [
      {
        name: 'componentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status component ID',
      },
    ],
    responses: {
      200: {
        description: 'Status component details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusComponentSchema, 'Status component details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Status component not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /status/components/{componentId}
registerPath('/status/components/{componentId}', {
  patch: {
    tags: ['Status'],
    summary: 'Update a status component',
    description:
      'Updates metadata and/or the live status. A `{ status }`-only body is the monitoring-tool automation hook (e.g. a Datadog/Pingdom webhook).',
    parameters: [
      {
        name: 'componentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status component ID',
      },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateStatusComponentSchema) } },
    },
    responses: {
      200: {
        description: 'Status component updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusComponentSchema, 'Updated status component'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Status component not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register GET /status/incidents
registerPath('/status/incidents', {
  get: {
    tags: ['Status'],
    summary: 'List status incidents',
    description: 'Returns incidents and scheduled maintenance windows (full admin detail)',
    parameters: [
      { name: 'kind', in: 'query', schema: { type: 'string', enum: ['incident', 'maintenance'] } },
      {
        name: 'state',
        in: 'query',
        schema: { type: 'string', enum: ['active', 'resolved', 'all'] },
      },
      { name: 'cursor', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
    ],
    responses: {
      200: {
        description: 'List of status incidents',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(StatusIncidentSchema, 'List of status incidents'),
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

// Register POST /status/incidents
registerPath('/status/incidents', {
  post: {
    tags: ['Status'],
    summary: 'Create a status incident or maintenance window',
    description: 'Publishes an incident/maintenance window and (by default) notifies subscribers',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateStatusIncidentSchema) } },
    },
    responses: {
      201: {
        description: 'Status incident created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusIncidentSchema, 'Created status incident'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /status/incidents/{incidentId}
registerPath('/status/incidents/{incidentId}', {
  get: {
    tags: ['Status'],
    summary: 'Get a status incident',
    parameters: [
      {
        name: 'incidentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status incident ID',
      },
    ],
    responses: {
      200: {
        description: 'Status incident details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusIncidentSchema, 'Status incident details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Status incident not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register POST /status/incidents/{incidentId}/updates
registerPath('/status/incidents/{incidentId}/updates', {
  post: {
    tags: ['Status'],
    summary: 'Post a status incident update',
    description:
      'Posts a new lifecycle update (status change). A terminal status restores affected components to operational unless skipRestore is set.',
    parameters: [
      {
        name: 'incidentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status incident ID',
      },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PostIncidentUpdateSchema) } },
    },
    responses: {
      201: {
        description: 'Status incident updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusIncidentSchema, 'Updated status incident'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Status incident not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
