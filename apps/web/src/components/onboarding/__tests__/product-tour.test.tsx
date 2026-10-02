// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const testState = vi.hoisted(() => ({ feedback: true, navigate: vi.fn(async () => {}) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => testState.navigate }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useFeatureFlags: () => ({ feedback: testState.feedback }),
}))
vi.mock('@/lib/client/use-permissions', () => ({
  usePermissions: () => new Set([PERMISSIONS.POST_VIEW_PRIVATE]),
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  markTourSeenFn: vi.fn(async () => ({ ok: true })),
}))

import { ProductTourProvider, TOUR_STOPS, useProductTour } from '../product-tour'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function Start() {
  const tour = useProductTour()
  return <button onClick={() => tour?.start()}>Start tour</button>
}
function mount() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      bottom: 60,
      right: 110,
      width: 100,
      height: 50,
      toJSON: () => ({}),
    }
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient()}>
        <ProductTourProvider>
          <Start />
          {TOUR_STOPS.map((stop) => (
            <div key={stop.target} data-tour={stop.target} />
          ))}
        </ProductTourProvider>
      </QueryClientProvider>
    </IntlProvider>
  )
}

it('never starts automatically and runs all five stops with keyboard navigation and Escape', async () => {
  testState.feedback = true
  mount()
  expect(screen.queryByRole('dialog')).toBeNull()
  const start = screen.getByRole('button', { name: 'Start tour' })
  start.focus()
  fireEvent.click(start)
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Step 1 of 5')
  )
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
  for (let step = 2; step <= 5; step++) {
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', `Step ${step} of 5`)
    )
  }
  fireEvent.keyDown(document, { key: 'ArrowLeft' })
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Step 4 of 5')
  )
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(start).toHaveFocus()
})

it('skips products that are disabled and announces the remaining count', async () => {
  testState.feedback = false
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Start tour' }))
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Step 1 of 2')
  )
  fireEvent.keyDown(document, { key: 'ArrowRight' })
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Step 2 of 2')
  )
  expect(screen.getByText('Open your portal to see what customers see.')).toBeVisible()
})
