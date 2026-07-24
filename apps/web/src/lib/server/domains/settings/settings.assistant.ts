import type { AuditActor, AuditEventType } from '@/lib/server/audit/log'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { and, db, eq, principal, settings, sql } from '@/lib/server/db'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { logger } from '@/lib/server/logger'
import {
  assistantConfigSchema,
  assistantCopilotCapabilitiesSchema,
  assistantAgentKnowledgeSchema,
  assistantCopilotKnowledgeSchema,
  assistantIdentitySchema,
  assistantVoiceSchema,
  DEFAULT_ASSISTANT_CONFIG,
  normalizeAssistantConfig,
  type AssistantAgentKnowledge,
  type AssistantConfig,
  type AssistantCopilotCapabilities,
  type AssistantCopilotKnowledge,
  type AssistantIdentity,
  type AssistantVoice,
} from '@/lib/shared/assistant/config'
import { ConflictError, ForbiddenError, InternalError, NotFoundError } from '@/lib/shared/errors'
import { z } from 'zod'
import { invalidateSettingsCache, requireSettings } from './settings.helpers'
import { resolveFeatureFlags } from './settings.types'

const log = logger.child({ component: 'settings-assistant' })

export const assistantIdentityUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  identity: assistantIdentitySchema,
})

export const assistantVoiceUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  voice: assistantVoiceSchema,
})

export const assistantAgentKnowledgeUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  knowledge: assistantAgentKnowledgeSchema,
})

export const assistantCopilotKnowledgeUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  knowledge: assistantCopilotKnowledgeSchema,
})

export const assistantCopilotCapabilitiesUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  capabilities: assistantCopilotCapabilitiesSchema,
})

export interface AssistantConfigState {
  config: AssistantConfig
  revision: number
}

export type AssistantConfigFallbackReason = 'invalid_assistant_config'

export interface AssistantRuntimeConfigState extends AssistantConfigState {
  workspaceName: string
  actionsEnabled: boolean
  configFallbackReason?: AssistantConfigFallbackReason
}

export interface AssistantSettingsState extends AssistantConfigState {
  managedFieldPaths: string[]
}

export type AssistantConfigAuditActor = AuditActor & { headers?: Headers }

/** Strict settings-page read. Invalid persisted JSON is a load failure, never an invented UI default. */
export async function getAssistantConfig(): Promise<AssistantConfigState> {
  const row = await requireSettings()
  const parsed = assistantConfigSchema.safeParse(row.assistantConfig)
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, 'stored assistant config is invalid')
    throw new InternalError('ASSISTANT_CONFIG_INVALID', 'Stored AI agent settings are invalid')
  }
  return { config: parsed.data, revision: row.assistantConfigRevision }
}

export async function getAssistantSettings(): Promise<AssistantSettingsState> {
  const row = await requireSettings()
  const parsed = assistantConfigSchema.safeParse(row.assistantConfig)
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, 'stored assistant config is invalid')
    throw new InternalError('ASSISTANT_CONFIG_INVALID', 'Stored AI agent settings are invalid')
  }
  return {
    config: parsed.data,
    revision: row.assistantConfigRevision,
    managedFieldPaths: row.managedFieldPaths,
  }
}

/** Runtime read posture: invalid behavior JSON falls back without reintroducing a V1 reader. */
export async function getAssistantRuntimeConfig(): Promise<AssistantRuntimeConfigState> {
  const row = await requireSettings()
  const flags = resolveFeatureFlags(row.featureFlags)
  const parsed = assistantConfigSchema.safeParse(row.assistantConfig)
  const runtimeFields = {
    revision: row.assistantConfigRevision,
    workspaceName: row.name,
    actionsEnabled: flags.assistantTools,
  }
  if (parsed.success) return { config: parsed.data, ...runtimeFields }

  log.error({ issues: parsed.error.issues }, 'using default assistant config for invalid V2 JSON')
  return {
    config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    ...runtimeFields,
    configFallbackReason: 'invalid_assistant_config',
  }
}

function changedLeafPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return []

  const beforeObject =
    typeof before === 'object' && before !== null && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : null
  const afterObject =
    typeof after === 'object' && after !== null && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : null

  if (!beforeObject || !afterObject) return prefix ? [prefix] : []

  const paths: string[] = []
  const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    paths.push(...changedLeafPaths(beforeObject[key], afterObject[key], path))
  }
  return paths
}

function auditEventForPaths(paths: string[]): AuditEventType {
  const root = paths[0]?.split('.')[0]
  if (root === 'identity') return 'assistant.identity.changed'
  if (paths.every((path) => path.startsWith('agents.copilot.capabilities'))) {
    return 'assistant.capabilities.changed'
  }
  if (paths.every((path) => path.endsWith('.knowledge') || path.includes('.knowledge.'))) {
    return 'assistant.knowledge.changed'
  }
  if (paths.every((path) => path === 'agents.agent.voice.additionalInstructions')) {
    return 'assistant.instructions.changed'
  }
  return 'assistant.voice.changed'
}

const SAFE_TRANSITION_PATHS = new Set([
  'agents.agent.voice.tone',
  'agents.agent.voice.responseLength',
])

function valueAtPath(config: AssistantConfig, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        typeof value === 'object' && value !== null
          ? (value as Record<string, unknown>)[key]
          : undefined,
      config
    )
}

function safeTransitions(before: AssistantConfig, after: AssistantConfig, paths: string[]) {
  return paths.flatMap((path) => {
    if (!SAFE_TRANSITION_PATHS.has(path)) return []
    return [{ path, from: valueAtPath(before, path) ?? null, to: valueAtPath(after, path) ?? null }]
  })
}

