// @vitest-environment happy-dom

/**
 * The saved-views menu lists its views only inside the dropdown, so it loads
 * them when the viewer reaches for the menu (hover, focus or open) instead of
 * on every feedback page load.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listPostViews = vi.fn()
vi.mock('@/lib/server/functions/post-views', () => ({
  listPostViewsFn: () => listPostViews(),
  createPostViewFn: vi.fn(),
  deletePostViewFn: vi.fn(),
}))

const { SavedViewsMenu } = await import('../saved-views-menu')

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<SavedViewsMenu filters={{}} hasActiveFilters={false} onApply={vi.fn()} />, {
    wrapper,
  })
}

beforeEach(() => {
  listPostViews.mockReset()
  listPostViews.mockResolvedValue([{ id: 'view_1', name: 'Hot bugs', filters: {} }])
})
afterEach(cleanup)

describe('SavedViewsMenu', () => {
  it('does not load the views on render', async () => {
    renderMenu()
    await act(() => Promise.resolve())

    expect(listPostViews).not.toHaveBeenCalled()
  })

  it('loads the views when the viewer points at the menu', async () => {
    renderMenu()

    fireEvent.pointerEnter(screen.getByRole('button', { name: /views/i }))

    await waitFor(() => expect(listPostViews).toHaveBeenCalledTimes(1))
  })

  it('loads the views when the menu takes keyboard focus', async () => {
    renderMenu()

    fireEvent.focus(screen.getByRole('button', { name: /views/i }))

    await waitFor(() => expect(listPostViews).toHaveBeenCalledTimes(1))
  })
})
