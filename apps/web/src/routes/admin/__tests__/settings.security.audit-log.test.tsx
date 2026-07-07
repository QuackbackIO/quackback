import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((input: unknown) => ({ kind: 'redirect', input }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: redirectMock,
}))

const { Route } = await import('../settings.security.audit-log')

describe('settings.security.audit-log route', () => {
  it('redirects to the canonical audit log URL', () => {
    let thrown: unknown

    try {
      ;(Route.options as { beforeLoad: () => void }).beforeLoad()
    } catch (error) {
      thrown = error
    }

    expect(redirectMock).toHaveBeenCalledWith({
      to: '/admin/settings/audit',
      replace: true,
    })
    expect(thrown).toEqual({
      kind: 'redirect',
      input: { to: '/admin/settings/audit', replace: true },
    })
  })
})
