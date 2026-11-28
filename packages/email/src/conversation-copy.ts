/**
 * Subject, intro, and template-gate helpers for conversation emails.
 *
 * Kept next to the senders so the notify path and the package tests share one
 * spelling of "Re: {subject}" and of the first-vs-follow-up team-alert intro.
 */

import { singleLineSubject } from './subject'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from './i18n'

export const CONVERSATION_MESSAGES = defineEmailMessages({
  newMessage: { id: 'email.conversation.newMessage', defaultMessage: 'New message' },
  started: {
    id: 'email.conversation.started',
    defaultMessage: '{name} started a conversation in {workspace}.',
  },
  sent: {
    id: 'email.conversation.sent',
    defaultMessage: '{name} sent a new message in {workspace}.',
  },
  openInbox: { id: 'email.conversation.openInbox', defaultMessage: 'Open inbox' },
  memberReason: {
    id: 'email.conversation.memberReason',
    defaultMessage: 'You received this email because you are a member of this workspace.',
  },
  replyFrom: { id: 'email.conversation.replyFrom', defaultMessage: 'New reply from {workspace}' },
  messageFrom: {
    id: 'email.conversation.messageFrom',
    defaultMessage: 'New message from {workspace}',
  },
  teamReplied: {
    id: 'email.conversation.teamReplied',
    defaultMessage: '{name} replied to your conversation.',
  },
  teamSent: { id: 'email.conversation.teamSent', defaultMessage: '{name} sent you a message.' },
  personReplied: {
    id: 'email.conversation.personReplied',
    defaultMessage: '{name} replied to your conversation with {workspace}.',
  },
  personSent: {
    id: 'email.conversation.personSent',
    defaultMessage: '{name} from {workspace} sent you a message.',
  },
  viewConversation: { id: 'email.conversation.view', defaultMessage: 'View conversation' },
  replyReason: {
    id: 'email.conversation.replyReason',
    defaultMessage: 'You received this email because you have an open conversation with this team.',
  },
  messageReason: {
    id: 'email.conversation.messageReason',
    defaultMessage: 'You received this email because {workspace} sent you a message.',
  },
  agentFrom: { id: 'email.conversation.agentFrom', defaultMessage: '{name} from {workspace}' },
  continueByReply: {
    id: 'email.conversation.continueByReply',
    defaultMessage: 'Reply to this email to continue the conversation',
  },
  viewOnline: { id: 'email.csat.viewOnline', defaultMessage: 'View it online' },
  quoteWithDate: {
    id: 'email.conversation.quoteWithDate',
    defaultMessage: 'On {date}, {name} wrote:',
  },
  quote: { id: 'email.conversation.quote', defaultMessage: '{name} wrote:' },
  closedSubject: {
    id: 'email.conversation.closedSubject',
    defaultMessage: 'Re: your conversation with {workspace}',
  },
  ackSubject: {
    id: 'email.conversation.ackSubject',
    defaultMessage: 'Re: your message to {workspace}',
  },
  ackBody: {
    id: 'email.conversation.ackBody',
    defaultMessage: 'We received your email and will get back to you shortly.',
  },
})
const M = CONVERSATION_MESSAGES

export type ConversationMailDirection = 'agent_reply' | 'visitor_message' | 'agent_started'

/**
 * Strip any leading `Re:` tokens (any case, repeated) and prefix a single `Re:`.
 * The stored subject can come from a multi-line message, so it is made one line first.
 */
export function conversationReplySubject(subject: string | null | undefined): string | null {
  if (subject == null) return null
  const stripped = singleLineSubject(subject)
    .replace(/^\s*(re:\s*)+/i, '')
    .trim()
  if (!stripped) return null
  return singleLineSubject(`Re: ${stripped}`)
}

/** Human correspondence template: email-channel agent replies and agent-started mail. */
export function isHumanReplyTemplate(
  channel: string | undefined,
  direction: ConversationMailDirection,
  correspondence?: boolean
): boolean {
  const theirs = correspondence ?? channel === 'email'
  return theirs && (direction === 'agent_reply' || direction === 'agent_started')
}

/** `{visitor}: {subject|preview}` for teammate alerts. */
export function teamAlertSubject(
  visitorName: string,
  subject: string | null | undefined,
  preview?: string | null,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  const topic =
    (subject &&
      singleLineSubject(subject)
        .replace(/^\s*(re:\s*)+/i, '')
        .trim()) ||
    preview?.replace(/\s+/g, ' ').trim().slice(0, 80) ||
    i18n.t(M.newMessage)
  return `${visitorName}: ${topic}`
}

/** The From display name on an agent's reply: `Alex from Acme`. */
export function agentReplyDisplayName(
  agentName: string,
  workspaceName: string,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(M.agentFrom, { name: agentName, workspace: workspaceName })
}

export function conversationMessageCopy(opts: {
  direction: ConversationMailDirection
  senderName: string
  /** `senderName` is the support team's, not a person's: the copy speaks as
   *  the team rather than "X from the workspace". */
  senderIsTeam?: boolean
  workspaceName: string
  conversationSubject?: string | null
  /** Team-alert subject fallback when the conversation has no subject. */
  preview?: string | null
  channel?: string
  isFirstMessage?: boolean
  /** When set, overrides the channel string for the human-template gate. */
  correspondence?: boolean
  i18n?: EmailLocale
}): {
  subject: string
  heading: string
  intro: string
  ctaLabel: string
  reason: string
  useHumanTemplate: boolean
} {
  const { direction, senderName, workspaceName } = opts
  const { t } = opts.i18n ?? ENGLISH_EMAIL
  const useHumanTemplate = isHumanReplyTemplate(opts.channel, direction, opts.correspondence)
  const forwarded = conversationReplySubject(opts.conversationSubject)
  const words = { name: senderName, workspace: workspaceName }

  if (direction === 'visitor_message') {
    return {
      subject: teamAlertSubject(senderName, opts.conversationSubject, opts.preview, opts.i18n),
      heading: t(M.newMessage),
      intro: t(opts.isFirstMessage === true ? M.started : M.sent, words),
      ctaLabel: t(M.openInbox),
      reason: t(M.memberReason),
      useHumanTemplate: false,
    }
  }

  const isReply = direction === 'agent_reply'
  const generic = t(isReply ? M.replyFrom : M.messageFrom, words)
  return {
    subject: forwarded ?? generic,
    heading: forwarded ?? generic,
    intro: t(
      opts.senderIsTeam
        ? isReply
          ? M.teamReplied
          : M.teamSent
        : isReply
          ? M.personReplied
          : M.personSent,
      words
    ),
    ctaLabel: t(M.viewConversation),
    reason: t(isReply ? M.replyReason : M.messageReason, words),
    useHumanTemplate,
  }
}

/** RFC 5322 References / In-Reply-To assembly for a visitor-facing send. */
export function assembleOutboundThreading(input: {
  messageId?: string
  outboundIds: string[]
  inboundIds: string[]
  mergedIds?: string[]
}): {
  messageId?: string
  inReplyTo?: string
  references?: string[]
} {
  if (!input.messageId) return {}
  const inbound = input.inboundIds
  const outbound = input.outboundIds
  const merged = input.mergedIds ?? [...inbound, ...outbound]
  const unique = [...new Set(merged.filter((id) => id.length > 0))]
  const inReplyTo = inbound[inbound.length - 1] ?? outbound[outbound.length - 1]
  return {
    messageId: input.messageId,
    inReplyTo,
    references: unique.length > 0 ? unique : undefined,
  }
}
