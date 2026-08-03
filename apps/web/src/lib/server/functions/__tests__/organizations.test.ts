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
  mockCreateOrganization: vi.fn(),
  mockUpdateOrganization: vi.fn(),
  mockArchiveOrganization: vi.fn(),
  mockUnarchiveOrganization: vi.fn(),
  mockGetOrganization: vi.fn(),
  mockListOrganizations: vi.fn(),
  mockRecordEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/organizations', () => ({
  createOrganization: (...args: unknown[]) => hoisted.mockCreateOrganization(...args),
  updateOrganization: (...args: unknown[]) => hoisted.mockUpdateOrganization(...args),
  archiveOrganization: (...args: unknown[]) => hoisted.mockArchiveOrganization(...args),
  unarchiveOrganization: (...args: unknown[]) => hoisted.mockUnarchiveOrganization(...args),
  getOrganization: (...args: unknown[]) => hoisted.mockGetOrganization(...args),
  listOrganizations: (...args: unknown[]) => hoisted.mockListOrganizations(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

await import('../organizations')

const [
  listOrganizationsFn,
  getOrganizationFn,
  createOrganizationFn,
  updateOrganizationFn,
  archiveOrganizationFn,
  unarchiveOrganizationFn,
] = handlersByIndex

if (!unarchiveOrganizationFn) {
  throw new Error(`organization handlers were not registered; found ${handlersByIndex.length}`)
}

const ctx = {
  principal: { id: 'principal_admin' },
  user: { id: 'user_admin' },
}

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org_123',
    name: 'Acme',
    domain: 'acme.example',
    website: 'https://acme.example',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue(ctx)
  hoisted.mockListOrganizations.mockResolvedValue([org()])
  hoisted.mockGetOrganization.mockResolvedValue(org({ name: 'Before' }))
  hoisted.mockCreateOrganization.mockResolvedValue(org({ name: 'Created' }))
  hoisted.mockUpdateOrganization.mockResolvedValue(org({ name: 'Updated' }))
  hoisted.mockArchiveOrganization.mockResolvedValue(undefined)
  hoisted.mockUnarchiveOrganization.mockResolvedValue(undefined)
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('organization server functions', () => {
  it('runs read functions behind org.view and passes list filters through', async () => {
    await expect(
      listOrganizationsFn({
        data: { search: 'acme', includeArchived: true, limit: 50, offset: 10 },
      })
    ).resolves.toEqual([org()])
    expect(hoisted.mockListOrganizations).toHaveBeenCalledWith({
      search: 'acme',
      includeArchived: true,
      limit: 50,
      offset: 10,
    })

    await expect(getOrganizationFn({ data: { organizationId: 'org_123' } })).resolves.toEqual(
      org({ name: 'Before' })
    )
    expect(hoisted.mockGetOrganization).toHaveBeenCalledWith('org_123')
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ORG_VIEW)
  })

  it('creates, updates, archives, and unarchives organizations with audit events', async () => {
    await expect(
      createOrganizationFn({
        data: { name: 'Created', domain: 'created.example', website: 'https://created.example' },
      })
    ).resolves.toEqual(org({ name: 'Created' }))
    expect(hoisted.mockCreateOrganization).toHaveBeenCalledWith(
      { name: 'Created', domain: 'created.example', website: 'https://created.example' },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(
      updateOrganizationFn({
        data: { organizationId: 'org_123', name: 'Updated', domain: 'updated.example' },
      })
    ).resolves.toEqual(org({ name: 'Updated' }))
    expect(hoisted.mockUpdateOrganization).toHaveBeenCalledWith(
      'org_123',
      { name: 'Updated', domain: 'updated.example' },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(archiveOrganizationFn({ data: { organizationId: 'org_123' } })).resolves.toEqual({
      ok: true,
    })
    await expect(unarchiveOrganizationFn({ data: { organizationId: 'org_123' } })).resolves.toEqual(
      { ok: true }
    )

    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.created', targetId: 'org_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.updated', targetId: 'org_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.archived', targetId: 'org_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.unarchived', targetId: 'org_123' })
    )
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ORG_MANAGE)
  })

  it('records an update audit event with no before diff when the organization did not exist', async () => {
    hoisted.mockGetOrganization.mockResolvedValueOnce(null)

    await updateOrganizationFn({
      data: { organizationId: 'org_123', name: 'Updated' },
    })

    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.updated',
        diff: expect.objectContaining({ before: undefined }),
      })
    )
  })

  it('does not call organization domains when permission is denied', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('org.view required'))

    await expect(listOrganizationsFn({ data: {} })).rejects.toThrow('org.view required')

    expect(hoisted.mockListOrganizations).not.toHaveBeenCalled()
    expect(hoisted.mockCreateOrganization).not.toHaveBeenCalled()
  })
})