/**
 * The only V2 assistant-configuration write boundary.
 *
 * It serializes writers on the settings row, rejects stale revisions, validates
 * the complete normalized config, and writes the privacy-minimal audit event in
 * the same transaction. Cache invalidation happens once, after commit.
 */
export async function updateAssistantConfig(
  expectedRevision: number,
  mutate: (current: AssistantConfig) => AssistantConfig,
  actor: AssistantConfigAuditActor
): Promise<AssistantConfigState> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: settings.id,
        assistantConfig: settings.assistantConfig,
        assistantConfigRevision: settings.assistantConfigRevision,
        managedFieldPaths: settings.managedFieldPaths,
      })
      .from(settings)
      .limit(1)
      .for('update')

    if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')

    const current = assistantConfigSchema.safeParse(row.assistantConfig)
    if (!current.success) {
      throw new InternalError('ASSISTANT_CONFIG_INVALID', 'Stored AI agent settings are invalid')
    }
    if (row.assistantConfigRevision !== expectedRevision) {
      throw new ConflictError(
        'ASSISTANT_CONFIG_REVISION_CONFLICT',
        'AI agent settings changed in another session. Reload the latest settings and try again.'
      )
    }

    const next = normalizeAssistantConfig(mutate(structuredClone(current.data)))
    const changedPaths = changedLeafPaths(current.data, next)
    for (const path of changedPaths) {
      if (isPathManaged(`assistant.${path}`, row.managedFieldPaths)) {
        throw new ForbiddenError(
          'MANAGED_SETTING',
          'This AI agent setting is managed by your deployment configuration.'
        )
      }
    }

    if (changedPaths.length === 0) {
      return { config: current.data, revision: row.assistantConfigRevision, changed: false }
    }

    const revision = row.assistantConfigRevision + 1
    await tx
      .update(settings)
      .set({ assistantConfig: next, assistantConfigRevision: revision })
      .where(eq(settings.id, row.id))

    if (changedPaths.some((path) => path.startsWith('identity.'))) {
      await tx
        .update(principal)
        .set({
          displayName: next.identity.name,
          avatarUrl: next.identity.avatarUrl,
        })
        .where(
          and(
            eq(principal.type, 'service'),
            sql`${principal.serviceMetadata}->>'kind' = 'integration'`,
            sql`${principal.serviceMetadata}->>'integrationType' = 'assistant'`
          )
        )
    }

    const { headers, ...auditActor } = actor
    await recordAuditEventInTransaction(tx, {
      event: auditEventForPaths(changedPaths),
      actor: auditActor,
      headers,
      target: { type: 'settings', id: row.id },
      metadata: {
        changedPaths,
        previousRevision: row.assistantConfigRevision,
        revision,
        transitions: safeTransitions(current.data, next, changedPaths),
      },
    })

    return { config: next, revision, changed: true }
  })

  if (result.changed) await invalidateSettingsCache()
  return { config: result.config, revision: result.revision }
}

export function updateAssistantIdentity(
  expectedRevision: number,
  identity: AssistantIdentity,
  actor: AssistantConfigAuditActor
): Promise<AssistantConfigState> {
  return updateAssistantConfig(expectedRevision, (current) => ({ ...current, identity }), actor)
}

export function updateAssistantVoice(
  expectedRevision: number,
  voice: AssistantVoice,
  actor: AssistantConfigAuditActor
): Promise<AssistantConfigState> {
  return updateAssistantConfig(
    expectedRevision,
    (current) => ({
      ...current,
      agents: { ...current.agents, agent: { ...current.agents.agent, voice } },
    }),
    actor
  )
}

/**
 * A knowledge-map write, discriminated by owning agent (C3): the `agent` tag
 * narrows `knowledge` to the correct per-agent shape, so a single writer serves
 * both the Agent's four-source map and the Copilot's seven-source map with no
 * casts. `normalizeAssistantConfig` re-validates against the per-agent schema at
 * the write boundary.
 */
export type AssistantKnowledgeUpdate =
  | { agent: 'agent'; knowledge: AssistantAgentKnowledge }
  | { agent: 'copilot'; knowledge: AssistantCopilotKnowledge }

export function updateAssistantAgentKnowledge(
  expectedRevision: number,
  update: AssistantKnowledgeUpdate,
  actor: AssistantConfigAuditActor
): Promise<AssistantConfigState> {
  return updateAssistantConfig(
    expectedRevision,
    (current) => {
      switch (update.agent) {
        case 'agent':
          return {
            ...current,
            agents: {
              ...current.agents,
              agent: { ...current.agents.agent, knowledge: update.knowledge },
            },
          }
        case 'copilot':
          return {
            ...current,
            agents: {
              ...current.agents,
              copilot: { ...current.agents.copilot, knowledge: update.knowledge },
            },
          }
        default: {
          const exhaustive: never = update
          throw new Error(`updateAssistantAgentKnowledge: unhandled agent "${exhaustive}"`)
        }
      }
    },
    actor
  )
}

export function updateAssistantCopilotCapabilities(
  expectedRevision: number,
  capabilities: AssistantCopilotCapabilities,
  actor: AssistantConfigAuditActor
): Promise<AssistantConfigState> {
  return updateAssistantConfig(
    expectedRevision,
    (current) => ({
      ...current,
      agents: { ...current.agents, copilot: { ...current.agents.copilot, capabilities } },
    }),
    actor
  )
}
