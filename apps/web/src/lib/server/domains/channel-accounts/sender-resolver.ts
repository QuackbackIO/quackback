/**
 * The one resolver for the From of a customer email.
 *
 * Every send that needs a workspace's own address asks {@link resolveSender},
 * directly or through one of the wrappers below, so the choice is made the same
 * way for a reply, a closing notice, a ticket notice, and feedback, changelog
 * and status mail. Which address each of those sends from is chosen in settings
 * (`email-senders.ts`).
 */
import type { ChannelAccountId, ConversationId, TeamId, TicketId } from '@quackback/ids'
import type { SendingIdentity } from '@quackback/email/sender'
import { parseAddress } from '@quackback/email/ses'
import { db, and, asc, eq, isNull, conversations, ticketConversations } from '@/lib/server/db'
import { platformInboxAddress } from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import { getChannelAccount } from './channel-account.service'
import { getEmailSenders, senderNameForAddress } from './email-senders'
import {
  permittedSendingIdentity,
  sendingIdentityContext,
  withSendingDisplayName,
  type SendingIdentityContext,
} from './outbound-identity'

/**
 * RFC 5322 display-name wrapper for a resolved sending address:
 * `Alex from Acme <support@acme.com>`. Does not change address resolution.
 */
export function formatNamedSendingAddress(
  address: SendingIdentity,
  displayName: string
): SendingIdentity {
  return withSendingDisplayName(address, displayName)
}

/** The kinds of customer email that choose their own sender. */
export type SenderSurface = 'support' | 'feedback' | 'changelog' | 'status'

/** Which step of the chain in {@link resolveSender} produced the From. */
export type SenderSource = 'thread' | 'inbox' | 'surface' | 'default' | 'platform_inbox'

export interface ResolvedSender {
  /** The address to send as. Always one the send guard permitted. */
  from: SendingIdentity
  source: SenderSource
  /**
   * The name the chosen address sends under, or null for the workspace name.
   * Callers name the mail `senderName ?? workspaceName`, and an agent's reply
   * "<agent> from <that>".
   */
  senderName: string | null
}

/**
 * The one place the From of a customer email is chosen.
 *
 * The chain, first match wins:
 *
 * 0. `thread`: for a conversation, the address its first customer email went
 *    out from (`conversations.thread_sender_address`, written by
 *    {@link resolveConversationFrom}). One thread keeps one sender, whatever is
 *    chosen in settings later. Like every other step it must pass the send
 *    guard: a stored address whose domain has since been demoted gives way to
 *    the rest of the chain.
 * 1. `inbox`: support only, and only while support is set to reply from the
 *    address the customer wrote to (`email_senders` mode `inbox`). For a
 *    conversation that arrived through a front door, the forwarded support
 *    address. A customer who wrote to `support@theircompany.com` hears back
 *    from it, or the thread visibly changes identity halfway through.
 * 2. `surface`: the identity chosen for this surface, when one is.
 * 3. `default`: the workspace's default sender, when one is chosen.
 * 4. `platform_inbox`: in inbox mode, for a front-door conversation, the
 *    workspace's own platform inbox address. Last, because it is the address a
 *    workspace has rather than one it chose; derived rather than stored,
 *    because an install's mint domain can move under a row written months ago.
 * 5. null: the caller sends as the platform default (`getEmailFrom()`, the
 *    registry `email.from` when pooled).
 *
 * Every candidate passes the send guard on its own (`outbound-identity.ts`), and
 * a refused one falls through to the next step rather than suppressing it. A
 * row's existence is not authority to send as the address it holds: the mail
 * provider signs for any identity verified on the account every workspace
 * shares, so a row naming a domain this workspace never proved would be an
 * impersonation the provider would carry out.
 *
 * `teamId` is accepted for existing callers and ignored: addresses were only
 * ever added on the default team, and per-team senders will come back as a
 * scope on `email_senders` rather than as team matching here.
 */
