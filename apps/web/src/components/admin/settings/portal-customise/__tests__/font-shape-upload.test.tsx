// @vitest-environment happy-dom
/**
 * Font and shape with an uploaded font: the select lists it first as
 * "{Family}, uploaded", choosing a listed font takes its place, and "Upload a
 * font" uploads each file with its weight and style, then hands the family
 * and the fallback picked from the listed fonts to the draft.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { getUrl, put } = vi.hoisted(() => ({ getUrl: vi.fn(), put: vi.fn() }))

vi.mock('@/lib/server/functions/uploads', () => ({
  getFontUploadUrlFn: (args: unknown) => getUrl(args),
}))
vi.mock('@/lib/client/storage-upload', () => ({
  putStorageUpload: (...args: unknown[]) => put(...args),
}))

const { FontShapeSection } = await import('../font-shape-section')

const LORA = '"Lora", ui-serif, Georgia, serif'
const brand = {
  family: 'Brand Sans',
  fallback: 'lora' as const,
  files: [{ key: 'fonts/2026/11/a-brand.woff2', weight: 400, style: 'normal' as const }],
}

function renderSection(props: Partial<Parameters<typeof FontShapeSection>[0]> = {}) {
  const handlers = {
    setFont: vi.fn(),
    setRadius: vi.fn(),
    setButtonShape: vi.fn(),
    setUploadedFont: vi.fn(),
    setHeadingFont: vi.fn(),
    setUploadedHeadingFont: vi.fn(),
    setCardStyle: vi.fn(),
  }
  render(
    <FontShapeSection
      font={LORA}
      headingFont={null}
      cardStyle="border"
      radius={0.5}
      buttonShape="pill"
      {...handlers}
      {...props}
    />
  )
  return handlers
}

afterEach(() => {
  cleanup()
  getUrl.mockReset()
  put.mockReset()
})

describe('FontShapeSection with an uploaded font', () => {
  it('names the uploaded family in the select, and writes its faces for the admin to see it', () => {
    renderSection({ customFont: brand })
    expect(screen.getByRole('combobox', { name: 'Text' })).toHaveTextContent('Brand Sans, uploaded')
    expect(document.querySelector('style')?.textContent).toContain(
      '@font-face { font-family: "Brand Sans"'
    )
    expect(screen.getByText(/Falls back to Lora/)).toBeInTheDocument()
  })

  it('uploads each file with its weight and style, then sets the family and fallback', async () => {
    getUrl
      .mockResolvedValueOnce({
        ok: true,
        uploadUrl: '/u1',
        key: 'fonts/2026/11/a-brand-regular.woff2',
        contentType: 'font/woff2',
      })
      .mockResolvedValueOnce({
        ok: true,
        uploadUrl: '/u2',
        key: 'fonts/2026/11/b-brand-bold.woff2',
        contentType: 'font/woff2',
      })
    put.mockResolvedValue(undefined)
    const { setUploadedFont } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Upload a font' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Upload only fonts your licence lets you use on the web.')

    fireEvent.change(screen.getByLabelText('Font files'), {
      target: {
        files: [
          new File(['wOF2'], 'BrandSans-Regular.woff2'),
          new File(['wOF2'], 'BrandSans-Bold.woff2'),
        ],
      },
    })
    expect(screen.getByLabelText('Name')).toHaveValue('Brand Sans')
    const upload = screen.getByRole('button', { name: 'Upload' })
    expect(upload).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(upload)

    await waitFor(() => expect(setUploadedFont).toHaveBeenCalled())
    expect(getUrl).toHaveBeenCalledWith({
      data: { filename: 'BrandSans-Regular.woff2', fileSize: 4 },
    })
    const [font, fallbackValue] = setUploadedFont.mock.calls[0]!
    expect(font).toEqual({
      family: 'Brand Sans',
      fallback: 'lora',
      files: [
        { key: 'fonts/2026/11/a-brand-regular.woff2', weight: 400, style: 'normal' },
        { key: 'fonts/2026/11/b-brand-bold.woff2', weight: 700, style: 'normal' },
      ],
    })
    expect(fallbackValue).toBe(LORA)
    // The body is sent with the type the upload URL was signed for.
    expect((put.mock.calls[0]![1] as Blob).type).toBe('font/woff2')
  })

  it("shows the server's refusal and sets nothing", async () => {
    getUrl.mockResolvedValue({ ok: false, code: 'TOO_LARGE', message: 'a.woff2 is over 400 KB.' })
    const { setUploadedFont } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Upload a font' }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Font files'), {
      target: { files: [new File(['x'], 'a.woff2')] },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('a.woff2 is over 400 KB.')
    expect(setUploadedFont).not.toHaveBeenCalled()
  })

  it('will not upload two files for one weight and style', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Upload a font' }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Font files'), {
      target: { files: [new File(['x'], 'Brand-Regular.woff2'), new File(['x'], 'Brand.woff2')] },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('alert')).toHaveTextContent('Two files are set to 400 upright.')
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
  })
})
