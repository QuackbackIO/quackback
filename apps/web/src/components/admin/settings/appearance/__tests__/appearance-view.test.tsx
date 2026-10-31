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
  invalidations: 0,
  published: [] as unknown[],
  asks: [] as unknown[],
  directions: [] as unknown[],
  logos: [] as unknown[],
  events: [] as Array<[string, unknown]>,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: async () => {
      server.invalidations++
    },
  }),
  ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ settings: { featureFlags: { feedback: true, changelog: true } } }),
}))
vi.mock('@/components/admin/settings/branding/welcome-body-editor', () => ({
  WelcomeBodyEditor: () => null,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { roadmaps: () => ({ queryKey: ['roadmaps'], queryFn: async () => [] }) },
}))
vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: ({ design, page }: { design: { css: string }; page: string }) => (
    <div data-testid="preview" data-page={page}>
      {design.css.includes('--qb-card-padding: 0.75rem') ? 'compact' : 'comfortable'}
    </div>
  ),
}))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: async () => editorState(),
  listPortalDesignVersionsFn: async () => [],
  savePortalDesignDraftFn: async () => ({
    ok: true,
    report: { adjustments: [], errors: [], css: [] },
  }),
  discardPortalDesignDraftFn: async () => ({ ok: true }),
  publishPortalDesignFn: async ({ data }: { data: unknown }) => {
    server.published.push(data)
    return { ok: true, revisionId: 'portal_design_revision_1', number: 1 }
  },
  restorePortalDesignVersionFn: async () => ({ ok: true }),
  getPortalDesignSwitchFn: async () => ({
    available: false,
    canSwitchBack: false,
    report: { errors: [], warnings: [], carried: [] },
  }),
  switchBackPortalDesignFn: async () => ({ ok: true }),
}))

vi.mock('@/lib/client/analytics', () => ({
  track: async (event: string, properties: unknown) => {
    server.events.push([event, properties])
  },
}))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({
  getPortalDesignAiStatusFn: async () => ({ available: true }),
  portalDesignDirectionsFn: async ({ data }: { data: unknown }) => {
    server.directions.push(data)
    return { ok: true, looks: [] }
  },
  askPortalDesignAiFn: async ({ data }: { data: { scope: string; message: string } }) => {
    server.asks.push(data)
    if (data.message === 'Break') throw new Error('The server could not be reached')
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
      report: { adjustments: [], errors: [], css: [] },
    }
  },
}))

vi.mock('@/lib/client/image-palette', () => ({
  imagePalette: async () => ['#7a1f35', '#ffffff'],
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUploadWorkspaceLogo: () => ({
    mutateAsync: async (file: unknown) => {
      server.logos.push(file)
    },
  }),
}))

const { AppearanceView } = await import('../appearance-view')
const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')

function editorState() {
  return {
    design: defaultDesign(),
    live: defaultDesign(),
    source: 'converted' as const,
    published: null,
    report: { adjustments: [], errors: [], css: [] },
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
  server.invalidations = 0
  server.published = []
  server.asks = []
  server.directions = []
  server.logos = []
  server.events = []
})

const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent
// The menu's drag and drop keeps a status region of its own.
const draftBar = () =>
  screen
    .getAllByRole('status')
    .map((region) => region.textContent ?? '')
    .find((text) => text.startsWith('Draft'))

describe('AppearanceView', () => {
  it('previews Home once it is on, with the feed a click away', async () => {
    mount()
    const preview = () => screen.getByTestId('preview').dataset.page
    expect(preview()).toBe('feedback')
    expect(screen.queryByRole('group', { name: 'Page' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Home page' }))
    expect(preview()).toBe('home')
    // The starting layout holds the pages this workspace has.
    expect(screen.getByRole('list', { name: 'Home blocks' }).textContent).toContain(
      'Latest updates'
    )
    expect(screen.getByRole('list', { name: 'Home blocks' }).textContent).not.toContain('Status')
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(preview()).toBe('feedback')
    // Changing Home shows Home again.
    expect(screen.getByRole('textbox', { name: 'Feedback headline' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Home headline' }), {
      target: { value: 'Welcome to Acme' },
    })
    expect(preview()).toBe('home')
    fireEvent.click(screen.getByRole('switch', { name: 'Home page' }))
    expect(preview()).toBe('feedback')
  })

  it('shows a change in the preview and the draft bar at once', async () => {
    mount()
    expect(screen.queryByText(/not live/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Compact' }))
    expect(screen.getByTestId('preview').textContent).toBe('compact')
    expect(draftBar()).toContain('Draft · 1 change, not live')
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

  it('says a band needs a headline until it has one', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Tint' }))
    expect(screen.getByText('The band shows behind a headline. Add one below.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Ideas' } })
    expect(screen.queryByText('The band shows behind a headline. Add one below.')).toBeNull()
  })

  it('applies a preset’s whole look to the draft', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Start from a preset' }))
    fireEvent.click(await screen.findByRole('button', { name: /Editorial/ }))
    expect(draftBar()).toMatch(/Draft · \d+ changes, not live/)
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
    expect(draftBar()).toContain('Draft · 1 change, not live')

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

  it('starts from the colours of a logo, and can make it the workspace logo', async () => {
    mount({ ai: true })
    const logo = new File(['png'], 'logo.png', { type: 'image/png' })
    fireEvent.click(screen.getByLabelText('Also make it our logo'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Start from your logo or a screenshot'), {
        target: { files: [logo] },
      })
    })
    await waitFor(() => expect(server.directions).toEqual([{ palette: ['#7a1f35', '#ffffff'] }]))
    expect(server.logos).toEqual([logo])
    // The new logo reaches the root settings, and with them the preview.
    expect(server.invalidations).toBeGreaterThan(0)
    expect(
      await screen.findByText('It is now your logo. Here are three looks to start from.')
    ).toBeTruthy()
  })

  it('sends the colours of an image attached to a request', async () => {
    mount({ ai: true })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Attach an image'), {
        target: { files: [new File(['png'], 'shot.png', { type: 'image/png' })] },
      })
    })
    expect(await screen.findByText('shot.png')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), {
      target: { value: 'Use these colours' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(server.asks).toEqual([
      expect.objectContaining({ message: 'Use these colours', palette: ['#7a1f35', '#ffffff'] }),
    ])
    expect(screen.queryByText('shot.png')).toBeNull()
  })

  it('answers a request that failed, so the conversation never goes quiet', async () => {
    mount({ ai: true })
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), { target: { value: 'Break' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(
      await screen.findByText('Something went wrong, so nothing changed. Try again.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), { target: { value: 'Again' } })
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
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
