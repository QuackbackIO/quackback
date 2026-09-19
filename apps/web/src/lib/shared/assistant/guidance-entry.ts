/**
 * Canonical guidance: the one authored shape behind the Guidance list.
 *
 * Three legacy sources fed the prompt separately: writing guidelines in the
 * versioned assistant config, situational rules in `assistant_guidance_rules`
 * (one rule, one profile), and packaged procedures in `agent_skills` (a
 * per-profile assignment map). One entry now holds the authored text once, and
 * a binding per profile says who applies it. A shared entry is two bindings,
 * never a third "both" role.
 *
 * Client-safe: the Guidance editor imports these schemas directly. The
 * vocabularies below are mirrored by the table CHECKs in
 * `packages/db/src/schema/assistant-guidance-entries.ts`, which cannot import
 * from the application.
 */
import { z } from 'zod'
import { assistantAgentSchema, type AssistantAgentKind } from './config'
import {
  normalizeGuidanceText,
  ASSISTANT_GUIDANCE_APPLIES_WHEN_MAX_LENGTH,
  ASSISTANT_GUIDANCE_CHAR_BUDGET,
  ASSISTANT_GUIDANCE_MAX_ENABLED_CANDIDATES,
  ASSISTANT_GUIDANCE_MAX_SELECTED_CONDITIONAL,
} from './guidance'
import {
  SKILL_CATALOGUE_CHAR_BUDGET,
  SKILL_LOADS_PER_TURN,
  SKILL_WHEN_TO_USE_MAX_LENGTH,
} from './skills'

/** How an entry applies. A procedure is loaded on demand and never sits in the prompt. */
export const GUIDANCE_ENTRY_KINDS = ['always', 'situational', 'procedure'] as const
export const guidanceEntryKindSchema = z.enum(GUIDANCE_ENTRY_KINDS)
export type GuidanceEntryKind = z.infer<typeof guidanceEntryKindSchema>

/**
 * Who owns the text.
 *
 * `canonical` entries live only in the entries table. `config` entries are a
 * projection of the versioned assistant config, which keeps ownership of both
 * the text and the prompt block that renders it: their edits go through the
 * config write funnel with its revision and managed-field checks, and the
 * runtime never reads them from here, so projecting them cannot inject the
 * same instruction twice.
 */
export const GUIDANCE_ENTRY_OWNERS = ['canonical', 'config'] as const
export const guidanceEntryOwnerSchema = z.enum(GUIDANCE_ENTRY_OWNERS)
export type GuidanceEntryOwner = z.infer<typeof guidanceEntryOwnerSchema>

/** Which legacy record an entry was converted from, or null when authored here. */
export const GUIDANCE_LEGACY_SOURCES = ['voice', 'managed', 'rule', 'skill'] as const
export const guidanceLegacySourceSchema = z.enum(GUIDANCE_LEGACY_SOURCES)
export type GuidanceLegacySource = z.infer<typeof guidanceLegacySourceSchema>

export const GUIDANCE_ENTRY_TITLE_MAX_LENGTH = 80
/** The largest legacy body (a procedure) so a conversion never has to truncate. */
export const GUIDANCE_ENTRY_BODY_MAX_LENGTH = 8_000
export const GUIDANCE_ENTRY_CONDITION_MAX_LENGTH = ASSISTANT_GUIDANCE_APPLIES_WHEN_MAX_LENGTH

/**
 * Every bound the runtime applies to guidance, in one place.
 *
 * Authoring is bounded by body length alone. Selection is bounded separately,
 * and an entry dropped for the selection budget is reported rather than
 * silently trimmed: `selectWithinGuidanceBudget` returns what it omitted and
 * the turn records those ids.
 */
