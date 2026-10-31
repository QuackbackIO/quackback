/**
 * Settings API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, createItemResponseSchema, asSchema } from '../openapi'
import { errorResponses } from './errors'
import {
  SETTINGS_AREAS,
  SETTINGS_RISKS,
  lockedFieldSchema,
  settingsAnyAreaPatchSchema,
  settingsChangeEntrySchema,
  settingsReadSchemas,
} from '@/lib/shared/settings-registry'

const AreaIdSchema = z.enum(SETTINGS_AREAS).meta({ example: 'messenger' })
const RevisionSchema = z.string().meta({
  description: 'A hash of the area value. Send it as If-Match to change the area.',
  example: '9f2c4a1d0b7e83a65c1f0d2e4b8a7c63',
})

const GatesSchema = z
  .object({
    permission: z.string().meta({ example: 'settings.manage' }),
    approval: z.enum(['none', 'required']).meta({
      description: '`required` means a change is filed as an approval, not applied.',
    }),
    freshSignIn: z.boolean(),
  })
  .meta({ description: 'What a change to the area needs' })

const AreaSummarySchema = z
  .object({
    id: AreaIdSchema,
    title: z.string(),
    description: z.string(),
    risk: z.enum(SETTINGS_RISKS),
    revision: RevisionSchema,
    locked: z.array(lockedFieldSchema),
    gates: GatesSchema,
  })
  .meta({ description: 'A settings area' })

const AreaReadSchema = AreaSummarySchema.extend({
  value: z.record(z.string(), z.unknown()).meta({
    description:
      'The area value. Its shape depends on the area; see the request body of PATCH for the fields that can change.',
  }),
  secrets: z.record(z.string(), z.boolean()).meta({
    description: 'Whether each secret field is set. A secret itself is never returned.',
  }),
}).meta({ description: 'A settings area with its value' })

const ReceiptSchema = z
  .object({
    id: z.string().meta({ example: 'audit_01h455vb4pex5vsknk084sn02q' }),
    area: z.string(),
    appliedAt: z.string().meta({ format: 'date-time' }),
    revision: RevisionSchema,
    changes: z.array(settingsChangeEntrySchema),
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    undoable: z.boolean(),
  })
  .meta({ description: 'What a write changed, with the values before and after' })

const ChangeResultSchema = z
  .object({
    status: z.enum(['applied', 'dry_run', 'noop']),
    receipt: ReceiptSchema.optional().meta({ description: 'Present when `status` is `applied`.' }),
    area: AreaIdSchema.optional(),
    risk: z.enum(SETTINGS_RISKS).optional(),
    revision: RevisionSchema.optional(),
    requiresApproval: z.boolean().optional(),
    changes: z.array(settingsChangeEntrySchema).optional(),
  })
  .meta({
    description:
      'The outcome of a change. `applied` carries a receipt; `dry_run` carries the preview; `noop` means the patch already matched.',
  })

const ApprovalFiledSchema = z
  .object({
    proposed: z.literal(true),
    approvalId: z.string().meta({ example: 'assistant_action_01h455vb4pex5vsknk084sn02q' }),
    status: z.literal('pending'),
    url: z.string().meta({ description: 'The in-app page where a person decides it.' }),
    next: z.string(),
    pendingActionId: z.string().meta({
      description: 'The same id as approvalId, kept for earlier clients.',
      example: 'assistant_action_01h455vb4pex5vsknk084sn02q',
    }),
    proposal: z.unknown(),
    reviewHref: z.string().optional(),
  })
  .meta({
    description:
      'The approval a medium-risk or higher change was filed as. Nothing is written until a person decides it.',
  })

const UndoResultSchema = z
  .object({
    id: z.string(),
    area: AreaIdSchema.nullable(),
    undone: z.literal(true),
    undoneAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ description: 'The result of an undo' })

const PatchBodySchema = settingsAnyAreaPatchSchema.meta({
  description: `A merge patch. Send only the fields to change; arrays replace. The fields depend on the area. Areas: ${SETTINGS_AREAS.join(', ')}. Read values: ${Object.keys(settingsReadSchemas).join(', ')}.`,
})

const areaParam = {
  name: 'area',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, enum: [...SETTINGS_AREAS] },
  description: 'Settings area',
}

registerPath('/settings', {
  get: {
    tags: ['Settings'],
    summary: 'List settings areas',
    description:
      'Returns the settings areas the key may read, each with its risk, revision and gates. Requires the read:settings scope.',
    responses: {
      200: {
        description: 'Settings areas',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(AreaSummarySchema) }).meta({
              description: 'Settings areas',
            }),
          },
        },
      },
      ...errorResponses(403),
    },
  },
})

registerPath('/settings/{area}', {
  get: {
    tags: ['Settings'],
    summary: 'Get a settings area',
    description:
      'Returns the value, revision and locked fields of one area. The revision is also the ETag. Secrets only say whether they are set. Requires the read:settings scope.',
    parameters: [areaParam],
    responses: {
      200: {
        description: 'The area',
        headers: { ETag: { description: 'The revision, quoted', schema: { type: 'string' } } },
        content: {
          'application/json': { schema: createItemResponseSchema(AreaReadSchema, 'Settings area') },
        },
      },
      ...errorResponses(403, 404),
    },
  },
  patch: {
    tags: ['Settings'],
    summary: 'Change a settings area',
    description:
      'Applies a merge patch. If-Match must carry the revision you read: 428 when missing, 412 when stale, 423 when the patch changes a locked field. A low-risk area applies at once and returns 200 with a receipt. A medium-risk or higher area files an approval and returns 202. Add ?dry_run=true to preview without writing; If-Match is then optional. Requires the write:settings scope.',
    parameters: [
      areaParam,
      {
        name: 'If-Match',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'The revision from the last read. Required unless dry_run=true.',
      },
      {
        name: 'dry_run',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Preview the change without writing it',
      },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PatchBodySchema) } },
    },
    responses: {
      200: {
        description: 'Applied, previewed, or already matching',
        headers: { ETag: { description: 'The new revision, quoted', schema: { type: 'string' } } },
        content: {
          'application/json': { schema: createItemResponseSchema(ChangeResultSchema, 'Outcome') },
        },
      },
      202: {
        description: 'Filed as an approval',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ApprovalFiledSchema, 'Approval filed'),
          },
        },
      },
      ...errorResponses(400, 403, 404, 412, 423, 428),
    },
  },
})

registerPath('/settings/receipts/{receiptId}/undo', {
  post: {
    tags: ['Settings'],
    summary: 'Undo a settings change',
    description:
      'Restores what a receipt recorded while the values have not moved since (409 otherwise). A receipt is the id returned by an applied change, or the id of an approval a person decided. Requires the write:settings scope.',
    parameters: [
      {
        name: 'receiptId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Receipt id',
      },
    ],
    responses: {
      200: {
        description: 'Undone',
        content: {
          'application/json': { schema: createItemResponseSchema(UndoResultSchema, 'Undone') },
        },
      },
      ...errorResponses(403, 404, 409),
    },
  },
})

// ── Portal design ─────────────────────────────────────────────────────────────

const DesignStateSchema = z
  .object({
    design: z.record(z.string(), z.unknown()).meta({
      description: 'The portal design document: brand, shape, layout, pages, menu and words.',
    }),
    source: z.enum(['draft', 'published', 'converted']).meta({
      description:
        'What is being edited: the draft, else the published design, else the branding settings converted.',
    }),
    published: z
      .object({ revisionId: z.string(), number: z.number().int() })
      .nullable()
      .meta({ description: 'The version visitors see, or null before the first publish.' }),
    report: z.object({
      adjustments: z.array(z.record(z.string(), z.unknown())).meta({
        description: 'Colours the contrast solver changed so every pair stays readable.',
      }),
      errors: z.array(z.string()).meta({ description: 'Pairs it could not fix.' }),
    }),
    revision: RevisionSchema,
  })
  .meta({ id: 'PortalDesignState' })

const DesignVersionSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    source: z.enum(['appearance', 'ai', 'api', 'mcp', 'import', 'conversion', 'restore']),
    message: z.string().nullable(),
    principalId: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'PortalDesignVersion' })

registerPath('/settings/portal_design', {
  get: {
    tags: ['Settings'],
    summary: 'Get the portal design',
    description:
      'Returns the design being edited (the draft, else the published design, else the branding settings converted), its contrast report and its revision, which is also the ETag. Requires the read:settings scope and the settings.branding permission.',
    responses: {
      200: {
        description: 'The design',
        headers: { ETag: { description: 'The revision, quoted', schema: { type: 'string' } } },
        content: {
          'application/json': {
            schema: createItemResponseSchema(DesignStateSchema, 'Portal design'),
          },
        },
      },
      ...errorResponses(403),
    },
  },
  patch: {
    tags: ['Settings'],
    summary: 'Change the portal design draft',
    description:
      'Applies a JSON merge patch to the design being edited and saves the result as the draft. Nothing goes live until a person publishes the draft in Settings › Portal. If-Match must carry the revision you read: 428 when missing, 412 when stale. A design that fails the schema answers 400 with INVALID_DESIGN, and one whose ink cannot be read answers 400 with UNREADABLE_DESIGN. Requires the write:settings scope and the settings.branding permission.',
    parameters: [
      {
        name: 'If-Match',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'The revision from the last read.',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', description: 'A JSON merge patch (RFC 7386).' },
        },
      },
    },
    responses: {
      200: {
        description: 'Saved as the draft',
        headers: { ETag: { description: 'The new revision, quoted', schema: { type: 'string' } } },
        content: {
          'application/json': {
            schema: createItemResponseSchema(DesignStateSchema, 'Portal design'),
          },
        },
      },
      ...errorResponses(400, 403, 412, 428),
    },
  },
})

registerPath('/settings/portal_design/draft', {
  delete: {
    tags: ['Settings'],
    summary: 'Discard the portal design draft',
    description:
      'Discards the draft. The published design stays as it is. Requires the write:settings scope and the settings.branding permission.',
    responses: {
      204: { description: 'Discarded' },
      ...errorResponses(403),
    },
  },
})

registerPath('/settings/portal_design/versions', {
  get: {
    tags: ['Settings'],
    summary: 'List portal design versions',
    description:
      'Published versions of the portal design, newest first. A person restores one in Settings › Portal. Requires the read:settings scope and the settings.branding permission.',
    responses: {
      200: {
        description: 'The versions',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.array(DesignVersionSchema), 'Versions'),
          },
        },
      },
      ...errorResponses(403),
    },
  },
})
