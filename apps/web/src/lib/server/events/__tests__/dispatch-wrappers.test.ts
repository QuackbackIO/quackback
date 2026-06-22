import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as dispatch from '../dispatch'
import type {
  EventActor,
  EventApiKeyRef,
  EventBoardRef,
  EventBusinessHoursRef,
  EventChangelogRef,
  EventContactRef,
  EventConversationRef,
  EventHelpCenterArticleRef,
  EventHelpCenterCategoryRef,
  EventInboxChannelRef,
  EventInboxMembershipRef,
  EventInboxRef,
  EventOrganizationRef,
  EventRoadmapRef,
  EventRoleAssignmentRef,
  EventRoleRef,
  EventRoutingRuleRef,
  EventSegmentRef,
  EventSlaPolicyRef,
  EventStatusRef,
  EventTagRef,
  EventTeamRef,
  EventTicketStatusRef,
  EventUserAttributeRef,
} from '../types'

const processEvent = vi.fn()
const getHookTargets = vi.fn()
const emailHookRun = vi.fn()
const logDebug = vi.fn()
const logError = vi.fn()

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      debug: (...args: unknown[]) => logDebug(...args),
      error: (...args: unknown[]) => logError(...args),
    }),
  },
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://example.test',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketStatuses: { findFirst: vi.fn() },
      inboxes: { findFirst: vi.fn() },
      teams: { findFirst: vi.fn() },
      contacts: { findFirst: vi.fn() },
      organizations: { findFirst: vi.fn() },
    },
  },
  eq: vi.fn(),
  ticketStatuses: { id: 'ticketStatuses.id' },
  inboxes: { id: 'inboxes.id' },
  teams: { id: 'teams.id' },
  contacts: { id: 'contacts.id' },
  organizations: { id: 'organizations.id' },
}))

vi.mock('../process', () => ({
  processEvent: (...args: unknown[]) => processEvent(...args),
}))

vi.mock('../targets', () => ({
  getHookTargets: (...args: unknown[]) => getHookTargets(...args),
}))

vi.mock('../handlers/email', () => ({
  emailHook: {
    run: (...args: unknown[]) => emailHookRun(...args),
  },
}))

const actor: EventActor = {
  type: 'user',
  principalId: 'principal_admin',
  userId: 'user_admin',
  displayName: 'Admin User',
}

interface CapturedEvent {
  id: string
  timestamp: string
  type: string
  actor: EventActor
  data: Record<string, unknown>
  syncSourceIntegrationId?: string
}

function lastEvent(): CapturedEvent {
  expect(processEvent).toHaveBeenCalledTimes(1)
  return processEvent.mock.calls[0]?.[0] as CapturedEvent
}

async function expectDispatched(
  run: () => Promise<void>,
  expected: {
    type: string
    data: Record<string, unknown>
    syncSourceIntegrationId?: string
  }
) {
  await run()
  const event = lastEvent()
  expect(event).toMatchObject({
    type: expected.type,
    actor,
    data: expected.data,
  })
  expect(typeof event.id).toBe('string')
  expect(typeof event.timestamp).toBe('string')
  if (expected.syncSourceIntegrationId) {
    expect(event.syncSourceIntegrationId).toBe(expected.syncSourceIntegrationId)
  } else {
    expect(event.syncSourceIntegrationId).toBeUndefined()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  processEvent.mockResolvedValue(undefined)
  getHookTargets.mockResolvedValue([])
  emailHookRun.mockResolvedValue(undefined)
})

const inbox: EventInboxRef = {
  id: 'inbox_1',
  slug: 'support',
  name: 'Support',
  description: null,
  primaryTeamId: 'team_1',
  defaultVisibilityScope: 'team',
  defaultPriority: 'normal',
  defaultStatusId: 'ticket_status_open',
  color: '#0f766e',
  icon: 'inbox',
  archivedAt: null,
}

const team: EventTeamRef = {
  id: 'team_1',
  slug: 'support',
  name: 'Support',
  description: null,
  shortLabel: 'SUP',
  color: '#0f766e',
  archivedAt: null,
}

