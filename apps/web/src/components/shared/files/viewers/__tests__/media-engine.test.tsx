// @vitest-environment happy-dom
import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MediaEngine from '../media-engine'
import { VIEWER_ARROWS_ATTR, type EngineToolbar, type ViewerFile } from '../../types'

function renderMedia(over: Partial<ViewerFile> & { name: string }) {
  const file: ViewerFile = {
    key: over.name,
    url: `/api/storage/files/${over.name}?read=tok`,
    contentType: 'application/octet-stream',
    size: 1000,
    family: 'image',
    ...over,
  }
  const toolbars: EngineToolbar[] = []
  const onToolbar = vi.fn((t: EngineToolbar) => {
    toolbars.push(t)
  })
  const onError = vi.fn()
  const result = render(
    <MediaEngine
      file={file}
      data={null}
      truncated={false}
      src={`${file.url}&proxy=1`}
      onToolbar={onToolbar}
      onError={onError}
      compact={false}
    />
  )
  return { ...result, toolbar: () => toolbars.at(-1)!, onError }
}

describe('MediaEngine images', () => {
  it('loads the image from the stored URL, not the proxy', () => {
    renderMedia({ name: 'shot.png', contentType: 'image/png' })
    expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute(
      'src',
      '/api/storage/files/shot.png?read=tok'
    )
  })

  it('reports zoom from 25% to 500% and applies what the shell sets', () => {
    const { toolbar } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    expect(toolbar().zoom).toMatchObject({ value: 1, min: 0.25, max: 5 })
    act(() => toolbar().zoom!.set(2.5))
    expect(toolbar().zoom?.value).toBe(2.5)
    expect(screen.getByRole('img').style.transform).toContain('scale(2.5)')
    act(() => toolbar().zoom!.set(9))
    expect(toolbar().zoom?.value).toBe(5)
  })

  it('toggles 200% on double-click', () => {
    const { toolbar } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    fireEvent.doubleClick(screen.getByRole('img'))
    expect(toolbar().zoom?.value).toBe(2)
    fireEvent.doubleClick(screen.getByRole('img'))
    expect(toolbar().zoom?.value).toBe(1)
  })

  it('pans by dragging only when zoomed in', () => {
    const { toolbar } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    const img = screen.getByRole('img')
    const stage = img.parentElement!
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(img.style.transform).toContain('translate(0px, 0px)')
    act(() => toolbar().zoom!.set(2))
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(img.style.transform).toContain('translate(50px, 30px)')
  })

  it('zooms with Ctrl and the wheel', () => {
    const { toolbar } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    const stage = screen.getByRole('img').parentElement!
    // happy-dom's WheelEvent drops modifier keys from its init dict.
    const wheel = (deltaY: number, ctrlKey: boolean) => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'ctrlKey', { value: ctrlKey })
      act(() => {
        stage.dispatchEvent(event)
      })
      return event
    }
    expect(wheel(-100, true).defaultPrevented).toBe(true)
    expect(toolbar().zoom!.value).toBeGreaterThan(1)
    const zoomed = toolbar().zoom!.value
    expect(wheel(100, false).defaultPrevented).toBe(false)
    expect(toolbar().zoom!.value).toBe(zoomed)
  })

  it('shows an SVG only as an image', () => {
    const { container } = renderMedia({ name: 'logo.svg', contentType: 'image/svg+xml' })
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/storage/files/logo.svg?read=tok')
    expect(container.querySelector('svg:not([aria-hidden])')).toBeNull()
    expect(container.querySelector('iframe, object, embed')).toBeNull()
  })

  it('shows a HEIC photo through its converted copy', () => {
    renderMedia({
      name: 'IMG_0412.heic',
      contentType: 'image/heic',
      preview: { renditionUrl: '/api/storage/previews/IMG_0412.jpg?read=r' },
    })
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/storage/previews/IMG_0412.jpg?read=r'
    )
  })

  it('reports an image the browser cannot decode', () => {
    const { onError } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    fireEvent.error(screen.getByRole('img'))
    expect(onError).toHaveBeenCalledWith('corrupt')
  })

  it('reports a HEIC photo with no converted copy as unsupported when it fails', () => {
    const { onError } = renderMedia({ name: 'IMG_0412.heic', contentType: 'image/heic' })
    fireEvent.error(screen.getByRole('img'))
    expect(onError).toHaveBeenCalledWith('unsupported')
  })

  it('notes the pixel size once the image loads', () => {
    const { toolbar } = renderMedia({ name: 'shot.png', contentType: 'image/png' })
    const img = screen.getByRole('img') as HTMLImageElement
    Object.defineProperty(img, 'naturalWidth', { value: 1440 })
    Object.defineProperty(img, 'naturalHeight', { value: 900 })
    fireEvent.load(img)
    expect(toolbar().note).toBe('1440 × 900')
  })
})

describe('MediaEngine video and audio', () => {
  it('plays video from the stored URL with native controls', () => {
    const { container, toolbar } = renderMedia({
      name: 'repro.mp4',
      family: 'video',
      contentType: 'video/mp4',
    })
    const video = container.querySelector('video')!
    expect(video).toHaveAttribute('src', '/api/storage/files/repro.mp4?read=tok')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAttribute('playsinline')
    expect(toolbar().zoom).toBeUndefined()
  })

  it('maps a video the browser cannot play to unsupported', () => {
    const { container, onError } = renderMedia({
      name: 'clip.mov',
      family: 'video',
      contentType: 'video/quicktime',
    })
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'error', { value: { code: 4 } })
    fireEvent.error(video)
    expect(onError).toHaveBeenCalledWith('unsupported')
  })

  it('keeps the arrow keys on a video or audio player, where they seek', () => {
    const video = renderMedia({ name: 'repro.mp4', family: 'video', contentType: 'video/mp4' })
    expect(video.container.querySelector('video')).toHaveAttribute(VIEWER_ARROWS_ATTR)
    video.unmount()
    const audio = renderMedia({ name: 'call.mp3', family: 'audio', contentType: 'audio/mpeg' })
    expect(audio.container.querySelector('audio')).toHaveAttribute(VIEWER_ARROWS_ATTR)
  })

  it('plays audio on a quiet card', () => {
    const { container } = renderMedia({
      name: 'voicemail.mp3',
      family: 'audio',
      contentType: 'audio/mpeg',
    })
    const audio = container.querySelector('audio')!
    expect(audio).toHaveAttribute('src', '/api/storage/files/voicemail.mp3?read=tok')
    expect(audio).toHaveAttribute('controls')
    expect(screen.getByText('voicemail.mp3')).toBeInTheDocument()
  })
})
