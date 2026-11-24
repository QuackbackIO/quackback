// @vitest-environment happy-dom
/**
 * The brand artwork in Header and tabs, named as brand guidelines name it:
 * the logo (the full logo, usually wide) and the icon (the mark alone, in a
 * square), then which of the two the header shows. Both uploads are staged
 * into the draft, the icon with the favicon made from it; nothing is saved
 * until Publish. Refusals read as plain words.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import type { LogoDraft } from '../portal-draft'

const { getUrl, getIconUrls, put, downscale } = vi.hoisted(() => ({
  getUrl: vi.fn(),
  getIconUrls: vi.fn(),
  put: vi.fn(),
  downscale: vi.fn(),
}))

vi.mock('@/lib/server/functions/uploads', () => ({
  getHeaderLogoUploadUrlFn: (args: unknown) => getUrl(args),
  getIconUploadUrlsFn: (args: unknown) => getIconUrls(args),
}))
vi.mock('@/lib/client/storage-upload', () => ({
  putStorageUpload: (...args: unknown[]) => put(...args),
}))
vi.mock('@/lib/client/downscale-square-image', () => ({
  downscaleSquareImage: (...args: unknown[]) => downscale(...args),
}))
// The cropper is a canvas: here it hands back the crop at once.
vi.mock('@/components/ui/image-cropper', () => ({
  ImageCropper: ({ onCropComplete }: { onCropComplete: (blob: Blob) => void }) => (
    <button type="button" onClick={() => onCropComplete(new Blob(['png'], { type: 'image/png' }))}>
      Crop
    </button>
  ),
}))

const { inks } = vi.hoisted(() => ({ inks: vi.fn() }))
vi.mock('@/lib/shared/theme/logo-ink-count', () => ({
  measureLogoInk: (...args: unknown[]) => inks(...args),
}))

const { LogoTiles } = await import('../logo-tiles')

const LOGO_KEY = 'header-logos/2026/11/abc-wordmark.svg'
const ICON = { key: 'logos/2026/11/mark.png', faviconKey: 'favicons/2026/11/mark.png' }
const NONE: LogoDraft = { wideKey: null, mode: 'logo_and_name', icon: null }

function renderTiles(props: Partial<Parameters<typeof LogoTiles>[0]> = {}) {
  const handlers = {
    onDarkUploaded: vi.fn(),
    onRemoveDark: vi.fn(),
    onLogoUploaded: vi.fn(),
    onIconUploaded: vi.fn(),
    onShowLogo: vi.fn(),
    onShowIconAndName: vi.fn(),
    onRemoveLogo: vi.fn(),
  }
  render(<LogoTiles workspaceName="Acme" logo={NONE} canChangeIcon {...handlers} {...props} />)
  return handlers
}

const pick = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } })

afterEach(() => {
  inks.mockReset()
  cleanup()
  for (const fn of [getUrl, getIconUrls, put, downscale]) fn.mockReset()
})

describe('LogoTiles', () => {
  it('names the two pieces of artwork as a brand does: Logo and Icon', () => {
    renderTiles({ logo: { ...NONE, wideKey: LOGO_KEY, icon: ICON } })
    expect(screen.getByRole('group', { name: 'Logo' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Icon' })).toBeInTheDocument()
    expect(document.querySelector(`img[src="/api/storage/${LOGO_KEY}"]`)).not.toBeNull()
    expect(document.querySelector(`img[src="/api/storage/${ICON.key}"]`)).not.toBeNull()
    expect(screen.queryByText(/wide logo|square icon/i)).toBeNull()
  })

  it('marks what the header shows, and switches between the two', () => {
    const handlers = renderTiles({ logo: { ...NONE, wideKey: LOGO_KEY, mode: 'custom_logo' } })
    const header = screen.getByRole('group', { name: 'In the header' })
    expect(header.querySelector('[aria-pressed="true"]')).toHaveTextContent('Logo')
    fireEvent.click(screen.getByRole('button', { name: /Icon and name/ }))
    expect(handlers.onShowIconAndName).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Logo/ }))
    expect(handlers.onShowLogo).toHaveBeenCalled()
  })

  it('stages an uploaded logo into the draft, saving nothing', async () => {
    getUrl.mockResolvedValue({ uploadUrl: '/api/storage/upload?t=1', key: LOGO_KEY })
    put.mockResolvedValue(undefined)
    const { onLogoUploaded } = renderTiles()
    const file = new File(['<svg/>'], 'wordmark.svg', { type: 'image/svg+xml' })
    pick('Logo file', file)
    await waitFor(() => expect(onLogoUploaded).toHaveBeenCalledWith(LOGO_KEY))
    expect(put).toHaveBeenCalledWith('/api/storage/upload?t=1', file, expect.any(String))
  })

  it('stages a cropped icon and the favicon made from it, saving nothing', async () => {
    downscale.mockResolvedValue(new Blob(['small'], { type: 'image/png' }))
    getIconUrls.mockResolvedValue({
      icon: { uploadUrl: '/u/icon', key: ICON.key },
      favicon: { uploadUrl: '/u/favicon', key: ICON.faviconKey },
    })
    put.mockResolvedValue(undefined)
    const { onIconUploaded } = renderTiles()
    pick('Icon file', new File(['png'], 'mark.png', { type: 'image/png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Crop' }))
    await waitFor(() => expect(onIconUploaded).toHaveBeenCalledWith(ICON))
    expect(downscale).toHaveBeenCalledWith(expect.any(Blob), 64)
    expect(put.mock.calls.map(([url]) => url)).toEqual(['/u/icon', '/u/favicon'])
  })

  it('says why an SVG logo was refused', async () => {
    getUrl.mockResolvedValue({ uploadUrl: '/u', key: LOGO_KEY })
    put.mockRejectedValue(
      new ValidationError('SVG_NOT_SAFE', "This SVG can't be used. Try a PNG or a simpler SVG.")
    )
    const { onLogoUploaded } = renderTiles()
    pick('Logo file', new File(['<svg/>'], 'w.svg', { type: 'image/svg+xml' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This SVG can't be used. Try a PNG or a simpler SVG."
    )
    expect(onLogoUploaded).not.toHaveBeenCalled()
  })

  it('refuses a logo that is not an SVG, PNG, WebP or JPEG before uploading', async () => {
    renderTiles()
    pick('Logo file', new File(['x'], 'w.gif', { type: 'image/gif' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an SVG, PNG or WebP file.')
    expect(getUrl).not.toHaveBeenCalled()
  })

  it('removes the logo, and has nothing to remove without one', () => {
    const handlers = renderTiles({ logo: { ...NONE, wideKey: LOGO_KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    expect(handlers.onRemoveLogo).toHaveBeenCalled()
    cleanup()
    renderTiles()
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull()
  })

  it('lets only people who may change the icon upload one', () => {
    renderTiles({ canChangeIcon: false, logo: { ...NONE, icon: ICON } })
    expect(screen.queryByLabelText('Icon file')).toBeNull()
    expect(screen.getByText('Only an owner can change the icon.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()
  })

  describe('the dark mode version', () => {
    const DARK_KEY = 'header-logos/2026/11/abc-wordmark-dark.svg'
    const withLogo: LogoDraft = { wideKey: LOGO_KEY, mode: 'custom_logo', icon: null }
    const dark = () => screen.getByRole('group', { name: 'Dark mode version' })

    it('is offered beside the logo, as optional, and says what shows until one is added', () => {
      inks.mockResolvedValue([{ color: '#f4f4f5', share: 1 }])
      renderTiles({ logo: withLogo, darkSurface: '#0a0a0a' })
      expect(dark()).toHaveTextContent('Dark mode version')
      expect(dark()).toHaveTextContent('Optional')
      expect(dark()).toHaveTextContent('Uses the logo above until you add one')
      expect(within(dark()).getByRole('button', { name: 'Upload' })).toBeInTheDocument()
    })

    it('is not offered before there is a logo', () => {
      renderTiles({ darkSurface: '#0a0a0a' })
      expect(screen.queryByRole('group', { name: 'Dark mode version' })).toBeNull()
    })

    it('stages an upload into the draft through the logo’s own upload, saving nothing', async () => {
      inks.mockResolvedValue(null)
      getUrl.mockResolvedValue({ uploadUrl: 'https://s3/put', key: DARK_KEY })
      put.mockResolvedValue(undefined)
      const handlers = renderTiles({ logo: withLogo, darkSurface: '#0a0a0a' })
      const file = new File(['<svg/>'], 'dark.svg', { type: 'image/svg+xml' })
      pick('Dark mode version file', file)
      await waitFor(() => expect(handlers.onDarkUploaded).toHaveBeenCalledWith(DARK_KEY))
      expect(getUrl).toHaveBeenCalledWith({
        data: { filename: 'dark.svg', contentType: 'image/svg+xml', fileSize: file.size },
      })
      expect(handlers.onLogoUploaded).not.toHaveBeenCalled()
    })

    it('shows the one it has on a dark ground, with Remove', () => {
      inks.mockResolvedValue(null)
      const handlers = renderTiles({
        logo: { ...withLogo, darkKey: DARK_KEY },
        darkSurface: '#101418',
      })
      const shown = dark().querySelector('img')!
      expect(shown).toHaveAttribute('src', `/api/storage/${DARK_KEY}`)
      expect(dark()).not.toHaveTextContent('Uses the logo above')
      fireEvent.click(within(dark()).getByRole('button', { name: 'Remove' }))
      expect(handlers.onRemoveDark).toHaveBeenCalled()
    })

    it('warns when the logo would be hard to see on the dark header and there is no dark version', async () => {
      // Drawn in near-black: nothing of it stands off a dark header.
      inks.mockResolvedValue([{ color: '#17332b', share: 1 }])
      renderTiles({ logo: withLogo, darkSurface: '#0a0a0a' })
      expect(
        await screen.findByText('Your logo is hard to see in dark mode. Add a dark mode version.')
      ).toBeInTheDocument()
      expect(inks).toHaveBeenCalledWith(`/api/storage/${LOGO_KEY}`, 0, 0)
    })

    it.each([
      ['the logo shows on the dark header', [{ color: '#e8f1ee', share: 1 }]],
      ['the picture cannot be read', null],
    ])('does not warn when %s', async (_why, counted) => {
      inks.mockResolvedValue(counted)
      renderTiles({ logo: withLogo, darkSurface: '#0a0a0a' })
      await waitFor(() => expect(inks).toHaveBeenCalled())
      expect(screen.queryByText(/hard to see in dark mode/)).toBeNull()
    })

    it('does not warn, or measure, once it has a dark version', async () => {
      inks.mockResolvedValue([{ color: '#17332b', share: 1 }])
      renderTiles({ logo: { ...withLogo, darkKey: DARK_KEY }, darkSurface: '#0a0a0a' })
      await Promise.resolve()
      expect(screen.queryByText(/hard to see in dark mode/)).toBeNull()
      expect(inks).not.toHaveBeenCalled()
    })

    it('never warns for a portal that is never drawn dark', async () => {
      inks.mockResolvedValue([{ color: '#17332b', share: 1 }])
      renderTiles({ logo: withLogo, darkSurface: null })
      await Promise.resolve()
      expect(screen.queryByText(/hard to see in dark mode/)).toBeNull()
      expect(inks).not.toHaveBeenCalled()
    })
  })
})
