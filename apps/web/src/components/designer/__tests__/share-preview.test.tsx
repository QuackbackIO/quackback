// @vitest-environment happy-dom
/**
 * Share preview makes a link to the draft as it is, saving it first, copies
 * the link, and lists the live links with a way to revoke each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@/lib/server/functions/portal-design-preview', () => ({
  listPortalDesignPreviewLinksFn: fns.list,
  createPortalDesignPreviewLinkFn: fns.create,
  revokePortalDesignPreviewLinkFn: fns.revoke,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const events = vi.hoisted(() => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)

const { SharePreviewDialog } = await import('../share-preview')

const URL_MADE = `https://portal.example.com/?share=qbp_${'a'.repeat(43)}`
const link = (id: string, createdBy: string | null = 'Ada') => ({
  id,
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-08T10:00:00.000Z',
  createdBy,
})

const writeText = vi.fn(async () => undefined)
beforeEach(() => {
  fns.list.mockReset().mockResolvedValue([link('portal_design_preview_old')])
  fns.create
    .mockReset()
    .mockResolvedValue({ ok: true, url: URL_MADE, link: link('portal_design_preview_new') })
  fns.revoke.mockReset().mockResolvedValue({ ok: true })
  writeText.mockClear()
  events.trackBuilder.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

function open(flush: () => Promise<void> = vi.fn(async () => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SharePreviewDialog open onOpenChange={() => {}} flush={flush} />
    </QueryClientProvider>
  )
  return flush
}

describe('SharePreviewDialog', () => {
  it('saves the draft, makes a link and copies it', async () => {
    const order: string[] = []
    const flush = vi.fn(async () => {
      order.push('flush')
    })
    fns.create.mockImplementation(async () => {
      order.push('create')
      return { ok: true, url: URL_MADE, link: link('portal_design_preview_new') }
    })
    open(flush)
    fireEvent.click(await screen.findByRole('button', { name: 'Create link' }))
    expect(await screen.findByDisplayValue(URL_MADE)).toBeTruthy()
    expect(order).toEqual(['flush', 'create'])
    expect(writeText).toHaveBeenCalledWith(URL_MADE)
    expect(events.trackBuilder.mock.calls).toEqual([['designer_preview_link_shared', {}]])
  })

  it('says why a link could not be made', async () => {
    fns.create.mockResolvedValue({
      ok: false,
      code: 'PREVIEW_LINK_LIMIT',
      message: 'A portal can have 20 preview links at once. Revoke one to share another.',
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Create link' }))
    expect(await screen.findByText(/20 preview links at once/)).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()
    expect(events.trackBuilder).not.toHaveBeenCalled()
  })

  it('lists the live links and revokes one', async () => {
    open()
    expect(await screen.findByText(/by Ada/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() =>
      expect(fns.revoke).toHaveBeenCalledWith({ data: { id: 'portal_design_preview_old' } })
    )
    await waitFor(() => expect(fns.list).toHaveBeenCalledTimes(2))
  })
})
