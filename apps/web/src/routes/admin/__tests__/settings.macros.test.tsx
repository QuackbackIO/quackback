// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/admin/conversation/macros-manager', () => ({
  MacrosManager: () => <p>macro library</p>,
}))
vi.mock('@/components/admin/upgrade', () => ({
  UpgradeScreen: () => <p>AI drafts are a Growth feature. Upgrade to Growth to enable it.</p>,
}))

const { MacrosSettingsBody } = await import('../settings.macros')

describe('macros settings page', () => {
  it('shows the in-route upgrade screen when macros are not on the plan', () => {
    render(<MacrosSettingsBody entitled={false} />)
    expect(screen.getByText(/AI drafts are a Growth feature/)).toBeTruthy()
    expect(screen.queryByText('macro library')).toBeNull()
  })

  it('shows the library when the plan includes macros', () => {
    render(<MacrosSettingsBody entitled />)
    expect(screen.getByText('macro library')).toBeTruthy()
    expect(screen.queryByText(/AI drafts are a Growth feature/)).toBeNull()
  })
})
