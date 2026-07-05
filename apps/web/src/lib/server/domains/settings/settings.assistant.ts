/**
 * Assistant customization settings: per-tool execution controls and
 * per-surface system-prompt instructions.
 *
 * Storage: like office-hours and ticket settings, both families ride in the
 * generic `settings.metadata` JSON bag (no dedicated column, no migration).
 * Reads default to an empty map — an absent tool control falls back to
 * whatever the assistant runtime bakes in for that tool, and a surface with
 * no saved instructions falls back to the runtime's built-in prompt.
 *
 * `ToolControlMode` is defined here rather than imported from the assistant
 * domain so settings has no dependency on assistant.
 */
import { z } from 'zod'
import { logger } from '@/lib/server/logger'
import { ASSISTANT_SURFACES, type AssistantSurface } from '@/lib/shared/assistant/surfaces'
import { requireSettings, wrapDbError, writeMetadataKey, parseJsonOrNull } from './settings.helpers'

const log = logger.child({ component: 'settings-assistant' })

/** Keys inside the `settings.metadata` JSON bag. */
const TOOL_CONTROLS_KEY = 'assistantToolControls'
const SURFACES_KEY = 'assistantSurfaces'

// ---------------------------------------------------------------------------
// Tool controls
// ---------------------------------------------------------------------------

/** How the assistant may exercise a given tool. */
export const toolControlModeSchema = z.enum(['disabled', 'approval', 'autonomous'])
export type ToolControlMode = z.infer<typeof toolControlModeSchema>

/**
 * Per-tool overrides, keyed by tool name. Unknown tool names are accepted at
 * this layer — the assistant's tool registry is the source of truth for which
 * names currently exist, and a control may be saved for a connector tool that
 * ships after this one. Exported so the server-fn layer's validator reuses
 * the same schema rather than redefining it.
 */
export const assistantToolControlsSchema = z.record(z.string(), toolControlModeSchema)

export type AssistantToolControls = z.infer<typeof assistantToolControlsSchema>

function resolveToolControls(metadataJson: string | null): AssistantToolControls {
  const meta = parseJsonOrNull<Record<string, unknown>>(metadataJson) ?? {}
  const parsed = assistantToolControlsSchema.safeParse(meta[TOOL_CONTROLS_KEY])
  return parsed.success ? parsed.data : {}
}

export async function getAssistantToolControls(): Promise<AssistantToolControls> {
  try {
    const org = await requireSettings()
    return resolveToolControls(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get assistant tool controls failed')
    wrapDbError('fetch assistant tool controls', error)
  }
}

export async function updateAssistantToolControls(
  input: AssistantToolControls
): Promise<AssistantToolControls> {
  log.info('update assistant tool controls')
  try {
    const validated = assistantToolControlsSchema.parse(input)
    await writeMetadataKey(TOOL_CONTROLS_KEY, validated)
    return validated
  } catch (error) {
    log.error({ err: error }, 'update assistant tool controls failed')
    wrapDbError('update assistant tool controls', error)
  }
}

// ---------------------------------------------------------------------------
// Surface instructions
// ---------------------------------------------------------------------------

/** Max length for a surface's saved instructions. */
const SURFACE_INSTRUCTIONS_MAX = 2000

const surfaceConfigSchema = z.object({
  instructions: z.string().max(SURFACE_INSTRUCTIONS_MAX),
})

/**
 * Partial map of surface -> instructions; an absent surface uses the default
 * prompt. Exported so the server-fn layer's validator reuses this schema.
 */
export const assistantSurfacesSchema = z.partialRecord(z.enum(ASSISTANT_SURFACES), surfaceConfigSchema)

export type AssistantSurfaceConfig = z.infer<typeof surfaceConfigSchema>
export type AssistantSurfacesConfig = Partial<Record<AssistantSurface, AssistantSurfaceConfig>>

function resolveAssistantSurfaces(metadataJson: string | null): AssistantSurfacesConfig {
  const meta = parseJsonOrNull<Record<string, unknown>>(metadataJson) ?? {}
  const parsed = assistantSurfacesSchema.safeParse(meta[SURFACES_KEY])
  return parsed.success ? parsed.data : {}
}

export async function getAssistantSurfaces(): Promise<AssistantSurfacesConfig> {
  try {
    const org = await requireSettings()
    return resolveAssistantSurfaces(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get assistant surfaces failed')
    wrapDbError('fetch assistant surfaces', error)
  }
}

/**
 * Persist the full per-surface instructions map. A blank (or whitespace-only)
 * instructions value drops that surface's key so it falls back to the
 * built-in prompt instead of an explicit empty override.
 */
export async function updateAssistantSurfaces(
  input: AssistantSurfacesConfig
): Promise<AssistantSurfacesConfig> {
  log.info('update assistant surfaces')
  try {
    const validated = assistantSurfacesSchema.parse(input)
    const normalized: AssistantSurfacesConfig = {}
    for (const surface of ASSISTANT_SURFACES) {
      const config = validated[surface]
      const trimmed = config?.instructions.trim()
      if (trimmed) normalized[surface] = { instructions: trimmed }
    }
    await writeMetadataKey(SURFACES_KEY, normalized)
    return normalized
  } catch (error) {
    log.error({ err: error }, 'update assistant surfaces failed')
    wrapDbError('update assistant surfaces', error)
  }
}
