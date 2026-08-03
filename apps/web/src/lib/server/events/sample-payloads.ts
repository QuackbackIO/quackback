/**
 * Canonical sample event payloads — one per `EventType`.
 *
 * Used by:
 *   - the test-fire endpoint (`POST /api/v1/webhooks/:id/test`) to send a
 *     well-formed, deterministic event to a webhook endpoint without waiting
 *     for real activity, and
 *   - the create/edit dialog payload-preview accordion so operators can see
 *     exactly what each event subscription will look like on the wire.
 *
 * IDs in samples are static placeholders (`*_sample`) — they do NOT exist
 * in the database. Receivers should not look these up; the actor is always
 * marked as a `service` so production logic can short-circuit on test events.
 */
import type { EventData, EventType, EventActor } from './types'

const SAMPLE_TIMESTAMP = '2026-01-01T12:00:00.000Z'
const SAMPLE_ACTOR: EventActor = {
  type: 'service',
  service: 'quackback-test-fire',
  displayName: 'Quackback Test Fire',
}

function envelope<T extends EventType>(type: T, eventId: string) {
  return { id: eventId, type, timestamp: SAMPLE_TIMESTAMP, actor: SAMPLE_ACTOR }
}

const SAMPLE_POST_REF = {
  id: 'post_sample',
  title: 'Sample feedback post',
  boardId: 'board_sample',
  boardSlug: 'feature-requests',
}

const SAMPLE_TICKET_REF = {
  id: 'ticket_sample',
  subject: 'Sample ticket — please ignore',
  descriptionText: null,
  statusId: 'tstatus_sample_open',
  statusCategory: 'open',
  priority: 'normal',
  channel: 'portal',
  visibility: 'team',
  inboxId: 'inbox_sample',
  primaryTeamId: 'team_sample',
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: 'principal_sample_requester',
  requesterContactId: 'contact_sample',
  statusName: 'Open',
  inboxName: 'Support',
  inboxSlug: 'support',
  primaryTeamName: 'CX Team',
  assigneeTeamName: null,
  requesterEmail: '[email protected]',
  requesterName: 'Sample Requester',
  organizationName: 'Sample Org',
  organizationDomain: 'sample.test',
  createdAt: SAMPLE_TIMESTAMP,
  firstResponseAt: null,
  resolvedAt: null,
  reopenedAt: null,
  closedAt: null,
  ticketUrl: 'https://app.example.test/tickets/ticket_sample',
}

const SAMPLE_INBOX_REF = {
  id: 'inbox_sample',
  slug: 'support',
  name: 'Support',
  description: 'Sample inbox for testing',
  primaryTeamId: 'team_sample',
  defaultVisibilityScope: 'team',
  defaultPriority: 'normal',
  defaultStatusId: 'tstatus_sample_open',
  color: '#6366f1',
  icon: 'inbox',
  archivedAt: null,
}

const SAMPLE_TEAM_REF = {
  id: 'team_sample',
  slug: 'cx',
  name: 'CX Team',
  description: 'Sample team for testing',
  shortLabel: 'CX',
  color: '#10b981',
  archivedAt: null,
}

const SAMPLE_TICKET_STATUS_REF = {
  id: 'tstatus_sample_open',
  slug: 'open',
  name: 'Open',
  color: '#3b82f6',
  category: 'open',
  position: 0,
  isDefault: true,
  isSystem: false,
  deletedAt: null,
}

