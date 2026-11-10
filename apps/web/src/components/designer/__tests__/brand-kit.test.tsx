// @vitest-environment happy-dom
/**
 * The brand kit: what the customer brings, as property rows. Fonts no pair
 * makes show as Custom and opening the kit never changes them; a pair picked
 * from its tiles writes both faces. A logo uploaded here goes into the draft
 * only, and Reset goes back to the workspace's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const ai = vi.hoisted(() => ({ available: true }))
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: {
    aiStatus: () => ({
      queryKey: ['ai-status'],
      queryFn: async () => ({ available: ai.available }),
    }),
  },
}))
vi.mock('@/lib/server/functions/uploads', () => {
  const presign = async ({ data }: { data: { filename: string } }) => ({
    uploadUrl: `/upload/${data.filename}?sig=x`,
    key: `design/${data.filename}`,
  })
  return {
    getWordmarkUploadUrlFn: presign,
    getFaviconUploadUrlFn: presign,
    getShareImageUploadUrlFn: presign,
    getBandImageUploadUrlFn: presign,
    getFontUploadUrlFn: vi.fn(),
    checkS3ConfiguredFn: async () => ({ configured: true }),
  }
})
vi.mock('@/lib/client/image-palette', () => ({
  imageInk: async () => null,
  imagePalette: async () => ['#0058A3', '#FFFFFF'],
  imageForModel: async () => null,
}))
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(null, { status: 200 }))
)

const { BrandKit } = await import('../brand-kit')

/** Fonts a start found: a face of its own for headlines, and a mix no pair makes. */
function imported(): PortalDesign {
  const design = defaultDesign()
  design.brand.fonts.heading = { kind: 'bundled', id: 'bodoni-moda' }
  design.brand.fonts.body = { kind: 'bundled', id: 'karla' }
  design.brand.fonts.display = { kind: 'bundled', id: 'unbounded' }
  return design
}

function renderKit(start: PortalDesign) {
  const seen = { design: start, updates: 0 }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <BrandKit
        design={design}
        logoUrl="/workspace-logo.png"
        update={(change) => {
          seen.updates += 1
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return { seen, view }
}

afterEach(() => {
  cleanup()
  ai.available = true
})

describe('the fonts', () => {
  it('show Custom for fonts no pair makes, and opening the kit changes nothing', () => {
    const start = imported()
    const before = structuredClone(start)
    const { seen } = renderKit(start)
    expect(screen.getByLabelText('Pair').textContent).toBe('Custom')
    expect(screen.getByRole('button', { name: 'Headline font: Unbounded' })).toBeTruthy()
    expect(seen.updates).toBe(0)
    expect(seen.design).toEqual(before)
  })

  it('write both faces of a pair picked from its tiles', () => {
    const { seen } = renderKit(imported())
    fireEvent.click(screen.getByLabelText('Pair'))
    fireEvent.click(screen.getByRole('radio', { name: 'Editorial' }))
    expect(seen.design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'fraunces' })
    expect(seen.design.brand.fonts.body).toEqual({ kind: 'bundled', id: 'inter' })
    expect(seen.design.brand.fonts.display).toBeUndefined()
    expect(document.getElementById('kit-font-pair')!.textContent).toBe('Editorial')
  })

  it('shows the headline font as the heading’s until set, then marks it with a Reset', () => {
    const { seen } = renderKit(imported())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to same as heading' }))
    expect(seen.design.brand.fonts.display).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Headline font: Same as heading' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset to same as heading' })).toBeNull()
  })

  it('sets the heading weight from tiles of the weights the face has', () => {
    const { seen } = renderKit(defaultDesign())
    const weights = within(screen.getByRole('radiogroup', { name: 'Heading weight' }))
    fireEvent.click(weights.getByRole('radio', { name: '700' }))
    expect(seen.design.brand.fonts.headingWeight).toBe(700)
  })
})

describe('the logo: an icon and a title', () => {
  it('shows the workspace logo as the icon until the portal has its own, and drafts an upload', async () => {
    const { seen } = renderKit(defaultDesign())
    expect(screen.getByText('Workspace logo')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset to workspace logo' })).toBeNull()
    const file = new File(['<svg/>'], 'mark.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByLabelText('Replace icon'), { target: { files: [file] } })
    await waitFor(() =>
      expect(seen.design.brand.logo.mark.light).toEqual({ key: 'design/mark.svg' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset to workspace logo' }))
    expect(seen.design.brand.logo.mark.light).toBeNull()
  })

  it('fills the logo colours from an uploaded icon, in the same step', async () => {
    const { seen } = renderKit(defaultDesign())
    const file = new File(['png'], 'mark.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Replace icon'), { target: { files: [file] } })
    await waitFor(() => expect(seen.design.brand.logoColours).toEqual(['#0058a3', '#ffffff']))
    expect(seen.design.brand.logo.mark.light).toEqual({ key: 'design/mark.png' })
  })

  it('says on hover, not in a paragraph, that the admin keeps the workspace logo', () => {
    const { view } = renderKit(defaultDesign())
    expect(view.container.textContent).not.toMatch(/All of this is in your draft/)
    expect(
      view.container.querySelector('[title="Admin and emails keep the workspace logo"]')
    ).toBeTruthy()
  })

  it('offers an icon and a title only: no wordmarks, logos on dark or what the header shows', () => {
    renderKit(defaultDesign())
    expect(screen.queryByLabelText('Header shows')).toBeNull()
    expect(screen.queryByLabelText(/wordmark/i)).toBeNull()
    expect(screen.queryByLabelText(/on dark/i)).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Wordmark colour' })).toBeNull()
  })

  it('drafts the title, and an empty title goes back to the workspace name', () => {
    const { seen } = renderKit(defaultDesign())
    const title = screen.getByLabelText('Title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Harbor Help' } })
    expect(seen.design.brand.logo.name).toBe('Harbor Help')
    fireEvent.change(title, { target: { value: ' ' } })
    expect(seen.design.brand.logo).not.toHaveProperty('name')
  })

  it('brings an icon or a title back into view on a logo that showed only one', () => {
    const start = defaultDesign()
    start.brand.logo.display = 'name'
    const { seen } = renderKit(start)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Harbor' } })
    expect(seen.design.brand.logo.display).toBe('mark_and_name')
  })
})
