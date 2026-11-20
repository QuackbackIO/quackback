/**
 * CLI for the support webhook and job specs: runs one operation through the
 * app's own services (so the real events, outbox rows and jobs follow) and
 * prints its JSON result. Used where no REST route exists (message edit and
 * delete, CSAT, attributes, mentions, SLA application, workflows).
 *
 * Usage: bun support-hook-ops.ts '<json { op, ...args }>'
 *
 *   note-mention   { conversationId, authorEmail, mentionEmail, text }
 *   agent-reply    { conversationId, authorEmail, text }   -> { messageId }
 *   edit           { messageId, authorEmail, text }
 *   delete         { messageId, actorEmail }
 *   csat           { conversationId, rating, comment? }    (as the visitor)
 *   attribute      { conversationId, key, value }          (text attribute; created if missing)
 *   archive-attribute { key }
 *   sla-conversation { conversationId, firstResponseSecs?, nextResponseSecs?,
 *                    timeToCloseSecs?, appliedMinutesAgo }  -> { policyId }
 *   sla-ticket     { ticketId, timeToResolveSecs, appliedMinutesAgo } -> { policyId }
 *   stream-token   { principalId, scope }                  -> { token }
 *   workflow-create { input: WorkflowInput, live?: boolean } -> { id, coldCache }
 *   workflow-delete { id }
 *
 * workflow-create keeps one never-matching live "sentinel" workflow so the
 * app's 30 s "is any workflow live?" cache never holds a stale `false` across
 * a workflow going live from this out-of-process script; `coldCache: true`
 * means nothing was live before, so the caller waits 31 s once.
 */
import { and, db, eq, isNull, principal, user, workflows } from '@/lib/server/db'
import type {
  ConversationId,
  ConversationMessageId,
  PrincipalId,
  SlaPolicyId,
  TicketId,
  WorkflowId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { Role } from '@/lib/shared/roles'

async function principalFor(
  email: string
): Promise<{ id: PrincipalId; role: string; name: string }> {
  const [row] = await db
    .select({ id: principal.id, role: principal.role, name: user.name })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(eq(user.email, email))
    .limit(1)
  if (!row) throw new Error(`No principal for ${email}`)
  return { id: row.id as PrincipalId, role: row.role, name: row.name }
}

async function teammateActor(
  email: string
): Promise<{ actor: Actor; id: PrincipalId; name: string }> {
  const p = await principalFor(email)
  const { permissionsForPrincipal } = await import('@/lib/server/policy/permissions')
  const permissions = await permissionsForPrincipal(p.id, p.role as Role)
  return {
    id: p.id,
    name: p.name,
    actor: {
      principalId: p.id,
      role: p.role as Role,
      principalType: 'user',
      segmentIds: new Set(),
      permissions,
    },
  }
}

const SENTINEL_NAME = 'E2E sentinel (never matches)'

async function ensureSentinel(): Promise<boolean> {
  const { createWorkflow, setWorkflowStatus } =
    await import('@/lib/server/domains/workflows/workflow.service')
  const live = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
    .limit(1)
  const [sentinel] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.name, SENTINEL_NAME), isNull(workflows.deletedAt)))
    .limit(1)
  if (!sentinel) {
    const row = await createWorkflow({
      name: SENTINEL_NAME,
      class: 'background',
      triggerType: 'page.visited',
      triggerSettings: { pagePath: '/__e2e-sentinel-never-visited' },
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })
    await setWorkflowStatus(row.id, 'live')
  }
  return live.length === 0
}

type Args = Record<string, unknown> & { op: string }

