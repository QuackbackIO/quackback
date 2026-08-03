import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findChannelMock: vi.fn(),
  findMembershipMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectOrderByMock: vi.fn(),
  selectInnerJoinMock: vi.fn(),
  selectJoinWhereMock: vi.fn(),
  selectJoinOrderByMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  isNullMock: vi.fn(),
  ascMock: vi.fn(),
  dispatchInboxChannelCreatedMock: vi.fn(),
  dispatchInboxChannelUpdatedMock: vi.fn(),
  dispatchInboxChannelArchivedMock: vi.fn(),
  dispatchInboxMembershipAddedMock: vi.fn(),
  dispatchInboxMembershipUpdatedMock: vi.fn(),
  dispatchInboxMembershipRemovedMock: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      inboxChannels: { findFirst: hoisted.findChannelMock },
      inboxMemberships: { findFirst: hoisted.findMembershipMock },
    },
    insert: (...args: unknown[]) => hoisted.insertMock(...args),
    update: (...args: unknown[]) => hoisted.updateMock(...args),
    delete: (...args: unknown[]) => hoisted.deleteMock(...args),
    select: (...args: unknown[]) => hoisted.selectMock(...args),
  },
  eq: (...args: unknown[]) => hoisted.eqMock(...args),
  and: (...args: unknown[]) => hoisted.andMock(...args),
  isNull: (...args: unknown[]) => hoisted.isNullMock(...args),
  asc: (...args: unknown[]) => hoisted.ascMock(...args),
  inboxChannels: {
    id: 'inboxChannels.id',
    inboxId: 'inboxChannels.inboxId',
    kind: 'inboxChannels.kind',
    label: 'inboxChannels.label',
    externalId: 'inboxChannels.externalId',
    enabled: 'inboxChannels.enabled',
    archivedAt: 'inboxChannels.archivedAt',
    createdAt: 'inboxChannels.createdAt',
  },
  inboxMemberships: {
    id: 'inboxMemberships.id',
    inboxId: 'inboxMemberships.inboxId',
    principalId: 'inboxMemberships.principalId',
    role: 'inboxMemberships.role',
    createdAt: 'inboxMemberships.createdAt',
  },
  inboxes: {
    id: 'inboxes.id',
    name: 'inboxes.name',
  },
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchInboxChannelCreated: (...args: unknown[]) =>
    hoisted.dispatchInboxChannelCreatedMock(...args),
  dispatchInboxChannelUpdated: (...args: unknown[]) =>
    hoisted.dispatchInboxChannelUpdatedMock(...args),
  dispatchInboxChannelArchived: (...args: unknown[]) =>
    hoisted.dispatchInboxChannelArchivedMock(...args),
  dispatchInboxMembershipAdded: (...args: unknown[]) =>
    hoisted.dispatchInboxMembershipAddedMock(...args),
  dispatchInboxMembershipUpdated: (...args: unknown[]) =>
    hoisted.dispatchInboxMembershipUpdatedMock(...args),
  dispatchInboxMembershipRemoved: (...args: unknown[]) =>
    hoisted.dispatchInboxMembershipRemovedMock(...args),
}))

const { addInboxChannel, updateInboxChannel, archiveInboxChannel, getInboxChannelByExternalId } =
  await import('../inbox.channels')
