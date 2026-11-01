// @vitest-environment happy-dom
/**
 * Home's Share an idea is the feed's composer, collapsed: what a visitor types
 * there goes with them to the feed, whose composer opens with it. The test
 * runs the real navigation and reads the arrival the way the feed does.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { takeArrivedTitle } from '@/components/public/feedback/feed-input-handoff'
import { HomeBlockView, type HomeBlock } from '../home-blocks'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const COMPOSER = { type: 'composer', width: 'full' } as HomeBlock

function renderHome(gates = GATES) {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <HomeBlockView block={COMPOSER} index={0} gates={gates} />,
  })
  const feed = createRoute({
    getParentRoute: () => root,
    path: '/feedback',
    component: () => <p>feed</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, feed]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <PortalWordsIntl>
          <RouterProvider router={router} />
        </PortalWordsIntl>
      </IntlProvider>
    </QueryClientProvider>
  )
  return router
}

afterEach(cleanup)

describe('Home’s Share an idea', () => {
  it('takes what was typed to the feed, which opens its composer with it', async () => {
    const router = renderHome()
    const input = await screen.findByRole('textbox', { name: 'Idea title' })
    fireEvent.change(input, { target: { value: '  Dark mode for the app  ' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    await screen.findByText('feed')
    expect(router.state.location.pathname).toBe('/feedback')
    expect(takeArrivedTitle(router.state.location.state)).toBe('Dark mode for the app')
  })

  it('opens the composer empty when nothing was typed', async () => {
    const router = renderHome()
    await screen.findByRole('textbox', { name: 'Idea title' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    await screen.findByText('feed')
    expect(takeArrivedTitle(router.state.location.state)).toBe('')
  })

  it('is not drawn while Feedback is off', async () => {
    renderHome({ ...GATES, feedback: false })
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
