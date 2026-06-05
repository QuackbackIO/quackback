import { beforeEach, describe, it, expect, vi } from 'vitest'

const getSession = vi.fn()
vi.mock('@/lib/server/auth/session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
}))

const findFirst = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: (...a: unknown[]) => findFirst(...a) } } },
  principal: { userId: 'principal.userId' },
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}))

const registerDevice = vi.fn()
const unregisterDevice = vi.fn()
vi.mock('@/lib/server/domains/push-devices/push-device.service', () => ({
  registerDevice: (...a: unknown[]) => registerDevice(...a),
  unregisterDevice: (...a: unknown[]) => unregisterDevice(...a),
}))

import { handleRegisterDevice, handleUnregisterDevice } from '../devices'

const post = (body: unknown) =>
  new Request('http://t/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const del = (body: unknown) =>
  new Request('http://t/api/devices', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/devices', () => {
  it('401s when unauthenticated', async () => {
    getSession.mockResolvedValue(null)
    const res = await handleRegisterDevice(post({ token: 't', platform: 'ios' }))
    expect(res.status).toBe(401)
    expect(registerDevice).not.toHaveBeenCalled()
  })

  it('400s on an unknown platform', async () => {
    getSession.mockResolvedValue({ user: { id: 'user_1' } })
    const res = await handleRegisterDevice(post({ token: 't', platform: 'windows' }))
    expect(res.status).toBe(400)
    expect(registerDevice).not.toHaveBeenCalled()
  })

  it('403s when the user has no principal', async () => {
    getSession.mockResolvedValue({ user: { id: 'user_1' } })
    findFirst.mockResolvedValue(undefined)
    const res = await handleRegisterDevice(post({ token: 't', platform: 'ios' }))
    expect(res.status).toBe(403)
    expect(registerDevice).not.toHaveBeenCalled()
  })

  it('registers the device for the resolved principal', async () => {
    getSession.mockResolvedValue({ user: { id: 'user_1' } })
    findFirst.mockResolvedValue({ id: 'principal_1' })
    const res = await handleRegisterDevice(post({ token: '  tok-1  ', platform: 'android' }))
    expect(res.status).toBe(204)
    expect(registerDevice).toHaveBeenCalledWith({
      principalId: 'principal_1',
      token: 'tok-1',
      platform: 'android',
    })
  })
})

describe('DELETE /api/devices', () => {
  it('401s when unauthenticated', async () => {
    getSession.mockResolvedValue(null)
    const res = await handleUnregisterDevice(del({ token: 't' }))
    expect(res.status).toBe(401)
    expect(unregisterDevice).not.toHaveBeenCalled()
  })

  it('403s when the user has no principal', async () => {
    getSession.mockResolvedValue({ user: { id: 'user_1' } })
    findFirst.mockResolvedValue(undefined)
    const res = await handleUnregisterDevice(del({ token: 'tok-1' }))
    expect(res.status).toBe(403)
    expect(unregisterDevice).not.toHaveBeenCalled()
  })

  it('unregisters the token scoped to the resolved principal', async () => {
    getSession.mockResolvedValue({ user: { id: 'user_1' } })
    findFirst.mockResolvedValue({ id: 'principal_1' })
    const res = await handleUnregisterDevice(del({ token: 'tok-1' }))
    expect(res.status).toBe(204)
    expect(unregisterDevice).toHaveBeenCalledWith({ principalId: 'principal_1', token: 'tok-1' })
  })
})
