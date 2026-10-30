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
    changes: z.array(settingsChangeEntrySchema).optional(),
  })
  .meta({
    description:
      'The outcome of a change. `applied` carries a receipt; `dry_run` carries the preview; `noop` means the patch already matched.',
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
      'Applies a merge patch. If-Match must carry the revision you read: 428 when missing, 412 when stale, 423 when the patch changes a locked field. The change applies at once and returns 200 with a receipt you can undo. Add ?dry_run=true to preview without writing; If-Match is then optional. Requires the write:settings scope.',
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
      ...errorResponses(400, 403, 404, 412, 423, 428),
    },
  },
})

registerPath('/settings/receipts/{receiptId}/undo', {
  post: {
    tags: ['Settings'],
    summary: 'Undo a settings change',
    description:
      'Restores what a receipt recorded while the values have not moved since (409 otherwise). A receipt is the id returned by an applied change, or the id of a settings card a person applied in the app. Requires the write:settings scope.',
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
