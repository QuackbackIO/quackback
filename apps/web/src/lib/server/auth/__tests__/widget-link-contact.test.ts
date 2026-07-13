/**
 * Unit tests for `linkContactForWidgetUser` — the widget-side variant of the
 * portal `linkContactForUser` hook. Gated on a verified ssoToken (rather than
 * `emailVerified`) because widget identify never sets `emailVerified`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserId } from '@quackback/ids'

const findOrCreateByEmailMock = vi.fn()
const linkContactToUserMock = vi.fn()

vi.mock('@/lib/server/domains/organizations/contact.service', () => ({
  findOrCreateByEmail: (...args: unknown[]) => findOrCreateByEmailMock(...args),
  linkContactToUser: (...args: unknown[]) => linkContactToUserMock(...args),
}))

import { linkContactForWidgetUser } from '../link-contact'

const USER_ID = 'user_123' as UserId

beforeEach(() => {
  vi.clearAllMocks()
  findOrCreateByEmailMock.mockReset().mockResolvedValue({ id: 'contact_x' })
  linkContactToUserMock.mockReset().mockResolvedValue({ id: 'cu_link_x' })
})

describe('linkContactForWidgetUser', () => {
  it('skips and returns null contactId when not verified', async () => {
    const result = await linkContactForWidgetUser({
      userId: USER_ID,
      email: '[email protected]',
      verified: false,
    })
    expect(result).toEqual({ contactId: null })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('skips when email is null (verified but no email)', async () => {
    const result = await linkContactForWidgetUser({
      userId: USER_ID,
      email: null,
      verified: true,
    })
    expect(result).toEqual({ contactId: null })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('skips when email is undefined', async () => {
    const result = await linkContactForWidgetUser({
      userId: USER_ID,
      email: undefined,
      verified: true,
    })
    expect(result).toEqual({ contactId: null })
    expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
    expect(linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('links and returns contactId when verified with email', async () => {
    const result = await linkContactForWidgetUser({
      userId: USER_ID,
      email: '[email protected]',
      verified: true,
    })
    expect(result).toEqual({ contactId: 'contact_x' })
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
      verified: true,
    }
    await linkContactForWidgetUser(input)
    await linkContactForWidgetUser(input)
    expect(findOrCreateByEmailMock).toHaveBeenCalledTimes(2)
    expect(linkContactToUserMock).toHaveBeenCalledTimes(2)
  })

  it('swallows errors, logs them and returns null contactId so identify is not broken', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    findOrCreateByEmailMock.mockRejectedValueOnce(new Error('db down'))
    const result = await linkContactForWidgetUser({
      userId: USER_ID,
      email: '[email protected]',
      verified: true,
    })
    expect(result).toEqual({ contactId: null })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(linkContactToUserMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
