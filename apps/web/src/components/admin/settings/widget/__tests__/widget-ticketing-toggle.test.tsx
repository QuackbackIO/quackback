// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WidgetTicketingToggle } from '../widget-ticketing-toggle'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  updateWidgetConfigFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useRouter: () => ({ invalidate: mocks.invalidate }),
  }
})

vi.mock('@/lib/server/functions/settings', () => ({
  updateWidgetConfigFn: mocks.updateWidgetConfigFn,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('WidgetTicketingToggle', () => {
  it('persists ticketing.enabled and invalidates settings', async () => {
    mocks.updateWidgetConfigFn.mockResolvedValueOnce({})
    const onEnabledChange = vi.fn()
    render(<WidgetTicketingToggle initialEnabled={false} onEnabledChange={onEnabledChange} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Support tickets' }))

    await waitFor(() =>
      expect(mocks.updateWidgetConfigFn).toHaveBeenCalledWith({
        data: { ticketing: { enabled: true } },
      })
    )
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1))
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })

  it('shows a saving state while the update is pending', async () => {
    let resolveUpdate!: () => void
    mocks.updateWidgetConfigFn.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve
      })
    )
    render(<WidgetTicketingToggle initialEnabled={false} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Support tickets' }))

    expect(screen.getByRole('switch', { name: 'Support tickets' })).toBeDisabled()
    resolveUpdate()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Support tickets' })).not.toBeDisabled()
    )
  })

  it('rolls back local and preview state when saving fails', async () => {
    mocks.updateWidgetConfigFn.mockRejectedValueOnce(new Error('failed'))
    const onEnabledChange = vi.fn()
    render(<WidgetTicketingToggle initialEnabled={false} onEnabledChange={onEnabledChange} />)

    const toggle = screen.getByRole('switch', { name: 'Support tickets' })
    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(onEnabledChange).toHaveBeenNthCalledWith(1, true)
    expect(onEnabledChange).toHaveBeenNthCalledWith(2, false)
  })
})
