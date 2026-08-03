import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((opts: unknown) => {
    const err = new Error('REDIRECT') as Error & { __redirect: unknown }
    err.__redirect = opts
    return err
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: mocks.redirect,
}))

const { Route } = await import('../contacts.people')

type LoaderFn = () => unknown
function loader(): LoaderFn {
  return (Route.options as unknown as { loader: LoaderFn }).loader
}

describe('admin contacts.people redirect route', () => {
  it('throws a redirect to /admin/customers/people', () => {
    expect(() => loader()()).toThrow('REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith({ to: '/admin/customers/people' })
  })
})
