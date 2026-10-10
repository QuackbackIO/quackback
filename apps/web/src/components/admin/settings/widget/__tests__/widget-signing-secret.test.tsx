// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { maskSigningSecret } from '../widget-signing-secret'

const { mutateAsync, copyWithFallback, toast } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  copyWithFallback: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useRegenerateWidgetSecret: () => ({
    mutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: (...args: unknown[]) => copyWithFallback(...args),
}))

vi.mock('sonner', () => ({
  toast,
}))

describe('maskSigningSecret', () => {
  it('keeps the prefix and masks the rest', () => {
    expect(maskSigningSecret('wgt_abc123secret')).toBe('wgt_abc1••••••••')
  })
})

describe('WidgetSigningSecret', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    copyWithFallback.mockReset()
    copyWithFallback.mockResolvedValue(undefined)
    mutateAsync.mockResolvedValue('wgt_new')
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('masks the secret until reveal', async () => {
    const { WidgetSigningSecret } = await import('../widget-signing-secret')
    const secret = 'wgt_abc123secret'
    render(<WidgetSigningSecret secret={secret} />)

    expect(screen.getByTestId('signing-secret')).toHaveTextContent(maskSigningSecret(secret))
    expect(screen.queryByText(secret)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reveal signing secret' }))
    expect(screen.getByTestId('signing-secret')).toHaveTextContent(secret)
  })

  it('copies the full secret', async () => {
    const { WidgetSigningSecret } = await import('../widget-signing-secret')
    render(<WidgetSigningSecret secret="wgt_abc123secret" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(copyWithFallback).toHaveBeenCalledWith('wgt_abc123secret')
    })
  })

  it('regenerates after confirm', async () => {
    const { WidgetSigningSecret } = await import('../widget-signing-secret')
    render(<WidgetSigningSecret secret="wgt_abc123secret" />)

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate signing secret' }))
    expect(screen.getByText('Regenerate signing secret?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate secret' }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledOnce()
    })
    expect(toast.success).toHaveBeenCalledWith('Signing secret regenerated')
  })

  it('keeps the dialog open and toasts when regenerate fails', async () => {
    mutateAsync.mockRejectedValue(new Error('nope'))
    const { WidgetSigningSecret } = await import('../widget-signing-secret')
    render(<WidgetSigningSecret secret="wgt_abc123secret" />)

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate signing secret' }))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate secret' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not regenerate the signing secret')
    })
    expect(screen.getByText('Regenerate signing secret?')).toBeInTheDocument()
  })
})
