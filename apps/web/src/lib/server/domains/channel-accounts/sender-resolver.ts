/**
 * The one resolver for the From of a customer email.
 *
 * Every send that needs a workspace's own address asks {@link resolveSender},
 * directly or through one of the wrappers below, so the choice is made the same
 * way for a reply, a closing notice, a ticket notice, and feedback, changelog
 * and status mail. Which address each of those sends from is chosen in settings
 * (`email-senders.ts`).
 */
import type { ChannelAccountId, ConversationId, TicketId } from '@quackback/ids'
import type { SendingIdentity } from '@quackback/email/sender'
import { parseAddress } from '@quackback/email/ses'
import { db, and, asc, eq, isNull, conversations, ticketConversations } from '@/lib/server/db'
import { platformInboxAddress } from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import { getChannelAccount } from './channel-account.service'
import { getEmailSenders, workspaceAddress } from './email-senders'
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
 *    {@link resolveConversationSender}). One thread keeps one sender, whatever
 *    is chosen in settings later, for as long as the workspace still has that
 *    address. Like every other step it must pass the send guard: a stored
 *    address whose domain has since been demoted gives way to the rest of the
 *    chain.
 * 1. `inbox`: support only, and only while support is set to reply from the
 *    address the customer wrote to (`email_senders` mode `inbox`). For a
 *    conversation that arrived through a front door, the forwarded support
 *    address. A customer who wrote to `support@theircompany.com` hears back
 *    from it, or the thread visibly changes identity halfway through.
 * 2. `surface`: the identity chosen for this surface, when one is. For support
 *    in inbox mode that is the address behind the inbox, when it has one.
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
 * `preview` is for a page that shows what a send would use: the same answer,
 * with a refused candidate not logged as a refused send.
 */
export async function resolveSender(input: {
  surface?: SenderSurface
  conversationId?: ConversationId
  preview?: boolean
}): Promise<ResolvedSender | null> {
  return (await resolve(input)).sender
}

/** A resolution with what {@link resolveConversationSender} needs to store it. */
interface Resolution {
  sender: ResolvedSender | null
  /**
   * The conversation's stored sender, and whether the workspace still has that
   * address. Null when nothing is stored (or there is no conversation).
   */
  stored: { address: string; known: boolean } | null
  /**
   * True when `sender` is the default only because the address this surface
   * chose could not send: a stand-in, not the thread's own sender.
   */
  standIn: boolean
}

async function resolve(input: {
  surface?: SenderSurface
  conversationId?: ConversationId
  preview?: boolean
}): Promise<Resolution> {
  const surface = input.surface ?? 'support'
  // The guard's context, gathered at most once per resolution and only when a
  // candidate needs checking: it loads every verified domain, and this runs on
  // every outbound email.
  let gathered: Promise<SendingIdentityContext> | undefined
  const ctx = () => (gathered ??= sendingIdentityContext())
  const permitted = async (address: string | null | undefined) =>
    address ? permittedSendingIdentity(address, await ctx(), { quiet: input.preview }) : null
  let channelAccountId: ChannelAccountId | null = null
  let stored: Resolution['stored'] = null

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
    const address = conv?.threadSenderAddress ?? null
    if (address) {
      // Reused only while it is still one of the workspace's addresses, so
      // removing an address moves its threads to whatever is chosen now.
      const own = await workspaceAddress(address)
      stored = { address, known: own.known }
      if (own.known) {
        const from = await permitted(address)
        if (from) {
          const sender = { from, source: 'thread' as const, senderName: own.senderName }
          return { sender, stored, standIn: false }
        }
      }
    }
  }
  const answer = (sender: ResolvedSender | null, standIn = false): Resolution => ({
    sender,
    stored,
    standIn,
  })

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
      const { senderName } = await workspaceAddress(inboxAddress)
      return answer({ from, source: 'inbox', senderName })
    }
  }

  // The address this surface chose: its own, or the one behind the inbox.
  let chosenRefused = false
  if (choice?.account) {
    const from = await permitted(choice.account.address)
    if (from) return answer({ from, source: 'surface', senderName: choice.account.senderName })
    chosenRefused = true
  }
  const fallback = senders.get('default')
  if (fallback?.mode === 'address') {
    const from = await permitted(fallback.account.address)
    if (from) {
      const sender = { from, source: 'default' as const, senderName: fallback.account.senderName }
      return answer(sender, chosenRefused)
    }
  }

  if (frontDoor) {
    const from = await permitted(platformInboxAddress(currentMailSlug()))
    if (from) return answer({ from, source: 'platform_inbox', senderName: null })
  }
  return answer(null)
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
 * by then. Two first sends racing each other converge on whichever wrote first.
 *
 * Only an answer that is the thread's own is stored. Not the platform default
 * or the platform inbox, which are addresses a thread has before the workspace
 * can send as its own. Not a default reached only because the address support
 * chose could not send, which stands in for that address until it can. And a
 * stored sender that is refused for a while (its domain unverified) is not
 * overwritten, so the thread returns to it; one the workspace has removed is
 * replaced by the current answer.
 */
export async function resolveConversationSender(
  conversationId: ConversationId,
  surface: SenderSurface = 'support'
): Promise<ResolvedSender | null> {
  const { sender, stored, standIn } = await resolve({ surface, conversationId })
  if (!sender || sender.source === 'thread' || sender.source === 'platform_inbox') return sender
  if (standIn || stored?.known) return sender

  const [written] = await db
    .update(conversations)
    .set({ threadSenderAddress: bareSenderAddress(sender.from) })
    .where(
      and(
        eq(conversations.id, conversationId),
        stored
          ? eq(conversations.threadSenderAddress, stored.address)
          : isNull(conversations.threadSenderAddress)
      )
    )
    .returning({ id: conversations.id })
  if (written) return sender
  // Another send stored the thread's sender between the read and this write.
  // Asking again returns it.
  return resolveSender({ surface, conversationId })
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
export async function resolveTicketSender(ticketId: TicketId): Promise<ResolvedSender | null> {
  const [link] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(eq(ticketConversations.ticketId, ticketId))
    .orderBy(asc(ticketConversations.createdAt), asc(ticketConversations.conversationId))
    .limit(1)
  if (link) return resolveConversationSender(link.conversationId, 'support')
  return resolveSender({ surface: 'support' })
}