const ticketStatus: EventTicketStatusRef = {
  id: 'ticket_status_open',
  slug: 'open',
  name: 'Open',
  color: '#16a34a',
  category: 'open',
  position: 1,
  isDefault: true,
  isSystem: true,
  deletedAt: null,
}

const contact: EventContactRef = {
  id: 'contact_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  title: 'CTO',
  externalId: null,
  organizationId: 'org_1',
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const organization: EventOrganizationRef = {
  id: 'org_1',
  name: 'Acme',
  domain: 'acme.com',
  website: 'https://acme.com',
  externalId: null,
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const category: EventHelpCenterCategoryRef = {
  id: 'help_category_1',
  slug: 'billing',
  name: 'Billing',
  parentId: null,
  isPublic: true,
  visibility: 'public',
  position: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const article: EventHelpCenterArticleRef = {
  id: 'help_article_1',
  categoryId: 'help_category_1',
  slug: 'billing-faq',
  title: 'Billing FAQ',
  authorPrincipalId: 'principal_admin',
  publishedAt: '2026-06-02T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const changelog: EventChangelogRef = {
  id: 'changelog_1',
  title: 'Release',
  contentPreview: 'New ticketing tools',
  categoryId: 'category_1',
  productId: 'product_1',
  publishedAt: '2026-06-02T00:00:00.000Z',
  linkedPostCount: 2,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const segment: EventSegmentRef = {
  id: 'segment_1',
  slug: 'enterprise',
  name: 'Enterprise',
  type: 'dynamic',
  color: '#2563eb',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const attribute: EventUserAttributeRef = {
  id: 'attribute_1',
  key: 'plan',
  label: 'Plan',
  type: 'string',
  currencyCode: null,
  externalKey: 'plan',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const board: EventBoardRef = {
  id: 'board_1',
  slug: 'ideas',
  name: 'Ideas',
  description: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const tag: EventTagRef = {
  id: 'tag_1',
  name: 'Priority',
  color: '#f97316',
  description: null,
  createdAt: '2026-06-01T00:00:00.000Z',
}

const status: EventStatusRef = {
  id: 'status_1',
  slug: 'planned',
  name: 'Planned',
  color: '#16a34a',
  category: 'planned',
  position: 1,
  showOnRoadmap: true,
  isDefault: false,
  createdAt: '2026-06-01T00:00:00.000Z',
}

const roadmap: EventRoadmapRef = {
  id: 'roadmap_1',
  slug: 'public',
  name: 'Public roadmap',
  description: null,
  isPublic: true,
  position: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const policy: EventSlaPolicyRef = {
  id: 'sla_policy_1',
  name: 'Gold support',
  scope: 'inbox',
  enabled: true,
  priority: 1,
  archivedAt: null,
}

const rule: EventRoutingRuleRef = {
  id: 'routing_rule_1',
  name: 'Billing routing',
  enabled: true,
  priority: 1,
  inboxIdScope: 'inbox_1',
}

const businessHours: EventBusinessHoursRef = {
  id: 'business_hours_1',
  name: 'Weekdays',
  timezone: 'Europe/Berlin',
  archivedAt: null,
}

const channel: EventInboxChannelRef = {
  id: 'inbox_channel_1',
  inboxId: 'inbox_1',
  kind: 'email',
  label: 'Support email',
  externalId: 'support@example.com',
  enabled: true,
  archivedAt: null,
}

const membership: EventInboxMembershipRef = {
  id: 'inbox_membership_1',
  inboxId: 'inbox_1',
  principalId: 'principal_agent',
  role: 'agent',
}

const apiKey: EventApiKeyRef = {
  id: 'api_key_1',
  name: 'Reporting',
  scopes: ['tickets:read'],
}

const role: EventRoleRef = {
  id: 'role_1',
  key: 'support_agent',
  name: 'Support agent',
  isSystem: false,
}

const assignment: EventRoleAssignmentRef = {
  id: 'role_assignment_1',
  roleId: 'role_1',
  roleKey: 'support_agent',
  principalId: 'principal_agent',
  teamId: 'team_1',
}

const conversation: EventConversationRef = {
  id: 'conversation_1',
  status: 'open',
  channel: 'live_chat',
  priority: 'medium',
}

const bareTicket = {
  id: 'ticket_1',
  subject: 'Billing question',
  descriptionText: 'Please check the invoice.',
  statusId: null,
  statusCategory: 'open',
  priority: 'normal',
  channel: 'email',
  visibility: 'team',
  inboxId: null,
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: null,
  requesterContactId: null,
  organizationId: null,
}

describe('configuration, content, and security event dispatch wrappers', () => {
  const cases: Array<{
    name: string
    run: () => Promise<void>
    type: string
    data: Record<string, unknown>
  }> = [
    {
      name: 'post.mentioned',
      run: () =>
        dispatch.dispatchPostMentioned(actor, {
          postId: 'post_1',
          postTitle: 'Import CSV support',
          postUrl: 'https://example.test/p/import-csv',
          mentionedPrincipalId: 'principal_mentioned',
          mentioningPrincipalId: 'principal_admin',
          excerpt: 'cc @support',
        }),
      type: 'post.mentioned',
      data: {
        postId: 'post_1',
        postTitle: 'Import CSV support',
        postUrl: 'https://example.test/p/import-csv',
        mentionedPrincipalId: 'principal_mentioned',
        mentioningPrincipalId: 'principal_admin',
        excerpt: 'cc @support',
      },
    },
    {
      name: 'conversation.assigned',
      run: () =>
        dispatch.dispatchConversationAssigned(
          actor,
          conversation,
          'principal_previous',
          'principal_next'
        ),
      type: 'conversation.assigned',
      data: {
        conversation,
        previousAgentPrincipalId: 'principal_previous',
        assignedAgentPrincipalId: 'principal_next',
      },
    },
    {
      name: 'conversation.priority_changed',
      run: () =>
        dispatch.dispatchConversationPriorityChanged(actor, conversation, 'medium', 'urgent'),
      type: 'conversation.priority_changed',
      data: { conversation, previousPriority: 'medium', newPriority: 'urgent' },
    },
    {
      name: 'message.deleted',
      run: () =>
        dispatch.dispatchMessageDeleted(
          actor,
          { id: 'message_1', conversationId: 'conversation_1' },
          conversation
        ),
      type: 'message.deleted',
      data: { message: { id: 'message_1', conversationId: 'conversation_1' }, conversation },
    },
    {
      name: 'inbox.created',
      run: () => dispatch.dispatchInboxCreated(actor, inbox),
      type: 'inbox.created',
      data: { inbox },
    },
    {
      name: 'inbox.updated',
      run: () => dispatch.dispatchInboxUpdated(actor, inbox, ['name']),
      type: 'inbox.updated',
      data: { inbox, changedFields: ['name'] },
    },
    {
      name: 'inbox.archived',
      run: () => dispatch.dispatchInboxArchived(actor, inbox),
      type: 'inbox.archived',
      data: { inbox },
    },
    {
      name: 'inbox.unarchived',
      run: () => dispatch.dispatchInboxUnarchived(actor, inbox),
      type: 'inbox.unarchived',
      data: { inbox },
    },
    {
      name: 'team.created',
      run: () => dispatch.dispatchTeamCreated(actor, team),
      type: 'team.created',
      data: { team },
    },
    {
      name: 'team.updated',
      run: () => dispatch.dispatchTeamUpdated(actor, team, ['color']),
      type: 'team.updated',
      data: { team, changedFields: ['color'] },
    },
    {
      name: 'team.archived',
      run: () => dispatch.dispatchTeamArchived(actor, team),
      type: 'team.archived',
      data: { team },
    },
    {
      name: 'ticket_status.created',
      run: () => dispatch.dispatchTicketStatusCreated(actor, ticketStatus),
      type: 'ticket_status.created',
      data: { status: ticketStatus },
    },
    {
      name: 'ticket_status.updated',
      run: () => dispatch.dispatchTicketStatusUpdated(actor, ticketStatus, ['position']),
      type: 'ticket_status.updated',
      data: { status: ticketStatus, changedFields: ['position'] },
    },
    {
      name: 'contact.created',
      run: () => dispatch.dispatchContactCreated(actor, contact),
      type: 'contact.created',
      data: { contact },
    },
    {
      name: 'contact.updated',
      run: () => dispatch.dispatchContactUpdated(actor, contact, ['email']),
      type: 'contact.updated',
      data: { contact, changedFields: ['email'] },
    },
    {
      name: 'contact.archived',
      run: () => dispatch.dispatchContactArchived(actor, contact),
      type: 'contact.archived',
      data: { contact },
    },
    {
      name: 'contact.linked',
      run: () => dispatch.dispatchContactLinked(actor, contact, 'user_linked', 'principal_admin'),
      type: 'contact.linked',
      data: { contact, userId: 'user_linked', linkedByPrincipalId: 'principal_admin' },
    },
    {
      name: 'contact.unlinked',
      run: () => dispatch.dispatchContactUnlinked(actor, contact, 'user_linked'),
      type: 'contact.unlinked',
      data: { contact, userId: 'user_linked' },
    },
    {
      name: 'organization.created',
      run: () => dispatch.dispatchOrganizationCreated(actor, organization),
      type: 'organization.created',
      data: { organization },
    },
    {
      name: 'organization.updated',
      run: () => dispatch.dispatchOrganizationUpdated(actor, organization, ['domain']),
      type: 'organization.updated',
      data: { organization, changedFields: ['domain'] },
    },
    {
      name: 'organization.archived',
      run: () => dispatch.dispatchOrganizationArchived(actor, organization),
      type: 'organization.archived',
      data: { organization },
    },
    {
      name: 'organization.unarchived',
      run: () => dispatch.dispatchOrganizationUnarchived(actor, organization),
      type: 'organization.unarchived',
      data: { organization },
    },
    {
      name: 'help_center.category.created',
      run: () => dispatch.dispatchHelpCenterCategoryCreated(actor, category),
      type: 'help_center.category.created',
      data: { category },
    },
    {
      name: 'help_center.category.updated',
      run: () => dispatch.dispatchHelpCenterCategoryUpdated(actor, category, ['visibility']),
      type: 'help_center.category.updated',
      data: { category, changedFields: ['visibility'] },
    },
    {
      name: 'help_center.category.deleted',
      run: () => dispatch.dispatchHelpCenterCategoryDeleted(actor, category),
      type: 'help_center.category.deleted',
      data: { category },
    },
    {
      name: 'help_center.article.created',
      run: () => dispatch.dispatchHelpCenterArticleCreated(actor, article),
      type: 'help_center.article.created',
      data: { article },
    },
    {
      name: 'help_center.article.updated',
      run: () => dispatch.dispatchHelpCenterArticleUpdated(actor, article, ['title']),
      type: 'help_center.article.updated',
      data: { article, changedFields: ['title'] },
    },
    {
      name: 'help_center.article.published',
      run: () => dispatch.dispatchHelpCenterArticlePublished(actor, article),
      type: 'help_center.article.published',
      data: { article },
    },
    {
      name: 'help_center.article.unpublished',
      run: () => dispatch.dispatchHelpCenterArticleUnpublished(actor, article),
      type: 'help_center.article.unpublished',
      data: { article },
    },
    {
      name: 'help_center.article.deleted',
      run: () => dispatch.dispatchHelpCenterArticleDeleted(actor, article),
      type: 'help_center.article.deleted',
      data: { article },
    },
    {
      name: 'changelog.created',
      run: () => dispatch.dispatchChangelogCreated(actor, changelog),
      type: 'changelog.created',
      data: { changelog },
    },
    {
      name: 'changelog.updated',
      run: () => dispatch.dispatchChangelogUpdated(actor, changelog, ['productId']),
      type: 'changelog.updated',
      data: { changelog, changedFields: ['productId'] },
    },
    {
      name: 'changelog.deleted',
      run: () => dispatch.dispatchChangelogDeleted(actor, changelog),
      type: 'changelog.deleted',
      data: { changelog },
    },
    {
      name: 'segment.created',
      run: () => dispatch.dispatchSegmentCreated(actor, segment),
      type: 'segment.created',
      data: { segment },
    },
    {
      name: 'segment.updated',
      run: () => dispatch.dispatchSegmentUpdated(actor, segment, ['name']),
      type: 'segment.updated',
      data: { segment, changedFields: ['name'] },
    },
    {
      name: 'segment.deleted',
      run: () => dispatch.dispatchSegmentDeleted(actor, segment),
      type: 'segment.deleted',
      data: { segment },
    },
    {
      name: 'user_attribute.created',
      run: () => dispatch.dispatchUserAttributeCreated(actor, attribute),
      type: 'user_attribute.created',
      data: { attribute },
    },
    {
      name: 'user_attribute.updated',
      run: () => dispatch.dispatchUserAttributeUpdated(actor, attribute, ['label']),
      type: 'user_attribute.updated',
      data: { attribute, changedFields: ['label'] },
    },
    {
      name: 'user_attribute.deleted',
      run: () => dispatch.dispatchUserAttributeDeleted(actor, attribute),
      type: 'user_attribute.deleted',
      data: { attribute },
    },
    {
      name: 'board.created',
      run: () => dispatch.dispatchBoardCreated(actor, board),
      type: 'board.created',
      data: { board },
    },
    {
      name: 'board.updated',
      run: () => dispatch.dispatchBoardUpdated(actor, board, ['name']),
      type: 'board.updated',
      data: { board, changedFields: ['name'] },
    },
    {
      name: 'board.deleted',
      run: () => dispatch.dispatchBoardDeleted(actor, board),
      type: 'board.deleted',
      data: { board },
    },
    {
      name: 'tag.created',
      run: () => dispatch.dispatchTagCreated(actor, tag),
      type: 'tag.created',
      data: { tag },
    },
    {
      name: 'tag.updated',
      run: () => dispatch.dispatchTagUpdated(actor, tag, ['color']),
      type: 'tag.updated',
      data: { tag, changedFields: ['color'] },
    },
    {
      name: 'tag.deleted',
      run: () => dispatch.dispatchTagDeleted(actor, tag),
      type: 'tag.deleted',
      data: { tag },
    },
    {
      name: 'status.created',
      run: () => dispatch.dispatchStatusCreated(actor, status),
      type: 'status.created',
      data: { status },
    },
    {
      name: 'status.updated',
      run: () => dispatch.dispatchStatusUpdated(actor, status, ['showOnRoadmap']),
      type: 'status.updated',
      data: { status, changedFields: ['showOnRoadmap'] },
    },
    {
      name: 'status.deleted',
      run: () => dispatch.dispatchStatusDeleted(actor, status),
      type: 'status.deleted',
      data: { status },
    },
    {
      name: 'roadmap.created',
      run: () => dispatch.dispatchRoadmapCreated(actor, roadmap),
      type: 'roadmap.created',
      data: { roadmap },
    },
    {
      name: 'roadmap.updated',
      run: () => dispatch.dispatchRoadmapUpdated(actor, roadmap, ['isPublic']),
      type: 'roadmap.updated',
      data: { roadmap, changedFields: ['isPublic'] },
    },
    {
      name: 'roadmap.deleted',
      run: () => dispatch.dispatchRoadmapDeleted(actor, roadmap),
      type: 'roadmap.deleted',
      data: { roadmap },
    },
    {
      name: 'sla_policy.created',
      run: () => dispatch.dispatchSlaPolicyCreated(actor, policy),
      type: 'sla_policy.created',
      data: { policy },
    },
    {
      name: 'sla_policy.updated',
      run: () => dispatch.dispatchSlaPolicyUpdated(actor, policy, ['enabled']),
      type: 'sla_policy.updated',
      data: { policy, changedFields: ['enabled'] },
    },
    {
      name: 'sla_policy.archived',
      run: () => dispatch.dispatchSlaPolicyArchived(actor, policy),
      type: 'sla_policy.archived',
      data: { policy },
    },
    {
      name: 'routing_rule.created',
      run: () => dispatch.dispatchRoutingRuleCreated(actor, rule),
      type: 'routing_rule.created',
      data: { rule },
    },
    {
      name: 'routing_rule.updated',
      run: () => dispatch.dispatchRoutingRuleUpdated(actor, rule, ['priority']),
      type: 'routing_rule.updated',
      data: { rule, changedFields: ['priority'] },
    },
    {
      name: 'routing_rule.deleted',
      run: () => dispatch.dispatchRoutingRuleDeleted(actor, rule),
      type: 'routing_rule.deleted',
      data: { rule },
    },
    {
      name: 'business_hours.created',
      run: () => dispatch.dispatchBusinessHoursCreated(actor, businessHours),
      type: 'business_hours.created',
      data: { businessHours },
    },
    {
      name: 'business_hours.updated',
      run: () => dispatch.dispatchBusinessHoursUpdated(actor, businessHours, ['timezone']),
      type: 'business_hours.updated',
      data: { businessHours, changedFields: ['timezone'] },
    },
    {
      name: 'business_hours.archived',
      run: () => dispatch.dispatchBusinessHoursArchived(actor, businessHours),
      type: 'business_hours.archived',
      data: { businessHours },
    },
    {
      name: 'inbox_channel.created',
      run: () => dispatch.dispatchInboxChannelCreated(actor, channel),
      type: 'inbox_channel.created',
      data: { channel },
    },
    {
      name: 'inbox_channel.updated',
      run: () => dispatch.dispatchInboxChannelUpdated(actor, channel, ['enabled']),
      type: 'inbox_channel.updated',
      data: { channel, changedFields: ['enabled'] },
    },
    {
      name: 'inbox_channel.archived',
      run: () => dispatch.dispatchInboxChannelArchived(actor, channel),
      type: 'inbox_channel.archived',
      data: { channel },
    },
    {
      name: 'inbox_membership.added',
      run: () => dispatch.dispatchInboxMembershipAdded(actor, membership),
      type: 'inbox_membership.added',
      data: { membership },
    },
    {
      name: 'inbox_membership.updated',
      run: () => dispatch.dispatchInboxMembershipUpdated(actor, membership, 'viewer'),
      type: 'inbox_membership.updated',
      data: { membership, previousRole: 'viewer' },
    },
    {
      name: 'inbox_membership.removed',
      run: () => dispatch.dispatchInboxMembershipRemoved(actor, membership),
      type: 'inbox_membership.removed',
      data: { membership },
    },
    {
      name: 'api_key.created',
      run: () => dispatch.dispatchApiKeyCreated(actor, apiKey),
      type: 'api_key.created',
      data: { apiKey },
    },
    {
      name: 'api_key.rotated',
      run: () => dispatch.dispatchApiKeyRotated(actor, apiKey),
      type: 'api_key.rotated',
      data: { apiKey },
    },
    {
      name: 'api_key.revoked',
      run: () => dispatch.dispatchApiKeyRevoked(actor, apiKey),
      type: 'api_key.revoked',
      data: { apiKey },
    },
    {
      name: 'role.created',
      run: () => dispatch.dispatchRoleCreated(actor, role),
      type: 'role.created',
      data: { role },
    },
    {
      name: 'role.updated',
      run: () => dispatch.dispatchRoleUpdated(actor, role, ['name']),
      type: 'role.updated',
      data: { role, changedFields: ['name'] },
    },
    {
      name: 'role.deleted',
      run: () => dispatch.dispatchRoleDeleted(actor, role),
      type: 'role.deleted',
      data: { role },
    },
    {
      name: 'role_assignment.created',
      run: () => dispatch.dispatchRoleAssignmentCreated(actor, assignment),
      type: 'role_assignment.created',
      data: { assignment },
    },
    {
      name: 'role_assignment.revoked',
      run: () => dispatch.dispatchRoleAssignmentRevoked(actor, assignment),
      type: 'role_assignment.revoked',
      data: { assignment },
    },
  ]

  it.each(cases)('$name emits the expected envelope', async ({ run, type, data }) => {
    await expectDispatched(run, { type, data })
  })
})

describe('ticket event dispatch wrappers', () => {
  const expectedTicket = expect.objectContaining({
    id: 'ticket_1',
    subject: 'Billing question',
    statusCategory: 'open',
    visibility: 'team',
    ticketUrl: 'https://example.test/admin/tickets/ticket_1',
  })

  const cases: Array<{
    name: string
    run: () => Promise<void>
    type: string
    data: Record<string, unknown>
    syncSourceIntegrationId?: string
  }> = [
    {
      name: 'ticket.assigned',
      run: () =>
        dispatch.dispatchTicketAssigned(actor, bareTicket, 'principal_previous', 'principal_next', {
          syncSourceIntegrationId: 'github_1',
        }),
      type: 'ticket.assigned',
      syncSourceIntegrationId: 'github_1',
      data: {
        ticket: expectedTicket,
        previousAssigneePrincipalId: 'principal_previous',
        newAssigneePrincipalId: 'principal_next',
      },
    },
    {
      name: 'ticket.unassigned',
      run: () => dispatch.dispatchTicketUnassigned(actor, bareTicket, 'principal_previous'),
      type: 'ticket.unassigned',
      data: { ticket: expectedTicket, previousAssigneePrincipalId: 'principal_previous' },
    },
    {
      name: 'ticket.status_changed',
      run: () =>
        dispatch.dispatchTicketStatusChanged(actor, bareTicket, 'open', 'closed', {
          syncSourceIntegrationId: 'zendesk_1',
        }),
      type: 'ticket.status_changed',
      syncSourceIntegrationId: 'zendesk_1',
      data: {
        ticket: expectedTicket,
        previousStatusCategory: 'open',
        newStatusCategory: 'closed',
      },
    },
    {
      name: 'ticket.updated',
      run: () =>
        dispatch.dispatchTicketUpdated(
          actor,
          bareTicket,
          ['priority'],
          { priority: { from: 'normal', to: 'high' } },
          { syncSourceIntegrationId: 'github_1' }
        ),
      type: 'ticket.updated',
      syncSourceIntegrationId: 'github_1',
      data: {
        ticket: expectedTicket,
        changedFields: ['priority'],
        diff: { priority: { from: 'normal', to: 'high' } },
      },
    },
    {
      name: 'ticket.first_response',
      run: () =>
        dispatch.dispatchTicketFirstResponse(
          actor,
          bareTicket,
          'thread_1',
          '2026-06-16T12:00:00.000Z'
        ),
      type: 'ticket.first_response',
      data: {
        ticket: expectedTicket,
        threadId: 'thread_1',
        firstResponseAt: '2026-06-16T12:00:00.000Z',
      },
    },
    {
      name: 'ticket.thread_updated',
      run: () =>
        dispatch.dispatchTicketThreadUpdated(
          actor,
          bareTicket,
          'thread_1',
          'shared_team',
          'team_2',
          {
            bodyTextPreview: 'Preview',
            bodyText: 'Full internal reply',
            bodyTextTruncated: false,
            authorPrincipalId: 'principal_agent',
            isFromRequester: false,
            createdAt: new Date('2026-06-16T12:00:00.000Z'),
            editedAt: new Date('2026-06-16T12:10:00.000Z'),
          }
        ),
      type: 'ticket.thread_updated',
      data: {
        ticket: expectedTicket,
        threadId: 'thread_1',
        audience: 'shared_team',
        sharedWithTeamId: 'team_2',
        thread: {
          id: 'thread_1',
          audience: 'shared_team',
          bodyTextPreview: 'Preview',
          bodyText: 'Full internal reply',
          bodyTextTruncated: false,
          authorPrincipalId: 'principal_agent',
          isFromRequester: false,
          sharedWithTeamId: 'team_2',
          createdAt: '2026-06-16T12:00:00.000Z',
          editedAt: '2026-06-16T12:10:00.000Z',
        },
      },
    },
    {
      name: 'ticket.participant_added',
      run: () => dispatch.dispatchTicketParticipantAdded(actor, bareTicket, 'principal_cc', 'cc'),
      type: 'ticket.participant_added',
      data: { ticket: expectedTicket, addedPrincipalId: 'principal_cc', role: 'cc' },
    },
    {
      name: 'ticket.participant_removed',
      run: () => dispatch.dispatchTicketParticipantRemoved(actor, bareTicket, 'principal_cc'),
      type: 'ticket.participant_removed',
      data: { ticket: expectedTicket, removedPrincipalId: 'principal_cc' },
    },
    {
      name: 'ticket.shared',
      run: () => dispatch.dispatchTicketShared(actor, bareTicket, 'team_2', 'comment'),
      type: 'ticket.shared',
      data: { ticket: expectedTicket, teamId: 'team_2', accessLevel: 'comment' },
    },
    {
      name: 'ticket.unshared',
      run: () => dispatch.dispatchTicketUnshared(actor, bareTicket, 'team_2'),
      type: 'ticket.unshared',
      data: { ticket: expectedTicket, teamId: 'team_2' },
    },
    {
      name: 'ticket.sla_warning',
      run: () => dispatch.dispatchTicketSlaWarning(actor, bareTicket, 'first_response', 'Gold'),
      type: 'ticket.sla_warning',
      data: { ticket: expectedTicket, kind: 'first_response', ruleName: 'Gold' },
    },
    {
      name: 'ticket.sla_breach',
      run: () => dispatch.dispatchTicketSlaBreach(actor, bareTicket, 'resolution'),
      type: 'ticket.sla_breach',
      data: { ticket: expectedTicket, kind: 'resolution' },
    },
    {
      name: 'ticket.restored',
      run: () => dispatch.dispatchTicketRestored(actor, bareTicket, 'principal_admin'),
      type: 'ticket.restored',
      data: { ticket: expectedTicket, restoredByPrincipalId: 'principal_admin' },
    },
    {
      name: 'ticket.attachment_added',
      run: () =>
        dispatch.dispatchTicketAttachmentAdded(actor, bareTicket, {
          id: 'attachment_1',
          threadId: 'thread_1',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          uploadedByPrincipalId: 'principal_admin',
          publicUrl: null,
        }),
      type: 'ticket.attachment_added',
      data: {
        ticket: expectedTicket,
        attachment: {
          id: 'attachment_1',
          threadId: 'thread_1',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          uploadedByPrincipalId: 'principal_admin',
          publicUrl: null,
        },
      },
    },
    {
      name: 'ticket.attachment_removed',
      run: () =>
        dispatch.dispatchTicketAttachmentRemoved(
          actor,
          bareTicket,
          { id: 'attachment_1', threadId: 'thread_1', filename: 'invoice.pdf' },
          'principal_admin'
        ),
      type: 'ticket.attachment_removed',
      data: {
        ticket: expectedTicket,
        attachment: { id: 'attachment_1', threadId: 'thread_1', filename: 'invoice.pdf' },
        removedByPrincipalId: 'principal_admin',
      },
    },
    {
      name: 'ticket.deleted',
      run: () =>
        dispatch.dispatchTicketDeleted(actor, bareTicket, 'principal_admin', {
          syncSourceIntegrationId: 'github_1',
        }),
      type: 'ticket.deleted',
      syncSourceIntegrationId: 'github_1',
      data: { ticket: expectedTicket, deletedByPrincipalId: 'principal_admin' },
    },
  ]

  it.each(cases)('$name emits the expected payload', async (testCase) => {
    await expectDispatched(testCase.run, testCase)
  })
})

describe('dispatch fallback email delivery', () => {
  it('sends email targets synchronously when event processing fails', async () => {
    const target = {
      type: 'email',
      target: { email: 'owner@example.com' },
      config: { subject: 'Fallback delivery' },
    }
    processEvent.mockRejectedValueOnce(new Error('queue unavailable'))
    getHookTargets.mockResolvedValueOnce([
      target,
      { type: 'webhook', target: { url: 'https://example.com/hook' }, config: {} },
    ])

    await dispatch.dispatchBoardCreated(actor, board)

    const event = processEvent.mock.calls[0]?.[0]
    expect(getHookTargets).toHaveBeenCalledWith(event)
    expect(emailHookRun).toHaveBeenCalledWith(event, target.target, target.config)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'board.created' }),
      'failed to process event'
    )
  })
})
