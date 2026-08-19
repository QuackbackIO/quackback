// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the moderation server fns — the section reuses these verbatim. The
// gate itself is enforced server-side (covered by moderation.test.ts); these
// tests assert the portal render contract: zero footprint when the viewer
// lacks post.approve, and correct wiring when they hold it.
const { mockList, mockApprove, mockReject } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}))

vi.mock('@/lib/server/functions/moderation', () => ({
  listPendingPostsFn: (...args: unknown[]) => mockList(...args),
  approvePostFn: (...args: unknown[]) => mockApprove(...args),
  rejectPostFn: (...args: unknown[]) => mockReject(...args),
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
  mockApprove.mockReset().mockResolvedValue({ ok: true })
  mockReject.mockReset().mockResolvedValue({ ok: true })
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

  it('renders the banner and a pending card for a post.approve holder', async () => {
    mockList.mockResolvedValue(PENDING)
    renderSection(true)
    // Banner count + card content driven by the reused list fn.
    expect(await screen.findByText(/waiting for approval/i)).toBeInTheDocument()
    expect(screen.getByText('Dark mode please')).toBeInTheDocument()
    // Pending state is text, not colour alone.
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot see this post yet/i)).toBeInTheDocument()
  })

  it('renders nothing when the holder has an empty queue', async () => {
    mockList.mockResolvedValue({ posts: [] })
    const { container } = renderSection(true)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PortalModerationSection — actions', () => {
  it('Approve calls approvePostFn with the post id', async () => {
    mockList.mockResolvedValue(PENDING)
    renderSection(true)
    const approveBtn = await screen.findByRole('button', { name: /approve/i })
    fireEvent.click(approveBtn)
    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith({ data: { postId: 'post_1' } })
    })
  })

  it('Reject opens the reason dialog and confirms with the typed reason', async () => {
    mockList.mockResolvedValue(PENDING)
    renderSection(true)
    const rejectBtn = await screen.findByRole('button', { name: /^reject$/i })
    fireEvent.click(rejectBtn)
    // Dialog appears with the optional reason field.
    const textarea = await screen.findByLabelText(/reason/i)
    fireEvent.change(textarea, { target: { value: 'off topic' } })
    const confirmBtn = screen.getByRole('button', { name: /reject post/i })
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith({
        data: { postId: 'post_1', reason: 'off topic' },
      })
    })
  })
})
