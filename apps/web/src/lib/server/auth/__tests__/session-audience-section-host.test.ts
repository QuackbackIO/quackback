/**
 * A sign-in made on a section host is portal scope, whichever way the host
 * reaches the session hook: the library's own request, the headers a server
 * function handed it, or the request being served. The real-instance proof is
 * section-host-sign-in.db.test.ts; this pins the hook's own decisions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  requestHeaders: new Headers() as Headers | null,
  sectionHosts: new Set<string>(),
  readFails: false,
  reads: [] as Array<string | null>,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => {
    if (!state.requestHeaders) throw new Error('no request')
    return state.requestHeaders
  },
  getRequestIP: () => '203.0.113.5',
}))
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  isSectionHost: async (host: string | null) => {
    state.reads.push(host)
    if (state.readFails) throw new Error('settings unavailable')
    return !!host && state.sectionHosts.has(host)
  },
}))

const { assignSessionScope } = await import('../session-audience')

const base = { userId: 'user_1', token: 'tok', expiresAt: new Date(0) }

beforeEach(() => {
  state.requestHeaders = new Headers()
  state.sectionHosts = new Set(['help.acme.com'])
  state.readFails = false
  state.reads = []
})

describe('assignSessionScope for a sign-in', () => {
  it('makes a sign-in on a section host portal scope', async () => {
    const result = await assignSessionScope(base, {
      path: '/sign-in/email',
      request: { headers: new Headers({ host: 'help.acme.com' }) },
    })
    expect(result).toEqual({ data: { ...base, scope: 'portal' } })
  })

  it('reads the host from the headers a server function handed the library', async () => {
    const result = await assignSessionScope(base, {
      path: '/sign-in/email-otp',
      headers: new Headers({ host: 'help.acme.com' }),
    })
    expect(result?.data.scope).toBe('portal')
  })

  it('reads the host of the request being served when the library was handed none', async () => {
    state.requestHeaders = new Headers({ host: 'help.acme.com' })
    const result = await assignSessionScope(base, { path: '/magic-link/verify' })
    expect(result?.data.scope).toBe('portal')
  })

  it('is portal scope when any of the hosts is a section host', async () => {
    state.requestHeaders = new Headers({ host: 'help.acme.com' })
    const result = await assignSessionScope(base, {
      path: '/sign-in/email',
      headers: new Headers({ host: 'acme.com' }),
    })
    expect(result?.data.scope).toBe('portal')
  })

  it('leaves a sign-in on the primary domain at the default (dashboard)', async () => {
    const result = await assignSessionScope(base, {
      path: '/sign-in/email',
      request: { headers: new Headers({ host: 'acme.com' }) },
    })
    expect(result).toBeUndefined()
    expect(state.reads).toEqual(['acme.com'])
  })

  it('leaves a session with no host to trace at the default, reading nothing', async () => {
    state.requestHeaders = null
    expect(await assignSessionScope(base, { path: '/sign-in/email' })).toBeUndefined()
    expect(state.reads).toEqual([])
  })

  it('makes the session portal scope when the section hosts cannot be read', async () => {
    state.readFails = true
    const result = await assignSessionScope(base, {
      path: '/sign-in/email',
      request: { headers: new Headers({ host: 'acme.com' }) },
    })
    expect(result?.data.scope).toBe('portal')
  })

  it('keeps the anonymous mint to its own two tiers, without a settings read', async () => {
    state.requestHeaders = new Headers({ host: 'help.acme.com' })
    const result = await assignSessionScope(base, {
      path: '/sign-in/anonymous',
      headers: new Headers({ host: 'help.acme.com' }),
    })
    expect(result?.data.scope).toBe('widget')
    expect(state.reads).toEqual([])
  })
})
