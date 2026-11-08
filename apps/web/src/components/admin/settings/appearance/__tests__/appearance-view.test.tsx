// @vitest-environment happy-dom
/**
 * Appearance is a summary of the portal's design: what visitors see now, what
 * waits in the draft, when it was last published, and the way into the
 * builder. Nothing on it edits the design.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign } from '@/lib/shared/design/schema'

const flags = vi.hoisted(() => ({ extra: {} as Record<string, boolean> }))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme', brandingData: { logoUrl: '/logo.png' } }),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ settings: { featureFlags: { feedback: true, ...flags.extra } } }),
}))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: async () => editorState(),
  listPortalDesignVersionsFn: async () => versions,
  getPortalDesignSwitchFn: async () => ({ canSwitchBack: false, canPublish: true }),
  restorePortalDesignVersionFn: async () => ({ ok: true }),
  switchBackPortalDesignFn: async () => ({ ok: true }),
}))

type Version = {
  id: `portal_design_revision_${string}`
  number: number
  source: 'appearance'
  message: string | null
  principalId: null
  createdAt: Date
}
let versions: Version[] = []

// The portal's picture is a frame: drawn, never loaded, in a test.
;(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true

const { AppearanceView } = await import('../appearance-view')
const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')

function editorState(changed = false) {
  const design = defaultDesign()
  if (changed) {
    design.brand.light.accent = '#0f766e'
    design.layout.density = 'compact'
  }
  return {
    design,
    live: defaultDesign(),
    source: changed ? ('draft' as const) : ('converted' as const),
    published: versions[0] ? { revisionId: versions[0].id, number: versions[0].number } : null,
    report: { adjustments: [], errors: [], css: [] },
    revision: 'rev1',
    authors: {},
    draftSavedAt: null,
    // The server counts what the draft changes: the accent and the density.
    waiting: changed ? 2 : 0,
    canPublish: true,
  }
}

function mount({ changed = false } = {}) {
  const client = new QueryClient()
  client.setQueryData(portalDesignQueries.editor().queryKey, editorState(changed))
  client.setQueryData(portalDesignQueries.versions().queryKey, versions)
  render(
    <QueryClientProvider client={client}>
      <AppearanceView />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  flags.extra = {}
  versions = []
})

describe('AppearanceView', () => {
  it('says nothing is published or waiting on a portal still on its first design', () => {
    mount()
    expect(screen.getByText('Nothing published yet')).toBeTruthy()
    expect(screen.getByText('No changes waiting')).toBeTruthy()
  })

  it('shows the live version, when it was published, and the changes waiting', () => {
    versions = [
      {
        id: 'portal_design_revision_2',
        number: 2,
        source: 'appearance',
        message: null,
        principalId: null,
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    ]
    mount({ changed: true })
    expect(screen.getByText(/^Version 2/).textContent).toMatch(/published 3 days ago/)
    expect(screen.getByText('2 changes waiting to publish')).toBeTruthy()
  })

  it('edits nothing itself: the builder is where the design changes', () => {
    mount({ changed: true })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText(/logo/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'Open builder' }).getAttribute('href')).toBe(
      '/design?path=%2F&from=appearance'
    )
  })

  it('shows the live portal: a picture of it, its logo, colours and fonts', () => {
    mount({ changed: true })
    const picture = screen.getByTitle('Your portal')
    expect(picture.getAttribute('src')).toBe('/?theme=light&preview=true&sort=trending')
    expect(picture.closest('[inert]')).toBeTruthy()
    // The live design's, not the draft's: the draft's teal waits to publish.
    const swatches = screen.getByRole('list', { name: 'Colours' })
    expect(swatches.textContent).not.toContain('#0f766e')
    expect(
      Array.from(swatches.querySelectorAll('[data-swatch]')).map((s) => s.getAttribute('title'))
    ).toEqual(['oklch(0.886 0.176 86)', '#ffffff', '#0a0a0a'])
    expect(screen.getByText('Inter')).toBeTruthy()
    expect(screen.getByAltText('Acme logo').getAttribute('src')).toBe('/logo.png')
  })

  it('leads to the Brand kit match row, and into the builder', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Match your brand' }).getAttribute('href')).toBe(
      '/design?path=%2F&from=appearance&brand=match'
    )
  })
})
