// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: () => {} }) }))
vi.mock('@/lib/server/functions/webhooks', () => ({ createWebhookFn: vi.fn() }))

const { CreateWebhookDialog } = await import('../create-webhook-dialog')

afterEach(cleanup)

describe('CreateWebhookDialog', () => {
  it('scrolls inside the viewport when the event list is taller than the screen', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateWebhookDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
    const content = screen.getByRole('dialog')
    expect(content).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
  })
})
