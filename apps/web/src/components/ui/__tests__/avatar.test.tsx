// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Avatar } from '../avatar'

// happy-dom doesn't actually load images, so drive the loaded/failed state via
// the standard `complete` / `naturalWidth` signals the component reads on mount.
let imgComplete = false
let imgNaturalWidth = 0

beforeEach(() => {
  imgComplete = false
  imgNaturalWidth = 0
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => imgComplete,
  })
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => imgNaturalWidth,
  })
})

afterEach(() => cleanup())

describe('Avatar (simple API)', () => {
  // The image must be in the initial DOM so the browser fetches it during the
  // SSR/initial parse — like the plain <img> org logo. Radix Avatar.Image instead
  // loads via a post-hydration effect, which made avatars lag behind. This test
  // asserts the <img> (with its src) is present on first render, not deferred.
  it('renders the image eagerly with its src on first render', () => {
    render(<Avatar src="https://example.com/a.png" name="Jane Doe" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/a.png')
    expect(img).toHaveAttribute('alt', 'Jane Doe')
    // Prioritize the avatar fetch among page resources.
    expect(img).toHaveAttribute('fetchpriority', 'high')
  })

  // The <img> must be in the server-rendered HTML so the browser fetches it
  // during the initial parse (effects don't run on the server, so this is exactly
  // what SSR emits — proves the eager-fetch claim).
  it('server-renders the <img> with its src', () => {
    const html = renderToStaticMarkup(<Avatar src="https://example.com/a.png" name="Jane Doe" />)
    expect(html).toContain('src="https://example.com/a.png"')
  })

  // While loading, the initials show underneath; once the image loads the
  // fallback must be removed so transparent avatars (PNG/WebP/GIF) render as
  // authored rather than showing the muted initials through transparent pixels.
  it('hides the initials fallback once the image loads', () => {
    render(<Avatar src="https://example.com/a.png" name="Jane Doe" />)
    expect(screen.getByText('JD')).toBeInTheDocument()
    fireEvent.load(screen.getByRole('img'))
    expect(screen.queryByText('JD')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('drops the image and shows initials when it fails to load', () => {
    render(<Avatar src="https://example.com/broken.png" name="Jane Doe" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  // SSR: the browser starts fetching during the initial parse, so the image can
  // finish/fail before React attaches onLoad/onError at hydration — those events
  // are missed. The component reconciles from the DOM (complete/naturalWidth) on
  // mount.
  it('falls back to initials when the image already failed before hydration', () => {
    imgComplete = true
    imgNaturalWidth = 0
    render(<Avatar src="https://example.com/broken.png" name="Jane Doe" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('hides the fallback when the image already loaded before hydration', () => {
    imgComplete = true
    imgNaturalWidth = 64
    render(<Avatar src="https://example.com/a.png" name="Jane Doe" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByText('JD')).not.toBeInTheDocument()
  })

  it('renders initials only when no src is provided', () => {
    render(<Avatar name="Jane Doe" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
  })
})
