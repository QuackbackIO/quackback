// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

import { BoardImportSection } from '../board-import-section'
import { BoardExportSection } from '../board-export-section'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('board Data tab sections', () => {
  it('import links to the Imports & exports hub', () => {
    render(<BoardImportSection boardId="board_1" />)
    expect(screen.getByText('Import posts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /imports & exports/i }).getAttribute('href')).toBe(
      '/admin/settings/imports'
    )
  })

  it('export requests this board as CSV', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Export failed' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BoardExportSection boardId="board_1" />)
    expect(screen.getByText('Export posts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/export?boardId=board_1'))
    expect(await screen.findByText('Export failed')).toBeInTheDocument()
  })
})
