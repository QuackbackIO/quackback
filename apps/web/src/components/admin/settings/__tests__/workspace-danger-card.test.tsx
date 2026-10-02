// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { wipeCloudWorkspaceFn } from '@/lib/server/functions/workspace-wipe'
import { WorkspaceDangerCard } from '../workspace-danger-card'

vi.mock('@/lib/server/functions/workspace-wipe', () => ({
  wipeCloudWorkspaceFn: vi.fn(),
}))

describe('WorkspaceDangerCard', () => {
  afterEach(cleanup)

  it('renders nothing when there is no irreversible action to offer', () => {
    const { container } = render(<WorkspaceDangerCard cloudEnabled={false} />)
    expect(container.textContent).toBe('')
  })

  it('holds only an outline Delete workspace action, never an export', () => {
    render(<WorkspaceDangerCard cloudEnabled />)
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Delete workspace' })
    expect(button.classList.contains('text-destructive')).toBe(true)
    expect(button.classList.contains('bg-destructive')).toBe(false)
    expect(button.classList.contains('bg-primary')).toBe(false)
    expect(screen.queryByText(/export/i)).toBeNull()
  })

  it('says the delete is restorable and describes no hosting', () => {
    render(<WorkspaceDangerCard cloudEnabled />)
    expect(screen.getByText(/restored until it is purged/i)).toBeTruthy()
    expect(screen.queryByText(/permanently removes/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/fleet/i)
    expect(screen.getByRole('alertdialog').textContent).toMatch(/offline/i)
  })

  it('confirms before calling the delete, and calls it with the wipe confirmation', async () => {
    vi.mocked(wipeCloudWorkspaceFn).mockResolvedValue({ dashboardUrl: '/' } as never)
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true })
    render(<WorkspaceDangerCard cloudEnabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    expect(wipeCloudWorkspaceFn).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete workspace'
    )!
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(wipeCloudWorkspaceFn).toHaveBeenCalledWith({ data: { confirm: 'wipe' } })
    )
  })
})
