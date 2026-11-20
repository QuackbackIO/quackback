// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ useHasPermission: () => false }))
vi.mock('@/lib/server/functions/channel-accounts', () => ({ getSurfaceSenderFn: vi.fn() }))

const { FeedbackEmailCard } = await import('../feedback-email-card')
const { surfaceSenderQuery } = await import('@/lib/client/queries/channel-accounts')

afterEach(cleanup)

function renderCard(from: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(surfaceSenderQuery('feedback').queryKey, { from })
  return render(
    <QueryClientProvider client={client}>
      <FeedbackEmailCard />
    </QueryClientProvider>
  )
}

describe('FeedbackEmailCard', () => {
  it('says which address feedback email comes from', () => {
    renderCard('Acme <hello@acme.com>')
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.getByText('Sent from')).toBeTruthy()
    expect(screen.getByText('Acme <hello@acme.com>')).toBeTruthy()
  })

  it('shows nothing when no address is known', () => {
    const { container } = renderCard(null)
    expect(container.textContent).toBe('')
  })
})
