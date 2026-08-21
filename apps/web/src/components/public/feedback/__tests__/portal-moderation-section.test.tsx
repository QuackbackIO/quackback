// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the moderation server fns — the section reuses these verbatim. The
// gate itself is enforced server-side (covered by moderation.test.ts); these
// tests assert the portal render contract: zero footprint when the viewer
// lacks post.approve, and correct wiring when they hold it.
const { mockList, mockListComments } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockListComments: vi.fn(),
}))

vi.mock('@/lib/server/functions/moderation', () => ({
  listPendingPostsFn: (...args: unknown[]) => mockList(...args),
  listPendingCommentsFn: (...args: unknown[]) => mockListComments(...args),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PortalModerationSection } from '../portal-moderation-section'

function renderSection(enabled: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" defaultLocale="en">
        <PortalModerationSection enabled={enabled} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

const PENDING = {
  posts: [
    {
      id: 'post_1',
      title: 'Dark mode please',
      content: 'It would be great to have a dark theme.',
      createdAt: new Date('2024-01-01').toISOString(),
      boardName: 'Feature Requests',
      authorName: 'Alice',
    },
  ],
}

beforeEach(() => {
  mockList.mockReset()
  mockListComments.mockReset().mockResolvedValue({ comments: [] })
})

afterEach(() => cleanup())

describe('PortalModerationSection — render gate', () => {
  it('renders nothing and issues zero queries when the viewer lacks post.approve', async () => {
    mockList.mockResolvedValue(PENDING)
    const { container } = renderSection(false)
    // enabled=false disables the query entirely — the customer/non-holder path
    // must not touch the pending-posts endpoint.
    await waitFor(() => {
      expect(mockList).not.toHaveBeenCalled()
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the banner and quarantined cards for a post.approve holder', async () => {
    mockList.mockResolvedValue(PENDING)
    renderSection(true)
    expect(await screen.findByText(/waiting for approval/i)).toBeInTheDocument()
    expect(screen.getByText('Dark mode please')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open queue/i })).toBeInTheDocument()
  })

  it('renders nothing when the holder has an empty queue', async () => {
    mockList.mockResolvedValue({ posts: [] })
    const { container } = renderSection(true)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
