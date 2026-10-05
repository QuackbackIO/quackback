// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  group: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  get_distinct_id: vi.fn(() => 'anon-device'),
  get_property: vi.fn((): unknown => undefined),
}))
vi.mock('posthog-js', () => ({ default: posthog }))

const ctx = vi.hoisted(() => ({
  analytics: null as null | {
    key: string
    host: string
    sessionRecording: boolean
    workspaceId: string | null
  },
  session: null as unknown,
  settings: { name: 'Acme' } as unknown,
  role: 'admin' as string | null,
}))
const route = vi.hoisted(() => ({ ids: ['__root__', '/admin', '/admin/feedback'] }))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ matches: route.ids.map((routeId) => ({ routeId })) }),
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useProductAnalyticsConfig: () => ctx.analytics,
  useSessionContext: () => ctx.session,
  useWorkspaceSettings: () => ctx.settings,
  useUserRole: () => ctx.role,
}))

import { ProductAnalytics } from '../product-analytics'
import { setAnalyticsClient, track } from '@/lib/client/analytics'

const teamSession = (id = 'user_1', email = 'ana@example.com') => ({
  session: { scope: 'dashboard' },
  user: { id, email, name: 'Ana', principalType: 'user' },
})

beforeEach(() => {
  vi.clearAllMocks()
  setAnalyticsClient(null)
  posthog.get_property.mockReturnValue(undefined)
  posthog.get_distinct_id.mockReturnValue('anon-device')
  ctx.analytics = {
    key: 'phc_test',
    host: 'https://eu.i.posthog.com',
    sessionRecording: true,
    workspaceId: 'ws_1',
  }
  ctx.session = teamSession()
  ctx.role = 'admin'
  route.ids = ['__root__', '/admin', '/admin/feedback']
})
afterEach(cleanup)

describe('ProductAnalytics', () => {
  it('loads nothing when the operator configured no key', async () => {
    ctx.analytics = null
    render(<ProductAnalytics />)
    await new Promise((r) => setTimeout(r, 0))
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('starts with the configured host and masks everything a replay could show', async () => {
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1))
    const [key, options] = posthog.init.mock.calls[0] as [string, Record<string, unknown>]
    expect(key).toBe('phc_test')
    expect(options).toMatchObject({
      api_host: 'https://eu.i.posthog.com',
      cross_subdomain_cookie: true,
      capture_pageview: 'history_change',
      person_profiles: 'identified_only',
      disable_session_recording: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    })
  })

  it('keeps replay off when the operator turned it off', async () => {
    ctx.analytics = { ...ctx.analytics!, sessionRecording: false }
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    expect(posthog.init.mock.calls[0]![1]).toMatchObject({ disable_session_recording: true })
  })

  it('identifies the team member and groups them under the workspace', async () => {
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled())
    expect(posthog.identify).toHaveBeenCalledWith('ana@example.com', {
      email: 'ana@example.com',
      name: 'Ana',
      role: 'admin',
    })
    expect(posthog.group).toHaveBeenCalledWith('workspace', 'ws_1', { name: 'Acme' })
  })

  it('does not identify a session outside the dashboard scope', async () => {
    ctx.session = { ...teamSession(), session: { scope: 'portal' } }
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    expect(posthog.identify).not.toHaveBeenCalled()
  })

  it('starts a fresh person when a different team member signs in on this browser', async () => {
    posthog.get_property.mockReturnValue('identified')
    posthog.get_distinct_id.mockReturnValue('previous@example.com')
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled())
    expect(posthog.reset).toHaveBeenCalled()
    expect(posthog.reset.mock.invocationCallOrder[0]).toBeLessThan(
      posthog.identify.mock.invocationCallOrder[0]!
    )
  })

  it('keeps an already identified person when the same person arrives from another app', async () => {
    posthog.get_property.mockReturnValue('identified')
    posthog.get_distinct_id.mockReturnValue('ana@example.com')
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled())
    expect(posthog.reset).not.toHaveBeenCalled()
  })

  it.each([
    [['__root__', '/onboarding', '/onboarding/_layout', '/onboarding/_layout/workspace']],
    [['__root__', '/auth/open-handoff']],
    [['__root__', '/admin/signup']],
  ])('runs on the signup and onboarding path %j', async (ids) => {
    route.ids = ids
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
  })

  it.each([
    [['__root__', '/_portal', '/_portal/']],
    [['__root__', '/widget']],
    [['__root__', '/hc', '/hc/$']],
    [['__root__', '/auth/login']],
  ])('never loads for visitors on %j', async (ids) => {
    route.ids = ids
    render(<ProductAnalytics />)
    await new Promise((r) => setTimeout(r, 0))
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('sends explicit funnel events once started, and drops them otherwise', async () => {
    await track('onboarding_workspace_saved', { useCase: 'feedback' })
    expect(posthog.capture).not.toHaveBeenCalled()

    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    await track('onboarding_workspace_saved', { useCase: 'feedback' })
    expect(posthog.capture).toHaveBeenCalledWith('onboarding_workspace_saved', {
      useCase: 'feedback',
    })
  })
})
