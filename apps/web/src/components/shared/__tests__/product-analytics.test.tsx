// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const posthog = vi.hoisted(() => ({
  __loaded: false,
  init: vi.fn(function (this: { __loaded: boolean }) {
    // Like the real SDK: init marks the shared instance loaded.
    this.__loaded = true
  }),
  identify: vi.fn(),
  group: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  get_distinct_id: vi.fn(() => 'anon-device'),
  get_property: vi.fn((): unknown => undefined),
}))
vi.mock('posthog-js', () => ({ default: posthog }))

const ctx = vi.hoisted(() => ({
  analytics: null as null | {
    key: string
    apiHost: string
    uiHost: string | null
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

/** The options the component passed to `posthog.init`. */
const initOptions = () =>
  (posthog.init.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]

const teamSession = (id = 'user_1', email = 'ana@example.com') => ({
  session: { scope: 'dashboard' },
  user: { id, email, name: 'Ana', principalType: 'user' },
})

const optOut = (dnt: string | null, gpc: boolean | undefined) => {
  Object.defineProperty(navigator, 'doNotTrack', { value: dnt, configurable: true })
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  optOut(null, undefined)
  posthog.__loaded = false
  setAnalyticsClient(null)
  posthog.get_property.mockReturnValue(undefined)
  posthog.get_distinct_id.mockReturnValue('anon-device')
  ctx.analytics = {
    key: 'phc_test',
    apiHost: 'https://t.example.com',
    uiHost: 'https://eu.posthog.com',
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
    const [key, options] = posthog.init.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ]
    expect(key).toBe('phc_test')
    expect(options).toMatchObject({
      defaults: '2026-05-30',
      api_host: 'https://t.example.com',
      ui_host: 'https://eu.posthog.com',
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
    expect(initOptions()).toMatchObject({ disable_session_recording: true })
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
    // These URLs carry a credential: a one-time sign-in token, an invitation.
    [['__root__', '/auth/open-handoff']],
    [['__root__', '/complete-signup/$id']],
  ])('never loads for visitors or on credential-bearing pages: %j', async (ids) => {
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

  it('forgets a previous person when a tracked page is reached signed out', async () => {
    ctx.session = null
    route.ids = ['__root__', '/onboarding', '/onboarding/_layout/account']
    posthog.get_property.mockReturnValue('identified')
    posthog.get_distinct_id.mockReturnValue('previous@example.com')
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.reset).toHaveBeenCalled())
    expect(posthog.identify).not.toHaveBeenCalled()
  })

  it('drops every event sent from a page outside the tracked paths', async () => {
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    const beforeSend = initOptions().before_send as (e: unknown) => unknown
    const event = { event: '$pageview' }

    window.history.pushState({}, '', '/admin/feedback')
    expect(beforeSend(event)).toBe(event)
    window.history.pushState({}, '', '/onboarding/account')
    expect(beforeSend(event)).toBe(event)
    // The SDK records a client-side navigation before React re-renders, so the
    // URL itself is the gate, not component state.
    for (const path of [
      '/',
      '/b/ideas',
      '/hc/guide',
      '/auth/login',
      '/administrator',
      '/auth/open-handoff',
      '/complete-signup/inv_1',
    ]) {
      window.history.pushState({}, '', path)
      expect(beforeSend(event)).toBeNull()
    }
  })

  it('pauses replay and explicit events when the page leaves the tracked routes', async () => {
    const view = render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled())

    route.ids = ['__root__', '/_portal', '/_portal/']
    view.rerender(<ProductAnalytics />)
    await waitFor(() => expect(posthog.stopSessionRecording).toHaveBeenCalled())
    await track('portal_thing')
    expect(posthog.capture).not.toHaveBeenCalled()

    route.ids = ['__root__', '/admin', '/admin/feedback']
    view.rerender(<ProductAnalytics />)
    await waitFor(() => expect(posthog.startSessionRecording).toHaveBeenCalled())
  })

  it('strips query strings and fragments from every URL an event carries', async () => {
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    const beforeSend = initOptions().before_send as (e: unknown) => {
      properties: Record<string, unknown>
    }
    window.history.pushState({}, '', '/admin/inbox?token=secret#otp=1')
    const out = beforeSend({
      event: '$pageview',
      properties: {
        $current_url: 'https://acme.example.com/admin/inbox?token=secret#otp=1',
        $referrer: 'https://mail.example.com/?ott=abc',
        $referring_domain: 'mail.example.com',
        utm_source: 'newsletter',
        $set: { $current_url: 'https://acme.example.com/admin/inbox?token=secret' },
        $set_once: { $initial_current_url: 'https://acme.example.com/onboarding?ott=abc' },
      },
    })
    expect(out.properties).toMatchObject({
      $current_url: 'https://acme.example.com/admin/inbox',
      $referrer: 'https://mail.example.com/',
      $referring_domain: 'mail.example.com',
      utm_source: 'newsletter',
      $set: { $current_url: 'https://acme.example.com/admin/inbox' },
      $set_once: { $initial_current_url: 'https://acme.example.com/onboarding' },
    })
  })

  it('settles who this is before explicit events can be sent', async () => {
    posthog.get_property.mockReturnValue('identified')
    posthog.get_distinct_id.mockReturnValue('previous@example.com')
    posthog.reset.mockImplementation(() => track('probe'))
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled())
    // A track() made during the reset had no client yet, so it was dropped
    // rather than filed under the previous person.
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it.each([
    ['Do Not Track', '1', undefined],
    ['Global Privacy Control', null, true],
  ])('never loads when the browser sends %s', async (_name, dnt, gpc) => {
    optOut(dnt, gpc)
    render(<ProductAnalytics />)
    await new Promise((r) => setTimeout(r, 0))
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('loads when Do Not Track is explicitly off', async () => {
    optOut('0', false)
    render(<ProductAnalytics />)
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
  })
})
