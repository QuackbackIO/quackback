import { afterEach, describe, expect, it } from 'vitest'
import { jwtVerify } from 'jose'
import { mintCloudWidgetSsoToken } from '../sso'

const SECRET = 'test-widget-signing-secret'

describe('mintCloudWidgetSsoToken', () => {
  afterEach(() => {
    delete process.env.WIDGET_SIGNING_SECRET
  })

  it('returns null when the signing secret is unset', async () => {
    delete process.env.WIDGET_SIGNING_SECRET
    await expect(
      mintCloudWidgetSsoToken({ id: 'usr_1', email: 'ada@example.com', name: 'Ada' })
    ).resolves.toBeNull()
  })

  it('returns null for anonymous placeholder emails', async () => {
    process.env.WIDGET_SIGNING_SECRET = SECRET
    await expect(
      mintCloudWidgetSsoToken({
        id: 'usr_anon',
        email: 'temp-abc@anon.quackback.io',
        name: 'Guest',
      })
    ).resolves.toBeNull()
  })

  it('signs a short-lived HS256 token with sub, email, and name', async () => {
    process.env.WIDGET_SIGNING_SECRET = SECRET
    const token = await mintCloudWidgetSsoToken({
      id: 'usr_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    })
    expect(token).toEqual(expect.any(String))
    const { payload } = await jwtVerify(token!, new TextEncoder().encode(SECRET))
    expect(payload.sub).toBe('usr_1')
    expect(payload.email).toBe('ada@example.com')
    expect(payload.name).toBe('Ada Lovelace')
    expect(payload.exp).toEqual(expect.any(Number))
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(5 * 60)
  })
})
