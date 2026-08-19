/**
 * Custom-action definitions (QUINN-TWO-AGENT-SPEC D6): the shared, client-safe
 * contract for the custom-action library. One definition = name, when-to-use
 * routing text (the load-bearing model-facing description, §9 C5), an HTTP
 * request template, the variables the model fills, and the response-field
 * allowlist that scopes which parts of the response ever reach the model.
 *
 * Schemas are the source of truth; every type here is `z.infer`-derived (C1),
 * and each vocabulary union lives in exactly one exported const array (C2).
 * This module is import-safe on the client (no crypto, no db): the encryption
 * of secret header values and the runtime request execution live server-side
 * in `custom-actions.service.ts`.
 */
import { z } from 'zod'

export const ASSISTANT_ACTION_NAME_MAX_LENGTH = 80
export const ASSISTANT_ACTION_WHEN_TO_USE_MAX_LENGTH = 500
export const ASSISTANT_ACTION_URL_MAX_LENGTH = 2_000
export const ASSISTANT_ACTION_BODY_MAX_LENGTH = 8_000
export const ASSISTANT_ACTION_VARIABLE_DESCRIPTION_MAX_LENGTH = 300
export const ASSISTANT_ACTION_MAX_VARIABLES = 20
export const ASSISTANT_ACTION_MAX_HEADERS = 20
export const ASSISTANT_ACTION_MAX_ALLOWLIST = 50
export const ASSISTANT_ACTION_ALLOWLIST_PATH_MAX_LENGTH = 200

/** The response character cap that reaches the model. Defaults conservatively. */
export const ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT = 4_000
export const ASSISTANT_ACTION_MIN_RESPONSE_CHAR_LIMIT = 100
export const ASSISTANT_ACTION_MAX_RESPONSE_CHAR_LIMIT = 20_000

/** HTTP methods a custom action may issue. One array, one enum (C2). */
export const ASSISTANT_ACTION_METHODS = ['GET', 'POST'] as const
export const assistantActionMethodSchema = z.enum(ASSISTANT_ACTION_METHODS)
export type AssistantActionMethod = z.infer<typeof assistantActionMethodSchema>

/**
 * A model-filled variable. `name` is a template identifier referenced as
 * `{{name}}` in the url/body; `description` is the model-facing `.describe()`
 * text for the generated input-schema field. Names are constrained to safe
 * identifiers so substitution is unambiguous and never collides with template
 * syntax.
 */
export const ASSISTANT_ACTION_VARIABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
export const assistantActionVariableSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(
      ASSISTANT_ACTION_VARIABLE_NAME_PATTERN,
      'Variable names must start with a letter and use only letters, numbers, and underscores'
    ),
  description: z.string().trim().min(1).max(ASSISTANT_ACTION_VARIABLE_DESCRIPTION_MAX_LENGTH),
})
export type AssistantActionVariable = z.infer<typeof assistantActionVariableSchema>

/**
 * One request header. `secret: true` marks the value as sensitive: it is
 * encrypted at rest server-side and never returned in plaintext to the client
 * (the admin UI shows a masked placeholder and only re-sends a value the user
 * actually retyped). A non-secret header value is stored and returned verbatim.
 */
export const assistantActionHeaderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9-]+$/, 'Header names may contain only letters, numbers, and hyphens'),
  value: z.string().max(2_000),
  secret: z.boolean(),
})
export type AssistantActionHeader = z.infer<typeof assistantActionHeaderSchema>

/**
 * The HTTP request template. `url` and `body` may contain `{{variable}}`
 * placeholders filled at call time; a body is only meaningful for POST.
 */
export const assistantActionRequestSchema = z.object({
  method: assistantActionMethodSchema,
  url: z
    .string()
    .trim()
    .min(1)
    .max(ASSISTANT_ACTION_URL_MAX_LENGTH)
    .refine((value) => /^https?:\/\//i.test(value), {
      message: 'URL must start with http:// or https://',
    }),
  headers: z.array(assistantActionHeaderSchema).max(ASSISTANT_ACTION_MAX_HEADERS),
  body: z.string().max(ASSISTANT_ACTION_BODY_MAX_LENGTH).optional(),
})
export type AssistantActionRequest = z.infer<typeof assistantActionRequestSchema>

/**
 * A response-field allowlist entry: a dot path into the JSON response, with an
 * optional `[]` to fan out across an array (e.g. `data.items[].name`). ONLY the
 * fields these paths select ever reach the model (D6 data-access scoping).
 */
export const ASSISTANT_ACTION_ALLOWLIST_PATH_PATTERN =
  /^[a-zA-Z0-9_]+(\[\])?(\.[a-zA-Z0-9_]+(\[\])?)*$/

