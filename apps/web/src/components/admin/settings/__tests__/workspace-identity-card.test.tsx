// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/admin/settings/logo-uploader', () => ({
  LogoUploader: () => <button type="button">Upload logo</button>,
}))

const { WorkspaceIdentityCard } = await import('../workspace-identity-card')

afterEach(cleanup)

const show = (portalInBuilder: boolean) =>
  render(
    <WorkspaceIdentityCard
      workspaceName="Acme"
      managed={false}
      onWorkspaceNameChange={() => {}}
      portalInBuilder={portalInBuilder}
    />
  )

describe('WorkspaceIdentityCard', () => {
  it('says the logo is for the admin and emails once the portal has its own brand', () => {
    show(true)
    expect(screen.getByText('Admin and emails')).toBeTruthy()
    expect(screen.queryByText(/portal/i)).toBeNull()
  })

  it('keeps saying the logo reaches the portal while the portal still uses it', () => {
    show(false)
    expect(screen.queryByText('Admin and emails')).toBeNull()
    expect(screen.getByText(/portal/)).toBeTruthy()
  })
})
