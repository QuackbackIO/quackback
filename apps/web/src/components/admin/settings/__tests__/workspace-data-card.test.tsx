// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkspaceDataCard } from '../workspace-data-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('WorkspaceDataCard', () => {
  afterEach(cleanup)

  it('links the export row to Imports & exports without starting an export itself', () => {
    render(<WorkspaceDataCard />)
    expect(screen.getByText('Export workspace data')).toBeTruthy()
    const link = screen.getByRole('link', { name: /Imports & exports/ })
    expect(link.getAttribute('href')).toBe('/admin/settings/imports')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
