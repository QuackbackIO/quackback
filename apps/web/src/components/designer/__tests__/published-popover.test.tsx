// @vitest-environment happy-dom
/**
 * Publishing ends on Publish itself: the live address with Copy and Open,
 * and the way to a domain of its own only while the portal has none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const events = vi.hoisted(() => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { PublishedPopover } = await import('../published-popover')

afterEach(() => {
  cleanup()
  events.trackBuilder.mockReset()
})

function renderPopover(offerDomain: boolean, onClose = () => {}) {
  return render(
    <PublishedPopover address={{ url: 'https://acme.quackback.io', offerDomain }} onClose={onClose}>
      <button type="button">Publish</button>
    </PublishedPopover>
  )
}

describe('PublishedPopover', () => {
  it('shows the live address with Copy and Open', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPopover(false)
    expect(screen.getByRole('status').textContent).toBe('Published. Visitors see it now.')
    expect((screen.getByLabelText('Live address') as HTMLInputElement).value).toBe(
      'https://acme.quackback.io'
    )
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      'https://acme.quackback.io'
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(writeText).toHaveBeenCalledWith('https://acme.quackback.io')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_live_link_used', { action: 'copy' })
  })

  it('offers a domain of its own only while there is none', () => {
    renderPopover(true)
    expect(screen.getByRole('link', { name: 'Use your own domain' }).getAttribute('href')).toBe(
      '/admin/settings/domains'
    )
    cleanup()
    renderPopover(false)
    expect(screen.queryByRole('link', { name: 'Use your own domain' })).toBeNull()
  })

  it('shows nothing until there is an address', () => {
    render(
      <PublishedPopover address={null} onClose={() => {}}>
        <button type="button">Publish</button>
      </PublishedPopover>
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
