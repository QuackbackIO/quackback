// @vitest-environment happy-dom
/**
 * The primary domain's end of a provider sign-in started on a section host:
 * it starts the provider sign-in here, where the callback and its state
 * cookie live, and asks to come back through the handoff on the section host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({ social: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { social: hoisted.social } },
}))

const { SectionSignIn } = await import('../section-sign-in')

const replace = vi.fn()

beforeEach(() => {
  hoisted.social.mockReset()
  replace.mockReset()
  vi.stubGlobal('location', { host: 'acme.com', hostname: 'acme.com', replace })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SectionSignIn', () => {
  it('starts the provider sign-in here and comes back through the handoff', async () => {
    hoisted.social.mockResolvedValue({ data: { url: 'https://github.com/login/oauth?x=1' } })
    render(
      <SectionSignIn
        search={{
          provider: 'github',
          to: 'help.acme.com',
          returnTo: '/hc/articles/x',
          errorReturnTo: '/?auth=signin',
          loginHint: 'jo@example.com',
        }}
      />
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://github.com/login/oauth?x=1'))
    const args = hoisted.social.mock.calls[0]![0] as Record<string, string>
    expect(args.provider).toBe('github')
    expect(args.loginHint).toBe('jo@example.com')
    expect(args.disableRedirect).toBe(true)
    const callback = new URL(args.callbackURL!)
    expect(callback.origin).toBe('https://help.acme.com')
    expect(callback.pathname).toBe('/auth/section-handoff')
    expect(callback.searchParams.get('from')).toBe('acme.com')
    expect(callback.searchParams.get('returnTo')).toBe('/hc/articles/x')
    expect(args.errorCallbackURL).toBe('https://help.acme.com/?auth=signin')
  })

  it('never builds a callback from an unsafe path', async () => {
    hoisted.social.mockResolvedValue({ data: { url: 'https://github.com/login' } })
    render(
      <SectionSignIn
        search={{ provider: 'github', to: 'help.acme.com', returnTo: '//evil.example' }}
      />
    )
    await waitFor(() => expect(hoisted.social).toHaveBeenCalled())
    const args = hoisted.social.mock.calls[0]![0] as Record<string, string>
    expect(new URL(args.callbackURL!).searchParams.get('returnTo')).toBe('/')
    expect(args.errorCallbackURL).toBe('https://help.acme.com/')
  })

  it('does not start anything for a host that is not a plain host name', async () => {
    render(<SectionSignIn search={{ provider: 'github', to: 'evil.example/@x', returnTo: '/' }} />)
    expect(await screen.findByText(/could not start/i)).toBeTruthy()
    expect(hoisted.social).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('stays put with a message when the library refuses (a host it does not trust)', async () => {
    hoisted.social.mockResolvedValue({ data: null, error: { status: 403 } })
    render(<SectionSignIn search={{ provider: 'github', to: 'evil.example', returnTo: '/' }} />)
    expect(await screen.findByText(/could not start/i)).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})
