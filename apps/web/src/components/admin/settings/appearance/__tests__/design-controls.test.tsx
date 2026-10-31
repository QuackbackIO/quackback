// @vitest-environment happy-dom
/**
 * The Brand and Sections tabs reach every choice a design makes: type style,
 * a second colour, the logo, buttons, the band and its image, a header on
 * the band, status markers, and where Home's composer sits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const uploads = vi.hoisted(() => ({ asked: [] as Array<{ fn: string; data: unknown }> }))
vi.mock('@/lib/server/functions/uploads', () => ({
  getWordmarkUploadUrlFn: async ({ data }: { data: unknown }) => {
    uploads.asked.push({ fn: 'wordmark', data })
    return { uploadUrl: 'https://storage.example.com/put', key: 'header-logos/w.svg' }
  },
  getBandImageUploadUrlFn: async ({ data }: { data: unknown }) => {
    uploads.asked.push({ fn: 'band', data })
    return { uploadUrl: 'https://storage.example.com/put', key: 'portal-images/room.jpg' }
  },
  getFontUploadUrlFn: vi.fn(),
  checkS3ConfiguredFn: async () => ({ configured: true }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/admin/settings/branding/welcome-body-editor', () => ({
  WelcomeBodyEditor: () => null,
}))
vi.mock('@/components/ui/select', async () => ({
  ...(await import('@/test/radix-select')),
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { roadmaps: () => ({ queryKey: ['roadmaps'], queryFn: async () => [] }) },
}))

const { BrandPanel } = await import('../brand-panel')
const { SectionsPanel } = await import('../sections-panel')

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function mount(panel: 'brand' | 'sections', start: PortalDesign = defaultDesign()) {
  const seen = { design: start }
  function Harness() {
    const [design, setDesign] = useState(start)
    const update = (change: (draft: PortalDesign) => void) => {
      const next = structuredClone(seen.design)
      change(next)
      seen.design = next
      setDesign(next)
    }
    return panel === 'brand' ? (
      <BrandPanel design={design} update={update} />
    ) : (
      <SectionsPanel
        design={design}
        update={update}
        gates={GATES}
        onEditHome={() => {}}
        cssWarnings={[]}
      />
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return seen
}

afterEach(() => {
  cleanup()
  uploads.asked = []
  vi.unstubAllGlobals()
})

describe('the Brand tab', () => {
  it('sets headline size, tracking and case together as a type style', () => {
    const seen = mount('brand')
    expect(screen.getByRole('radio', { name: 'Quiet' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByText('Poster'))
    expect(seen.design.brand.fonts).toMatchObject({
      scale: 'display',
      tracking: 'tight',
      headlineCase: 'upper',
    })
    fireEvent.click(screen.getByLabelText('Menu and buttons in capitals'))
    expect(seen.design.brand.fonts.labelCase).toBe('upper')
  })

  it('sets a second colour, and clears it', () => {
    const seen = mount('brand')
    const field = screen.getByLabelText('Second colour')
    fireEvent.change(field, { target: { value: '#e58fae' } })
    expect(seen.design.brand.light.support).toBe('#e58fae')
    fireEvent.change(field, { target: { value: '' } })
    expect(seen.design.brand.light.support).toBeUndefined()
  })

  it('shows the wordmark slots for a wordmark, and stores an uploaded SVG’s key', async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', put)
    const seen = mount('brand')
    expect(screen.queryByLabelText('Wordmark', { selector: 'input[type=file]' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Wordmark' }))
    expect(seen.design.brand.logo.display).toBe('wordmark')
    const file = new File(['<svg/>'], 'wordmark.svg', { type: 'image/svg+xml' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Wordmark', { selector: 'input[type=file]' }), {
        target: { files: [file] },
      })
    })
    await waitFor(() =>
      expect(seen.design.brand.logo.wordmark.light).toEqual({ key: 'header-logos/w.svg' })
    )
    expect(uploads.asked).toEqual([
      {
        fn: 'wordmark',
        data: { filename: 'wordmark.svg', contentType: 'image/svg+xml', fileSize: 6 },
      },
    ])
    expect(put).toHaveBeenCalledWith(
      'https://storage.example.com/put',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('gives buttons their own shape', () => {
    const seen = mount('brand')
    expect(screen.getByRole('radio', { name: 'Like corners' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Buttons' })).getByText('Pill'))
    expect(seen.design.shape.buttons).toBe('pill')
  })
})

describe('the Sections tab', () => {
  const withHeadline = () => {
    const design = defaultDesign()
    design.pages.feedback.headline = { title: { en: 'Make it work harder' }, subtitle: {} }
    return design
  }

  it('offers the blend’s style and the band’s shape', () => {
    const seen = mount('sections', withHeadline())
    expect(screen.queryByText('Mesh')).toBeNull()
    fireEvent.click(screen.getByText('Blend'))
    fireEvent.click(screen.getByText('Mesh'))
    fireEvent.click(screen.getByText('Words on a panel'))
    expect(seen.design.layout).toMatchObject({ band: 'blend', blend: 'mesh', bandShape: 'panel' })
  })

  it('puts the header on the band once the band has colour', () => {
    const seen = mount('sections', withHeadline())
    const toggle = screen.getByLabelText('Header on the band')
    expect(toggle).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByText('Brand colour'))
    fireEvent.click(screen.getByLabelText('Header on the band'))
    expect(seen.design.layout.headerOnBand).toBe(true)
  })

  it('sets a phrase of the headline apart', () => {
    const seen = mount('sections', withHeadline())
    fireEvent.change(screen.getByLabelText('Phrase to set apart'), { target: { value: 'harder' } })
    expect(seen.design.pages.feedback.headline?.accent).toEqual({
      style: 'colour',
      text: { en: 'harder' },
    })
  })

  it('offers logo colours for status only when the logo has them', () => {
    const plain = mount('sections')
    expect(screen.queryByText('Logo colours')).toBeNull()
    fireEvent.click(screen.getByText('Tags'))
    expect(plain.design.layout.status).toBe('pill')
    cleanup()
    const design = defaultDesign()
    design.brand.logoColours = ['#ecb22e', '#36c5f0']
    mount('sections', design)
    expect(screen.getByText('Logo colours')).toBeTruthy()
  })
})
