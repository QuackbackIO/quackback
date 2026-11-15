/**
 * Which identity each kind of customer email is sent from (`email_senders`).
 *
 * `default` is the workspace's default sender; `support`, `feedback`,
 * `changelog` and `status` override it. A surface with no row sends from the
 * default, and no default row means the platform address. Support has one more
 * choice, `inbox`: reply from the address the customer wrote to. An inbox row
 * may name an address of its own, which support email that is not such a reply
 * (or whose inbox address cannot send) leaves from before the default; a
 * workspace that had both an inbox and a support address keeps both this way.
 * Only the workspace scope is read or written here; the scope columns are for
 * per-team or per-site overrides later.
 */
import { ValidationError } from '@/lib/shared/errors'
import type { ChannelAccountId } from '@quackback/ids'
import {
  db,
  and,
  asc,
  eq,
  isNull,
  or,
  sql,
  channelAccounts,
  emailSenders,
  type ChannelAccount,
  type EmailSenderSurface,
} from '@/lib/server/db'

export type { EmailSenderSurface }

/**
 * A surface's choice: an identity, or (support only) the inbox, with the
 * address behind it when it has one.
 */
export type EmailSenderChoice =
  { mode: 'address'; account: ChannelAccount } | { mode: 'inbox'; account: ChannelAccount | null }

/** Each surface's workspace-scope choice. A surface that is absent has none. */
export async function getEmailSenders(): Promise<Map<EmailSenderSurface, EmailSenderChoice>> {
  const rows = await db
    .select({ surface: emailSenders.surface, mode: emailSenders.mode, account: channelAccounts })
    .from(emailSenders)
    .leftJoin(
      channelAccounts,
      and(
        eq(channelAccounts.id, emailSenders.channelAccountId),
        eq(channelAccounts.role, 'sending'),
        isNull(channelAccounts.deletedAt)
      )
    )
    .where(and(eq(emailSenders.scopeType, 'workspace'), isNull(emailSenders.scopeId)))
  const choices = new Map<EmailSenderSurface, EmailSenderChoice>()
  for (const row of rows) {
    if (row.mode === 'inbox') {
      // Only support can reply from the inbox; a stray row elsewhere is ignored.
      if (row.surface === 'support') {
        choices.set('support', { mode: 'inbox', account: row.account ?? null })
      }
    } else if (row.account) {
      choices.set(row.surface, { mode: 'address', account: row.account })
    }
  }
  return choices
}

/** Thrown for a choice the settings page should never send. Readable on purpose. */
export class EmailSenderChoiceError extends ValidationError {
  constructor(message: string) {
    super('EMAIL_SENDER_CHOICE_REFUSED', message)
  }
}

/**
 * Set or clear a surface's choice. `null` clears it: the surface then sends from
 * the default, and a cleared default sends from the platform address.
 */
export async function setEmailSender(
  surface: EmailSenderSurface,
  choice: { mode: 'address'; channelAccountId: ChannelAccountId } | { mode: 'inbox' } | null
): Promise<void> {
  const workspaceScope = and(
    eq(emailSenders.surface, surface),
    eq(emailSenders.scopeType, 'workspace'),
    isNull(emailSenders.scopeId)
  )
  if (!choice) {
    await db.delete(emailSenders).where(workspaceScope)
    return
  }
  if (choice.mode === 'inbox' && surface !== 'support') {
    throw new EmailSenderChoiceError('Only support replies can come from the inbox address.')
  }
  const channelAccountId = choice.mode === 'address' ? choice.channelAccountId : null
  if (channelAccountId) {
    const [account] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.id, channelAccountId),
          eq(channelAccounts.role, 'sending'),
          isNull(channelAccounts.deletedAt)
        )
      )
      .limit(1)
    if (!account) throw new EmailSenderChoiceError('That sending address no longer exists.')
  }
  // Choosing the inbox keeps the address the row already holds: the one behind
  // the inbox, or the address support sent from until now. Either is what
  // support email that is not a reply to the inbox leaves from.
  await db
    .insert(emailSenders)
    .values({ surface, mode: choice.mode, channelAccountId })
    .onConflictDoUpdate({
      target: [emailSenders.surface, emailSenders.scopeType],
      targetWhere: sql`scope_id IS NULL`,
      set:
        choice.mode === 'inbox'
          ? { mode: choice.mode, updatedAt: new Date() }
          : { mode: choice.mode, channelAccountId, updatedAt: new Date() },
    })
}

/**
 * Support replies from the inbox once a workspace receives email, unless a
 * choice was already made. Called when an inbound route is created.
 */
export async function chooseInboxForSupportIfUnset(): Promise<void> {
  await db
    .insert(emailSenders)
    .values({ surface: 'support', mode: 'inbox' })
    .onConflictDoNothing({
      target: [emailSenders.surface, emailSenders.scopeType],
      where: sql`scope_id IS NULL`,
    })
}

/**
 * Clear every choice of an address, which is about to stop being one. An inbox
 * choice that had it behind it stays an inbox choice, with nothing behind it.
 */
export async function clearEmailSendersFor(id: ChannelAccountId): Promise<void> {
  await db
    .update(emailSenders)
    .set({ channelAccountId: null, updatedAt: new Date() })
    .where(and(eq(emailSenders.channelAccountId, id), eq(emailSenders.mode, 'inbox')))
  await db.delete(emailSenders).where(eq(emailSenders.channelAccountId, id))
}

/**
 * What the workspace's own rows say about an address, in one read: whether it
 * is still one of theirs (a sending address, or the address an inbound route
 * forwards), and the name it sends under.
 *
 * A thread's stored sender and an inbox address name an address, not a row, so
 * both questions are asked of the address. `senderName` is that of the oldest
 * live sending address with it, null when there is none or it has no name of
 * its own (the workspace name).
 */
export async function workspaceAddress(
  address: string
): Promise<{ known: boolean; senderName: string | null }> {
  const bare = address.trim().toLowerCase()
  const rows = await db
    .select({
      role: channelAccounts.role,
      address: channelAccounts.address,
      senderName: channelAccounts.senderName,
    })
    .from(channelAccounts)
    .where(
      and(
        isNull(channelAccounts.deletedAt),
        or(
          sql`lower(${channelAccounts.address}) = ${bare}`,
          sql`lower(${channelAccounts.config}->>'forwardingTarget') = ${bare}`
        )
      )
    )
    .orderBy(asc(channelAccounts.createdAt), asc(channelAccounts.id))
  const sending = rows.find((r) => r.role === 'sending' && r.address?.toLowerCase() === bare)
  return { known: rows.length > 0, senderName: sending?.senderName ?? null }
}
