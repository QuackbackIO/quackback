import { randomUUID } from 'node:crypto'
import { createId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  sql,
  desc,
  isNull,
  workspaceAssistantThreads,
  conversationMessages,
  type Transaction,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import type {
  WorkspaceCopilotThread,
  WorkspaceCopilotThreadSummary,
  WorkspaceCopilotFinalPayload,
} from '@/lib/shared/assistant/workspace-contract'
import type { AssistantThreadMessage } from './assistant.runtime'
import { WORKSPACE_THREAD_PREFIX } from './workspace-safety'

const LEASE_MS = 5 * 60 * 1000
function missing(): never {
  throw new NotFoundError('WORKSPACE_THREAD_NOT_FOUND', 'Conversation not found')
}
function assertActor(actor: Actor) {
  if (
    !actor.principalId ||
    actor.principalType !== 'user' ||
    (actor.role !== 'admin' && actor.role !== 'member') ||
    !can(actor, PERMISSIONS.COPILOT_USE)
  )
    missing()
  return actor.principalId
}

export async function assertWorkspaceThreadOwned(
  key: string,
  actor: Actor,
  exec: typeof db | Transaction = db,
  lock = false
) {
  const ownerId = assertActor(actor)
  if (!key.startsWith(WORKSPACE_THREAD_PREFIX)) missing()
  const query = exec
    .select()
    .from(workspaceAssistantThreads)
    .where(
      and(
        eq(workspaceAssistantThreads.key, key),
        eq(workspaceAssistantThreads.ownerPrincipalId, ownerId)
      )
    )
    .limit(1)
  const [row] = lock ? await query.for('update') : await query
  if (!row) missing()
  return row
}
function summary(
  row: typeof workspaceAssistantThreads.$inferSelect
): WorkspaceCopilotThreadSummary {
  return { key: row.key, title: row.title, updatedAt: row.updatedAt.toISOString() }
}

export async function createWorkspaceThread(
  actor: Actor,
  title = '',
  exec: typeof db | Transaction = db
): Promise<WorkspaceCopilotThreadSummary> {
  const ownerPrincipalId = assertActor(actor)
  const [row] = await exec
    .insert(workspaceAssistantThreads)
    .values({
      key: `${WORKSPACE_THREAD_PREFIX}${randomUUID()}`,
      ownerPrincipalId,
      title: title.trim().slice(0, 120),
    })
    .returning()
  return summary(row)
}
export async function listWorkspaceThreads(actor: Actor): Promise<WorkspaceCopilotThreadSummary[]> {
  const ownerId = assertActor(actor)
  const rows = await db
    .select()
    .from(workspaceAssistantThreads)
    .where(eq(workspaceAssistantThreads.ownerPrincipalId, ownerId))
    .orderBy(desc(workspaceAssistantThreads.updatedAt), desc(workspaceAssistantThreads.key))
    .limit(30)
  return rows.map(summary)
}
export async function readWorkspaceThread(
  key: string,
  actor: Actor
): Promise<WorkspaceCopilotThread> {
  const thread = await assertWorkspaceThreadOwned(key, actor)
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(
      and(eq(conversationMessages.workspaceThreadKey, key), isNull(conversationMessages.deletedAt))
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(200)
  return {
    ...summary(thread),
    messages: rows.reverse().map((row) => ({
      id: row.id,
      sender: row.senderType === 'visitor' ? 'customer' : 'assistant',
      text: row.content,
      createdAt: row.createdAt.toISOString(),
      ...(row.metadata?.workspaceTurn?.payload
        ? {
            payload: row.metadata.workspaceTurn.payload as unknown as WorkspaceCopilotFinalPayload,
          }
        : {}),
    })),
  }
}
export type WorkspaceTurnAcquired =
  | {
      status: 'acquired'
      leaseToken: string
      messageId: string
      messages: AssistantThreadMessage[]
    }
  | { status: 'completed'; payload: WorkspaceCopilotFinalPayload }

export async function acquireWorkspaceTurn(
  actor: Actor,
  key: string,
  runId: string,
  question: string
): Promise<WorkspaceTurnAcquired> {
  if (!runId || runId.length > 200 || !question.trim() || question.length > 4000)
    throw new ConflictError('WORKSPACE_RUN_INVALID', 'A question is required')
  return db.transaction(async (tx) => {
    const thread = await assertWorkspaceThreadOwned(key, actor, tx, true)
    const sameRun = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.workspaceThreadKey, key),
          isNull(conversationMessages.deletedAt),
          sql`${conversationMessages.metadata}->'workspaceTurn'->>'runId' = ${runId}`
        )
      )
    const rows = (
      await tx
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.workspaceThreadKey, key),
            isNull(conversationMessages.deletedAt)
          )
        )
        .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
        .limit(21)
    ).reverse()
    const prior = sameRun.find(
      (row) => row.senderType === 'visitor' && row.metadata?.workspaceTurn?.runId === runId
    )
    if (prior && prior.content !== question.trim())
      throw new ConflictError('WORKSPACE_RUN_INPUT_CHANGED', 'This request has different content')
    const completed = sameRun.find(
      (row) => row.senderType === 'agent' && row.metadata?.workspaceTurn?.runId === runId
    )
    if (completed?.metadata?.workspaceTurn?.payload)
      return {
        status: 'completed',
        payload: completed.metadata.workspaceTurn
          .payload as unknown as WorkspaceCopilotFinalPayload,
      }
    if (thread.activeRunId && thread.leaseExpiresAt && thread.leaseExpiresAt.getTime() > Date.now())
      throw new ConflictError(
        'WORKSPACE_THREAD_BUSY',
        'Copilot is already answering in this conversation'
      )
    // Retrying an earlier unanswered request after a later turn would reorder history.
    if (prior && rows.at(-1)?.id !== prior.id)
      throw new ConflictError(
        'WORKSPACE_RUN_SUPERSEDED',
        'Start a new request to continue this conversation'
      )
    const leaseToken = randomUUID(),
      now = new Date()
    const messageId = prior?.id ?? createId('conversation_message')
    if (!prior)
      await tx.insert(conversationMessages).values({
        id: messageId,
        workspaceThreadKey: key,
        principalId: actor.principalId,
        senderType: 'visitor',
        content: question.trim(),
        isInternal: true,
        metadata: { workspaceTurn: { runId } },
        createdAt: now,
      })
    await tx
      .update(workspaceAssistantThreads)
      .set({
        activeRunId: runId,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
        ...(!thread.title ? { title: question.trim().slice(0, 120) } : {}),
      })
      .where(eq(workspaceAssistantThreads.key, key))
    const history = rows
      .filter((row) => row.id !== prior?.id)
      .slice(-20)
      .map((row) => ({
        sender: row.senderType === 'visitor' ? ('customer' as const) : ('assistant' as const),
        content: row.content,
      }))
    return {
      status: 'acquired',
      leaseToken,
      messageId,
      messages: [...history, { sender: 'customer', content: question.trim() }],
    }
  })
}

