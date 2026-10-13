/**
 * The agents that can answer customers.
 *
 * The built-in Quackback AI is one seeded row. A workspace registers at most
 * one external agent of its own: it receives signed turn requests, answers over
 * the REST API with its own `qba_` credential, and authors its replies as a
 * service principal so they read as AI everywhere a reply is shown.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  db,
  principal,
  supportAgents,
  conversations,
  and,
  eq,
  isNull,
  type SupportAgentFallback,
} from '@/lib/server/db'
import type { PrincipalId, SupportAgentId } from '@quackback/ids'
import { resetAiPrincipalIds } from '@/lib/server/messages/assistant-principal'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isValidWebhookUrl } from '@/lib/server/events/integrations/webhook/constants'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'
import { logger } from '@/lib/server/logger'
import {
  AGENT_CREDENTIAL_PREFIX,
  AGENT_DEADLINE_DEFAULT_SECONDS,
  AGENT_DEADLINE_MAX_SECONDS,
  AGENT_DEADLINE_MIN_SECONDS,
} from '@/lib/shared/support-agents'

const log = logger.child({ component: 'support-agents' })

export type SupportAgent = typeof supportAgents.$inferSelect

/** The agent as a client may see it: never the secret or the credential hash. */
export interface SupportAgentView {
  id: SupportAgentId
  kind: SupportAgent['kind']
  name: string
  status: SupportAgent['status']
  endpointUrl: string | null
  credentialPrefix: string | null
  replyDeadlineSeconds: number
  fallback: SupportAgentFallback
  lastDeliveredAt: string | null
  lastError: string | null
}

export function toSupportAgentView(agent: SupportAgent): SupportAgentView {
  return {
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    status: agent.status,
    endpointUrl: agent.endpointUrl,
    credentialPrefix: agent.credentialPrefix,
    replyDeadlineSeconds: agent.replyDeadlineSeconds,
    fallback: agent.fallback,
    lastDeliveredAt: agent.lastDeliveredAt?.toISOString() ?? null,
    lastError: agent.lastError,
  }
}

const SECRETS_PURPOSE = 'support-agent-secrets'

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

function newCredential(): string {
  return `${AGENT_CREDENTIAL_PREFIX}${randomBytes(24).toString('hex')}`
}

function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

export function decryptAgentSigningSecret(agent: Pick<SupportAgent, 'signingSecretEnc'>): string {
  if (!agent.signingSecretEnc) throw new Error('support agent has no signing secret')
  return decrypt(agent.signingSecretEnc, SECRETS_PURPOSE)
}

/** The seeded built-in AI row, or null before the migration's seed ran. */
export async function getBuiltinSupportAgent(): Promise<SupportAgent | null> {
  const [row] = await db
    .select()
    .from(supportAgents)
    .where(and(eq(supportAgents.kind, 'quackback_ai'), isNull(supportAgents.deletedAt)))
    .limit(1)
  return row ?? null
}

/** The workspace's live external agent, or null when it has none. */
export async function getExternalSupportAgent(): Promise<SupportAgent | null> {
  const [row] = await db
    .select()
    .from(supportAgents)
    .where(and(eq(supportAgents.kind, 'external'), isNull(supportAgents.deletedAt)))
    .limit(1)
  return row ?? null
}

export async function getSupportAgent(id: SupportAgentId): Promise<SupportAgent | null> {
  const [row] = await db
    .select()
    .from(supportAgents)
    .where(and(eq(supportAgents.id, id), isNull(supportAgents.deletedAt)))
    .limit(1)
  return row ?? null
}

export interface ExternalAgentInput {
  name: string
  endpointUrl: string | null
  replyDeadlineSeconds?: number
  fallback?: SupportAgentFallback
}

