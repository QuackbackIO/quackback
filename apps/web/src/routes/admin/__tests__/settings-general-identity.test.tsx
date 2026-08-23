// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdentityCard } from '../settings.general'

vi.mock('@/components/admin/settings/logo-uploader', () => ({
  LogoUploader: ({ workspaceName }: { workspaceName: string }) => (
    <button type="button" aria-label="Change workspace logo">
      {workspaceName.charAt(0).toUpperCase() || 'W'}
    </button>
  ),
}))

describe('General workspace identity', () => {
  it('shows logo and name with no Workspace URL field', () => {
    render(
      <WorkspaceIdentityCard
        workspaceName="Acme"
        saving={false}
        managed={false}
        onWorkspaceNameChange={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    expect(
      screen.getByText('Your logo and name, shown across the portal, widget, and emails')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace Name')).toHaveValue('Acme')
    expect(screen.getByRole('button', { name: 'Change workspace logo' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Workspace URL')).not.toBeInTheDocument()
    expect(screen.queryByText(/Friendly Quackback URL/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ws-/)).not.toBeInTheDocument()
  })
})
