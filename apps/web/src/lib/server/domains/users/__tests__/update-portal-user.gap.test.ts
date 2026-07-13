/**
 * Differential-coverage test for updatePortalUser — the full update path through
 * the user/principal writes, contact linking, and the projected result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  principalRows: [] as unknown[],
  userFindFirst: vi.fn(),
  updateSet: vi.fn(),
  validateInputAttributes: vi.fn(),
  mergeMetadata: vi.fn(() => ({})),
  extractExternalId: vi.fn(() => 'ext-1'),
  linkContactForUser: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { user: { findFirst: h.userFindFirst } },
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.principalRows) }) }),
    }),
    update: () => ({
      set: (v: unknown) => {
        h.updateSet(v)
        return { where: () => Promise.resolve() }
      },
    }),
  },
  eq: (...a: unknown[]) => ['eq', ...a],
  and: (...a: unknown[]) => ['and', ...a],
  principal: { id: 'id', userId: 'userId', role: 'role' },
  user: { id: 'id' },
}))
vi.mock('../user.attributes', () => ({
  USER_COLUMNS: {},
  EXTERNAL_ID_KEY: 'externalId',
  parseUserAttributes: vi.fn(),
  extractExternalId: h.extractExternalId,
  mergeMetadata: h.mergeMetadata,
  validateInputAttributes: h.validateInputAttributes,
}))
vi.mock('@/lib/server/auth/link-contact', () => ({ linkContactForUser: h.linkContactForUser }))

import { updatePortalUser } from '../user.identify'
import type { PrincipalId } from '@quackback/ids'

beforeEach(() => {
  vi.clearAllMocks()
  h.principalRows = [{ principalId: 'pr_1', userId: 'u_1' }]
  h.validateInputAttributes.mockResolvedValue({ validAttrs: { plan: 'pro' }, attrRemovals: [] })
  h.userFindFirst.mockResolvedValue({
    id: 'u_1',
    name: 'Old',
    email: 'jane@x.test',
    image: null,
    emailVerified: false,
    metadata: null,
  })
})

describe('updatePortalUser', () => {
  it('throws when the portal user principal is missing', async () => {
    h.principalRows = []
    await expect(updatePortalUser('pr_x' as PrincipalId, {})).rejects.toThrow(/not found/i)
  })

  it('updates user + principal fields, links the contact, and projects the result', async () => {
    const res = await updatePortalUser('pr_1' as PrincipalId, {
      name: 'Jane',
      image: 'a.png',
      emailVerified: true,
      externalId: 'ext-1',
      attributes: { plan: 'pro' },
    })
    expect(h.updateSet).toHaveBeenCalled()
    expect(h.linkContactForUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u_1' }))
    expect(res).toMatchObject({ principalId: 'pr_1', userId: 'u_1', externalId: 'ext-1' })
  })

  it('throws when the user record is gone', async () => {
    h.userFindFirst.mockResolvedValueOnce(undefined)
    await expect(updatePortalUser('pr_1' as PrincipalId, { name: 'X' })).rejects.toThrow(
      /not found/i
    )
  })
})
