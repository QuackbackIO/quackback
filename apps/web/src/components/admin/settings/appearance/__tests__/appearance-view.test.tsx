// @vitest-environment happy-dom
/**
 * Appearance edits the draft and says what is waiting: a change shows in the
 * draft bar at once, and Review and publish lists it before it goes live.
 * Quackback AI changes the same draft, scoped to the section picked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign } from '@/lib/shared/design/schema'

const server = vi.hoisted(() => ({
  published: [] as unknown[],
  asks: [] as unknown[],
  events: [] as Array<[string, unknown]>,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: ({ design }: { design: { css: string } }) => (
    <div data-testid="preview">
      {design.css.includes('--qb-card-padding: 0.75rem') ? 'compact' : 'comfortable'}
    </div>
  ),
}))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: async () => editorState(),
  listPortalDesignVersionsFn: async () => [],
  savePortalDesignDraftFn: async () => ({ ok: true, report: { adjustments: [], errors: [] } }),
  discardPortalDesignDraftFn: async () => ({ ok: true }),
  publishPortalDesignFn: async ({ data }: { data: unknown }) => {
    server.published.push(data)
    return { ok: true, revisionId: 'portal_design_revision_1', number: 1 }
  },
  restorePortalDesignVersionFn: async () => ({ ok: true }),
}))

vi.mock('@/lib/client/analytics', () => ({
  track: async (event: string, properties: unknown) => {
    server.events.push([event, properties])
  },
}))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({
  getPortalDesignAiStatusFn: async () => ({ available: true }),
  portalDesignDirectionsFn: async () => ({ ok: true, looks: [] }),
  askPortalDesignAiFn: async ({ data }: { data: { scope: string } }) => {
    server.asks.push(data)
    if (data.scope === 'header')
      return {
        ok: true,
        reply: 'That is outside the header, so nothing changed.',
        design: defaultDesign(),
        applied: [],
        skipped: 0,
        outOfScope: true,
        readability: [],
      }
    const design = defaultDesign()
    design.layout.density = 'compact'
    return {
      ok: true,
      reply: 'The feed is tighter.',
      design,
      applied: [{ path: 'layout.density', before: 'comfortable', after: 'compact' }],
      skipped: 0,
      readability: [],
      report: { adjustments: [], errors: [] },
    }
  },
}))

const { AppearanceView } = await import('../appearance-view')
const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')

function editorState() {
  return {
    design: defaultDesign(),
    live: defaultDesign(),
    source: 'converted' as const,
    published: null,
    report: { adjustments: [], errors: [] },
    revision: 'rev1',
  }
}

function mount({ ai = false }: { ai?: boolean } = {}) {
  const client = new QueryClient()
  client.setQueryData(portalDesignQueries.editor().queryKey, editorState())
  client.setQueryData(portalDesignQueries.aiStatus().queryKey, { available: ai })
  render(
    <QueryClientProvider client={client}>
      <AppearanceView workspaceName="Acme" faviconUrl={null} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  server.published = []
  server.asks = []
  server.events = []
})

const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent

describe('AppearanceView', () => {
  it('shows a change in the preview and the draft bar at once', async () => {
    mount()
    expect(screen.queryByText(/not live/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Compact' }))
    expect(screen.getByTestId('preview').textContent).toBe('compact')
    expect(screen.getByRole('status').textContent).toContain('Draft · 1 change, not live')
  })

  it('opens Sections when a section is picked in the preview', async () => {
    mount()
    expect(screen.queryByText('Menu style')).toBeNull()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-section', section: 'band' },
          origin: window.location.origin,
        })
      )
    })
    expect(await screen.findByText('Menu style')).toBeTruthy()
  })

  it('applies a preset’s whole look to the draft', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Start from a preset' }))
    fireEvent.click(await screen.findByRole('button', { name: /Editorial/ }))
    expect(screen.getByRole('status').textContent).toMatch(/Draft · \d+ changes, not live/)
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    expect(await screen.findByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Narrow' })).toHaveAttribute('aria-checked', 'true')
  })

  it('opens on Ask AI with a model, and on Brand without one', () => {
    mount({ ai: true })
    expect(selectedTab()).toBe('Ask AI')
    expect(screen.getByLabelText('Ask Quackback AI')).toBeTruthy()
    cleanup()
    mount()
    expect(selectedTab()).toBe('Brand')
    expect(screen.queryByLabelText('Ask Quackback AI')).toBeNull()
  })

  it('asks about the section picked, and the answer is already in the draft', async () => {
    mount({ ai: true })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-section', section: 'feed' },
          origin: window.location.origin,
        })
      )
    })
    expect(await screen.findByRole('button', { name: 'Clear the section' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), {
      target: { value: 'Tighter please' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(server.asks).toEqual([{ message: 'Tighter please', scope: 'feed', history: [] }])
    expect(selectedTab()).toBe('Ask AI')
    expect(await screen.findByText('Changes applied to your draft')).toBeTruthy()
    expect(screen.getByTestId('preview').textContent).toBe('compact')
    expect(screen.getByRole('status').textContent).toContain('Draft · 1 change, not live')

    fireEvent.click(screen.getByRole('button', { name: 'Review and publish' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() =>
      expect(server.events).toContainEqual(['appearance_published', { source: 'ai', changes: 1 }])
    )
  })

  it('asks again about the whole site when a request reached outside the section', async () => {
    mount({ ai: true })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-section', section: 'header' },
          origin: window.location.origin,
        })
      )
    })
    await screen.findByRole('button', { name: 'Clear the section' })
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), {
      target: { value: 'Tighter feed' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(await screen.findByText('That is outside the header, so nothing changed.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask about the whole site' }))
    })
    expect(server.asks).toEqual([
      { message: 'Tighter feed', scope: 'header', history: [] },
      expect.objectContaining({ message: 'Tighter feed', scope: 'site' }),
    ])
    expect(await screen.findByText('Changes applied to your draft')).toBeTruthy()
  })

  it('lists the change in Review and publish, then publishes it with its note', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review and publish' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Density')).toBeTruthy()
    expect(within(dialog).getByText('Compact')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Note for this version'), {
      target: { value: 'Tighter feed' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(server.published).toEqual([{ message: 'Tighter feed' }]))
    expect(server.events).toContainEqual(['appearance_published', { source: 'manual', changes: 1 }])
  })
})
