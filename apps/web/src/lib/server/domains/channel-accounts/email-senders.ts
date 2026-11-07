/**
 * Which identity each kind of customer email is sent from (`email_senders`).
 *
 * `default` is the workspace's default sender; `support`, `feedback`,
 * `changelog` and `status` override it. A surface with no row sends from the
 * default, and no default row means the platform address. Support has one more
 * choice, `inbox`: reply from the address the customer wrote to, else the
 * default. Only the workspace scope is read or written here; the scope columns
 * are for per-team or per-site overrides later.
 */
import type { ChannelAccountId } from '@quackback/ids'
import {
  db,
  and,
  asc,
  eq,
  isNull,
  sql,
  channelAccounts,
  emailSenders,
  type ChannelAccount,
  type EmailSenderSurface,
} from '@/lib/server/db'

export type { EmailSenderSurface }

/** A surface's choice: an identity, the inbox (support only), or nothing chosen. */
export type EmailSenderChoice =
  { mode: 'address'; account: ChannelAccount } | { mode: 'inbox'; account: null }

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
      if (row.surface === 'support') choices.set('support', { mode: 'inbox', account: null })
    } else if (row.account) {
      choices.set(row.surface, { mode: 'address', account: row.account })
    }
  }
  return choices
}

/** Thrown for a choice the settings page should never send. Readable on purpose. */
export class EmailSenderChoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailSenderChoiceError'
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
  await db
    .insert(emailSenders)
    .values({ surface, mode: choice.mode, channelAccountId })
    .onConflictDoUpdate({
      target: [emailSenders.surface, emailSenders.scopeType],
      targetWhere: sql`scope_id IS NULL`,
      set: { mode: choice.mode, channelAccountId, updatedAt: new Date() },
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

/** The surfaces that send from an address, so removing it can say what falls back. */
export async function surfacesUsingAccount(id: ChannelAccountId): Promise<EmailSenderSurface[]> {
  const rows = await db
    .select({ surface: emailSenders.surface })
    .from(emailSenders)
    .where(eq(emailSenders.channelAccountId, id))
  return rows.map((r) => r.surface)
}

/** Clear every choice of an address, which is about to stop being one. */
export async function clearEmailSendersFor(id: ChannelAccountId): Promise<void> {
  await db.delete(emailSenders).where(eq(emailSenders.channelAccountId, id))
}

/**
 * The sender name of the live sending address with this address, when there is
 * one: a thread's stored sender or an inbox address names an address, not a
 * row. Null when none, or when it has no name of its own (the workspace name).
 */
export async function senderNameForAddress(address: string): Promise<string | null> {
  const [row] = await db
    .select({ senderName: channelAccounts.senderName })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.role, 'sending'),
        eq(channelAccounts.address, address.trim().toLowerCase()),
        isNull(channelAccounts.deletedAt)
      )
    )
    .orderBy(asc(channelAccounts.createdAt), asc(channelAccounts.id))
    .limit(1)
  return row?.senderName ?? null
}
