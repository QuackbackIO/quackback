/**
 * Custom-action library service (QUINN-TWO-AGENT-SPEC D6/Phase 5).
 *
 * Owns the definition CRUD, the at-rest encryption of secret header values, and
 * — most importantly — the runtime concerns that MUST stay server-side: turning
 * an enabled+assigned definition into a dynamic `AssistantToolSpec`, executing
 * the HTTP request through the shared SSRF-safe `safeFetch` with strict template
 * substitution, and filtering the response through the definition's allowlist
 * and character cap BEFORE any of it reaches the model (the D6 data-access
 * scoping). Nothing here is client-safe: `encrypt`/`decrypt` and `safeFetch`
 * are server-only, and the crypto stays in this domain module (never a
 * fn-module / hydration path).
 */
import { eq } from 'drizzle-orm'
import {
  db as defaultDb,
  assistantActions,
  type StoredAssistantActionHeader,
  type StoredAssistantActionVariable,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantCustomActionId, PrincipalId } from '@quackback/ids'
import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import {
  assistantActionInputSchema,
  extractTemplateVariables,
  slugifyActionName,
  type AssistantActionInput,
  type AssistantActionDTO,
  type AssistantActionHeaderDTO,
} from '@/lib/shared/assistant/custom-actions'
import type { AssistantAgentKind as AgentKind } from '@/lib/shared/assistant/config'
import type { AssistantToolSpec } from './assistant.toolspec'
import { withGateEnvelope } from './assistant.toolspec'
import {
  performActionRequest,
  customActionOutputSchema,
  type CustomActionOutput,
} from './custom-actions.execute'

// Re-export the execution engine (custom-actions.execute.ts) so callers and
// tests keep importing the whole custom-action surface from one module.
export {
  substituteTemplate,
  projectAllowlisted,
  capSerializedResponse,
  performActionRequest,
  customActionOutputSchema,
  ACTION_REQUEST_TIMEOUT_MS,
  ACTION_MAX_RESPONSE_BYTES,
  type CustomActionOutput,
  type PerformActionRequestInput,
  type PerformActionRequestResult,
} from './custom-actions.execute'

const log = logger.child({ component: 'assistant-custom-actions' })

/** HKDF domain-separation purpose for encrypted secret header values. */
const HEADER_ENCRYPTION_PURPOSE = 'assistant-custom-action-headers'

export type AssistantActionRow = typeof assistantActions.$inferSelect

function encryptHeaderValue(plaintext: string): string {
  return encrypt(plaintext, HEADER_ENCRYPTION_PURPOSE)
}

function decryptHeaderValue(ciphertext: string): string {
  return decrypt(ciphertext, HEADER_ENCRYPTION_PURPOSE)
}

/**
 * Reduce the submitted headers to their stored form: a secret header's value is
 * encrypted; a non-secret header's value is stored verbatim. When editing, a
 * secret header whose submitted value is empty KEEPS the previously stored
 * ciphertext (the UI masks secrets and only re-sends a value the user retyped).
 */
function toStoredHeaders(
  submitted: readonly { name: string; value: string; secret: boolean }[],
  previous: readonly StoredAssistantActionHeader[] = []
): StoredAssistantActionHeader[] {
  const previousByName = new Map(previous.filter((h) => h.secret).map((h) => [h.name, h.value]))
  return submitted.map((header) => {
    if (!header.secret) return { name: header.name, value: header.value, secret: false }
    if (header.value.length === 0) {
      // Kept a masked secret: reuse the stored ciphertext if one exists.
      return { name: header.name, value: previousByName.get(header.name) ?? '', secret: true }
    }
    return { name: header.name, value: encryptHeaderValue(header.value), secret: true }
  })
}

