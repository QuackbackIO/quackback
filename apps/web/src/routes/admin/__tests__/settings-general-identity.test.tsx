// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdentityCard } from '@/components/admin/settings/workspace-identity-card'

vi.mock('@/components/admin/settings/logo-uploader', () => ({
  LogoUploader: ({ workspaceName, focus }: { workspaceName: string; focus?: boolean }) => (
    <button type="button" aria-label="Change workspace logo" data-focus={focus ? 'yes' : 'no'}>
      {workspaceName.charAt(0).toUpperCase() || 'W'}
    </button>
  ),
}))

describe('General workspace identity', () => {
  it('shows logo and name with no Workspace URL field', () => {
    render(
      <WorkspaceIdentityCard workspaceName="Acme" managed={false} onWorkspaceNameChange={vi.fn()} />
    )
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    expect(
      screen.getByText('Your logo and name, shown across the portal, widget and emails.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme')
    expect(screen.getByRole('button', { name: 'Change workspace logo' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Workspace URL')).not.toBeInTheDocument()
    expect(screen.queryByText(/Friendly Quackback URL/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ws-/)).not.toBeInTheDocument()
  })

  it('passes the logo deep link through to the uploader', () => {
    const { rerender } = render(
      <WorkspaceIdentityCard workspaceName="Acme" managed={false} onWorkspaceNameChange={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Change workspace logo' })).toHaveAttribute(
      'data-focus',
      'no'
    )
    rerender(
      <WorkspaceIdentityCard
        workspaceName="Acme"
        managed={false}
        onWorkspaceNameChange={vi.fn()}
        focusLogo
      />
    )
    expect(screen.getByRole('button', { name: 'Change workspace logo' })).toHaveAttribute(
      'data-focus',
      'yes'
    )
  })
})
