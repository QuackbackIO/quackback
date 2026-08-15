// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceDangerCard } from '../workspace-danger-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/admin/settings/imports">{children}</a>
  ),
}))

vi.mock('@/lib/server/functions/workspace-wipe', () => ({
  wipeCloudWorkspaceFn: vi.fn(),
}))

vi.mock('@/components/admin/settings/imports/export-workspace-action', () => ({
  ExportWorkspaceAction: () => <button type="button">Export workspace data</button>,
}))

function renderCard(cloudEnabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDangerCard cloudEnabled={cloudEnabled} />
    </QueryClientProvider>
  )
}

describe('WorkspaceDangerCard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    )
  })

  it('always offers export and only offers wipe when cloud is on', () => {
    const { rerender } = renderCard(false)
    expect(screen.getByRole('button', { name: /Export workspace data/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wipe workspace' })).toBeNull()

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceDangerCard cloudEnabled />
      </QueryClientProvider>
    )
    expect(screen.getByRole('button', { name: 'Wipe workspace' })).toBeTruthy()
  })
})
