// @vitest-environment happy-dom
/**
 * Brand › Fonts: the workspace's own font. Weights and the family come from
 * the file names, nothing uploads before the licence is ticked, each file
 * goes to storage as woff2, and the draft's font becomes the uploaded family
 * with the old one as its fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign } from '@/lib/shared/design/schema'

const server = vi.hoisted(() => ({
  configured: true,
  asked: [] as unknown[],
  refusal: null as null | { ok: false; code: string; message: string },
}))

vi.mock('@/lib/server/functions/uploads', () => ({
  checkS3ConfiguredFn: async () => ({ configured: server.configured }),
  getFontUploadUrlFn: async ({ data }: { data: { filename: string } }) => {
    server.asked.push(data)
    if (server.refusal) return server.refusal
    const key = `fonts/2026/10/abc-${data.filename.toLowerCase()}`
    return { ok: true, uploadUrl: `/api/storage/${key}?sig=x`, key }
  },
}))

const { FontsSection, guessFace, guessFamily } = await import('../fonts-section')

describe('reading a font file’s name', () => {
  it.each([
    ['Unbounded-Bold.woff2', 700, 'normal'],
    ['Brand-SemiBoldItalic.woff2', 600, 'italic'],
    ['brand_extralight.woff2', 200, 'normal'],
    ['Brand-500.woff2', 500, 'normal'],
    ['Brand.woff2', 400, 'normal'],
  ])('%s is %i %s', (name, weight, style) => {
    expect(guessFace(name)).toEqual({ weight, style })
  })

  it('takes the family from before the weight', () => {
    expect(guessFamily('Unbounded-Bold.woff2')).toBe('Unbounded')
    expect(guessFamily('BrandSans_Regular.woff2')).toBe('Brand Sans')
  })
})

const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
vi.stubGlobal('fetch', fetchSpy)

function renderSection() {
  const seen = { design: defaultDesign() }
  function Harness() {
    const [design, setDesign] = useState(seen.design)
    return (
      <FontsSection
        design={design}
        update={(change) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
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

async function openOwnFont() {
  const details = screen.getByText('Your own font').closest('details')!
  details.open = true
  await act(async () => details.dispatchEvent(new Event('toggle')))
}

const woff2 = (name: string, size = 30_000) =>
  new File([new Uint8Array(size)], name, { type: 'font/woff2' })

afterEach(() => {
  cleanup()
  server.configured = true
  server.asked = []
  server.refusal = null
  fetchSpy.mockClear()
})

describe('your own font', () => {
  it('says why when there is no file storage', async () => {
    server.configured = false
    renderSection()
    await openOwnFont()
    expect(await screen.findByText('Uploading fonts needs file storage.')).toBeTruthy()
    expect(screen.queryByLabelText('Font files')).toBeNull()
  })

  it('uploads once the licence is ticked, and makes it the heading font', async () => {
    const seen = renderSection()
    await openOwnFont()
    fireEvent.change(await screen.findByLabelText('Font files'), {
      target: { files: [woff2('Unbounded-Bold.woff2')] },
    })
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Unbounded')
    const add = screen.getByRole('button', { name: 'Add font' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I have a licence to use this font on the web.' })
    )
    await act(async () => fireEvent.click(add))
    // Each file asks for a URL and uploads before the draft changes.
    await waitFor(() => expect(seen.design.brand.fonts.heading.kind).toBe('uploaded'), {
      timeout: 5000,
    })

    expect(server.asked).toEqual([{ filename: 'Unbounded-Bold.woff2', fileSize: 30_000 }])
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/storage/fonts/2026/10/abc-unbounded-bold.woff2?sig=x',
      expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'font/woff2' } })
    )
    expect(seen.design.brand.fonts.heading).toEqual({
      kind: 'uploaded',
      family: 'Unbounded',
      files: [{ key: 'fonts/2026/10/abc-unbounded-bold.woff2', weight: 700, style: 'normal' }],
      fallback: 'inter',
    })
    expect(seen.design.brand.fonts.headingWeight).toBe(700)
    expect(seen.design.brand.fonts.body).toEqual(defaultDesign().brand.fonts.body)
  })

  it('stops at a file that is too large, and shows a refusal', async () => {
    const seen = renderSection()
    await openOwnFont()
    const input = await screen.findByLabelText('Font files')
    fireEvent.change(input, { target: { files: [woff2('Big.woff2', 400 * 1024 + 1)] } })
    expect(screen.getByRole('alert').textContent).toBe('Big.woff2 is over 400 KB.')

    fireEvent.change(input, { target: { files: [woff2('Brand-Bold.woff2')] } })
    server.refusal = {
      ok: false,
      code: 'TIER_LIMIT_EXCEEDED',
      message: 'Uploading fonts is not available on your plan. Upgrade to enable it.',
    }
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I have a licence to use this font on the web.' })
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add font' })))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Uploading fonts is not available on your plan. Upgrade to enable it.'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(seen.design.brand.fonts.heading).toEqual(defaultDesign().brand.fonts.heading)
  })
})
