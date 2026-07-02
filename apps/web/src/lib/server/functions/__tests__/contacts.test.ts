import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  mockCreateContact: vi.fn(),
  mockUpdateContact: vi.fn(),
  mockArchiveContact: vi.fn(),
  mockGetContact: vi.fn(),
  mockListContactsForOrganization: vi.fn(),
  mockSearchContacts: vi.fn(),
  mockLinkContactToUser: vi.fn(),
  mockUnlinkContactFromUser: vi.fn(),
  mockListLinksForContact: vi.fn(),
  mockRecordEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/organizations', () => ({
  createContact: (...args: unknown[]) => hoisted.mockCreateContact(...args),
  updateContact: (...args: unknown[]) => hoisted.mockUpdateContact(...args),
  archiveContact: (...args: unknown[]) => hoisted.mockArchiveContact(...args),
  getContact: (...args: unknown[]) => hoisted.mockGetContact(...args),
  listContactsForOrganization: (...args: unknown[]) =>
    hoisted.mockListContactsForOrganization(...args),
  searchContacts: (...args: unknown[]) => hoisted.mockSearchContacts(...args),
  linkContactToUser: (...args: unknown[]) => hoisted.mockLinkContactToUser(...args),
  unlinkContactFromUser: (...args: unknown[]) => hoisted.mockUnlinkContactFromUser(...args),
  listLinksForContact: (...args: unknown[]) => hoisted.mockListLinksForContact(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

await import('../contacts')

const [
  searchContactsFn,
  listContactsForOrganizationFn,
  getContactFn,
  createContactFn,
  updateContactFn,
  archiveContactFn,
  linkContactToUserFn,
  unlinkContactFromUserFn,
  listLinksForContactFn,
] = handlersByIndex

if (!listLinksForContactFn) {
  throw new Error(`contacts handlers were not registered; found ${handlersByIndex.length}`)
}

const ctx = {
  principal: { id: 'principal_admin' },
  user: { id: 'user_admin' },
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact_123',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    organizationId: 'org_123',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue(ctx)
  hoisted.mockSearchContacts.mockResolvedValue([contact()])
  hoisted.mockListContactsForOrganization.mockResolvedValue([contact()])
  hoisted.mockGetContact.mockResolvedValue(contact({ name: 'Before' }))
  hoisted.mockCreateContact.mockResolvedValue(contact({ name: 'Created' }))
  hoisted.mockUpdateContact.mockResolvedValue(contact({ name: 'Updated' }))
  hoisted.mockArchiveContact.mockResolvedValue(undefined)
  hoisted.mockLinkContactToUser.mockResolvedValue({ contactId: 'contact_123', userId: 'user_123' })
  hoisted.mockUnlinkContactFromUser.mockResolvedValue(undefined)
  hoisted.mockListLinksForContact.mockResolvedValue([{ userId: 'user_123' }])
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('contact server functions', () => {
  it('runs read functions behind org.view and passes filters to the organization domain', async () => {
    await expect(
      searchContactsFn({
        data: {
          query: 'ada',
          email: 'ada@example.com',
          organizationId: 'org_123',
          includeArchived: true,
          limit: 25,
          offset: 5,
        },
      })
    ).resolves.toEqual([contact()])
    expect(hoisted.mockSearchContacts).toHaveBeenCalledWith({
      query: 'ada',
      email: 'ada@example.com',
      organizationId: 'org_123',
      includeArchived: true,
      limit: 25,
      offset: 5,
    })

    await expect(
      listContactsForOrganizationFn({
        data: { organizationId: 'org_123', includeArchived: false, limit: 10, offset: 0 },
      })
    ).resolves.toEqual([contact()])
    expect(hoisted.mockListContactsForOrganization).toHaveBeenCalledWith('org_123', {
      includeArchived: false,
      limit: 10,
      offset: 0,
    })

    await expect(getContactFn({ data: { contactId: 'contact_123' } })).resolves.toEqual(
      contact({ name: 'Before' })
    )
    await expect(listLinksForContactFn({ data: { contactId: 'contact_123' } })).resolves.toEqual([
      { userId: 'user_123' },
    ])
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ORG_VIEW)
  })

  it('creates, updates, and archives contacts behind org.manage with audit events', async () => {
    const createResult = await createContactFn({
      data: {
        name: 'Created',
        email: 'created@example.com',
        organizationId: 'org_123',
      },
    })
    expect(createResult).toEqual(contact({ name: 'Created' }))
    expect(hoisted.mockCreateContact).toHaveBeenCalledWith(
      {
        name: 'Created',
        email: 'created@example.com',
        organizationId: 'org_123',
      },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    const updateResult = await updateContactFn({
      data: { contactId: 'contact_123', name: 'Updated', email: 'updated@example.com' },
    })
    expect(updateResult).toEqual(contact({ name: 'Updated' }))
    expect(hoisted.mockUpdateContact).toHaveBeenCalledWith(
      'contact_123',
      { name: 'Updated', email: 'updated@example.com' },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(archiveContactFn({ data: { contactId: 'contact_123' } })).resolves.toEqual({
      ok: true,
    })
    expect(hoisted.mockArchiveContact).toHaveBeenCalledWith('contact_123', {
      principalId: 'principal_admin',
      userId: 'user_admin',
    })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contact.created', targetId: 'contact_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contact.updated', targetId: 'contact_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contact.archived', targetId: 'contact_123' })
    )
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ORG_MANAGE)
  })

  it('records an update audit event with no before diff when the contact did not exist', async () => {
    hoisted.mockGetContact.mockResolvedValueOnce(null)

    await updateContactFn({
      data: { contactId: 'contact_123', name: 'Updated' },
    })

    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.updated',
        diff: expect.objectContaining({ before: undefined }),
      })
    )
  })

  it('links and unlinks users with contact audit context', async () => {
    await expect(
      linkContactToUserFn({ data: { contactId: 'contact_123', userId: 'user_123' } })
    ).resolves.toEqual({ contactId: 'contact_123', userId: 'user_123' })
    expect(hoisted.mockLinkContactToUser).toHaveBeenCalledWith(
      {
        contactId: 'contact_123',
        userId: 'user_123',
        linkedByPrincipalId: 'principal_admin',
      },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(
      unlinkContactFromUserFn({ data: { contactId: 'contact_123', userId: 'user_123' } })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockUnlinkContactFromUser).toHaveBeenCalledWith('contact_123', 'user_123', {
      principalId: 'principal_admin',
      userId: 'user_admin',
    })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.linked_user',
        diff: { context: { userId: 'user_123' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.unlinked_user',
        diff: { context: { userId: 'user_123' } },
      })
    )
  })

  it('does not call the organization domain when permission is denied', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('org.view required'))

    await expect(searchContactsFn({ data: {} })).rejects.toThrow('org.view required')

    expect(hoisted.mockSearchContacts).not.toHaveBeenCalled()
  })
})
