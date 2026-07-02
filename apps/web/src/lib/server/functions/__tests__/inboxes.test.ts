import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxChannelId, InboxId, InboxMembershipId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockCreateInbox: vi.fn(),
  mockUpdateInbox: vi.fn(),
  mockArchiveInbox: vi.fn(),
  mockUnarchiveInbox: vi.fn(),
  mockGetInbox: vi.fn(),
  mockListInboxes: vi.fn(),
  mockAddInboxMembership: vi.fn(),
  mockUpdateInboxMembershipRole: vi.fn(),
  mockRemoveInboxMembership: vi.fn(),
  mockListMembershipsForInbox: vi.fn(),
  mockListInboxRowsForPrincipal: vi.fn(),
  mockAddInboxChannel: vi.fn(),
  mockUpdateInboxChannel: vi.fn(),
  mockArchiveInboxChannel: vi.fn(),
  mockListChannelsForInbox: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

vi.mock('@/lib/server/domains/inboxes', () => ({
  createInbox: (...args: unknown[]) => hoisted.mockCreateInbox(...args),
  updateInbox: (...args: unknown[]) => hoisted.mockUpdateInbox(...args),
  archiveInbox: (...args: unknown[]) => hoisted.mockArchiveInbox(...args),
  unarchiveInbox: (...args: unknown[]) => hoisted.mockUnarchiveInbox(...args),
  getInbox: (...args: unknown[]) => hoisted.mockGetInbox(...args),
  listInboxes: (...args: unknown[]) => hoisted.mockListInboxes(...args),
  addInboxMembership: (...args: unknown[]) => hoisted.mockAddInboxMembership(...args),
  updateInboxMembershipRole: (...args: unknown[]) => hoisted.mockUpdateInboxMembershipRole(...args),
  removeInboxMembership: (...args: unknown[]) => hoisted.mockRemoveInboxMembership(...args),
  listMembershipsForInbox: (...args: unknown[]) => hoisted.mockListMembershipsForInbox(...args),
  listInboxRowsForPrincipal: (...args: unknown[]) => hoisted.mockListInboxRowsForPrincipal(...args),
  addInboxChannel: (...args: unknown[]) => hoisted.mockAddInboxChannel(...args),
  updateInboxChannel: (...args: unknown[]) => hoisted.mockUpdateInboxChannel(...args),
  archiveInboxChannel: (...args: unknown[]) => hoisted.mockArchiveInboxChannel(...args),
  listChannelsForInbox: (...args: unknown[]) => hoisted.mockListChannelsForInbox(...args),
}))

vi.mock('@/lib/server/db', () => ({
  INBOX_CHANNEL_KINDS: ['email', 'widget', 'api'],
  INBOX_MEMBERSHIP_ROLES: ['owner', 'member', 'viewer'],
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_VISIBILITY_SCOPES: ['workspace', 'team', 'private'],
}))

const PRINCIPAL = 'principal_admin' as PrincipalId
const AGENT = 'principal_agent' as PrincipalId
const INBOX = 'inbox_123' as InboxId
const CHANNEL = 'inbox_channel_123' as InboxChannelId
const MEMBERSHIP = 'inbox_membership_123' as InboxMembershipId

await import('../inboxes')

const [
  listInboxesFn,
  getInboxFn,
  createInboxFn,
  updateInboxFn,
  archiveInboxFn,
  unarchiveInboxFn,
  listInboxChannelsFn,
  addInboxChannelFn,
  updateInboxChannelFn,
  archiveInboxChannelFn,
  listInboxMembershipsFn,
  listMyInboxesFn,
  addInboxMembershipFn,
  updateInboxMembershipRoleFn,
  removeInboxMembershipFn,
] = handlersByIndex

if (!removeInboxMembershipFn) {
  throw new Error(`Inbox handlers were not registered; found ${handlersByIndex.length}`)
}

