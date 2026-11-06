/**
 * The one resolver for the From of a customer email.
 *
 * Every send that needs a workspace's own address asks {@link resolveSender},
 * directly or through one of the two wrappers below, so the choice is made the
 * same way for a reply, a closing notice, a ticket notice and changelog mail.
 */
import type { ChannelAccountId, ConversationId, TeamId } from '@quackback/ids'
import type { SendingIdentity } from '@quackback/email/sender'
import { db, eq, conversations } from '@/lib/server/db'
import { platformInboxAddress } from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import {
  defaultTeamId,
  getChannelAccount,
  listSendingAddresses,
  type SendingModule,
} from './channel-account.service'
import { permittedSendingIdentity, withSendingDisplayName } from './outbound-identity'

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

/** Which step of the chain in {@link resolveSender} produced the From. */
export type SenderSource = 'inbox' | 'team' | 'default_team' | 'platform_inbox'

export interface ResolvedSender {
  /** The address to send as. Always one the send guard permitted. */
  from: SendingIdentity
  source: SenderSource
}

/**
 * The first of a team's addresses for the module that the send guard permits.
 *
 * Every row is a candidate in the fixed order, and each is put to the guard
 * rather than only the first: a row whose domain is still pending, or has been
 * demoted, must not hide a live address beside it.
 */
async function permittedTeamAddress(
  teamId: TeamId,
  module: SendingModule
): Promise<SendingIdentity | null> {
  for (const row of await listSendingAddresses(teamId, module)) {
    const permitted = await permittedSendingIdentity(row.address)
    if (permitted) return permitted
  }
  return null
}

/**
 * The one place the From of a customer email is chosen.
 *
 * The chain, first match wins:
 *
 * 1. `inbox`: for a conversation that arrived through a front door, the address
 *    the customer wrote to. Replying from the address that was written to is
 *    the point of a customer-owned sending domain: a customer forwards
 *    `support@theircompany.com` in, and the reply has to leave as that address
 *    or the thread visibly changes identity halfway through.
 * 2. `team`: the assigned team's sending address for the module.
 * 3. `default_team`: the default team's sending address for the module. Teams
 *    are created freely and work is assigned to them, so a team with no address
 *    of its own sends as the workspace's rather than dropping to the platform
 *    sender.
 * 4. `platform_inbox`: for a front-door conversation only, the workspace's own
 *    address on the platform's minting domain. Derived rather than read off the
 *    route row, because an install's mint domain can move under a row written
 *    months ago. Last, because it is the address a workspace has rather than one
 *    it chose.
 * 5. null: the caller sends as the platform default (`getEmailFrom()`, the
 *    registry `email.from` when pooled).
 *
 * Within a team, rows are tried oldest first, then by id, so the same inputs
 * always give the same From and a newly added address never replaces the one
 * already in use.
 *
 * Every candidate passes the send guard on its own (`outbound-identity.ts`), and
 * a refused one falls through to the next step rather than suppressing it. A
 * row's existence is not authority to send as the address it holds: the mail
 * provider signs for any identity verified on the account every workspace
 * shares, so a row naming a domain this workspace never proved would be an
 * impersonation the provider would carry out.
 *
 * With `conversationId`, the conversation's assigned team is used and `teamId`
 * is ignored. A conversation with no channel account (a widget thread, for
 * example) gets steps 2, 3 and 5, never 1 or 4.
 */
export async function resolveSender(input: {
  module?: SendingModule
  teamId?: TeamId | null
  conversationId?: ConversationId
}): Promise<ResolvedSender | null> {
  const module = input.module ?? 'support'
  let teamId = input.teamId ?? null
  let channelAccountId: ChannelAccountId | null = null

  if (input.conversationId) {
    const [conv] = await db
      .select({
        assignedTeamId: conversations.assignedTeamId,
        channelAccountId: conversations.channelAccountId,
      })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1)
    teamId = conv?.assignedTeamId ?? null
    channelAccountId = conv?.channelAccountId ?? null
  }

  if (channelAccountId) {
    const account = await getChannelAccount(channelAccountId)
    // A sending row carries its address in the column; an inbound route carries
    // the address mail was forwarded from in its config. Either is "the address
    // the customer wrote to" for the conversation bound to it.
    const inboxAddress = account?.address ?? account?.config?.forwardingTarget ?? null
    const from = await permittedSendingIdentity(inboxAddress)
    if (from) return { from, source: 'inbox' }
  }

  const defaultTeam = await defaultTeamId()
  if (teamId && teamId !== defaultTeam) {
    const from = await permittedTeamAddress(teamId, module)
    if (from) return { from, source: 'team' }
  }
  if (defaultTeam) {
    const from = await permittedTeamAddress(defaultTeam, module)
    // The default team's address is the team's own when it is the one assigned.
    if (from) return { from, source: teamId === defaultTeam ? 'team' : 'default_team' }
  }

  if (channelAccountId) {
    const from = await permittedSendingIdentity(platformInboxAddress(currentMailSlug()))
    if (from) return { from, source: 'platform_inbox' }
  }
  return null
}

/**
 * The From for an email that belongs to a team rather than to a conversation
 * (ticket notices, changelog mail): the team's address for the module, else the
 * default team's, else null for the platform default. See {@link resolveSender}.
 */
export async function resolveSendingAddress(
  assignedTeamId: TeamId | null,
  module: SendingModule = 'support'
): Promise<SendingIdentity | null> {
  return (await resolveSender({ module, teamId: assignedTeamId }))?.from ?? null
}

/**
 * The From for an email on a conversation: the address the customer wrote to,
 * then the assigned team's address, then the default team's, then (for a
 * front-door conversation) the workspace's platform inbox address, else null
 * for the platform default. See {@link resolveSender}.
 *
 * A conversation with no channel account, such as a widget thread, still sends
 * from its team's or the default team's address when one is permitted; it only
 * skips the inbox and platform inbox steps, which need a front door.
 */
export async function resolveConversationFrom(
  conversationId: ConversationId,
  module: SendingModule = 'support'
): Promise<SendingIdentity | null> {
  return (await resolveSender({ module, conversationId }))?.from ?? null
}
