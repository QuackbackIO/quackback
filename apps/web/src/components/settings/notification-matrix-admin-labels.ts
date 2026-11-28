import type { NotificationTypeMeta } from '@/lib/shared/notifications/catalog'

type Message = { id: string; defaultMessage: string }

/** The rows only the admin shows (assignments, conversations, SLA, domains), in the teammate's language. */
export const ADMIN_TYPE_LABELS: Partial<
  Record<NotificationTypeMeta['type'], { label: Message; description: Message }>
> = {
  post_owner_assigned: {
    label: {
      id: 'portal.settings.notifications.type.postAssigned.label',
      defaultMessage: 'Post assigned',
    },
    description: {
      id: 'portal.settings.notifications.type.postAssigned.description',
      defaultMessage: 'A post is assigned to you',
    },
  },
  chat_message: {
    label: {
      id: 'portal.settings.notifications.type.chatMessage.label',
      defaultMessage: 'New message',
    },
    description: {
      id: 'portal.settings.notifications.type.chatMessage.description',
      defaultMessage: 'A new message arrives in a conversation you follow',
    },
  },
  conversation_assigned: {
    label: {
      id: 'portal.settings.notifications.type.conversationAssigned.label',
      defaultMessage: 'Conversation assigned',
    },
    description: {
      id: 'portal.settings.notifications.type.conversationAssigned.description',
      defaultMessage: 'A conversation is assigned to you or your team',
    },
  },
  chat_mention: {
    label: {
      id: 'portal.settings.notifications.type.chatMention.label',
      defaultMessage: 'Mentioned in a conversation',
    },
    description: {
      id: 'portal.settings.notifications.type.chatMention.description',
      defaultMessage: 'Someone @-mentions you in a conversation',
    },
  },
  assistant_handed_off: {
    label: {
      id: 'portal.settings.notifications.type.assistantHandedOff.label',
      defaultMessage: 'AI handed off to you',
    },
    description: {
      id: 'portal.settings.notifications.type.assistantHandedOff.description',
      defaultMessage: 'The AI assistant hands a conversation to the human inbox',
    },
  },
  ticket_assigned: {
    label: {
      id: 'portal.settings.notifications.type.ticketAssigned.label',
      defaultMessage: 'Ticket assigned',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketAssigned.description',
      defaultMessage: 'A ticket is assigned to you or your team',
    },
  },
  ticket_note_added: {
    label: {
      id: 'portal.settings.notifications.type.ticketNoteAdded.label',
      defaultMessage: 'Ticket internal notes',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketNoteAdded.description',
      defaultMessage: 'A ticket you follow gets an internal note',
    },
  },
  ticket_external_status_changed: {
    label: {
      id: 'portal.settings.notifications.type.ticketExternalStatus.label',
      defaultMessage: 'Linked issue updates',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketExternalStatus.description',
      defaultMessage: 'A tracker issue linked to a ticket you follow changes status',
    },
  },
  sla_warning: {
    label: {
      id: 'portal.settings.notifications.type.slaWarning.label',
      defaultMessage: 'SLA breach warning',
    },
    description: {
      id: 'portal.settings.notifications.type.slaWarning.description',
      defaultMessage: 'An SLA clock you own is approaching breach',
    },
  },
  sla_breach: {
    label: {
      id: 'portal.settings.notifications.type.slaBreach.label',
      defaultMessage: 'SLA breached',
    },
    description: {
      id: 'portal.settings.notifications.type.slaBreach.description',
      defaultMessage: 'An SLA clock you own has breached',
    },
  },
  sending_domain_live: {
    label: {
      id: 'portal.settings.notifications.type.sendingDomainLive.label',
      defaultMessage: 'Sending domain verified',
    },
    description: {
      id: 'portal.settings.notifications.type.sendingDomainLive.description',
      defaultMessage: 'A sending domain is verified and ready to send',
    },
  },
  sending_domain_needs_attention: {
    label: {
      id: 'portal.settings.notifications.type.sendingDomainAttention.label',
      defaultMessage: 'Sending domain needs attention',
    },
    description: {
      id: 'portal.settings.notifications.type.sendingDomainAttention.description',
      defaultMessage:
        'A sending domain stops verifying, so its email comes from your default address',
    },
  },
  domain_needs_attention: {
    label: {
      id: 'portal.settings.notifications.type.domainAttention.label',
      defaultMessage: 'Domain needs attention',
    },
    description: {
      id: 'portal.settings.notifications.type.domainAttention.description',
      defaultMessage: "A domain's verification record is missing, or it stopped verifying",
    },
  },
}
