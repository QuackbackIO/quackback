// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Webhook } from '@/lib/shared/types'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: () => {} }) }))
vi.mock('@/lib/server/functions/webhooks', () => ({ updateWebhookFn: vi.fn() }))
vi.mock('../rotate-webhook-secret-dialog', () => ({ RotateWebhookSecretDialog: () => null }))

const { EditWebhookDialog } = await import('../edit-webhook-dialog')

afterEach(cleanup)

const hook = {
  id: 'webhook_1',
  url: 'https://example.com/hook',
  events: ['post.created'],
  boardIds: null,
  status: 'active',
  failureCount: 0,
  lastError: null,
  lastTriggeredAt: null,
  secret: 'whsec_test',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdById: 'principal_1',
} as unknown as Webhook

describe('EditWebhookDialog', () => {
  it('names controls by their visible text and uses sentence case', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditWebhookDialog webhook={hook} open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
    expect(screen.getByRole('switch', { name: 'Send events' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate secret' })).toBeInTheDocument()
  })

  it('scrolls inside the viewport when the event list is taller than the screen', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditWebhookDialog webhook={hook} open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
    const content = screen.getByRole('dialog')
    expect(content).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
  })
})
