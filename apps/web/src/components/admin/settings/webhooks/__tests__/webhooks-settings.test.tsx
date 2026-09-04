// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Webhook } from '@/lib/shared/types'

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeModal: ({ open }: { open: boolean }) =>
    open ? <p>Webhooks are a Pro feature. Upgrade to Pro to enable it.</p> : null,
}))

vi.mock('../create-webhook-dialog', () => ({
  CreateWebhookDialog: ({ open }: { open: boolean }) => (open ? <p>Create webhook form</p> : null),
}))
vi.mock('../edit-webhook-dialog', () => ({
  EditWebhookDialog: () => null,
}))
vi.mock('../delete-webhook-dialog', () => ({
  DeleteWebhookDialog: () => null,
}))

const { WebhooksSettings } = await import('../webhooks-settings')

describe('WebhooksSettings create lock', () => {
  it('opens the upgrade modal instead of the create form when locked', () => {
    render(<WebhooksSettings webhooks={[]} entitled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Create your first webhook/ }))
    expect(screen.getByText(/Webhooks are a Pro feature/)).toBeTruthy()
    expect(screen.queryByText('Create webhook form')).toBeNull()
  })

  it('opens the create form when the plan includes webhooks', () => {
    render(<WebhooksSettings webhooks={[]} entitled />)
    fireEvent.click(screen.getByRole('button', { name: /Create your first webhook/ }))
    expect(screen.getByText('Create webhook form')).toBeTruthy()
    expect(screen.queryByText(/Webhooks are a Pro feature/)).toBeNull()
  })

  it('keeps existing webhooks visible when create is locked', () => {
    const webhook = {
      id: 'webhook_1',
      url: 'https://example.com/hook',
      events: ['post.created'],
      boardIds: null,
      status: 'active',
      failureCount: 0,
      lastError: null,
      lastTriggeredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: 'principal_1',
    } as unknown as Webhook
    render(<WebhooksSettings webhooks={[webhook]} entitled={false} />)
    expect(screen.getByText('https://example.com/hook')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Create Webhook/ }))
    expect(screen.getByText(/Webhooks are a Pro feature/)).toBeTruthy()
  })
})
