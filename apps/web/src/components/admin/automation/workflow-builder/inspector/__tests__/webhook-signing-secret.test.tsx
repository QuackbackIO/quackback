// @vitest-environment happy-dom
/**
 * The "Send webhook" step shows the secret its deliveries are signed with, on
 * request, for the URL in the step, and hides it again when the URL changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const getWorkflowWebhookSecretFn = vi.hoisted(() =>
  vi.fn(async ({ data }: { data: { url: string } }) => ({ secret: `whsec_for:${data.url}` }))
)
vi.mock('@/lib/server/functions/workflows', () => ({ getWorkflowWebhookSecretFn }))

import { WebhookSigningSecret } from '../action-editor'

afterEach(() => {
  cleanup()
  getWorkflowWebhookSecretFn.mockClear()
})

describe('WebhookSigningSecret', () => {
  it('shows the secret for the step URL on request', async () => {
    render(<WebhookSigningSecret url="https://hooks.example.com/a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show secret' }))

    expect(((await screen.findByLabelText('Signing secret')) as HTMLInputElement).value).toBe(
      'whsec_for:https://hooks.example.com/a'
    )
    expect(getWorkflowWebhookSecretFn).toHaveBeenCalledWith({
      data: { url: 'https://hooks.example.com/a' },
    })
  })

  it('hides the secret again when the URL changes', async () => {
    const { rerender } = render(<WebhookSigningSecret url="https://hooks.example.com/a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show secret' }))
    await screen.findByLabelText('Signing secret')

    rerender(<WebhookSigningSecret url="https://hooks.example.com/b" />)
    expect(screen.queryByLabelText('Signing secret')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show secret' })).toBeTruthy()
  })

  it('cannot be asked for before the URL is an https address', () => {
    render(<WebhookSigningSecret url="" />)
    expect(
      (screen.getByRole('button', { name: 'Show secret' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
