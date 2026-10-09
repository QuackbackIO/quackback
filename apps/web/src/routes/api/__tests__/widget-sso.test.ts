import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string; name: string }
    session: { scope: string }
  },
  token: null as string | null,
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/server/cloud-widget/sso', () => ({
  mintCloudWidgetSsoToken: async () => state.token,
}))

import { handleWidgetSso } from '../widget-sso'

const teammate = {
  user: { id: 'user_1', email: 'sam@acme.test', name: 'Sam' },
  session: { scope: 'dashboard' },
}

afterEach(() => {
  state.session = null
  state.token = null
})

describe('widget sign-in token for the team help launcher', () => {
  it('refuses someone signed out', async () => {
    expect((await handleWidgetSso()).status).toBe(401)
  })

  it('answers quietly with nothing to identify when no token can be made', async () => {
    state.session = teammate
    const res = await handleWidgetSso()
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('hands a signed-in teammate their token', async () => {
    state.session = teammate
    state.token = 'jwt'
    const res = await handleWidgetSso()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ssoToken: 'jwt' })
  })
})
