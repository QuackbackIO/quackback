// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { wipeCloudWorkspaceFn } from '@/lib/server/functions/workspace-wipe'
import { WorkspaceDangerCard } from '../workspace-danger-card'

vi.mock('@/lib/server/functions/workspace-wipe', () => ({
  wipeCloudWorkspaceFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
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

  it('names the restore window and what happens after it, and describes no hosting', () => {
    render(<WorkspaceDangerCard cloudEnabled />)
    expect(screen.getByText(/restore it from your Quackback dashboard for 30 days/i)).toBeTruthy()
    expect(screen.queryByText(/until it is purged/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    const dialog = screen.getByRole('alertdialog').textContent ?? ''
    expect(dialog).not.toMatch(/fleet/i)
    expect(dialog).toMatch(/offline/i)
    expect(dialog).toMatch(/permanently deleted/i)
    expect(dialog).toMatch(/subscription won't renew/i)
  })

  it('holds the delete back until the workspace name is typed', () => {
    render(<WorkspaceDangerCard cloudEnabled workspaceName="Acme" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    const dialog = screen.getByRole('alertdialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete workspace'
    )!
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Type Acme to confirm'), { target: { value: 'Acme' } })
    expect(confirm.hasAttribute('disabled')).toBe(false)
  })

  it('confirms before calling the delete, and calls it with the wipe confirmation', async () => {
    vi.mocked(wipeCloudWorkspaceFn).mockResolvedValue({ dashboardUrl: '/' } as never)
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true })
    render(<WorkspaceDangerCard cloudEnabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    expect(wipeCloudWorkspaceFn).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Type delete to confirm'), {
      target: { value: 'delete' },
    })
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
