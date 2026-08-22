// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdentityCard } from '../settings.general'

vi.mock('@/components/admin/settings/logo-uploader', () => ({
  LogoUploader: () => (
    <button type="button" aria-label="Change workspace logo">
      W
    </button>
  ),
}))

describe('cloud workspace identity on General', () => {
  it('keeps only name and logo — no URL controls or save button', () => {
    render(
      <WorkspaceIdentityCard
        workspaceName="Untitled workspace"
        saving={false}
        managed={false}
        onWorkspaceNameChange={vi.fn()}
        maxLength={80}
      />
    )

    expect(screen.getByLabelText('Workspace Name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Quackback URL')).not.toBeInTheDocument()
    expect(screen.queryByText(/Preview:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })
})
