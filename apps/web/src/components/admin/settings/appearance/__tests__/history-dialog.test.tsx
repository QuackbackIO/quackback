// @vitest-environment happy-dom
/**
 * Versions: each can be copied into the draft to look at, where undo takes
 * it back, or restored, which publishes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const server = vi.hoisted(() => ({ canPublish: true }))

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: async () => {} }) }))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: vi.fn(),
  getPortalDesignSwitchFn: async () => ({ canSwitchBack: false, canPublish: server.canPublish }),
  listPortalDesignVersionsFn: async () => [
    {
      id: 'portal_design_revision_2',
      number: 2,
      source: 'appearance',
      message: null,
      publishedBy: 'Sam Rivera',
      createdAt: new Date(),
    },
    {
      id: 'portal_design_revision_1',
      number: 1,
      source: 'appearance',
      message: 'First',
      publishedBy: null,
      createdAt: new Date(),
    },
  ],
  switchBackPortalDesignFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({ getPortalDesignAiStatusFn: vi.fn() }))

const { HistoryDialog } = await import('../history-dialog')

afterEach(() => {
  cleanup()
  server.canPublish = true
})

describe('HistoryDialog', () => {
  it('says who published each version, when it knows', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoryDialog open onOpenChange={() => {}} currentNumber={2} onRestore={vi.fn()} />
      </QueryClientProvider>
    )
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('Appearance · Sam Rivera · ')
    expect(rows[1]!.textContent).toContain('First · ')
    expect(rows[1]!.textContent).not.toContain('Sam Rivera')
  })

  it('copies a version into the draft without publishing, and closes', async () => {
    const onCopy = vi.fn(async () => ({ ok: true as const }))
    const onRestore = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoryDialog
          open
          onOpenChange={onOpenChange}
          currentNumber={2}
          onRestore={onRestore}
          onCopy={onCopy}
        />
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Copy version \d+ into the draft/ })
      ).toHaveLength(2)
    )
    fireEvent.click(screen.getAllByRole('button', { name: /Copy version \d+ into the draft/ })[1]!)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onCopy).toHaveBeenCalledWith('portal_design_revision_1', 1)
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('offers copying, not restoring, to someone who may not publish', async () => {
    server.canPublish = false
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoryDialog
          open
          onOpenChange={() => {}}
          currentNumber={2}
          onRestore={vi.fn()}
          onCopy={vi.fn()}
        />
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Copy version \d+ into the draft/ })
      ).toHaveLength(2)
    )
    await screen.findByText('Restoring a version needs permission to publish the design.')
    expect(screen.queryByRole('button', { name: /^Restore version/ })).toBeNull()
  })
})