function inbox(overrides: Record<string, unknown> = {}) {
  return {
    id: INBOX,
    slug: 'support',
    name: 'Support',
    description: null,
    defaultPriority: 'normal',
    defaultVisibilityScope: 'workspace',
    archivedAt: null,
    ...overrides,
  }
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    inboxId: INBOX,
    kind: 'email',
    label: 'Support email',
    config: {},
    externalId: null,
    enabled: true,
    archivedAt: null,
    ...overrides,
  }
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBERSHIP,
    inboxId: INBOX,
    principalId: AGENT,
    role: 'member',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue({
    principal: { id: PRINCIPAL, role: 'admin' },
  })
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('inbox server functions', () => {
  it('lists, fetches, and returns current-principal inboxes with view permission', async () => {
    const row = inbox()
    const rowsForPrincipal = [{ inboxId: INBOX, role: 'owner' }]
    hoisted.mockListInboxes.mockResolvedValue([row])
    hoisted.mockGetInbox.mockResolvedValue(row)
    hoisted.mockListInboxRowsForPrincipal.mockResolvedValue(rowsForPrincipal)

    await expect(listInboxesFn({ data: { includeArchived: true } })).resolves.toEqual([row])
    await expect(getInboxFn({ data: { inboxId: INBOX } })).resolves.toBe(row)
    await expect(listMyInboxesFn({ data: {} })).resolves.toEqual(rowsForPrincipal)

    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.INBOX_VIEW)
    expect(hoisted.mockListInboxes).toHaveBeenCalledWith({ includeArchived: true })
    expect(hoisted.mockGetInbox).toHaveBeenCalledWith(INBOX)
    expect(hoisted.mockListInboxRowsForPrincipal).toHaveBeenCalledWith(PRINCIPAL)
  })

  it('creates, updates, archives, and unarchives inboxes with audit events', async () => {
    const created = inbox({ name: 'Escalations' })
    const updated = inbox({ name: 'Priority support' })
    hoisted.mockCreateInbox.mockResolvedValue(created)
    hoisted.mockUpdateInbox.mockResolvedValue(updated)
    hoisted.mockArchiveInbox.mockResolvedValue(updated)
    hoisted.mockUnarchiveInbox.mockResolvedValue(updated)

    await expect(
      createInboxFn({
        data: {
          slug: 'escalations',
          name: 'Escalations',
          description: 'Urgent support',
          primaryTeamId: 'team_support',
          defaultVisibilityScope: 'team',
          defaultPriority: 'urgent',
          defaultStatusId: 'status_open',
          color: '#ff0000',
          icon: 'siren',
        },
      })
    ).resolves.toBe(created)
    expect(hoisted.mockCreateInbox).toHaveBeenCalledWith(
      {
        slug: 'escalations',
        name: 'Escalations',
        description: 'Urgent support',
        primaryTeamId: 'team_support',
        defaultVisibilityScope: 'team',
        defaultPriority: 'urgent',
        defaultStatusId: 'status_open',
        color: '#ff0000',
        icon: 'siren',
      },
      { principalId: PRINCIPAL }
    )

    await expect(
      updateInboxFn({
        data: {
          inboxId: INBOX,
          name: 'Priority support',
          primaryTeamId: null,
          defaultStatusId: null,
          color: null,
        },
      })
    ).resolves.toBe(updated)
    expect(hoisted.mockUpdateInbox).toHaveBeenCalledWith(
      INBOX,
      {
        name: 'Priority support',
        primaryTeamId: null,
        defaultStatusId: null,
        color: null,
      },
      { principalId: PRINCIPAL }
    )

    await expect(archiveInboxFn({ data: { inboxId: INBOX } })).resolves.toBe(updated)
    await expect(unarchiveInboxFn({ data: { inboxId: INBOX } })).resolves.toBe(updated)

    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.INBOX_MANAGE)
    expect(hoisted.mockArchiveInbox).toHaveBeenCalledWith(INBOX, { principalId: PRINCIPAL })
    expect(hoisted.mockUnarchiveInbox).toHaveBeenCalledWith(INBOX, { principalId: PRINCIPAL })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'inbox.created',
        targetType: 'inbox',
        targetId: INBOX,
        diff: { after: { slug: 'support', name: 'Escalations' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'inbox.updated',
        targetId: INBOX,
        diff: {
          after: {
            name: 'Priority support',
            primaryTeamId: null,
            defaultStatusId: null,
            color: null,
          },
        },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbox.archived', targetId: INBOX })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbox.unarchived', targetId: INBOX })
    )
  })

  it('stops inbox writes before domain calls when manage permission is denied', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('permission denied'))

    await expect(createInboxFn({ data: { slug: 'support', name: 'Support' } })).rejects.toThrow(
      'permission denied'
    )

    expect(hoisted.mockCreateInbox).not.toHaveBeenCalled()
    expect(hoisted.mockRecordEvent).not.toHaveBeenCalled()
  })

  it('lists and mutates inbox channels with channel-manage audit events', async () => {
    const row = channel()
    const updated = channel({ label: 'Renamed channel', enabled: false })
    hoisted.mockListChannelsForInbox.mockResolvedValue([row])
    hoisted.mockAddInboxChannel.mockResolvedValue(row)
    hoisted.mockUpdateInboxChannel.mockResolvedValue(updated)
    hoisted.mockArchiveInboxChannel.mockResolvedValue(updated)

    await expect(listInboxChannelsFn({ data: { inboxId: INBOX } })).resolves.toEqual([row])
    expect(hoisted.mockListChannelsForInbox).toHaveBeenCalledWith(INBOX)

    await expect(
      addInboxChannelFn({
        data: {
          inboxId: INBOX,
          kind: 'email',
          label: 'Support email',
          config: { address: 'support@example.com' },
          externalId: 'support@example.com',
          enabled: true,
        },
      })
    ).resolves.toBe(row)
    expect(hoisted.mockAddInboxChannel).toHaveBeenCalledWith({
      inboxId: INBOX,
      kind: 'email',
      label: 'Support email',
      config: { address: 'support@example.com' },
      externalId: 'support@example.com',
      enabled: true,
    })

    await expect(
      updateInboxChannelFn({
        data: {
          channelId: CHANNEL,
          label: 'Renamed channel',
          config: { address: 'vip@example.com' },
          externalId: null,
          enabled: false,
        },
      })
    ).resolves.toBe(updated)
    expect(hoisted.mockUpdateInboxChannel).toHaveBeenCalledWith(CHANNEL, {
      label: 'Renamed channel',
      config: { address: 'vip@example.com' },
      externalId: null,
      enabled: false,
    })

    await expect(archiveInboxChannelFn({ data: { channelId: CHANNEL } })).resolves.toBe(updated)
    expect(hoisted.mockArchiveInboxChannel).toHaveBeenCalledWith(CHANNEL)
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.INBOX_CHANNEL_MANAGE)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbox_channel.added',
        targetType: 'inbox_channel',
        targetId: CHANNEL,
        diff: { after: { inboxId: INBOX, kind: 'email' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbox_channel.updated',
        targetId: CHANNEL,
        diff: {
          after: {
            label: 'Renamed channel',
            config: { address: 'vip@example.com' },
            externalId: null,
            enabled: false,
          },
        },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbox_channel.archived', targetId: CHANNEL })
    )
  })

  it('lists and mutates memberships with manage permission and audit events', async () => {
    const row = membership()
    const updated = membership({ role: 'owner' })
    hoisted.mockListMembershipsForInbox.mockResolvedValue([row])
    hoisted.mockAddInboxMembership.mockResolvedValue(row)
    hoisted.mockUpdateInboxMembershipRole.mockResolvedValue(updated)
    hoisted.mockRemoveInboxMembership.mockResolvedValue(undefined)

    await expect(listInboxMembershipsFn({ data: { inboxId: INBOX } })).resolves.toEqual([row])
    expect(hoisted.mockListMembershipsForInbox).toHaveBeenCalledWith(INBOX)

    await expect(
      addInboxMembershipFn({ data: { inboxId: INBOX, principalId: AGENT, role: 'member' } })
    ).resolves.toBe(row)
    expect(hoisted.mockAddInboxMembership).toHaveBeenCalledWith({
      inboxId: INBOX,
      principalId: AGENT,
      role: 'member',
    })

    await expect(
      updateInboxMembershipRoleFn({ data: { membershipId: MEMBERSHIP, role: 'owner' } })
    ).resolves.toBe(updated)
    expect(hoisted.mockUpdateInboxMembershipRole).toHaveBeenCalledWith(MEMBERSHIP, 'owner')

    await expect(removeInboxMembershipFn({ data: { membershipId: MEMBERSHIP } })).resolves.toEqual({
      ok: true,
    })
    expect(hoisted.mockRemoveInboxMembership).toHaveBeenCalledWith(MEMBERSHIP)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbox.membership_added',
        targetType: 'inbox',
        targetId: INBOX,
        diff: { after: { principalId: AGENT, role: 'member' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbox.membership_updated',
        targetType: 'inbox',
        targetId: INBOX,
        diff: { after: { role: 'owner' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbox.membership_removed',
        targetType: 'inbox_membership',
        targetId: MEMBERSHIP,
      })
    )
  })
})
