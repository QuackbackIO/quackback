/**
 * The audience stamped on a session as Better Auth creates it.
 *
 * Two surfaces mint anonymous sessions through the same `/sign-in/anonymous`
 * endpoint: the portal (cookie, same origin) and the widget (Bearer token via
 * `set-auth-token`, cookies omitted). The portal session has to reach
 * `requireAuth`, which refuses widget scope; the widget session has to stay
 * widget so its Bearer never satisfies a site surface. Absent a marker the mint
 * is the widget's, so an old or unmarked client lands on the restrictive side.
 */
import { describe, expect, it } from 'vitest'
import { assignSessionScope } from '../session-audience'
import { SESSION_AUDIENCE_HEADER } from '@/lib/shared/roles'

const base = { userId: 'user_anon', token: 'tok', expiresAt: new Date(0) }

function ctx(
  path: string,
  headers: Record<string, string> = {},
  via: 'headers' | 'request' = 'headers'
) {
  const bag = new Headers(headers)
  return via === 'headers' ? { path, headers: bag } : { path, request: { headers: bag } }
}

describe('assignSessionScope', () => {
  it('tags the portal anonymous mint as portal', async () => {
    const result = await assignSessionScope(
      base,
      ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: 'portal' })
    )
    expect(result).toEqual({ data: { ...base, scope: 'portal' } })
  })

  it('reads the marker from the request when the context carries no header bag', async () => {
    const result = await assignSessionScope(
      base,
      ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: 'portal' }, 'request')
    )
    expect(result?.data.scope).toBe('portal')
  })

  it('tags the widget anonymous mint (no marker) as widget', async () => {
    const result = await assignSessionScope(base, ctx('/sign-in/anonymous'))
    expect(result).toEqual({ data: { ...base, scope: 'widget' } })
  })

  it('treats a mint with no context headers at all as widget', async () => {
    const result = await assignSessionScope(base, { path: '/sign-in/anonymous' })
    expect(result?.data.scope).toBe('widget')
  })

  it.each(['dashboard', 'widget', 'PORTAL', 'portal, dashboard', ''])(
    'never grants anything but portal or widget: marker %j mints widget',
    async (value) => {
      const result = await assignSessionScope(
        base,
        ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: value })
      )
      expect(result?.data.scope).toBe('widget')
    }
  )

  it('leaves non-anonymous sign-ins at the column default, marker or not', async () => {
    for (const path of ['/sign-in/email', '/sign-in/social', '/callback/:id']) {
      expect(
        await assignSessionScope(base, ctx(path, { [SESSION_AUDIENCE_HEADER]: 'portal' }))
      ).toBeUndefined()
    }
    expect(await assignSessionScope(base, null)).toBeUndefined()
  })
})