const {
  addInboxMembership,
  updateInboxMembershipRole,
  removeInboxMembership,
  listMembershipsForInbox,
  listInboxesForPrincipal,
  listInboxRowsForPrincipal,
} = await import('../inbox.memberships')

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'channel_1',
    inboxId: 'inbox_1',
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
    id: 'membership_1',
    inboxId: 'inbox_1',
    principalId: 'principal_1',
    role: 'agent',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.eqMock.mockImplementation((left: unknown, right: unknown) => ['eq', left, right])
  hoisted.andMock.mockImplementation((...parts: unknown[]) => ['and', ...parts])
  hoisted.isNullMock.mockImplementation((value: unknown) => ['isNull', value])
  hoisted.ascMock.mockImplementation((value: unknown) => ['asc', value])
  hoisted.insertMock.mockReturnValue({
    values: (values: unknown) => {
      hoisted.insertValuesMock(values)
      return { returning: hoisted.insertReturningMock }
    },
  })
  hoisted.updateMock.mockReturnValue({
    set: (patch: unknown) => {
      hoisted.updateSetMock(patch)
      return {
        where: (condition: unknown) => {
          hoisted.updateWhereMock(condition)
          return { returning: hoisted.updateReturningMock }
        },
      }
    },
  })
  hoisted.deleteMock.mockReturnValue({
    where: (...args: unknown[]) => hoisted.deleteWhereMock(...args),
  })
  hoisted.selectMock.mockImplementation((shape?: unknown) => {
    if (shape) {
      return {
        from: (table: unknown) => {
          hoisted.selectFromMock(table)
          return {
            innerJoin: (...args: unknown[]) => {
              hoisted.selectInnerJoinMock(...args)
              return {
                where: (condition: unknown) => {
                  hoisted.selectJoinWhereMock(condition)
                  return { orderBy: (...args: unknown[]) => hoisted.selectJoinOrderByMock(...args) }
                },
              }
            },
          }
        },
      }
    }
    return {
      from: (table: unknown) => {
        hoisted.selectFromMock(table)
        return {
          where: (condition: unknown) => {
            hoisted.selectWhereMock(condition)
            return { orderBy: (...args: unknown[]) => hoisted.selectOrderByMock(...args) }
          },
        }
      },
    }
  })
  hoisted.dispatchInboxChannelCreatedMock.mockResolvedValue(undefined)
  hoisted.dispatchInboxChannelUpdatedMock.mockResolvedValue(undefined)
  hoisted.dispatchInboxChannelArchivedMock.mockResolvedValue(undefined)
  hoisted.dispatchInboxMembershipAddedMock.mockResolvedValue(undefined)
  hoisted.dispatchInboxMembershipUpdatedMock.mockResolvedValue(undefined)
  hoisted.dispatchInboxMembershipRemovedMock.mockResolvedValue(undefined)
})

