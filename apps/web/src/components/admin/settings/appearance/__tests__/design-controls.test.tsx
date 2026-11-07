// @vitest-environment happy-dom
/**
 * The design controls the builder's panels are made of reach every choice a
 * design makes: type style, the logo and the name as a wordmark, buttons,
 * the band and its image, a header on the band, status markers, and where
 * Home's composer sits.
 */
import { selectWords, wordsEditor } from '@/components/designer/words/__tests__/words-test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  getFaviconUploadUrlFn: vi.fn(),
  getShareImageUploadUrlFn: vi.fn(),
  getLogoUploadUrlFn: vi.fn(),
  checkS3ConfiguredFn: async () => ({ configured: true }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
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

const { LogoControls } = await import('../logo-controls')
const { TypeStyleControls } = await import('../type-shape-controls')
const { FeedControls, HeaderControls, HeadlineFields } = await import('../section-controls')

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
      <>
        <LogoControls design={design} update={update} />
        <TypeStyleControls design={design} update={update} />
      </>
    ) : (
      <>
        <HeaderControls design={design} update={update} />
        <HeadlineFields design={design} update={update} page="feedback" locale="en" />
        <FeedControls design={design} update={update} />
      </>
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

describe('the type, logo and button controls', () => {
  it('sets headline size, tracking and case together as a type style', () => {
    const seen = mount('brand')
    expect(screen.getByRole('radio', { name: 'Quiet' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByText('Poster'))
    expect(seen.design.brand.fonts).toMatchObject({
      scale: 'display',
      tracking: 'tight',
      headlineCase: 'upper',
    })
  })

  it('shows the full logo slot once asked for, and stores an uploaded SVG’s key', async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', put)
    const seen = mount('brand')
    expect(screen.queryByLabelText('Full logo', { selector: 'input[type=file]' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Use a full logo image instead' }))
    expect(seen.design.brand.logo.display).toBe('wordmark')
    const file = new File(['<svg/>'], 'wordmark.svg', { type: 'image/svg+xml' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Full logo', { selector: 'input[type=file]' }), {
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
})

describe('the section controls', () => {
  const withHeadline = () => {
    const design = defaultDesign()
    design.pages.feedback.headline = { title: { en: 'Make it work harder' }, subtitle: {} }
    return design
  }

  it('sets a phrase of the headline apart by selecting it in the headline', async () => {
    const seen = mount('sections', withHeadline())
    expect(screen.queryByLabelText('Phrase to set apart')).toBeNull()
    const editor = await wordsEditor('Headline')
    selectWords(editor, 'harder')
    fireEvent.click(await screen.findByRole('button', { name: 'Accent' }))
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