/**
 * Segment tokens that must never appear in an allowlist path. The projector
 * walks the response object by these path segments, so a segment naming a
 * prototype slot (`__proto__`, `constructor`, `prototype`) is a prototype-
 * pollution footgun even though the current projector reads own-values only.
 * Rejected at the schema so a definition can never persist one.
 */
export const ASSISTANT_ACTION_ALLOWLIST_FORBIDDEN_SEGMENTS = [
  '__proto__',
  'constructor',
  'prototype',
] as const

/** The distinct `.`-separated segments of a path, with any trailing `[]` stripped. */
function allowlistPathSegments(path: string): string[] {
  return path.split('.').map((segment) => segment.replace(/\[\]$/, ''))
}

export const assistantActionAllowlistPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(ASSISTANT_ACTION_ALLOWLIST_PATH_MAX_LENGTH)
  .regex(
    ASSISTANT_ACTION_ALLOWLIST_PATH_PATTERN,
    'Use dot paths like data.items[].name (letters, numbers, underscores, and [] for arrays)'
  )
  .refine(
    (path) =>
      !allowlistPathSegments(path).some((segment) =>
        (ASSISTANT_ACTION_ALLOWLIST_FORBIDDEN_SEGMENTS as readonly string[]).includes(segment)
      ),
    'Response paths may not reference __proto__, constructor, or prototype'
  )

/** Which agents a definition is assigned to. Boolean per agent, no run-mode dial (D6/D14). */
export const assistantActionAssignmentsSchema = z.object({
  agent: z.boolean(),
  copilot: z.boolean(),
})
export type AssistantActionAssignments = z.infer<typeof assistantActionAssignmentsSchema>

export const assistantActionResponseCharLimitSchema = z
  .number()
  .int()
  .min(ASSISTANT_ACTION_MIN_RESPONSE_CHAR_LIMIT)
  .max(ASSISTANT_ACTION_MAX_RESPONSE_CHAR_LIMIT)

/**
 * The full create/replace input for a custom action. Server code parses (not
 * casts, C4) untrusted input through this before persisting. `variables`
 * referenced in the template are validated for existence in the service layer
 * (a cross-field concern beyond a single schema's reach).
 */
export const assistantActionInputSchema = z.object({
  name: z.string().trim().min(1).max(ASSISTANT_ACTION_NAME_MAX_LENGTH),
  whenToUse: z.string().trim().min(1).max(ASSISTANT_ACTION_WHEN_TO_USE_MAX_LENGTH),
  request: assistantActionRequestSchema,
  variables: z.array(assistantActionVariableSchema).max(ASSISTANT_ACTION_MAX_VARIABLES),
  responseAllowlist: z
    .array(assistantActionAllowlistPathSchema)
    .max(ASSISTANT_ACTION_MAX_ALLOWLIST),
  responseCharLimit: assistantActionResponseCharLimitSchema.default(
    ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT
  ),
  assignments: assistantActionAssignmentsSchema,
  enabled: z.boolean(),
})
export type AssistantActionInput = z.infer<typeof assistantActionInputSchema>

/**
 * A definition projected for the admin UI. Secret header values are never sent:
 * a header marked `secret` reports `value: ''` with `hasValue` telling the
 * client whether a stored secret exists (so it can render "•••• saved" and only
 * overwrite when the user types a new value).
 */
export interface AssistantActionHeaderDTO {
  name: string
  /** Empty for a secret header; the stored plaintext for a non-secret one. */
  value: string
  secret: boolean
  /** True when a secret value is stored server-side (masked in the UI). */
  hasValue: boolean
}

export interface AssistantActionDTO {
  id: string
  /** Stable tool name the model sees and a pending action persists (`action_<slug>`). */
  toolName: string
  name: string
  whenToUse: string
  request: {
    method: AssistantActionMethod
    url: string
    headers: AssistantActionHeaderDTO[]
    body: string | null
  }
  variables: AssistantActionVariable[]
  responseAllowlist: string[]
  responseCharLimit: number
  assignments: AssistantActionAssignments
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Derive the stable tool-name slug from a definition name. The runtime prefixes
 * it with `action_` to form the tool name the model sees and a pending action
 * persists. Definition names are unique per workspace (case-insensitively, and
 * the service also rejects two names that slugify equal), so `action_<slug>` is
 * a stable 1:1 key with no de-collision suffix — a persisted tool name resolves
 * back to at most one definition. This pure part is shared so the UI can
 * preview the name the model will see.
 */
export function slugifyActionName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : 'action'
}

/** The `{{variable}}` placeholder names referenced by a url/body template. */
export function extractTemplateVariables(template: string): string[] {
  const found = new Set<string>()
  const pattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    found.add(match[1])
  }
  return [...found]
}
