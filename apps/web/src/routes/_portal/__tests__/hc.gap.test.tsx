// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteOptions = {
  beforeLoad: (input: { context: Record<string, unknown> }) => void
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Outlet: () => null,
  notFound: () => {
    throw { notFound: true }
  },
  redirect: (input: unknown) => {
    throw { redirect: input }
  },
}))

const { Route } = await import('../hc')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('portal help-center layout route — beforeLoad', () => {
  it('redirects when the help center tab is disabled', () => {
    expect(() =>
      routeOptions().beforeLoad({ context: { enabledTabs: { helpCenter: false } } })
    ).toThrow()
    try {
      routeOptions().beforeLoad({ context: { enabledTabs: { helpCenter: false } } })
    } catch (err) {
      expect(err).toEqual({ redirect: { to: '/' } })
    }
  })

  it('throws notFound when the help center feature flag is off', () => {
    try {
      routeOptions().beforeLoad({ context: { settings: { featureFlags: {} } } })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toEqual({ notFound: true })
    }
  })

  it('throws notFound when the help center config is disabled', () => {
    try {
      routeOptions().beforeLoad({
        context: {
          settings: { featureFlags: { helpCenter: true }, helpCenterConfig: { enabled: false } },
        },
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toEqual({ notFound: true })
    }
  })

  it('passes when feature flag and config are enabled', () => {
    expect(() =>
      routeOptions().beforeLoad({
        context: {
          settings: { featureFlags: { helpCenter: true }, helpCenterConfig: { enabled: true } },
        },
      })
    ).not.toThrow()
  })
})