function validateInput(input: Partial<ExternalAgentInput>): void {
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name || name.length > 80) {
      throw new ValidationError('VALIDATION_ERROR', 'Agent name must be 1 to 80 characters')
    }
  }
  if (input.endpointUrl != null && !isValidWebhookUrl(input.endpointUrl.trim())) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Invalid endpoint URL: must be HTTPS and cannot target private networks'
    )
  }
  const seconds = input.replyDeadlineSeconds
  if (
    seconds !== undefined &&
    (!Number.isInteger(seconds) ||
      seconds < AGENT_DEADLINE_MIN_SECONDS ||
      seconds > AGENT_DEADLINE_MAX_SECONDS)
  ) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Reply deadline must be ${AGENT_DEADLINE_MIN_SECONDS} to ${AGENT_DEADLINE_MAX_SECONDS} seconds`
    )
  }
}

export interface RegisteredAgent {
  agent: SupportAgent
  /** Shown once: the agent sends this as `Authorization: Bearer`. */
  credential: string
  /** Shown once: verifies the signature on each turn request. */
  signingSecret: string
}

/** Register the workspace's external agent. Only one may be live. */
export async function registerExternalAgent(input: ExternalAgentInput): Promise<RegisteredAgent> {
  validateInput(input)
  if (await getExternalSupportAgent()) {
    throw new ConflictError('AGENT_EXISTS', 'This workspace already has an AI agent of its own')
  }
  const credential = newCredential()
  const signingSecret = newSigningSecret()
  const servicePrincipal = await createServicePrincipal({
    role: 'member',
    displayName: input.name.trim(),
    serviceMetadata: { kind: 'integration', integrationType: 'ai_agent' },
  })
  try {
    const [agent] = await db
      .insert(supportAgents)
      .values({
        kind: 'external',
        name: input.name.trim(),
        endpointUrl: input.endpointUrl?.trim() || null,
        signingSecretEnc: encrypt(signingSecret, SECRETS_PURPOSE),
        credentialHash: hashCredential(credential),
        credentialPrefix: credential.slice(0, 12),
        principalId: servicePrincipal.id,
        replyDeadlineSeconds: input.replyDeadlineSeconds ?? AGENT_DEADLINE_DEFAULT_SECONDS,
        fallback: input.fallback ?? 'team',
      })
      .returning()
    resetAiPrincipalIds()
    log.info({ agent_id: agent.id }, 'external support agent registered')
    return { agent, credential, signingSecret }
  } catch (err) {
    await db.delete(principal).where(eq(principal.id, servicePrincipal.id))
    throw err
  }
}

export async function updateExternalAgent(
  id: SupportAgentId,
  patch: Partial<ExternalAgentInput> & { status?: SupportAgent['status'] }
): Promise<SupportAgent> {
  validateInput(patch)
  const existing = await getSupportAgent(id)
  if (!existing || existing.kind !== 'external') {
    throw new NotFoundError('AGENT_NOT_FOUND', 'Agent not found')
  }
  const [agent] = await db
    .update(supportAgents)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.endpointUrl !== undefined
        ? { endpointUrl: patch.endpointUrl?.trim() || null }
        : {}),
      ...(patch.replyDeadlineSeconds !== undefined
        ? { replyDeadlineSeconds: patch.replyDeadlineSeconds }
        : {}),
      ...(patch.fallback !== undefined ? { fallback: patch.fallback } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(supportAgents.id, id))
    .returning()
  if (patch.name !== undefined && existing.principalId) {
    await db
      .update(principal)
      .set({ displayName: patch.name.trim() })
      .where(eq(principal.id, existing.principalId))
  }
  return agent
}

/** Issue a new credential and/or signing secret. The old ones stop working at once. */
export async function rotateExternalAgentSecrets(
  id: SupportAgentId,
  which: 'credential' | 'signing'
): Promise<{ agent: SupportAgent; secret: string }> {
  const existing = await getSupportAgent(id)
  if (!existing || existing.kind !== 'external') {
    throw new NotFoundError('AGENT_NOT_FOUND', 'Agent not found')
  }
  if (which === 'credential') {
    const credential = newCredential()
    const [agent] = await db
      .update(supportAgents)
      .set({
        credentialHash: hashCredential(credential),
        credentialPrefix: credential.slice(0, 12),
        updatedAt: new Date(),
      })
      .where(eq(supportAgents.id, id))
      .returning()
    return { agent, secret: credential }
  }
  const signingSecret = newSigningSecret()
  const [agent] = await db
    .update(supportAgents)
    .set({ signingSecretEnc: encrypt(signingSecret, SECRETS_PURPOSE), updatedAt: new Date() })
    .where(eq(supportAgents.id, id))
    .returning()
  return { agent, secret: signingSecret }
}

/**
 * Remove the external agent. Its conversations return to the team (the
 * controller column is cleared by the foreign key on delete only for a hard
 * delete, so it is cleared here explicitly for the soft delete).
 */
export async function deleteExternalAgent(id: SupportAgentId): Promise<void> {
  const existing = await getSupportAgent(id)
  if (!existing || existing.kind !== 'external') {
    throw new NotFoundError('AGENT_NOT_FOUND', 'Agent not found')
  }
  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ controllerAgentId: null })
      .where(eq(conversations.controllerAgentId, id))
    await tx
      .update(supportAgents)
      .set({
        deletedAt: new Date(),
        credentialHash: null,
        signingSecretEnc: null,
        status: 'paused',
        updatedAt: new Date(),
      })
      .where(eq(supportAgents.id, id))
  })
  resetAiPrincipalIds()
  log.info({ agent_id: id }, 'external support agent removed')
}

/** Resolve an agent from the credential it presented. Constant-time compare. */
export async function verifyAgentCredential(token: string): Promise<SupportAgent | null> {
  if (!token.startsWith(AGENT_CREDENTIAL_PREFIX)) return null
  const hash = hashCredential(token)
  const [agent] = await db
    .select()
    .from(supportAgents)
    .where(
      and(
        eq(supportAgents.credentialHash, hash),
        eq(supportAgents.kind, 'external'),
        isNull(supportAgents.deletedAt)
      )
    )
    .limit(1)
  const stored = agent?.credentialHash ?? '0'.repeat(64)
  const matches = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored, 'hex'))
  return agent && matches ? agent : null
}

/** The principal id that authors an agent's replies, when it has one. */
export function agentPrincipalId(agent: Pick<SupportAgent, 'principalId'>): PrincipalId | null {
  return agent.principalId
}

export async function recordDeliveryResult(
  id: SupportAgentId,
  result: { ok: true } | { ok: false; error: string }
): Promise<void> {
  try {
    await db
      .update(supportAgents)
      .set(
        result.ok
          ? { lastDeliveredAt: new Date(), lastError: null }
          : { lastError: result.error.slice(0, 500) }
      )
      .where(eq(supportAgents.id, id))
  } catch (err) {
    log.warn({ err, agent_id: id }, 'could not record agent delivery result')
  }
}
