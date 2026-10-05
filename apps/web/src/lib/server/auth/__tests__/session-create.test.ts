import { describe, it, expect, vi, beforeEach } from 'vitest'

const peer = vi.hoisted(() => ({ ip: '203.0.113.5' as string | undefined }))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'x-forwarded-for': '1.2.3.4' }),
  getRequestIP: () => peer.ip,
}))

const { beforeSessionCreate } = await import('../session-create')

const SESSION = { userId: 'user_1', token: 't', ipAddress: '1.2.3.4', expiresAt: new Date() }

beforeEach(() => {
  peer.ip = '203.0.113.5'
})

describe('beforeSessionCreate', () => {
  it('scopes the anonymous mint to the widget and records the resolved peer address', async () => {
    const result = await beforeSessionCreate(SESSION, { path: '/sign-in/anonymous' })
    expect(result).toEqual({ data: { ...SESSION, scope: 'widget', ipAddress: '203.0.113.5' } })
  })

  it('leaves every other sign-in alone', async () => {
    expect(await beforeSessionCreate(SESSION, { path: '/sign-in/email' })).toBeUndefined()
    expect(await beforeSessionCreate(SESSION, null)).toBeUndefined()
  })
})