describe('inbox channel service', () => {
  it('validates required channel input and duplicate external ids', async () => {
    await expect(
      addInboxChannel({ inboxId: '' as never, kind: 'email' as never, label: 'Email' })
    ).rejects.toMatchObject({ code: 'INBOX_REQUIRED' })
    await expect(
      addInboxChannel({ inboxId: 'inbox_1' as never, kind: 'email' as never, label: '  ' })
    ).rejects.toMatchObject({ code: 'CHANNEL_LABEL_REQUIRED' })
    await expect(
      addInboxChannel({
        inboxId: 'inbox_1' as never,
        kind: 'email' as never,
        label: 'x'.repeat(201),
      })
    ).rejects.toMatchObject({ code: 'CHANNEL_LABEL_TOO_LONG' })

    hoisted.findChannelMock.mockResolvedValue(channel({ externalId: 'support@example.com' }))
    await expect(
      addInboxChannel({
        inboxId: 'inbox_1' as never,
        kind: 'email' as never,
        label: 'Email',
        externalId: 'support@example.com',
      })
    ).rejects.toMatchObject({ code: 'CHANNEL_EXTERNAL_ID_TAKEN' })
  })

  it('creates a channel with defaults and dispatches an event snapshot', async () => {
    const created = channel({ label: 'Email', externalId: 'support@example.com' })
    hoisted.findChannelMock.mockResolvedValue(undefined)
    hoisted.insertReturningMock.mockResolvedValue([created])

    await expect(
      addInboxChannel({
        inboxId: 'inbox_1' as never,
        kind: 'email' as never,
        label: '  Email  ',
        externalId: 'support@example.com',
      })
    ).resolves.toBe(created)

    expect(hoisted.insertValuesMock).toHaveBeenCalledWith({
      inboxId: 'inbox_1',
      kind: 'email',
      label: 'Email',
      config: {},
      externalId: 'support@example.com',
      enabled: true,
    })
    expect(hoisted.dispatchInboxChannelCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'inbox-channel-system' }),
      expect.objectContaining({
        id: 'channel_1',
        inboxId: 'inbox_1',
        kind: 'email',
        label: 'Email',
        externalId: 'support@example.com',
        enabled: true,
        archivedAt: null,
      })
    )
  })

  it('updates, no-ops, validates, and archives channels', async () => {
    const existing = channel()
    const updated = channel({ label: 'VIP email', config: { address: 'vip@example.com' } })
    hoisted.findChannelMock.mockResolvedValueOnce(undefined)
    await expect(updateInboxChannel('missing' as never, { label: 'Nope' })).rejects.toMatchObject({
      code: 'CHANNEL_NOT_FOUND',
    })

    hoisted.findChannelMock.mockResolvedValueOnce(existing)
    await expect(updateInboxChannel('channel_1' as never, {})).resolves.toBe(existing)
    expect(hoisted.updateSetMock).not.toHaveBeenCalled()

    hoisted.findChannelMock.mockResolvedValueOnce(existing)
    await expect(updateInboxChannel('channel_1' as never, { label: '   ' })).rejects.toMatchObject({
      code: 'CHANNEL_LABEL_REQUIRED',
    })

    hoisted.findChannelMock.mockResolvedValueOnce(existing)
    hoisted.updateReturningMock.mockResolvedValueOnce([updated])
    await expect(
      updateInboxChannel('channel_1' as never, {
        label: ' VIP email ',
        config: { address: 'vip@example.com' },
        externalId: null,
        enabled: false,
      })
    ).resolves.toBe(updated)
    expect(hoisted.updateSetMock).toHaveBeenCalledWith({
      label: 'VIP email',
      config: { address: 'vip@example.com' },
      externalId: null,
      enabled: false,
    })
    expect(hoisted.dispatchInboxChannelUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'inbox-channel-system' }),
      expect.objectContaining({ label: 'VIP email' }),
      ['label', 'config', 'externalId', 'enabled']
    )

    const archived = channel({ archivedAt: new Date('2026-01-01T00:00:00.000Z') })
    hoisted.findChannelMock.mockResolvedValueOnce(archived)
    await expect(archiveInboxChannel('channel_1' as never)).resolves.toBe(archived)

    hoisted.findChannelMock.mockResolvedValueOnce(existing)
    hoisted.updateReturningMock.mockResolvedValueOnce([archived])
    await expect(archiveInboxChannel('channel_1' as never)).resolves.toBe(archived)
    expect(hoisted.updateSetMock).toHaveBeenLastCalledWith({
      archivedAt: expect.any(Date),
      enabled: false,
    })
    expect(hoisted.dispatchInboxChannelArchivedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'inbox-channel-system' }),
      expect.objectContaining({ id: 'channel_1' })
    )
  })

  it('looks up channels by active external id', async () => {
    const row = channel({ externalId: 'support@example.com' })
    hoisted.findChannelMock.mockResolvedValue(row)

    await expect(
      getInboxChannelByExternalId('email' as never, 'support@example.com')
    ).resolves.toBe(row)

    expect(hoisted.findChannelMock).toHaveBeenCalledWith({
      where: expect.arrayContaining(['and']),
    })
  })
})

