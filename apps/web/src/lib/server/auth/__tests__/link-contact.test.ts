/**
 * Unit tests for `linkContactForUser` — the auth-hook helper that links a
 * portal user to a CRM contact based on their verified email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserId } from '@quackback/ids'

const findOrCreateByEmailMock = vi.fn()
const linkContactToUserMock = vi.fn()

vi.mock('@/lib/server/domains/organizations/contact.service', () => ({
  findOrCreateByEmail: (...args: unknown[]) => findOrCreateByEmailMock(...args),
  linkContactToUser: (...args: unknown[]) => linkContactToUserMock(...args),
}))

import { linkContactForUser } from '../link-contact'

const USER_ID = 'user_123' as UserId

beforeEach(() => {
  vi.clearAllMocks()
  findOrCreateByEmailMock.mockReset().mockResolvedValue({ id: 'contact_x' })
  linkContactToUserMock.mockReset().mockResolvedValue({ id: 'cu_link_x' })
})

describe('linkContactForUser', () => {
  it('skips when user is anonymous', async () => {
    await linkContactForUser({
      userId: USER_ID,
      email: '[email protected]',
      emailVerified: true,
      anonymous: true,
    })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('skips when email is null', async () => {
    await linkContactForUser({
      userId: USER_ID,
      email: null,
      emailVerified: true,
      anonymous: false,
    })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('skips when email is undefined', async () => {
    await linkContactForUser({
      userId: USER_ID,
      email: undefined,
      emailVerified: true,
      anonymous: false,
    })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('skips when email is not verified', async () => {
    await linkContactForUser({
      userId: USER_ID,
      email: '[email protected]',
      emailVerified: false,
      anonymous: false,
    })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('links when email is verified — calls both services with system actor', async () => {
    await linkContactForUser({
      userId: USER_ID,
      email: '[email protected]',
      emailVerified: true,
      anonymous: false,
    })
    expect(findOrCreateByEmailMock).toHaveBeenCalledTimes(1)
    expect(findOrCreateByEmailMock).toHaveBeenCalledWith({ email: '[email protected]' })
    expect(linkContactToUserMock).toHaveBeenCalledTimes(1)
    expect(linkContactToUserMock).toHaveBeenCalledWith({
      contactId: 'contact_x',
      userId: USER_ID,
      linkedByPrincipalId: null,
    })
  })

  it('is idempotent — repeated calls reissue the same idempotent service calls', async () => {
    const input = {
      userId: USER_ID,
      email: '[email protected]',
      emailVerified: true,
      anonymous: false,
    }
    await linkContactForUser(input)
    await linkContactForUser(input)
    expect(findOrCreateByEmailMock).toHaveBeenCalledTimes(2)
    expect(linkContactToUserMock).toHaveBeenCalledTimes(2)
  })

  it('swallows errors and logs them so signup is not broken', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    findOrCreateByEmailMock.mockRejectedValueOnce(new Error('db down'))
    await expect(
      linkContactForUser({
        userId: USER_ID,
        email: '[email protected]',
        emailVerified: true,
        anonymous: false,
      })
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(linkContactToUserMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