export async function resolveSender(input: {
  surface?: SenderSurface
  teamId?: TeamId | null
  conversationId?: ConversationId
}): Promise<ResolvedSender | null> {
  const surface = input.surface ?? 'support'
  // The guard's context, gathered at most once per resolution and only when a
  // candidate needs checking: it loads every verified domain, and this runs on
  // every outbound email.
  let gathered: Promise<SendingIdentityContext> | undefined
  const ctx = () => (gathered ??= sendingIdentityContext())
  const permitted = async (address: string | null | undefined) =>
    address ? permittedSendingIdentity(address, await ctx()) : null
  let channelAccountId: ChannelAccountId | null = null

  if (input.conversationId) {
    const [conv] = await db
      .select({
        channelAccountId: conversations.channelAccountId,
        threadSenderAddress: conversations.threadSenderAddress,
      })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1)
    channelAccountId = conv?.channelAccountId ?? null
    const stored = conv?.threadSenderAddress ?? null
    const from = await permitted(stored)
    if (from && stored)
      return { from, source: 'thread', senderName: await senderNameForAddress(stored) }
  }

  const senders = await getEmailSenders()
  const choice = senders.get(surface)
  const inboxMode = surface === 'support' && choice?.mode === 'inbox'

  // A front-door conversation in inbox mode, which may end on the platform
  // inbox address below.
  const frontDoor = inboxMode && channelAccountId !== null
  if (frontDoor && channelAccountId) {
    const account = await getChannelAccount(channelAccountId)
    // A sending row carries its address in the column; an inbound route carries
    // the address mail was forwarded from in its config. Either is "the address
    // the customer wrote to" for the conversation bound to it.
    const inboxAddress = account?.address ?? account?.config?.forwardingTarget ?? null
    const from = await permitted(inboxAddress)
    if (from && inboxAddress) {
      return { from, source: 'inbox', senderName: await senderNameForAddress(inboxAddress) }
    }
  }

  if (choice?.mode === 'address') {
    const from = await permitted(choice.account.address)
    if (from) return { from, source: 'surface', senderName: choice.account.senderName }
  }
  const fallback = senders.get('default')
  if (fallback?.mode === 'address') {
    const from = await permitted(fallback.account.address)
    if (from) return { from, source: 'default', senderName: fallback.account.senderName }
  }

  if (frontDoor) {
    const from = await permitted(platformInboxAddress(currentMailSlug()))
    if (from) return { from, source: 'platform_inbox', senderName: null }
  }
  return null
}

/**
 * The From for an email that belongs to no conversation (feedback, changelog
 * and status mail, a ticket with no linked conversation): the surface's chosen
 * address, else the default, else null for the platform default. The team is
 * accepted and ignored; see {@link resolveSender}.
 */
export async function resolveSendingAddress(
  assignedTeamId: TeamId | null,
  surface: SenderSurface = 'support'
): Promise<SendingIdentity | null> {
  return (await resolveSender({ surface, teamId: assignedTeamId }))?.from ?? null
}

/** The bare addr-spec of a From, without any display name; what a thread stores. */
export function bareSenderAddress(from: SendingIdentity | string): string {
  const parsed = parseAddress(from)
  return typeof parsed === 'string' ? parsed : parsed.address
}

/**
 * The From for an email on a conversation, called by every send that emails the
 * customer about it, with the name to send it under. See {@link resolveSender}
 * for the order.
 *
 * The first answer is stored as the thread's sender, so every later email on
 * the conversation leaves from the same address whatever is chosen in settings
 * by then. Stored only while the column is empty: two first sends racing each
 * other converge on whichever wrote first, and a sender that falls through the
 * guard for a while is not overwritten, so the thread returns to it when its
 * domain is verified again. Nothing is stored for the platform default, which
 * is the address a thread has before anything is configured rather than one it
 * chose.
 */
export async function resolveConversationSender(
  conversationId: ConversationId,
  surface: SenderSurface = 'support'
): Promise<ResolvedSender | null> {
  const resolved = await resolveSender({ surface, conversationId })
  if (!resolved || resolved.source === 'thread') return resolved

  const [stored] = await db
    .update(conversations)
    .set({ threadSenderAddress: bareSenderAddress(resolved.from) })
    .where(and(eq(conversations.id, conversationId), isNull(conversations.threadSenderAddress)))
    .returning({ id: conversations.id })
  if (stored) return resolved
  // Either another send stored the thread's sender between the read and this
  // write, or the stored one is refused for now. Asking again returns the
  // former and falls through the same way for the latter.
  return resolveSender({ surface, conversationId })
}

/** {@link resolveConversationSender}, for callers that only need the address. */
export async function resolveConversationFrom(
  conversationId: ConversationId,
  surface: SenderSurface = 'support'
): Promise<SendingIdentity | null> {
  return (await resolveConversationSender(conversationId, surface))?.from ?? null
}

/**
 * The From for an email to a ticket's requester, with its name.
 *
 * A ticket opened from a conversation is the same customer's thread carried on
 * elsewhere, so it sends from that conversation's thread sender
 * ({@link resolveConversationSender}): the ticket's emails and the
 * conversation's replies then come from one address. With several linked, the
 * first one linked decides. A ticket with no linked conversation sends as
 * support does.
 */
export async function resolveTicketSender(
  ticketId: TicketId,
  assignedTeamId: TeamId | null
): Promise<ResolvedSender | null> {
  const [link] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(eq(ticketConversations.ticketId, ticketId))
    .orderBy(asc(ticketConversations.createdAt), asc(ticketConversations.conversationId))
    .limit(1)
  if (link) return resolveConversationSender(link.conversationId, 'support')
  return resolveSender({ surface: 'support', teamId: assignedTeamId })
}

/** {@link resolveTicketSender}, for callers that only need the address. */
export async function resolveTicketFrom(
  ticketId: TicketId,
  assignedTeamId: TeamId | null
): Promise<SendingIdentity | null> {
  return (await resolveTicketSender(ticketId, assignedTeamId))?.from ?? null
}