describe('inbox membership service', () => {
  it('validates required membership input and returns existing memberships idempotently', async () => {
    await expect(
      addInboxMembership({ inboxId: '' as never, principalId: 'principal_1' as never })
    ).rejects.toMatchObject({ code: 'INBOX_REQUIRED' })
    await expect(
      addInboxMembership({ inboxId: 'inbox_1' as never, principalId: '' as never })
    ).rejects.toMatchObject({ code: 'PRINCIPAL_REQUIRED' })

    const existing = membership({ role: 'owner' })
    hoisted.findMembershipMock.mockResolvedValue(existing)
    await expect(
      addInboxMembership({ inboxId: 'inbox_1' as never, principalId: 'principal_1' as never })
    ).resolves.toBe(existing)
    expect(hoisted.insertValuesMock).not.toHaveBeenCalled()
  })

  it('creates, updates, no-ops, and removes memberships with dispatch snapshots', async () => {
    const created = membership({ role: 'agent' })
    hoisted.findMembershipMock.mockResolvedValueOnce(undefined)
    hoisted.insertReturningMock.mockResolvedValueOnce([created])

    await expect(
      addInboxMembership({ inboxId: 'inbox_1' as never, principalId: 'principal_1' as never })
    ).resolves.toBe(created)
    expect(hoisted.insertValuesMock).toHaveBeenCalledWith({
      inboxId: 'inbox_1',
      principalId: 'principal_1',
      role: 'agent',
    })
    expect(hoisted.dispatchInboxMembershipAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'inbox-membership-system' }),
      expect.objectContaining({ id: 'membership_1', role: 'agent' })
    )

    hoisted.findMembershipMock.mockResolvedValueOnce(undefined)
    await expect(
      updateInboxMembershipRole('missing' as never, 'owner' as never)
    ).rejects.toMatchObject({ code: 'INBOX_MEMBERSHIP_NOT_FOUND' })

    hoisted.findMembershipMock.mockResolvedValueOnce(created)
    await expect(
      updateInboxMembershipRole('membership_1' as never, 'agent' as never)
    ).resolves.toBe(created)

    const updated = membership({ role: 'owner' })
    hoisted.findMembershipMock.mockResolvedValueOnce(created)
    hoisted.updateReturningMock.mockResolvedValueOnce([updated])
    await expect(
      updateInboxMembershipRole('membership_1' as never, 'owner' as never)
    ).resolves.toBe(updated)
    expect(hoisted.updateSetMock).toHaveBeenCalledWith({ role: 'owner' })
    expect(hoisted.dispatchInboxMembershipUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'inbox-membership-system' }),
      expect.objectContaining({ role: 'owner' }),
      'agent'
    )

    hoisted.findMembershipMock.mockResolvedValueOnce(updated)
    await removeInboxMembership('membership_1' as never)
    expect(hoisted.deleteWhereMock).toHaveBeenCalled()
    expect(hoisted.dispatchInboxMembershipRemovedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'inbox-membership-system' }),
      expect.objectContaining({ id: 'membership_1', role: 'owner' })
    )

    vi.clearAllMocks()
    hoisted.deleteMock.mockReturnValue({
      where: (...args: unknown[]) => hoisted.deleteWhereMock(...args),
    })
    hoisted.findMembershipMock.mockResolvedValueOnce(undefined)
    await removeInboxMembership('missing' as never)
    expect(hoisted.deleteWhereMock).toHaveBeenCalled()
    expect(hoisted.dispatchInboxMembershipRemovedMock).not.toHaveBeenCalled()
  })

  it('lists memberships and joined inbox rows in stable order', async () => {
    const rows = [membership()]
    const inboxRows = [{ inbox: { id: 'inbox_1', name: 'Support' } }]
    hoisted.selectOrderByMock.mockResolvedValue(rows)
    hoisted.selectJoinOrderByMock.mockResolvedValue(inboxRows)

    await expect(listMembershipsForInbox('inbox_1' as never)).resolves.toEqual(rows)
    await expect(listInboxesForPrincipal('principal_1' as never)).resolves.toEqual(rows)
    await expect(listInboxRowsForPrincipal('principal_1' as never)).resolves.toEqual([
      { id: 'inbox_1', name: 'Support' },
    ])

    expect(hoisted.selectWhereMock).toHaveBeenCalledTimes(2)
    expect(hoisted.selectInnerJoinMock).toHaveBeenCalled()
    expect(hoisted.selectJoinWhereMock).toHaveBeenCalled()
  })
})
