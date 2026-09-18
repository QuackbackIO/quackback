/**
 * Unproven visitor contact (name + email) on an anonymous principal.
 *
 * Written from the pre-chat form, an agent inbox edit, or the assistant
 * capture tool. Capture never overwrites an address already on file. Explicit
 * agent corrections can replace anonymous contact details; neither operation
 * changes account identity or treats a synthetic placeholder as a real address.
 */
import { db, eq, and, isNull, conversations, principal, user } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { acceptableContactEmail } from '@/lib/server/domains/principals/contact-email'
import { isGeneratedAnonymousName } from '@/lib/shared/anonymous-names'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-contact' })

const MAX_DISPLAY_NAME = 80

export interface RecordVisitorContactResult {
  captured: boolean
  email: string | null
  name: string | null
  possibleMatchPrincipalId: PrincipalId | null
}

export function acceptableDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length < 1 || name.length > MAX_DISPLAY_NAME) return null
  return name
}

export async function findIdentifiedPrincipalByEmail(
  email: string,
  excludePrincipalId: PrincipalId,
  exec: Executor = db
): Promise<{ principalId: PrincipalId; displayName: string | null } | null> {
  const [row] = await exec
    .select({ id: principal.id, displayName: principal.displayName })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(and(eq(principal.type, 'user'), eq(user.email, email)))
    .limit(1)
  if (!row || row.id === excludePrincipalId) return null
  return { principalId: row.id, displayName: row.displayName ?? null }
}

export async function applyVisitorContact(
  exec: Executor,
  params: {
    conversationId: ConversationId
    visitorPrincipalId: PrincipalId
    existingVisitorEmail: string | null
    email?: string
    name?: string
    overwriteName?: boolean
    refuseTeamEmail?: boolean
    correct?: boolean
  }
): Promise<RecordVisitorContactResult> {
  let email = acceptableContactEmail(params.email)
  if (email && params.refuseTeamEmail) {
    const { listTeamSeatEmails } =
      await import('@/lib/server/domains/principals/membership-sync-queue')
    const teamEmails = await listTeamSeatEmails()
    if (teamEmails.includes(email)) email = null
  }

  const name = acceptableDisplayName(params.name)
  const [visitor] = await exec
    .select({
      type: principal.type,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      userId: principal.userId,
    })
    .from(principal)
    .where(eq(principal.id, params.visitorPrincipalId))
    .limit(1)
    .for('update')

  if (!visitor || visitor.type !== 'anonymous') {
    return {
      captured: false,
      email: visitor?.contactEmail ?? params.existingVisitorEmail,
      name: visitor?.displayName ?? null,
      possibleMatchPrincipalId: null,
    }
  }

  let wroteEmail = false
  if (email && (params.correct || (!params.existingVisitorEmail && !visitor.contactEmail))) {
    const [changed] = await exec
      .update(principal)
      .set({ contactEmail: email })
      .where(
        and(
          eq(principal.id, params.visitorPrincipalId),
          eq(principal.type, 'anonymous'),
          params.correct ? undefined : isNull(principal.contactEmail)
        )
      )
      .returning({ id: principal.id })
    if (changed) {
      await exec
        .update(conversations)
        .set({ visitorEmail: email })
        .where(
          and(
            eq(conversations.id, params.conversationId),
            params.correct ? undefined : isNull(conversations.visitorEmail)
          )
        )
      wroteEmail = true
    }
  }

  const storedEmail = wroteEmail ? email : (visitor?.contactEmail ?? params.existingVisitorEmail)
  const isAnonymous = visitor?.type === 'anonymous'
  const canSetName =
    !!name &&
    (params.overwriteName ||
      (isAnonymous &&
        isGeneratedAnonymousName(visitor?.displayName, [
          visitor?.userId,
          params.visitorPrincipalId,
        ])))

  let wroteName = false
  if (canSetName && name) {
    await exec
      .update(principal)
      .set({ displayName: name })
      .where(eq(principal.id, params.visitorPrincipalId))
    wroteName = true
  }

  let possibleMatchPrincipalId: PrincipalId | null = null
  if (storedEmail && isAnonymous) {
    const match = await findIdentifiedPrincipalByEmail(storedEmail, params.visitorPrincipalId, exec)
    possibleMatchPrincipalId = match?.principalId ?? null
  }

  return {
    captured: wroteEmail || wroteName,
    email: storedEmail ?? null,
    name: wroteName ? name : (visitor?.displayName ?? null),
    possibleMatchPrincipalId,
  }
}

export async function subscribeCapturedContact(principalId: PrincipalId): Promise<void> {
  const { ensureAutoSubscribed } =
    await import('@/lib/server/domains/changelog/changelog-subscription.service')
  await ensureAutoSubscribed(principalId).catch((err) =>
    log.warn({ err }, 'contact subscription failed')
  )
}

export async function recordVisitorContact(
  conversationId: ConversationId,
  input: { email?: string; name?: string },
  options?: { overwriteName?: boolean; refuseTeamEmail?: boolean; correct?: boolean }
): Promise<RecordVisitorContactResult> {
  if (options?.correct && input.email !== undefined && !acceptableContactEmail(input.email)) {
    const { ValidationError } = await import('@/lib/shared/errors')
    throw new ValidationError('INVALID_CONTACT_EMAIL', 'Enter a valid email address.')
  }
  const committed = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
      .for('update')
    if (!conversation) return null
    const result = await applyVisitorContact(tx, {
      conversationId,
      visitorPrincipalId: conversation.visitorPrincipalId,
      existingVisitorEmail: conversation.visitorEmail,
      ...input,
      ...options,
    })
    if (options?.correct && !result.captured) {
      const [identity] = await tx
        .select({ type: principal.type })
        .from(principal)
        .where(eq(principal.id, conversation.visitorPrincipalId))
        .limit(1)
      if (identity?.type !== 'anonymous') {
        const { ConflictError } = await import('@/lib/shared/errors')
        throw new ConflictError(
          'CONTACT_IDENTIFIED',
          'This contact has signed in. Refresh the conversation before editing contact details.'
        )
      }
    }
    return { result, visitorPrincipalId: conversation.visitorPrincipalId }
  })
  if (!committed)
    return { captured: false, email: null, name: null, possibleMatchPrincipalId: null }
  if (committed.result.captured) {
    await subscribeCapturedContact(committed.visitorPrincipalId)
    const { conversationToDTO } = await import('./conversation.query')
    const { publishConversationUpdate } =
      await import('@/lib/server/realtime/conversation-channels')
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.visitorPrincipalId, committed.visitorPrincipalId))
    for (const row of rows) publishConversationUpdate(row.id, await conversationToDTO(row, 'agent'))
  }
  return committed.result
}

export async function lookupIdentifiedContactMatch(
  email: string
): Promise<{ principalId: PrincipalId; displayName: string | null } | null> {
  const accepted = acceptableContactEmail(email)
  if (!accepted) return null
  return findIdentifiedPrincipalByEmail(accepted, '' as PrincipalId)
}
