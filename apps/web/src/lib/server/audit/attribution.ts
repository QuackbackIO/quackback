/**
 * Audit attribution: who made a change, through what, and for whom.
 *
 * Each boundary that lets something change the workspace states once how the
 * change arrived, and every audit write underneath it reads that statement
 * from here, so no call site has to pass it along:
 *
 * - request middleware: `ui` for a signed-in server function, and an empty
 *   slot for every other request, which REST key auth fills (`api`)
 * - the MCP handler: `mcp`, with the OAuth client or the API key
 * - the assistant runtime, while it runs a tool: `assistant`
 * - a workflow run, while its actions execute: `workflow`
 * - the job runner, around every job: `system`
 *
 * A boundary opens a scope with {@link runWithAuditAttribution}; a nested
 * scope wins for its subtree only, so a workflow started by an API write is
 * attributed to the workflow. Key auth cannot wrap the handler that calls it,
 * so it fills the enclosing scope's slot with {@link setAuditAttribution}
 * instead, and the request boundary sees the result once the handler returns.
 *
 * Server-only: carried on AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ApiKeyId, PrincipalId } from '@quackback/ids'
import type { AuditChannel, AuditCredentialKind } from '@/lib/shared/audit-attribution'
import type { AuditActor } from './log'

export type { AuditChannel, AuditCredentialKind }

export interface AuditAttribution {
  channel: AuditChannel
  credentialKind?: AuditCredentialKind | null
  /** The API key id or OAuth client id. */
  credentialId?: string | null
  /** The key name, the OAuth client's registered name, the assistant or the workflow. */
  clientName?: string | null
  /** The person a credential or the assistant acts for. */
  onBehalfOfPrincipalId?: PrincipalId | null
}

/** The audit_log columns an attribution fills. */
export interface AuditAttributionColumns {
  channel: AuditChannel | null
  credentialKind: AuditCredentialKind | null
  credentialId: string | null
  clientName: string | null
  onBehalfOfPrincipalId: PrincipalId | null
}

interface AttributionSlot {
  attribution: AuditAttribution | null
  /** Who the boundary authenticated, for the events the boundary itself records. */
  actor: AuditActor | null
  /** The request is a bulk import, which the boundary summarises rather than records write by write. */
  importMode: boolean
}

/**
 * One store per process, reached through a global symbol: the dev server can
 * evaluate a module twice, and two stores would let a boundary set
 * attribution that the audit writer never sees.
 */
const STORAGE_KEY = Symbol.for('quackback.auditAttribution')
const storage: AsyncLocalStorage<AttributionSlot> = ((globalThis as Record<symbol, unknown>)[
  STORAGE_KEY
] ??= new AsyncLocalStorage<AttributionSlot>()) as AsyncLocalStorage<AttributionSlot>

/**
 * A client name is display text, and an OAuth client registers its own name
 * without signing in, so it is cleaned before it reaches a row: line breaks
 * become spaces, control characters and the bidirectional marks, overrides
 * and isolates are dropped (a reversed or multi-line name could otherwise
 * pass for another client), and the result is capped.
 */
const CLIENT_NAME_MAX_LEN = 200

const LINE_BREAKS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029])

function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

function cleanName(name: string | null | undefined): string | null {
  if (!name) return null
  let cleaned = ''
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    if (LINE_BREAKS.has(code)) cleaned += ' '
    else if (!isInvisible(code)) cleaned += char
  }
  cleaned = cleaned.replace(/ {2,}/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > CLIENT_NAME_MAX_LEN ? cleaned.slice(0, CLIENT_NAME_MAX_LEN) : cleaned
}

/** Run `fn` with `attribution` as the boundary for its whole async subtree. */
export function runWithAuditAttribution<T>(attribution: AuditAttribution | null, fn: () => T): T {
  return storage.run({ attribution, actor: null, importMode: false }, fn)
}

/**
 * Fill the enclosing boundary's slot. For a boundary that runs inside a
 * handler rather than around it (REST key auth). No-op outside any boundary.
 */
export function setAuditAttribution(
  attribution: AuditAttribution,
  actor?: AuditActor,
  options?: { importMode?: boolean }
): void {
  const slot = storage.getStore()
  if (!slot) return
  slot.attribution = attribution
  if (actor) slot.actor = actor
  if (options?.importMode) slot.importMode = true
}

/** Whether the enclosing boundary is a bulk import. */
export function isAuditImportMode(): boolean {
  return storage.getStore()?.importMode ?? false
}

/** The active attribution, or null when no boundary has stated one. */
export function getAuditAttribution(): AuditAttribution | null {
  return storage.getStore()?.attribution ?? null
}

/** The actor the enclosing boundary authenticated, or null. */
export function getAuditBoundaryActor(): AuditActor | null {
  return storage.getStore()?.actor ?? null
}

/** Map an attribution (the active one by default) onto the audit_log columns. */
export function auditAttributionColumns(
  attribution: AuditAttribution | null = getAuditAttribution()
): AuditAttributionColumns {
  return {
    channel: attribution?.channel ?? null,
    credentialKind: attribution?.credentialKind ?? null,
    credentialId: attribution?.credentialId ?? null,
    clientName: cleanName(attribution?.clientName),
    onBehalfOfPrincipalId: attribution?.onBehalfOfPrincipalId ?? null,
  }
}

export const UI_ATTRIBUTION: AuditAttribution = Object.freeze({ channel: 'ui' })
export const SYSTEM_ATTRIBUTION: AuditAttribution = Object.freeze({ channel: 'system' })
/** An MCP request before its credential is known. */
export const MCP_ATTRIBUTION: AuditAttribution = Object.freeze({ channel: 'mcp' })

/** An API key acts for the teammate who created it. */
export function apiKeyAttribution(
  apiKey: { id: ApiKeyId; name: string; createdById: PrincipalId | null },
  channel: Extract<AuditChannel, 'api' | 'mcp'>
): AuditAttribution {
  return {
    channel,
    credentialKind: 'api_key',
    credentialId: apiKey.id,
    clientName: cleanName(apiKey.name),
    onBehalfOfPrincipalId: apiKey.createdById,
  }
}

/** An OAuth client acts for the user who granted it. */
export function oauthClientAttribution(input: {
  clientId: string | null
  clientName: string | null
  principalId: PrincipalId
}): AuditAttribution {
  return {
    channel: 'mcp',
    credentialKind: 'oauth_client',
    credentialId: input.clientId,
    clientName: cleanName(input.clientName),
    onBehalfOfPrincipalId: input.principalId,
  }
}

/** A workflow run acts as the workflow, named as it was when it ran. */
export function workflowAttribution(workflow: { name: string }): AuditAttribution {
  return { channel: 'workflow', clientName: cleanName(workflow.name) }
}

/** The workspace's own AI agent acts as itself, with a credential of its own. */
export function agentAttribution(agent: { id: string; name: string }): AuditAttribution {
  return {
    channel: 'agent',
    credentialKind: 'agent_credential',
    credentialId: agent.id,
    clientName: cleanName(agent.name),
    onBehalfOfPrincipalId: null,
  }
}

/**
 * The assistant acts as itself. When it runs a tool for a teammate, as on Home
 * or for an approved proposal, it acts on that teammate's behalf; on its own
 * customer-support turns it acts for no one.
 */
export function assistantAttribution(input: {
  assistantName: string
  actor: { principalId: PrincipalId | null; principalType: string }
}): AuditAttribution {
  return {
    channel: 'assistant',
    clientName: cleanName(input.assistantName),
    onBehalfOfPrincipalId: input.actor.principalType === 'user' ? input.actor.principalId : null,
  }
}
