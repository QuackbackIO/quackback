// @vitest-environment happy-dom
/**
 * The named route-context reads: each returns its part of the context, and a
 * navigation that hands the tree a new context with the same parts renders
 * none of their readers again. A part that did change reaches them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  useBaseUrl,
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlag,
  useFeatureFlags,
  useManagedFieldPaths,
  usePrincipalId,
  useProductEnabled,
  useSessionContext,
  useUserRole,
  useWorkspaceSettings,
} from '../use-root-context'

afterEach(cleanup)

const featureFlags = {
  feedback: true,
  changelog: false,
  helpCenter: false,
  supportInbox: true,
  supportTickets: false,
  statusPage: false,
}

// The root and admin beforeLoads keep one answer between navigations (their
// route-context memos), so the parts are the same objects each time while the
// context around them is new.
let rootAnswer: {
  settings: { featureFlags: typeof featureFlags }
  session: { user: { name: string } }
  userRole: string
  baseUrl: string
  billingEnabled: boolean
  cloudEnabled: boolean | undefined
  managedFieldPaths: string[]
}
const adminAnswer = { principal: { id: 'principal_1' } }

const reads: Array<Record<string, unknown>> = []

function Reader() {
  reads.push({
    settings: useWorkspaceSettings(),
    session: useSessionContext(),
    userRole: useUserRole(),
    baseUrl: useBaseUrl(),
    billingEnabled: useBillingEnabled(),
    cloudEnabled: useCloudEnabled(),
    managedFieldPaths: useManagedFieldPaths(),
    featureFlags: useFeatureFlags(),
    supportInbox: useFeatureFlag('supportInbox'),
    supportTickets: useFeatureFlag('supportTickets'),
    feedbackProduct: useProductEnabled('feedback'),
    changelogProduct: useProductEnabled('changelog'),
    principalId: usePrincipalId(),
  })
  return null
}

async function mount() {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => <Outlet />,
  })
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    beforeLoad: () => ({ ...adminAnswer }),
    component: () => (
      <>
        <Reader />
        <Outlet />
      </>
    ),
  })
  const pageA = createRoute({
    getParentRoute: () => adminRoute,
    path: '/feedback',
    component: () => <p>page a</p>,
  })
  const pageB = createRoute({
    getParentRoute: () => adminRoute,
    path: '/roadmap',
    component: () => <p>page b</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([pageA, pageB])]),
    history: createMemoryHistory({ initialEntries: ['/admin/feedback'] }),
    context: {},
  })
  render(<RouterProvider router={router} />)
  await screen.findByText('page a')
  return router
}

describe('route-context hooks', () => {
  it('read their part and render again only when it changes', async () => {
    const settings = { featureFlags }
    const session = { user: { name: 'Ada' } }
    const managedFieldPaths = ['portalConfig.oauth']
    rootAnswer = {
      settings,
      session,
      userRole: 'admin',
      baseUrl: 'https://feedback.example.com',
      billingEnabled: true,
      cloudEnabled: undefined,
      managedFieldPaths,
    }
    const router = await mount()

    expect(reads.at(-1)).toEqual({
      settings,
      session,
      userRole: 'admin',
      baseUrl: 'https://feedback.example.com',
      billingEnabled: true,
      cloudEnabled: false,
      managedFieldPaths,
      featureFlags,
      supportInbox: true,
      supportTickets: false,
      feedbackProduct: true,
      changelogProduct: false,
      principalId: 'principal_1',
    })
    expect(reads.at(-1)!.settings).toBe(settings)

    const renders = reads.length
    await act(() => router.navigate({ to: '/admin/roadmap' }))
    await screen.findByText('page b')
    expect(reads.length).toBe(renders)

    rootAnswer = { ...rootAnswer, settings: { featureFlags: { ...featureFlags, changelog: true } } }
    await act(() => router.invalidate())
    expect(reads.length).toBeGreaterThan(renders)
    expect(reads.at(-1)!.changelogProduct).toBe(true)
    expect(reads.at(-1)!.session).toBe(session)
  })
})
