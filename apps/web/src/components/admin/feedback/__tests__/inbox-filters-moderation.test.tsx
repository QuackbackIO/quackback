// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let canApprove = true
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => key === 'post.approve' && canApprove,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const { InboxFiltersPanel } = await import('../inbox-filters')

afterEach(cleanup)

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InboxFiltersPanel
        filters={{ sort: 'newest' }}
        onFiltersChange={() => {}}
        boards={[]}
        tags={[]}
        statuses={[]}
      />
    </QueryClientProvider>
  )
}

describe('InboxFiltersPanel moderation row', () => {
  it('links to the queue for a reviewer', () => {
    canApprove = true
    renderPanel()
    expect(screen.getByRole('link', { name: /Moderation/ })).toBeTruthy()
    expect(screen.getByText('Review')).toBeTruthy()
  })

  it('hides the row and its section without post.approve', () => {
    canApprove = false
    renderPanel()
    expect(screen.queryByRole('link', { name: /Moderation/ })).toBeNull()
    expect(screen.queryByText('Review')).toBeNull()
  })
})
