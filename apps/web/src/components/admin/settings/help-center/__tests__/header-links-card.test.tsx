// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HeaderLinksCard } from '../header-links-card'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateHelpCenterConfig: () => ({ mutate, isPending: false }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  mutate.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HeaderLinksCard', () => {
  it('shows a muted empty line and no Save links button', () => {
    render(<HeaderLinksCard links={[]} />)
    expect(screen.getByText('No header links yet.')).toBeTruthy()
    expect(screen.queryByText('Save links')).toBeNull()
  })

  it('does not save when a blank row is added', () => {
    render(<HeaderLinksCard links={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByLabelText('Link 1 label')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('autosaves the cleaned links after typing, dropping incomplete rows', () => {
    render(<HeaderLinksCard links={[{ label: 'Docs', url: '/docs' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }))
    fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: ' Blog ' } })
    expect(mutate).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({ headerLinks: [{ label: 'Blog', url: '/docs' }] })
  })

  it('asks before removing a saved link, then saves right away', async () => {
    render(
      <HeaderLinksCard
        links={[
          { label: 'Docs', url: '/docs' },
          { label: 'Blog', url: '/blog' },
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Delete link?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }))
    expect(mutate).toHaveBeenCalledWith({ headerLinks: [{ label: 'Blog', url: '/blog' }] })
  })

  it('keeps the link when the removal is cancelled', () => {
    render(<HeaderLinksCard links={[{ label: 'Docs', url: '/docs' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Link 1 label')).toBeTruthy()
  })

  it('removes a blank row without asking', () => {
    render(<HeaderLinksCard links={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }))
    expect(screen.queryByText('Delete link?')).toBeNull()
    expect(screen.getByText('No header links yet.')).toBeTruthy()
  })

  it('does not save a URL the server would reject, and says so on that row', () => {
    const { unmount } = render(<HeaderLinksCard links={[{ label: 'Docs', url: '/docs' }]} />)
    const url = screen.getByLabelText('Link 1 URL')
    fireEvent.change(url, { target: { value: 'example.com' } })
    fireEvent.blur(url)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/http/)
    unmount()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('saves every valid edit once the invalid row is fixed', () => {
    render(
      <HeaderLinksCard
        links={[
          { label: 'Docs', url: '/docs' },
          { label: 'Blog', url: '/blog' },
        ]}
      />
    )
    fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: 'Guides' } })
    fireEvent.change(screen.getByLabelText('Link 2 URL'), { target: { value: 'blog' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Link 2 URL'), { target: { value: 'https://blog.dev' } })
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({
      headerLinks: [
        { label: 'Guides', url: '/docs' },
        { label: 'Blog', url: 'https://blog.dev' },
      ],
    })
  })
})
