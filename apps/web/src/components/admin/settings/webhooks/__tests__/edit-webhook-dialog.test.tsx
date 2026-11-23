// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Webhook } from '@/lib/shared/types'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: () => {} }) }))
vi.mock('@/lib/server/functions/webhooks', () => ({ updateWebhookFn: vi.fn() }))
vi.mock('../rotate-webhook-secret-dialog', () => ({ RotateWebhookSecretDialog: () => null }))

const { EditWebhookDialog } = await import('../edit-webhook-dialog')
const { updateWebhookFn } = await import('@/lib/server/functions/webhooks')

afterEach(() => {
  cleanup()
  vi.mocked(updateWebhookFn).mockReset()
})

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

  function renderDialog(webhook: Webhook) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditWebhookDialog webhook={webhook} open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
  }

  async function savedData() {
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateWebhookFn).toHaveBeenCalledTimes(1))
    return (vi.mocked(updateWebhookFn).mock.calls[0][0] as { data: Record<string, unknown> }).data
  }

  it('leaves the status out of an edit that does not touch the switch', async () => {
    renderDialog({ ...hook, failureCount: 12, lastError: 'HTTP 500' } as Webhook)
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://example.com/moved' },
    })
    const data = await savedData()
    expect(data.url).toBe('https://example.com/moved')
    expect(data).not.toHaveProperty('status')
  })

  it('sends the status when the switch changes it', async () => {
    renderDialog({ ...hook, status: 'disabled', failureCount: 50 } as Webhook)
    fireEvent.click(screen.getByRole('switch', { name: 'Send events' }))
    expect(await savedData()).toMatchObject({ status: 'active' })
  })
})
