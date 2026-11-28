// @vitest-environment happy-dom
/**
 * The widget's reply alerts card: three picture tiles for how an unread
 * reply shows while the widget is closed (a preview when nothing is
 * stored), and the tab title switch, off unless stored on. Both save under
 * the messenger settings and revert when the save fails.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: unknown) => ({})),
}))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return { ...actual, useRouter: () => ({ invalidate: vi.fn() }) }
})

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync, isPending: false }),
}))

const { ReplyAlertsCard } = await import('@/components/admin/settings/widget/reply-alerts-card')

type Config = Parameters<typeof ReplyAlertsCard>[0]['config']

const renderCard = (config: Config = {}) => render(<ReplyAlertsCard config={config} />)
const tile = (name: string) => screen.getByRole('radio', { name })
const titleSwitch = () => screen.getByRole('switch', { name: 'Show replies in the tab title' })

afterEach(() => {
  mutateAsync.mockReset().mockImplementation(async () => ({}))
  document.body.innerHTML = ''
})

describe('ReplyAlertsCard', () => {
  it('offers three picture tiles, with a preview chosen when nothing is stored', () => {
    renderCard()
    expect(screen.getByText('Reply alerts')).toBeTruthy()
    for (const name of ['Badge only', 'Preview', 'Full message']) expect(tile(name)).toBeTruthy()
    expect(tile('Preview').getAttribute('aria-checked')).toBe('true')
    const tiles = screen.getAllByRole('radio')
    expect(tiles).toHaveLength(3)
    tiles.forEach((t) => expect(t.querySelector('svg[aria-hidden="true"]')).not.toBeNull())
  })

  it('reflects a stored style', () => {
    renderCard({ messenger: { replyAlerts: 'full' } })
    expect(tile('Full message').getAttribute('aria-checked')).toBe('true')
  })

  it('saves a chosen style under the messenger settings', async () => {
    renderCard()
    fireEvent.click(tile('Badge only'))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ messenger: { replyAlerts: 'badge' } })
    )
    expect(tile('Badge only').getAttribute('aria-checked')).toBe('true')
  })

  it('goes back to the stored style when the save fails', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('save failed'))
    renderCard()
    fireEvent.click(tile('Full message'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(tile('Preview').getAttribute('aria-checked')).toBe('true'))
  })

  it('has the tab title switch off unless stored on, with its helper text', () => {
    renderCard()
    expect(titleSwitch().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('"Alex replied" while the visitor is on another tab.')).toBeTruthy()
    document.body.innerHTML = ''
    renderCard({ messenger: { titleAlerts: true } })
    expect(titleSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('saves the tab title switch, and reverts when the save fails', async () => {
    renderCard()
    fireEvent.click(titleSwitch())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ messenger: { titleAlerts: true } })
    )
    expect(titleSwitch().getAttribute('aria-checked')).toBe('true')
    // The switch is disabled until the first save settles; a click before then is ignored.
    await waitFor(() => expect(titleSwitch().hasAttribute('data-disabled')).toBe(false))

    mutateAsync.mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(titleSwitch())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(titleSwitch().getAttribute('aria-checked')).toBe('true'))
  })
})