export async function completeWorkspaceTurn(
  actor: Actor,
  key: string,
  runId: string,
  leaseToken: string,
  result: Omit<WorkspaceCopilotFinalPayload, 'threadKey' | 'messageId'>
): Promise<WorkspaceCopilotFinalPayload> {
  return db.transaction(async (tx) => {
    const thread = await assertWorkspaceThreadOwned(key, actor, tx, true)
    if (
      thread.activeRunId !== runId ||
      thread.leaseToken !== leaseToken ||
      !thread.leaseExpiresAt ||
      thread.leaseExpiresAt.getTime() <= Date.now()
    )
      throw new ConflictError('WORKSPACE_TURN_LOST', 'This Copilot turn is no longer active')
    const id = createId('conversation_message'),
      payload: WorkspaceCopilotFinalPayload = { ...result, threadKey: key, messageId: id }
    await tx.insert(conversationMessages).values({
      id,
      workspaceThreadKey: key,
      principalId: null,
      senderType: 'agent',
      content: result.text,
      isInternal: true,
      createdAt: new Date(),
      metadata: {
        workspaceTurn: { runId, payload: payload as unknown as Record<string, unknown> },
      },
    })
    await tx
      .update(workspaceAssistantThreads)
      .set({
        activeRunId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        revision: thread.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workspaceAssistantThreads.key, key))
    return payload
  })
}
export async function failWorkspaceTurn(
  key: string,
  runId: string,
  leaseToken: string
): Promise<void> {
  await db
    .update(workspaceAssistantThreads)
    .set({ activeRunId: null, leaseToken: null, leaseExpiresAt: null })
    .where(
      and(
        eq(workspaceAssistantThreads.key, key),
        eq(workspaceAssistantThreads.activeRunId, runId),
        eq(workspaceAssistantThreads.leaseToken, leaseToken)
      )
    )
}