/** Header name -> plaintext value, decrypting secrets, for request execution. */
function decryptStoredHeaders(
  headers: readonly StoredAssistantActionHeader[]
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const header of headers) {
    if (!header.secret) {
      out[header.name] = header.value
      continue
    }
    if (header.value.length === 0) continue
    try {
      out[header.name] = decryptHeaderValue(header.value)
    } catch (err) {
      log.error({ err, header: header.name }, 'custom action secret header decryption failed')
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validationError(error: unknown): never {
  const issueMessage =
    typeof error === 'object' && error !== null && 'issues' in error
      ? (error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
  throw new ValidationError('VALIDATION_ERROR', issueMessage ?? 'Invalid custom action')
}

/**
 * Reject a name whose slug collides with another definition's (case-insensitive).
 * The DB's `lower(name)` unique index catches exact case-folded duplicates; this
 * catches the broader class the tool-name grammar cares about — two DISTINCT
 * names that `slugifyActionName` maps to the same `action_<slug>` (e.g.
 * "Lookup order", "lookup-order", "Lookup_Order"). Without it, delete + the old
 * suffix remap could silently point a pending proposal's persisted tool name at
 * a different surviving action (a confused deputy); with it, `action_<slug>` is
 * a stable 1:1 key. `excludeId` is the row being updated (skip self-collision).
 */
async function assertActionNameUnique(
  name: string,
  excludeId: AssistantCustomActionId | null,
  execDb: Executor
): Promise<void> {
  const slug = slugifyActionName(name)
  const rows = await execDb
    .select({ id: assistantActions.id, name: assistantActions.name })
    .from(assistantActions)
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue
    if (slugifyActionName(row.name) === slug) {
      throw new ValidationError(
        'ASSISTANT_ACTION_DUPLICATE_NAME',
        'Another action already uses a similar name. Choose a distinct name.'
      )
    }
  }
}

/** Every `{{var}}` in the url/body must be a declared variable (cross-field). */
function assertTemplateVariablesDeclared(input: AssistantActionInput): void {
  const declared = new Set(input.variables.map((v) => v.name))
  const referenced = new Set([
    ...extractTemplateVariables(input.request.url),
    ...(input.request.method === 'POST' && input.request.body
      ? extractTemplateVariables(input.request.body)
      : []),
  ])
  for (const name of referenced) {
    if (!declared.has(name)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Template references undeclared variable "${name}"`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// DTO projection
// ---------------------------------------------------------------------------

function toHeaderDTO(header: StoredAssistantActionHeader): AssistantActionHeaderDTO {
  if (!header.secret) {
    return {
      name: header.name,
      value: header.value,
      secret: false,
      hasValue: header.value.length > 0,
    }
  }
  // Never leak the ciphertext (or plaintext) of a secret to the client.
  return { name: header.name, value: '', secret: true, hasValue: header.value.length > 0 }
}

export function toActionDTO(row: AssistantActionRow): AssistantActionDTO {
  return {
    id: row.id,
    toolName: actionToolName(row),
    name: row.name,
    whenToUse: row.whenToUse,
    request: {
      method: row.method,
      url: row.url,
      headers: row.headers.map(toHeaderDTO),
      body: row.body,
    },
    variables: row.variables,
    responseAllowlist: row.responseAllowlist,
    responseCharLimit: row.responseCharLimit,
    assignments: row.assignments,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listCustomActions(
  execDb: Executor = defaultDb
): Promise<AssistantActionRow[]> {
  return execDb.select().from(assistantActions).orderBy(assistantActions.createdAt)
}

export async function getCustomAction(
  id: AssistantCustomActionId,
  execDb: Executor = defaultDb
): Promise<AssistantActionRow | null> {
  const [row] = await execDb
    .select()
    .from(assistantActions)
    .where(eq(assistantActions.id, id))
    .limit(1)
  return row ?? null
}

export async function createCustomAction(
  input: AssistantActionInput & { createdById?: PrincipalId | null },
  execDb: Executor = defaultDb
): Promise<AssistantActionRow> {
  const parsed = assistantActionInputSchema.safeParse(input)
  if (!parsed.success) validationError(parsed.error)
  assertTemplateVariablesDeclared(parsed.data)
  await assertActionNameUnique(parsed.data.name, null, execDb)
  const [row] = await execDb
    .insert(assistantActions)
    .values({
      name: parsed.data.name,
      whenToUse: parsed.data.whenToUse,
      method: parsed.data.request.method,
      url: parsed.data.request.url,
      headers: toStoredHeaders(parsed.data.request.headers),
      body: parsed.data.request.method === 'POST' ? (parsed.data.request.body ?? null) : null,
      variables: parsed.data.variables satisfies StoredAssistantActionVariable[],
      responseAllowlist: parsed.data.responseAllowlist,
      responseCharLimit: parsed.data.responseCharLimit,
      assignments: parsed.data.assignments,
      enabled: parsed.data.enabled,
      createdById: input.createdById ?? null,
    })
    .returning()
  return row
}

export async function updateCustomAction(
  id: AssistantCustomActionId,
  input: AssistantActionInput,
  execDb: Executor = defaultDb
): Promise<AssistantActionRow | null> {
  const parsed = assistantActionInputSchema.safeParse(input)
  if (!parsed.success) validationError(parsed.error)
  assertTemplateVariablesDeclared(parsed.data)
  const existing = await getCustomAction(id, execDb)
  if (!existing) return null
  await assertActionNameUnique(parsed.data.name, id, execDb)
  const [row] = await execDb
    .update(assistantActions)
    .set({
      name: parsed.data.name,
      whenToUse: parsed.data.whenToUse,
      method: parsed.data.request.method,
      url: parsed.data.request.url,
      headers: toStoredHeaders(parsed.data.request.headers, existing.headers),
      body: parsed.data.request.method === 'POST' ? (parsed.data.request.body ?? null) : null,
      variables: parsed.data.variables satisfies StoredAssistantActionVariable[],
      responseAllowlist: parsed.data.responseAllowlist,
      responseCharLimit: parsed.data.responseCharLimit,
      assignments: parsed.data.assignments,
      enabled: parsed.data.enabled,
      updatedAt: new Date(),
    })
    .where(eq(assistantActions.id, id))
    .returning()
  return row ?? null
}

export async function deleteCustomAction(
  id: AssistantCustomActionId,
  execDb: Executor = defaultDb
): Promise<void> {
  await execDb.delete(assistantActions).where(eq(assistantActions.id, id))
}

// ---------------------------------------------------------------------------
// Runtime registration
// ---------------------------------------------------------------------------

/**
 * The stable tool name the model sees for a definition. Definition names are
 * unique per workspace (the service rejects a name whose slug collides with
 * another's — see `assertActionNameUnique`, backed by a `lower(name)` unique
 * index), so `action_<slug>` is a 1:1 key with no de-collision suffix: a
 * persisted tool name resolves back to at most one row, and a deleted action's
 * tool name resolves to NOTHING (the approve path surfaces that as gone).
 */
export function actionToolName(row: Pick<AssistantActionRow, 'name'>): string {
  return `action_${slugifyActionName(row.name)}`
}

/**
 * Build the dynamic tool spec for one definition. Input schema is one `string`
 * param per declared variable, each carrying its model-facing `.describe()`
 * (§9 C5); the output is the allowlist-scoped projection under the gate
 * envelope. Risk is `write` for audit purposes (custom actions are write-risk-
 * unknown, D14), with no RBAC permissions (the admin who defined it is the
 * authority) and no `parents` restriction (an action never keys off the
 * conversation/ticket).
 */
export function buildActionToolSpec(row: AssistantActionRow, toolName: string): AssistantToolSpec {
  const shape: Record<string, z.ZodString> = {}
  for (const variable of row.variables) {
    shape[variable.name] = z.string().describe(variable.description)
  }
  const definition = toolDefinition({
    name: toolName,
    description: row.whenToUse,
    inputSchema: z.object(shape),
    outputSchema: withGateEnvelope(customActionOutputSchema),
  })
  const plaintextHeaders = decryptStoredHeaders(row.headers)

  return {
    name: toolName,
    label: row.name,
    description: row.whenToUse,
    promptGuidance: row.whenToUse,
    risk: 'write',
    permissions: [],
    parents: ['conversation', 'ticket'],
    definition,
    execute: async (args: unknown): Promise<CustomActionOutput> => {
      const values = normalizeArgs(args, row.variables)
      const result = await performActionRequest({
        method: row.method,
        url: row.url,
        headers: plaintextHeaders,
        body: row.body,
        variables: values,
        responseAllowlist: row.responseAllowlist,
        responseCharLimit: row.responseCharLimit,
      })
      return { ok: result.ok, httpStatus: result.httpStatus, data: result.data, note: result.note }
    },
    summarize: () => `Run action "${row.name}"`,
  }
}

/** Coerce model-authored args into a string map keyed by declared variables. */
function normalizeArgs(
  args: unknown,
  variables: readonly StoredAssistantActionVariable[]
): Record<string, string> {
  const source = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const variable of variables) {
    const raw = source[variable.name]
    out[variable.name] = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  }
  return out
}

/** Candidate rows for an agent: enabled AND assigned to that agent. */
async function loadAssignedActionRows(
  agent: AgentKind,
  execDb: Executor
): Promise<AssistantActionRow[]> {
  const rows = await execDb
    .select()
    .from(assistantActions)
    .where(eq(assistantActions.enabled, true))
  return rows.filter((row) => row.assignments[agent === 'agent' ? 'agent' : 'copilot'] === true)
}

/**
 * The custom-action tool specs to assemble for one agent this turn: every
 * enabled definition assigned to it, each as a dynamic write-risk spec. Caller
 * gates on the `assistantCustomActions` flag; a flag-off turn never calls this.
 */
export async function listActionSpecsForAgent(
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<AssistantToolSpec[]> {
  const rows = await loadAssignedActionRows(agent, execDb)
  return rows.map((row) => buildActionToolSpec(row, actionToolName(row)))
}

/**
 * Resolve a persisted `action_<slug>` toolName back to its current dynamic spec
 * for the approve path — the copilot propose flow stores the toolName on a
 * pending action, and `getToolSpecByName` (static registry) can't see it.
 * Matches the stable `action_<slug>` name (unique per definition) against the
 * enabled+assigned set for the origin agent. Returns null if no enabled+assigned
 * definition now maps to that name (the definition was disabled, unassigned,
 * renamed, or removed — the approve fn surfaces this as "no longer available",
 * same as a gone built-in).
 */
export async function getActionSpecByToolName(
  toolName: string,
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<AssistantToolSpec | null> {
  if (!toolName.startsWith('action_')) return null
  const rows = await loadAssignedActionRows(agent, execDb)
  const row = rows.find((candidate) => actionToolName(candidate) === toolName)
  return row ? buildActionToolSpec(row, toolName) : null
}
