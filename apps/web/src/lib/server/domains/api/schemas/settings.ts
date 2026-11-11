/**
 * Settings API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, createItemResponseSchema, asSchema } from '../openapi'
import { errorResponses } from './errors'
import {
  SETTINGS_AREAS,
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
    area: AreaIdSchema,
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
      'Restores what a receipt recorded while the values have not moved since (409 otherwise). A receipt is the id returned by an applied change. Requires the write:settings scope.',
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
      description:
        "The portal design document: brand, shape, layout, pages, menu and words. Its version is 3, which names the hero's keys hero (layout.hero, layout.heroShape, brand.heroImage); version 2 named them band.",
    }),
    live: z.record(z.string(), z.unknown()).meta({
      description:
        'What visitors see now: the published design, else the branding settings converted.',
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
    newerFormat: z.boolean().meta({
      description:
        'True when a newer version of Quackback saved the design. It is shown without what this version does not know, and every change answers 409 with DESIGN_NEWER_FORMAT until Quackback is updated.',
    }),
  })
  .meta({ id: 'PortalDesignState' })

const DesignVersionSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    source: z.enum(['appearance', 'ai', 'api', 'mcp', 'import', 'conversion', 'restore']),
    message: z.string().nullable(),
    principalId: z.string().nullable(),
    /** The name of who published it; null for a version setup or a former teammate made. */
    publishedBy: z.string().nullable(),
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
      "Applies a JSON merge patch to the design being edited and saves the result as the draft. Nothing goes live until a person publishes the draft in Settings › Portal. If-Match must carry the revision you read: 428 when missing, 412 when stale. A design that fails the schema answers 400 with INVALID_DESIGN, and one whose ink cannot be read answers 400 with UNREADABLE_DESIGN. A patch written for version 2, with the hero keys named band (layout.band, layout.bandShape, brand.bandImage), is still accepted: its keys take their version 3 names. A design a newer version of Quackback saved answers 409 with DESIGN_NEWER_FORMAT. Arrays are replaced whole: a patch that names pages.home.blocks, overrides or nav.items answers 400 with REPLACE_REQUIRED unless it passes ?replace=true, and Home blocks and menu links without their ids answer 400 with ID_REQUIRED. To change one block, use POST /settings/portal_design/draft/ops. Home's grid is settled after the patch, so blocks never overlap. Requires the write:settings scope and the settings.branding permission.",
    parameters: [
      {
        name: 'replace',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['true'] },
        description: 'Allows the patch to replace pages.home.blocks, overrides or nav.items whole.',
      },
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
      ...errorResponses(400, 403, 409, 412, 428),
    },
  },
})

registerPath('/settings/portal_design/draft', {
  delete: {
    tags: ['Settings'],
    summary: 'Discard the portal design draft',
    description:
      'Discards the draft. The published design stays as it is. With If-Match, a draft that changed since that revision is kept and the discard answers 412. A design a newer version of Quackback saved answers 409 with DESIGN_NEWER_FORMAT. Requires the write:settings scope and the settings.branding permission.',
    parameters: [
      {
        name: 'If-Match',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'The revision from the last read.',
      },
    ],
    responses: {
      204: { description: 'Discarded' },
      ...errorResponses(403, 409, 412),
    },
  },
})

const DesignOpsResultSchema = z
  .object({
    applied: z.array(z.number().int()).meta({ description: 'The operations made, by index.' }),
    refused: z
      .array(z.object({ index: z.number().int(), reason: z.string() }))
      .meta({ description: 'The operations refused, by index, and why. They changed nothing.' }),
    revision: RevisionSchema,
  })
  .meta({ id: 'PortalDesignOpsResult' })

registerPath('/settings/portal_design/draft/ops', {
  post: {
    tags: ['Settings'],
    summary: 'Apply operations to the portal design draft',
    description:
      "Applies the builder's operations to the design being edited, in order, with the builder's checks, and saves the result as the draft. A refused operation changes nothing and the rest still apply. Blocks are named by id or by their place in the list. Operations: block.set {block, key, value, locale?}, block.setEach {block, settings, locale?}, block.add {type, after?, turnOnHome?}, block.duplicate {id}, block.remove {block}, block.step {id, by: -1|1}, block.place {id, place}, block.grid {id, change: {nudge}|{move:{x,y}}|{size:{w,h}}}, block.look {id, scope, prop, value?}, block.lookReset {id, scope, prop}, block.matchLook {id, to}, block.styleReset {id, element}, block.phoneHidden {id, hidden}, home.layout {layout}, section.set {type, key, value, locale?}, page.choice {page, key, value}, part.shown {key, shown}, words.set {field, locale, doc}, hero.set {key, value, locale?}, brand.colour {role: accent|background|ink|surface|raised|muted|border|support, value (null removes), mode?: light|dark}, brand.font {slot: heading|body, font}, logo.title {title}, style.set {element, state?, prop, value (null clears), scope?: everywhere|part:<id>|page:<page>|block:<id>, layer?: all|phone|dark}, menu.rename {item, name}, menu.shown {item, shown}, menu.move {item, place}, menu.addLink {label, url}, menu.removeLink {item}; a menu item is home, a page type or link:<id>. Every operation must leave a design that passes the schema and the contrast check, or it is refused. If-Match must carry the revision you read: 428 when missing, 412 when stale. Nothing goes live until a person publishes the draft. Requires the write:settings scope and the settings.branding permission.",
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
          schema: {
            type: 'object',
            required: ['ops'],
            properties: {
              ops: {
                type: 'array',
                minItems: 1,
                maxItems: 50,
                items: {
                  type: 'object',
                  required: ['op'],
                  properties: { op: { type: 'string' } },
                },
              },
            },
            example: { ops: [{ op: 'block.set', block: 'ideas001', key: 'count', value: 5 }] },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Applied; saved as the draft when any operation was made',
        headers: { ETag: { description: 'The new revision, quoted', schema: { type: 'string' } } },
        content: {
          'application/json': {
            schema: createItemResponseSchema(DesignOpsResultSchema, 'Operations'),
          },
        },
      },
      ...errorResponses(400, 403, 409, 412, 428),
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