async function run(args: Args): Promise<unknown> {
  switch (args.op) {
    case 'note-mention': {
      const author = await teammateActor(String(args.authorEmail))
      const mentioned = await principalFor(String(args.mentionEmail))
      const text = String(args.text)
      const { addAgentNote } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: mentioned.id, label: mentioned.name } },
              { type: 'text', text: ` ${text}` },
            ],
          },
        ],
      }
      const result = await addAgentNote(
        args.conversationId as ConversationId,
        `@${mentioned.name} ${text}`,
        { principalId: author.id, displayName: author.name, email: String(args.authorEmail) },
        author.actor,
        doc as never
      )
      return { messageId: (result as { message?: { id: string } }).message?.id ?? null }
    }
    case 'agent-reply': {
      const author = await teammateActor(String(args.authorEmail))
      const { sendAgentMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const result = await sendAgentMessage(
        args.conversationId as ConversationId,
        String(args.text),
        { principalId: author.id, displayName: author.name, email: String(args.authorEmail) },
        author.actor
      )
      return { messageId: (result as { message: { id: string } }).message.id }
    }
    case 'edit': {
      const author = await teammateActor(String(args.authorEmail))
      const { editConversationMessage } =
        await import('@/lib/server/domains/conversation/conversation.edit')
      await editConversationMessage(
        args.messageId as ConversationMessageId,
        String(args.text),
        null,
        author.actor
      )
      return { ok: true }
    }
    case 'delete': {
      const who = await teammateActor(String(args.actorEmail))
      const { deleteConversationMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await deleteConversationMessage(args.messageId as ConversationMessageId, who.actor)
      return { ok: true }
    }
    case 'csat': {
      const { conversations } = await import('@/lib/server/db')
      const { toUuid } = await import('@quackback/ids')
      const [c] = await db
        .select({ visitor: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, toUuid(args.conversationId as ConversationId) as never))
        .limit(1)
      if (!c) throw new Error('conversation not found')
      const [v] = await db
        .select({ type: principal.type })
        .from(principal)
        .where(eq(principal.id, c.visitor as PrincipalId))
        .limit(1)
      const actor: Actor = {
        principalId: c.visitor as PrincipalId,
        role: 'user',
        principalType: (v?.type ?? 'anonymous') as Actor['principalType'],
        segmentIds: new Set(),
      }
      const { recordCsat } = await import('@/lib/server/domains/conversation/conversation.service')
      await recordCsat(
        args.conversationId as ConversationId,
        Number(args.rating),
        args.comment === undefined ? undefined : String(args.comment),
        actor
      )
      return { ok: true }
    }
    case 'attribute': {
      const svc =
        await import('@/lib/server/domains/conversation-attributes/conversation-attribute.service')
      const key = String(args.key)
      const existing = await svc.listConversationAttributes()
      if (!existing.some((a: { key: string }) => a.key === key)) {
        await svc.createConversationAttribute({ key, label: key, fieldType: 'text' } as never)
      }
      const { setConversationAttribute } =
        await import('@/lib/server/domains/conversation-attributes/set-attribute.service')
      await setConversationAttribute(
        { conversationId: args.conversationId as ConversationId },
        key,
        String(args.value),
        'teammate'
      )
      return { ok: true }
    }
    case 'archive-attribute': {
      const svc =
        await import('@/lib/server/domains/conversation-attributes/conversation-attribute.service')
      const all = await svc.listConversationAttributes()
      const found = all.find((a) => a.key === String(args.key))
      if (found) await svc.archiveConversationAttribute(found.id)
      return { ok: true }
    }
    case 'sla-conversation': {
      const { createSlaPolicy } = await import('@/lib/server/domains/sla/sla-policy.service')
      const { applySlaToConversation } = await import('@/lib/server/domains/sla/sla.service')
      const policy = await createSlaPolicy({
        name: `E2E policy ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`,
        firstResponseTargetSecs: (args.firstResponseSecs as number | undefined) ?? null,
        nextResponseTargetSecs: (args.nextResponseSecs as number | undefined) ?? null,
        timeToCloseTargetSecs: (args.timeToCloseSecs as number | undefined) ?? null,
      })
      const at = new Date(Date.now() - Number(args.appliedMinutesAgo ?? 0) * 60_000)
      const applied = await applySlaToConversation(
        args.conversationId as ConversationId,
        policy.id as SlaPolicyId,
        at
      )
      return { policyId: policy.id, applied }
    }
    case 'sla-ticket': {
      const { createSlaPolicy } = await import('@/lib/server/domains/sla/sla-policy.service')
      const { applySlaToTicket } = await import('@/lib/server/domains/sla/ticket-sla.service')
      const policy = await createSlaPolicy({
        name: `E2E ticket policy ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`,
        timeToResolveTargetSecs: Number(args.timeToResolveSecs),
      })
      const at = new Date(Date.now() - Number(args.appliedMinutesAgo ?? 0) * 60_000)
      const applied = await applySlaToTicket(
        args.ticketId as TicketId,
        policy.id as SlaPolicyId,
        at
      )
      return { policyId: policy.id, applied }
    }
    case 'stream-token': {
      const { mintStreamToken } = await import('@/lib/server/realtime/stream-token')
      return {
        token: mintStreamToken(
          args.principalId as PrincipalId,
          (args.scope as 'dashboard' | 'widget' | 'portal') ?? 'widget',
          5 * 60_000
        ),
      }
    }
    case 'workflow-create': {
      const { createWorkflow, setWorkflowStatus } =
        await import('@/lib/server/domains/workflows/workflow.service')
      const { workflowGraphSchema } =
        await import('@/lib/server/domains/workflows/workflow.schemas')
      const input = args.input as Parameters<typeof createWorkflow>[0]
      if (input.graph) workflowGraphSchema.parse(input.graph)
      const coldCache = await ensureSentinel()
      const row = await createWorkflow(input)
      if (args.live) await setWorkflowStatus(row.id, 'live')
      return { id: row.id, coldCache }
    }
    case 'workflow-delete': {
      const { softDeleteWorkflow } = await import('@/lib/server/domains/workflows/workflow.service')
      await softDeleteWorkflow(args.id as WorkflowId)
      return { ok: true }
    }
    default:
      throw new Error(`Unknown op ${args.op}`)
  }
}

try {
  const out = await run(JSON.parse(process.argv[2] ?? '{}') as Args)
  // Several services emit their events fire-and-forget (void promise): let
  // those outbox writes land before the process exits.
  await new Promise((r) => setTimeout(r, 1_500))
  // Marked, since the app's logger may write to stdout too.
  process.stdout.write(`\n__RESULT__${JSON.stringify(out ?? {})}\n`)
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
}