export const GUIDANCE_RUNTIME_BUDGETS = {
  /** Enabled always/situational entries considered for one profile's turn. */
  maxCandidates: ASSISTANT_GUIDANCE_MAX_ENABLED_CANDIDATES,
  /** Conditional entries the selector may choose from those candidates. */
  maxSelectedConditional: ASSISTANT_GUIDANCE_MAX_SELECTED_CONDITIONAL,
  /** Characters of instruction text the prompt's guidance block may carry. */
  instructionCharBudget: ASSISTANT_GUIDANCE_CHAR_BUDGET,
  /** Characters the always-present procedure catalogue may carry. */
  procedureCatalogueCharBudget: SKILL_CATALOGUE_CHAR_BUDGET,
  /** Procedure bodies one turn may load on demand. */
  procedureLoadsPerTurn: SKILL_LOADS_PER_TURN,
  /** The longest authored body, loaded whole or not at all. */
  bodyMaxLength: GUIDANCE_ENTRY_BODY_MAX_LENGTH,
} as const

const normalizedText = (label: string, maxLength: number) =>
  z
    .string()
    .transform(normalizeGuidanceText)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(maxLength, `${label} must be ${maxLength} characters or fewer`)
    )

export const guidanceEntryTitleSchema = normalizedText('Name', GUIDANCE_ENTRY_TITLE_MAX_LENGTH)
export const guidanceEntryBodySchema = normalizedText('Instruction', GUIDANCE_ENTRY_BODY_MAX_LENGTH)

/** One existing profile per binding, with no duplicates and at least one use. */
export const guidanceEntryUsesSchema = z
  .array(assistantAgentSchema)
  .min(1, 'Choose at least one use')
  .refine((uses) => new Set(uses).size === uses.length, 'Each use may be selected once')

const rawConditionSchema = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : normalizeGuidanceText(value) || null))

/**
 * Authoring input for one entry and its bindings, written together.
 *
 * `kind` decides whether a condition is required and how long it may be: a
 * procedure's condition is its catalogue line, which is always in the prompt,
 * so it keeps the shorter procedure bound.
 */
export const guidanceEntryInputSchema = z
  .object({
    kind: guidanceEntryKindSchema,
    title: guidanceEntryTitleSchema,
    body: guidanceEntryBodySchema,
    appliesWhen: rawConditionSchema.default(null),
    enabled: z.boolean().default(true),
    priority: z.number().int().default(0),
    uses: guidanceEntryUsesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'always') {
      if (value.appliesWhen !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['appliesWhen'],
          message: 'Guidance for every conversation has no situation',
        })
      }
      return
    }
    if (value.appliesWhen === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['appliesWhen'],
        message:
          value.kind === 'procedure'
            ? 'Describe when to use this procedure'
            : 'Describe the situation this applies to',
      })
      return
    }
    const limit =
      value.kind === 'procedure'
        ? SKILL_WHEN_TO_USE_MAX_LENGTH
        : GUIDANCE_ENTRY_CONDITION_MAX_LENGTH
    if (value.appliesWhen.length > limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['appliesWhen'],
        message: `Situation must be ${limit} characters or fewer`,
      })
    }
  })

export type GuidanceEntryInput = z.input<typeof guidanceEntryInputSchema>
export type NormalizedGuidanceEntryInput = z.output<typeof guidanceEntryInputSchema>

/** What the editor sends: the entry, its bindings, and the version it was read at. */
export const guidanceEntrySaveSchema = z.object({
  id: z.string().min(1).optional(),
  /** Required for an update. A save carrying an older version is refused. */
  expectedVersion: z.number().int().optional(),
  entry: guidanceEntryInputSchema,
})
export type GuidanceEntrySaveInput = z.input<typeof guidanceEntrySaveSchema>

/** Client-facing projection of one entry with its bindings resolved. */
export interface GuidanceEntryDTO {
  id: string
  kind: GuidanceEntryKind
  owner: GuidanceEntryOwner
  title: string
  body: string
  appliesWhen: string | null
  enabled: boolean
  priority: number
  version: number
  /** Profiles with an enabled binding, in the canonical profile order. */
  uses: AssistantAgentKind[]
  legacySource: GuidanceLegacySource | null
  legacyId: string | null
  /** Config-owned and pinned by the deployment configuration: read-only here. */
  managed: boolean
  updatedAt: string
}

/** The profile order every list and badge row uses. */
export const GUIDANCE_PROFILES = ['agent', 'copilot', 'workspace'] as const

export const GUIDANCE_USE_LABELS: Record<AssistantAgentKind, string> = {
  agent: 'Customer conversations',
  copilot: 'Support teammates',
  workspace: 'Workspace and Slack',
}