const SAMPLE_CONTACT_REF = {
  id: 'contact_sample',
  name: 'Sample Requester',
  email: '[email protected]',
  phone: null,
  title: 'Customer',
  externalId: null,
  organizationId: 'org_sample',
  archivedAt: null,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_ORG_REF = {
  id: 'org_sample',
  name: 'Sample Org',
  domain: 'sample.test',
  website: 'https://sample.test',
  externalId: null,
  archivedAt: null,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_CONVERSATION_REF = {
  id: 'conv_sample',
  status: 'open' as const,
  channel: 'messenger' as const,
  priority: 'medium' as const,
}

const SAMPLE_CONVERSATION_DATA = {
  ...SAMPLE_CONVERSATION_REF,
  subject: 'Sample conversation — please ignore',
  visitorPrincipalId: 'principal_sample_visitor',
  visitorEmail: '[email protected]',
  assignedAgentPrincipalId: null,
  createdAt: SAMPLE_TIMESTAMP,
  lastMessageAt: SAMPLE_TIMESTAMP,
  resolvedAt: null,
}

const SAMPLE_MESSAGE_DATA = {
  id: 'msg_sample',
  conversationId: 'conv_sample',
  senderType: 'visitor' as const,
  authorPrincipalId: 'principal_sample_visitor',
  authorName: 'Sample Visitor',
  authorEmail: '[email protected]',
  content: 'Sample message body.',
  createdAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_HELP_CENTER_CATEGORY_REF = {
  id: 'category_sample',
  slug: 'getting-started',
  name: 'Getting Started',
  parentId: null,
  isPublic: true,
  visibility: 'public',
  position: 0,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_HELP_CENTER_ARTICLE_REF = {
  id: 'article_sample',
  categoryId: 'category_sample',
  slug: 'how-to-get-started',
  title: 'How to get started',
  authorPrincipalId: 'principal_sample_author',
  publishedAt: SAMPLE_TIMESTAMP,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_CHANGELOG_REF = {
  id: 'changelog_sample',
  title: 'Sample release',
  contentPreview: 'New things shipped this week.',
  categoryId: null,
  productId: null,
  publishedAt: SAMPLE_TIMESTAMP,
  linkedPostCount: 3,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_SEGMENT_REF = {
  id: 'segment_sample',
  slug: 'power-users',
  name: 'Power Users',
  type: 'dynamic',
  color: '#6b7280',
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_USER_ATTRIBUTE_REF = {
  id: 'user_attr_sample',
  key: 'plan_tier',
  label: 'Plan Tier',
  type: 'string',
  currencyCode: null,
  externalKey: null,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}

const SAMPLE_BOARD_REF = {
  id: 'board_sample',
  slug: 'feature-requests',
  name: 'Feature Requests',
  description: null,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}
const SAMPLE_TAG_REF = {
  id: 'tag_sample',
  name: 'bug',
  color: '#ef4444',
  description: null,
  createdAt: SAMPLE_TIMESTAMP,
}
const SAMPLE_STATUS_REF = {
  id: 'status_sample',
  slug: 'planned',
  name: 'Planned',
  color: '#3b82f6',
  category: 'active',
  position: 0,
  showOnRoadmap: true,
  isDefault: false,
  createdAt: SAMPLE_TIMESTAMP,
}
const SAMPLE_ROADMAP_REF = {
  id: 'roadmap_sample',
  slug: '2026',
  name: '2026 Roadmap',
  description: null,
  isPublic: true,
  position: 0,
  createdAt: SAMPLE_TIMESTAMP,
  updatedAt: SAMPLE_TIMESTAMP,
}
const SAMPLE_SLA_POLICY_REF = {
  id: 'sla_pol_sample',
  name: 'Standard SLA',
  scope: 'workspace',
  enabled: true,
  priority: 0,
  archivedAt: null,
}
const SAMPLE_ROUTING_RULE_REF = {
  id: 'route_rule_sample',
  name: 'Billing to Finance',
  enabled: true,
  priority: 0,
  inboxIdScope: null,
}
const SAMPLE_BUSINESS_HOURS_REF = {
  id: 'bizhrs_sample',
  name: 'Weekdays 9-5',
  timezone: 'America/New_York',
  archivedAt: null,
}
const SAMPLE_INBOX_CHANNEL_REF = {
  id: 'inbox_ch_sample',
  inboxId: 'inbox_sample',
  kind: 'email',
  label: 'Support Email',
  externalId: null,
  enabled: true,
  archivedAt: null,
}
const SAMPLE_INBOX_MEMBERSHIP_REF = {
  id: 'inbox_mem_sample',
  inboxId: 'inbox_sample',
  principalId: 'principal_sample',
  role: 'agent',
}
const SAMPLE_API_KEY_REF = {
  id: 'api_key_sample',
  name: 'CI deploy key',
  scopes: ['ticket.view_all'],
}
const SAMPLE_ROLE_REF = {
  id: 'role_sample',
  key: 'billing_agent',
  name: 'Billing Agent',
  isSystem: false,
}
const SAMPLE_ROLE_ASSIGNMENT_REF = {
  id: 'role_asgn_sample',
  roleId: 'role_sample',
  roleKey: 'billing_agent',
  principalId: 'principal_sample',
  teamId: null,
}

const SAMPLES: Partial<{ [K in EventType]: EventData }> & Record<string, EventData> = {
  'post.created': {
    ...envelope('post.created', 'evt_sample_post_created'),
    data: {
      post: {
        ...SAMPLE_POST_REF,
        content: 'This is a sample post body.',
        authorEmail: '[email protected]',
        authorName: 'Sample User',
        voteCount: 0,
      },
    },
  },
  'post.status_changed': {
    ...envelope('post.status_changed', 'evt_sample_post_status_changed'),
    data: { post: SAMPLE_POST_REF, previousStatus: 'open', newStatus: 'planned' },
  },
  'post.updated': {
    ...envelope('post.updated', 'evt_sample_post_updated'),
    data: { post: SAMPLE_POST_REF, changedFields: ['title'] },
  },
  'post.deleted': {
    ...envelope('post.deleted', 'evt_sample_post_deleted'),
    data: { post: SAMPLE_POST_REF, deletedBy: 'admin@example.test' },
  },
  'post.restored': {
    ...envelope('post.restored', 'evt_sample_post_restored'),
    data: { post: SAMPLE_POST_REF },
  },
  'post.merged': {
    ...envelope('post.merged', 'evt_sample_post_merged'),
    data: {
      duplicatePost: SAMPLE_POST_REF,
      canonicalPost: { ...SAMPLE_POST_REF, id: 'post_sample_canonical' },
    },
  },
  'post.unmerged': {
    ...envelope('post.unmerged', 'evt_sample_post_unmerged'),
    data: {
      post: SAMPLE_POST_REF,
      formerCanonicalPost: { ...SAMPLE_POST_REF, id: 'post_sample_canonical' },
    },
  },
  'post.mentioned': {
    ...envelope('post.mentioned', 'evt_sample_post_mentioned'),
    data: {
      postId: 'post_sample',
      postTitle: 'Sample feedback post',
      postUrl: 'https://app.example.test/posts/post_sample',
      mentionedPrincipalId: 'principal_sample_mentioned',
      mentioningPrincipalId: 'principal_sample_author',
      excerpt: 'Hey @sample, can you take a look at this sample feedback post?',
    },
  },
  'comment.created': {
    ...envelope('comment.created', 'evt_sample_comment_created'),
    data: {
      comment: {
        id: 'comment_sample',
        content: 'Sample comment body.',
        authorEmail: '[email protected]',
        authorName: 'Sample User',
        isPrivate: false,
      },
      post: SAMPLE_POST_REF,
    },
  },
  'comment.updated': {
    ...envelope('comment.updated', 'evt_sample_comment_updated'),
    data: {
      comment: { id: 'comment_sample', content: 'Updated sample comment body.' },
      post: SAMPLE_POST_REF,
    },
  },
  'comment.deleted': {
    ...envelope('comment.deleted', 'evt_sample_comment_deleted'),
    data: { comment: { id: 'comment_sample', isPrivate: false }, post: SAMPLE_POST_REF },
  },
  'changelog.published': {
    ...envelope('changelog.published', 'evt_sample_changelog_published'),
    data: {
      changelog: {
        id: 'changelog_sample',
        title: 'Sample release',
        contentPreview: 'New things shipped this week.',
        publishedAt: SAMPLE_TIMESTAMP,
        linkedPostCount: 3,
      },
    },
  },
  'ticket.created': {
    ...envelope('ticket.created', 'evt_sample_ticket_created'),
    data: { ticket: SAMPLE_TICKET_REF },
  },
  'ticket.updated': {
    ...envelope('ticket.updated', 'evt_sample_ticket_updated'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      changedFields: ['priority'],
      diff: { priority: { from: 'normal', to: 'high' } },
    },
  },
  'ticket.deleted': {
    ...envelope('ticket.deleted', 'evt_sample_ticket_deleted'),
    data: { ticket: SAMPLE_TICKET_REF, deletedByPrincipalId: 'principal_sample_admin' },
  },
  'ticket.restored': {
    ...envelope('ticket.restored', 'evt_sample_ticket_restored'),
    data: { ticket: SAMPLE_TICKET_REF, restoredByPrincipalId: 'principal_sample_admin' },
  },
  'ticket.assigned': {
    ...envelope('ticket.assigned', 'evt_sample_ticket_assigned'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      previousAssigneePrincipalId: null,
      newAssigneePrincipalId: 'principal_sample_agent',
    },
  },
  'ticket.unassigned': {
    ...envelope('ticket.unassigned', 'evt_sample_ticket_unassigned'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      previousAssigneePrincipalId: 'principal_sample_agent',
    },
  },
  'ticket.status_changed': {
    ...envelope('ticket.status_changed', 'evt_sample_ticket_status_changed'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      previousStatusCategory: 'open',
      newStatusCategory: 'pending',
    },
  },
  'ticket.first_response': {
    ...envelope('ticket.first_response', 'evt_sample_ticket_first_response'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      threadId: 'thread_sample',
      firstResponseAt: SAMPLE_TIMESTAMP,
    },
  },
  'ticket.thread_added': {
    ...envelope('ticket.thread_added', 'evt_sample_ticket_thread_added'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      threadId: 'thread_sample',
      audience: 'public',
      sharedWithTeamId: null,
      thread: {
        id: 'thread_sample',
        audience: 'public',
        bodyTextPreview: 'Sample reply body.',
        bodyTextTruncated: false,
        authorPrincipalId: 'principal_sample_agent',
        isFromRequester: false,
        sharedWithTeamId: null,
        createdAt: SAMPLE_TIMESTAMP,
      },
    },
  },
  'ticket.thread_updated': {
    ...envelope('ticket.thread_updated', 'evt_sample_ticket_thread_updated'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      threadId: 'thread_sample',
      audience: 'public',
      sharedWithTeamId: null,
      thread: {
        id: 'thread_sample',
        audience: 'public',
        bodyTextPreview: 'Updated sample reply body.',
        bodyTextTruncated: false,
        authorPrincipalId: 'principal_sample_agent',
        isFromRequester: false,
        sharedWithTeamId: null,
        createdAt: SAMPLE_TIMESTAMP,
        editedAt: SAMPLE_TIMESTAMP,
      },
    },
  },
  'ticket.thread_deleted': {
    ...envelope('ticket.thread_deleted', 'evt_sample_ticket_thread_deleted'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      threadId: 'thread_sample',
      audience: 'public',
      sharedWithTeamId: null,
      deletedByPrincipalId: 'principal_sample_agent',
    },
  },
  'ticket.participant_added': {
    ...envelope('ticket.participant_added', 'evt_sample_ticket_participant_added'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      addedPrincipalId: 'principal_sample_observer',
      role: 'cc',
    },
  },
  'ticket.participant_removed': {
    ...envelope('ticket.participant_removed', 'evt_sample_ticket_participant_removed'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      removedPrincipalId: 'principal_sample_observer',
    },
  },
  'ticket.shared': {
    ...envelope('ticket.shared', 'evt_sample_ticket_shared'),
    data: { ticket: SAMPLE_TICKET_REF, teamId: 'team_sample_partner', accessLevel: 'read' },
  },
  'ticket.unshared': {
    ...envelope('ticket.unshared', 'evt_sample_ticket_unshared'),
    data: { ticket: SAMPLE_TICKET_REF, teamId: 'team_sample_partner' },
  },
  'ticket.sla_warning': {
    ...envelope('ticket.sla_warning', 'evt_sample_ticket_sla_warning'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      kind: 'first_response',
      ruleName: 'Default first-response SLA',
    },
  },
  'ticket.sla_breach': {
    ...envelope('ticket.sla_breach', 'evt_sample_ticket_sla_breach'),
    data: { ticket: SAMPLE_TICKET_REF, kind: 'first_response' },
  },
  'ticket.attachment_added': {
    ...envelope('ticket.attachment_added', 'evt_sample_ticket_attachment_added'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      attachment: {
        id: 'tatt_sample',
        threadId: 'thread_sample',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        sizeBytes: 12345,
        uploadedByPrincipalId: 'principal_sample_agent',
        publicUrl: 'https://cdn.example.test/sample.png',
      },
    },
  },
  'ticket.attachment_removed': {
    ...envelope('ticket.attachment_removed', 'evt_sample_ticket_attachment_removed'),
    data: {
      ticket: SAMPLE_TICKET_REF,
      attachment: {
        id: 'tatt_sample',
        threadId: 'thread_sample',
        filename: 'screenshot.png',
      },
      removedByPrincipalId: 'principal_sample_agent',
    },
  },
  'inbox.created': {
    ...envelope('inbox.created', 'evt_sample_inbox_created'),
    data: { inbox: SAMPLE_INBOX_REF },
  },
  'inbox.updated': {
    ...envelope('inbox.updated', 'evt_sample_inbox_updated'),
    data: {
      inbox: { ...SAMPLE_INBOX_REF, name: 'Support (renamed)' },
      changedFields: ['name'],
    },
  },
  'inbox.archived': {
    ...envelope('inbox.archived', 'evt_sample_inbox_archived'),
    data: {
      inbox: { ...SAMPLE_INBOX_REF, archivedAt: SAMPLE_TIMESTAMP },
    },
  },
  'inbox.unarchived': {
    ...envelope('inbox.unarchived', 'evt_sample_inbox_unarchived'),
    data: { inbox: SAMPLE_INBOX_REF },
  },
  'team.created': {
    ...envelope('team.created', 'evt_sample_team_created'),
    data: { team: SAMPLE_TEAM_REF },
  },
  'team.updated': {
    ...envelope('team.updated', 'evt_sample_team_updated'),
    data: {
      team: { ...SAMPLE_TEAM_REF, color: '#0ea5e9' },
      changedFields: ['color'],
    },
  },
  'team.archived': {
    ...envelope('team.archived', 'evt_sample_team_archived'),
    data: {
      team: { ...SAMPLE_TEAM_REF, archivedAt: SAMPLE_TIMESTAMP },
    },
  },
  'ticket_status.created': {
    ...envelope('ticket_status.created', 'evt_sample_ticket_status_created'),
    data: { status: SAMPLE_TICKET_STATUS_REF },
  },
  'ticket_status.updated': {
    ...envelope('ticket_status.updated', 'evt_sample_ticket_status_updated'),
    data: {
      status: { ...SAMPLE_TICKET_STATUS_REF, name: 'Open (renamed)' },
      changedFields: ['name'],
    },
  },
  'contact.created': {
    ...envelope('contact.created', 'evt_sample_contact_created'),
    data: { contact: SAMPLE_CONTACT_REF },
  },
  'contact.updated': {
    ...envelope('contact.updated', 'evt_sample_contact_updated'),
    data: {
      contact: { ...SAMPLE_CONTACT_REF, title: 'Senior Customer' },
      changedFields: ['title'],
    },
  },
  'contact.archived': {
    ...envelope('contact.archived', 'evt_sample_contact_archived'),
    data: {
      contact: { ...SAMPLE_CONTACT_REF, archivedAt: SAMPLE_TIMESTAMP },
    },
  },
  'contact.linked': {
    ...envelope('contact.linked', 'evt_sample_contact_linked'),
    data: {
      contact: SAMPLE_CONTACT_REF,
      userId: 'user_sample_portal',
      linkedByPrincipalId: 'principal_sample_agent',
    },
  },
  'contact.unlinked': {
    ...envelope('contact.unlinked', 'evt_sample_contact_unlinked'),
    data: {
      contact: SAMPLE_CONTACT_REF,
      userId: 'user_sample_portal',
    },
  },
  'organization.created': {
    ...envelope('organization.created', 'evt_sample_organization_created'),
    data: { organization: SAMPLE_ORG_REF },
  },
  'organization.updated': {
    ...envelope('organization.updated', 'evt_sample_organization_updated'),
    data: {
      organization: { ...SAMPLE_ORG_REF, name: 'Sample Org (renamed)' },
      changedFields: ['name'],
    },
  },
  'organization.archived': {
    ...envelope('organization.archived', 'evt_sample_organization_archived'),
    data: {
      organization: { ...SAMPLE_ORG_REF, archivedAt: SAMPLE_TIMESTAMP },
    },
  },
  'organization.unarchived': {
    ...envelope('organization.unarchived', 'evt_sample_organization_unarchived'),
    data: { organization: SAMPLE_ORG_REF },
  },
  'conversation.created': {
    ...envelope('conversation.created', 'evt_sample_conversation_created'),
    data: { conversation: SAMPLE_CONVERSATION_DATA },
  },
  'conversation.status_changed': {
    ...envelope('conversation.status_changed', 'evt_sample_conversation_status_changed'),
    data: {
      conversation: SAMPLE_CONVERSATION_REF,
      previousStatus: 'open',
      newStatus: 'pending',
    },
  },
  'conversation.assigned': {
    ...envelope('conversation.assigned', 'evt_sample_conversation_assigned'),
    data: {
      conversation: SAMPLE_CONVERSATION_REF,
      assignedAgentPrincipalId: 'principal_sample_agent',
      previousAgentPrincipalId: null,
    },
  },
  'conversation.priority_changed': {
    ...envelope('conversation.priority_changed', 'evt_sample_conversation_priority_changed'),
    data: {
      conversation: SAMPLE_CONVERSATION_REF,
      previousPriority: 'medium',
      newPriority: 'high',
    },
  },
  'conversation.csat_submitted': {
    ...envelope('conversation.csat_submitted', 'evt_sample_conversation_csat_submitted'),
    data: {
      conversation: SAMPLE_CONVERSATION_REF,
      rating: 5,
      comment: 'Great support, thank you!',
      submittedAt: SAMPLE_TIMESTAMP,
    },
  },
  'message.created': {
    ...envelope('message.created', 'evt_sample_message_created'),
    data: {
      message: SAMPLE_MESSAGE_DATA,
      conversation: SAMPLE_CONVERSATION_REF,
    },
  },
  'message.note_created': {
    ...envelope('message.note_created', 'evt_sample_message_note_created'),
    data: {
      message: {
        ...SAMPLE_MESSAGE_DATA,
        id: 'msg_sample_note',
        senderType: 'agent',
        authorPrincipalId: 'principal_sample_agent',
        authorName: 'Sample Agent',
        authorEmail: '[email protected]',
        content: 'Internal note — visitor mentioned a billing issue.',
      },
      conversation: SAMPLE_CONVERSATION_REF,
    },
  },
  'message.deleted': {
    ...envelope('message.deleted', 'evt_sample_message_deleted'),
    data: {
      message: { id: 'msg_sample', conversationId: 'conv_sample' },
      conversation: SAMPLE_CONVERSATION_REF,
    },
  },
  'help_center.category.created': {
    ...envelope('help_center.category.created', 'evt_sample_help_center_category_created'),
    data: { category: SAMPLE_HELP_CENTER_CATEGORY_REF },
  },
  'help_center.category.updated': {
    ...envelope('help_center.category.updated', 'evt_sample_help_center_category_updated'),
    data: {
      category: { ...SAMPLE_HELP_CENTER_CATEGORY_REF, name: 'Getting Started (renamed)' },
      changedFields: ['name'],
    },
  },
  'help_center.category.deleted': {
    ...envelope('help_center.category.deleted', 'evt_sample_help_center_category_deleted'),
    data: { category: SAMPLE_HELP_CENTER_CATEGORY_REF },
  },
  'help_center.article.created': {
    ...envelope('help_center.article.created', 'evt_sample_help_center_article_created'),
    data: { article: { ...SAMPLE_HELP_CENTER_ARTICLE_REF, publishedAt: null } },
  },
  'help_center.article.updated': {
    ...envelope('help_center.article.updated', 'evt_sample_help_center_article_updated'),
    data: {
      article: { ...SAMPLE_HELP_CENTER_ARTICLE_REF, title: 'How to get started (revised)' },
      changedFields: ['title'],
    },
  },
  'help_center.article.published': {
    ...envelope('help_center.article.published', 'evt_sample_help_center_article_published'),
    data: { article: SAMPLE_HELP_CENTER_ARTICLE_REF },
  },
  'help_center.article.unpublished': {
    ...envelope('help_center.article.unpublished', 'evt_sample_help_center_article_unpublished'),
    data: { article: { ...SAMPLE_HELP_CENTER_ARTICLE_REF, publishedAt: null } },
  },
  'help_center.article.deleted': {
    ...envelope('help_center.article.deleted', 'evt_sample_help_center_article_deleted'),
    data: { article: SAMPLE_HELP_CENTER_ARTICLE_REF },
  },
  'changelog.created': {
    ...envelope('changelog.created', 'evt_sample_changelog_created'),
    data: { changelog: { ...SAMPLE_CHANGELOG_REF, publishedAt: null, linkedPostCount: 0 } },
  },
  'changelog.updated': {
    ...envelope('changelog.updated', 'evt_sample_changelog_updated'),
    data: {
      changelog: { ...SAMPLE_CHANGELOG_REF, title: 'Sample release (revised)' },
      changedFields: ['title'],
    },
  },
  'changelog.deleted': {
    ...envelope('changelog.deleted', 'evt_sample_changelog_deleted'),
    data: { changelog: SAMPLE_CHANGELOG_REF },
  },
  'segment.created': {
    ...envelope('segment.created', 'evt_sample_segment_created'),
    data: { segment: SAMPLE_SEGMENT_REF },
  },
  'segment.updated': {
    ...envelope('segment.updated', 'evt_sample_segment_updated'),
    data: {
      segment: { ...SAMPLE_SEGMENT_REF, name: 'Power Users (renamed)' },
      changedFields: ['name'],
    },
  },
  'segment.deleted': {
    ...envelope('segment.deleted', 'evt_sample_segment_deleted'),
    data: { segment: SAMPLE_SEGMENT_REF },
  },
  'user_attribute.created': {
    ...envelope('user_attribute.created', 'evt_sample_user_attribute_created'),
    data: { attribute: SAMPLE_USER_ATTRIBUTE_REF },
  },
  'user_attribute.updated': {
    ...envelope('user_attribute.updated', 'evt_sample_user_attribute_updated'),
    data: {
      attribute: { ...SAMPLE_USER_ATTRIBUTE_REF, label: 'Plan Tier (renamed)' },
      changedFields: ['label'],
    },
  },
  'user_attribute.deleted': {
    ...envelope('user_attribute.deleted', 'evt_sample_user_attribute_deleted'),
    data: { attribute: SAMPLE_USER_ATTRIBUTE_REF },
  },

  // Feedback configuration
  'board.created': {
    ...envelope('board.created', 'evt_sample_board_created'),
    data: { board: SAMPLE_BOARD_REF },
  },
  'board.updated': {
    ...envelope('board.updated', 'evt_sample_board_updated'),
    data: { board: { ...SAMPLE_BOARD_REF, name: 'Ideas' }, changedFields: ['name'] },
  },
  'board.deleted': {
    ...envelope('board.deleted', 'evt_sample_board_deleted'),
    data: { board: SAMPLE_BOARD_REF },
  },
  'tag.created': {
    ...envelope('tag.created', 'evt_sample_tag_created'),
    data: { tag: SAMPLE_TAG_REF },
  },
  'tag.updated': {
    ...envelope('tag.updated', 'evt_sample_tag_updated'),
    data: { tag: { ...SAMPLE_TAG_REF, name: 'defect' }, changedFields: ['name'] },
  },
  'tag.deleted': {
    ...envelope('tag.deleted', 'evt_sample_tag_deleted'),
    data: { tag: SAMPLE_TAG_REF },
  },
  'status.created': {
    ...envelope('status.created', 'evt_sample_status_created'),
    data: { status: SAMPLE_STATUS_REF },
  },
  'status.updated': {
    ...envelope('status.updated', 'evt_sample_status_updated'),
    data: { status: { ...SAMPLE_STATUS_REF, name: 'In Progress' }, changedFields: ['name'] },
  },
  'status.deleted': {
    ...envelope('status.deleted', 'evt_sample_status_deleted'),
    data: { status: SAMPLE_STATUS_REF },
  },
  'roadmap.created': {
    ...envelope('roadmap.created', 'evt_sample_roadmap_created'),
    data: { roadmap: SAMPLE_ROADMAP_REF },
  },
  'roadmap.updated': {
    ...envelope('roadmap.updated', 'evt_sample_roadmap_updated'),
    data: { roadmap: { ...SAMPLE_ROADMAP_REF, isPublic: false }, changedFields: ['isPublic'] },
  },
  'roadmap.deleted': {
    ...envelope('roadmap.deleted', 'evt_sample_roadmap_deleted'),
    data: { roadmap: SAMPLE_ROADMAP_REF },
  },

  // Support configuration
  'sla_policy.created': {
    ...envelope('sla_policy.created', 'evt_sample_sla_policy_created'),
    data: { policy: SAMPLE_SLA_POLICY_REF },
  },
  'sla_policy.updated': {
    ...envelope('sla_policy.updated', 'evt_sample_sla_policy_updated'),
    data: { policy: { ...SAMPLE_SLA_POLICY_REF, enabled: false }, changedFields: ['enabled'] },
  },
  'sla_policy.archived': {
    ...envelope('sla_policy.archived', 'evt_sample_sla_policy_archived'),
    data: { policy: { ...SAMPLE_SLA_POLICY_REF, archivedAt: SAMPLE_TIMESTAMP } },
  },
  'routing_rule.created': {
    ...envelope('routing_rule.created', 'evt_sample_routing_rule_created'),
    data: { rule: SAMPLE_ROUTING_RULE_REF },
  },
  'routing_rule.updated': {
    ...envelope('routing_rule.updated', 'evt_sample_routing_rule_updated'),
    data: { rule: { ...SAMPLE_ROUTING_RULE_REF, enabled: false }, changedFields: ['enabled'] },
  },
  'routing_rule.deleted': {
    ...envelope('routing_rule.deleted', 'evt_sample_routing_rule_deleted'),
    data: { rule: SAMPLE_ROUTING_RULE_REF },
  },
  'business_hours.created': {
    ...envelope('business_hours.created', 'evt_sample_business_hours_created'),
    data: { businessHours: SAMPLE_BUSINESS_HOURS_REF },
  },
  'business_hours.updated': {
    ...envelope('business_hours.updated', 'evt_sample_business_hours_updated'),
    data: {
      businessHours: { ...SAMPLE_BUSINESS_HOURS_REF, name: 'Weekdays 8-6' },
      changedFields: ['name'],
    },
  },
  'business_hours.archived': {
    ...envelope('business_hours.archived', 'evt_sample_business_hours_archived'),
    data: { businessHours: { ...SAMPLE_BUSINESS_HOURS_REF, archivedAt: SAMPLE_TIMESTAMP } },
  },
  'inbox_channel.created': {
    ...envelope('inbox_channel.created', 'evt_sample_inbox_channel_created'),
    data: { channel: SAMPLE_INBOX_CHANNEL_REF },
  },
  'inbox_channel.updated': {
    ...envelope('inbox_channel.updated', 'evt_sample_inbox_channel_updated'),
    data: { channel: { ...SAMPLE_INBOX_CHANNEL_REF, enabled: false }, changedFields: ['enabled'] },
  },
  'inbox_channel.archived': {
    ...envelope('inbox_channel.archived', 'evt_sample_inbox_channel_archived'),
    data: { channel: { ...SAMPLE_INBOX_CHANNEL_REF, archivedAt: SAMPLE_TIMESTAMP } },
  },
  'inbox_membership.added': {
    ...envelope('inbox_membership.added', 'evt_sample_inbox_membership_added'),
    data: { membership: SAMPLE_INBOX_MEMBERSHIP_REF },
  },
  'inbox_membership.updated': {
    ...envelope('inbox_membership.updated', 'evt_sample_inbox_membership_updated'),
    data: { membership: { ...SAMPLE_INBOX_MEMBERSHIP_REF, role: 'owner' }, previousRole: 'agent' },
  },
  'inbox_membership.removed': {
    ...envelope('inbox_membership.removed', 'evt_sample_inbox_membership_removed'),
    data: { membership: SAMPLE_INBOX_MEMBERSHIP_REF },
  },

  // Administration
  'api_key.created': {
    ...envelope('api_key.created', 'evt_sample_api_key_created'),
    data: { apiKey: SAMPLE_API_KEY_REF },
  },
  'api_key.rotated': {
    ...envelope('api_key.rotated', 'evt_sample_api_key_rotated'),
    data: { apiKey: SAMPLE_API_KEY_REF },
  },
  'api_key.revoked': {
    ...envelope('api_key.revoked', 'evt_sample_api_key_revoked'),
    data: { apiKey: SAMPLE_API_KEY_REF },
  },
  'role.created': {
    ...envelope('role.created', 'evt_sample_role_created'),
    data: { role: SAMPLE_ROLE_REF },
  },
  'role.updated': {
    ...envelope('role.updated', 'evt_sample_role_updated'),
    data: { role: { ...SAMPLE_ROLE_REF, name: 'Billing Lead' }, changedFields: ['name'] },
  },
  'role.deleted': {
    ...envelope('role.deleted', 'evt_sample_role_deleted'),
    data: { role: SAMPLE_ROLE_REF },
  },
  'role_assignment.created': {
    ...envelope('role_assignment.created', 'evt_sample_role_assignment_created'),
    data: { assignment: SAMPLE_ROLE_ASSIGNMENT_REF },
  },
  'role_assignment.revoked': {
    ...envelope('role_assignment.revoked', 'evt_sample_role_assignment_revoked'),
    data: { assignment: SAMPLE_ROLE_ASSIGNMENT_REF },
  },
}

/**
 * Returns the canonical sample event payload for a given event type. Returned
 * objects are shared, deeply-frozen at module init — callers must NOT mutate
 * (use structuredClone if you need to tweak fields like `id` for a test fire).
 */
export function getSampleEventPayload(type: EventType): EventData {
  return SAMPLES[type]!
}

/** All samples keyed by event type (for the GET preview endpoint). */
export function getAllSampleEventPayloads(): Partial<Record<EventType, EventData>> {
  return SAMPLES
}

/** Stable prefix every test-fire / sample event id starts with. */
export const SAMPLE_EVENT_ID_PREFIX = 'evt_sample_'
/** Prefix for event ids generated by the test-fire endpoint at runtime. */
export const TEST_FIRE_EVENT_ID_PREFIX = 'evt_test_'
