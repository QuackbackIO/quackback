// @vitest-environment happy-dom
/**
 * With the AI allowance used, the composer says so calmly in place of the
 * box; otherwise the picked block rides along as a chip whose X lets it go.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/image-palette', () => ({
  imagePalette: async (file: File) => (file.name === 'broken.png' ? [] : ['#112233']),
  imageForModel: async (file: File) =>
    file.name === 'broken.png' ? null : `data:image/jpeg;base64,${file.name.replace(/\W/g, '')}`,
}))
// A screenshot is read in the browser once: a name with "dim" in it reads as dimmed by a pop-up.
vi.mock('@/lib/client/brand-shots', () => ({
  readBrandShot: async (file: File) =>
    file.name.endsWith('.png')
      ? {
          id: file.name,
          file,
          url: `blob:${file.name}`,
          jpeg: `data:image/jpeg;base64,${file.name.replace(/\W/g, '')}`,
          width: 4,
          height: 4,
          pixels: new Uint8ClampedArray(64).fill(255),
          pixelWidth: 4,
          pixelHeight: 4,
          dimmed: file.name.includes('dim'),
        }
      : null,
}))
const shotsRead = vi.hoisted(() => ({
  banners: [] as Array<{ image: number }>,
  calls: 0,
  gate: Promise.resolve() as Promise<void>,
}))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({
  readBrandShotsFn: async () => {
    shotsRead.calls++
    await shotsRead.gate
    return {
      ok: true,
      read: {
        name: 'Acme',
        icon: null,
        banners: shotsRead.banners.map((b) => ({ ...b, box: { x: 0, y: 0.8, w: 1, h: 0.2 } })),
        dimmed: [],
      },
    }
  },
}))
const { DesignComposer } = await import('../design-composer')

afterEach(() => {
  cleanup()
  shotsRead.banners = []
  shotsRead.calls = 0
  shotsRead.gate = Promise.resolve()
})

describe('DesignComposer', () => {
  it('says why Quackback AI cannot run in place of the box', () => {
    render(
      <DesignComposer
        scope="site"
        busy={false}
        limited="Quackback AI has used this month’s allowance."
        onClearScope={() => {}}
        onAsk={() => {}}
      />
    )
    expect(screen.getByText('Quackback AI has used this month’s allowance.')).toBeTruthy()
    expect(screen.queryByLabelText('Ask Quackback AI')).toBeNull()
  })

  it('offers the box otherwise', () => {
    render(<DesignComposer scope="site" busy={false} onClearScope={() => {}} onAsk={() => {}} />)
    expect(screen.getByLabelText('Ask Quackback AI')).toBeTruthy()
  })

  it('carries the picked block as a chip, and its X removes it from the chat', () => {
    const onClearScope = vi.fn()
    render(
      <DesignComposer
        scope="home"
        context={{ name: 'Top posts', page: 'Home' }}
        busy={false}
        onClearScope={onClearScope}
        onAsk={() => {}}
      />
    )
    expect(screen.getByText('Top posts')).toBeTruthy()
    expect(screen.getByText('On Home')).toBeTruthy()
    expect(screen.getByPlaceholderText('Ask about Top posts')).toBeTruthy()
    // The chip stands in for the scope: one chip, not two.
    expect(screen.queryByRole('button', { name: 'Widen to the whole site' })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Top posts from the chat and deselect it' })
    )
    expect(onClearScope).toHaveBeenCalledOnce()
  })

  describe('images', () => {
    const png = (name: string, type = 'image/png') => new File(['x'], name, { type })
    const box = () => screen.getByLabelText('Ask Quackback AI')
    const setup = (onAsk = vi.fn()) => {
      render(<DesignComposer scope="site" busy={false} onClearScope={() => {}} onAsk={onAsk} />)
      return onAsk
    }
    const paste = (...files: File[]) =>
      fireEvent.paste(box(), { clipboardData: { files, types: ['Files'], items: [] } })

    it('shows a pasted image as a thumbnail, with no palette swatches', async () => {
      setup()
      paste(png('shot.png'))
      const thumb = await screen.findByAltText('shot.png')
      expect(thumb.getAttribute('src')).toContain('data:image/jpeg')
      expect(screen.queryByRole('img', { name: /Colours/ })).toBeNull()
    })

    it('leaves a paste of text alone', () => {
      setup()
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.assign(event, { clipboardData: { files: [], types: ['text/plain'], items: [] } })
      box().dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    it('adds a dropped image', async () => {
      setup()
      fireEvent.drop(box(), { dataTransfer: { files: [png('dropped.png')], types: ['Files'] } })
      expect(await screen.findByAltText('dropped.png')).toBeTruthy()
    })

    it('adds an image from the attach button', async () => {
      setup()
      fireEvent.change(screen.getByLabelText('Attach an image'), {
        target: { files: [png('picked.png')] },
      })
      expect(await screen.findByAltText('picked.png')).toBeTruthy()
    })

    it('removes a thumbnail with its X', async () => {
      setup()
      paste(png('shot.png'))
      await screen.findByAltText('shot.png')
      fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
      expect(screen.queryByAltText('shot.png')).toBeNull()
    })

    it('keeps to four images and says so', async () => {
      setup()
      paste(...['a', 'b', 'c', 'd', 'e', 'f'].map((n) => png(`${n}.png`)))
      await screen.findByAltText('d.png')
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(4)
      )
      expect(screen.queryByAltText('e.png')).toBeNull()
      expect(screen.getByRole('status').textContent).toBe('Up to 4 images. The rest were left out.')
      paste(png('g.png'))
      expect(screen.queryByAltText('g.png')).toBeNull()
    })

    it('refuses a file that is not a png, jpeg, webp or svg', async () => {
      setup()
      paste(png('notes.pdf', 'application/pdf'))
      expect(screen.getByRole('status').textContent).toBe('Only PNG, JPEG, WebP or SVG images.')
      expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
    })

    it('refuses an image that cannot be read', async () => {
      setup()
      paste(png('broken.png'))
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe('broken.png could not be read.')
      )
    })

    it('sends every image with the message, then clears them', async () => {
      const onAsk = setup()
      paste(png('one.png'), png('two.png'))
      await screen.findByAltText('two.png')
      await screen.findByAltText('one.png')
      fireEvent.change(box(), { target: { value: 'Match these' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(onAsk.mock.calls[0]!.slice(0, 2)).toEqual([
        'Match these',
        [
          { palette: ['#112233'], image: 'data:image/jpeg;base64,onepng' },
          { palette: ['#112233'], image: 'data:image/jpeg;base64,twopng' },
        ],
      ])
      expect(screen.queryByAltText('one.png')).toBeNull()
    })

    it('marks a screenshot dimmed by a pop-up, and sends only once it is kept anyway', async () => {
      const onAsk = setup()
      paste(png('dim.png'))
      await screen.findByText('This one looks dimmed by a pop-up. A clean screenshot works better.')
      expect(screen.getByLabelText('dim.png: dimmed by a pop-up')).toBeTruthy()
      fireEvent.change(box(), { target: { value: 'match my brand' } })
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        true
      )
      fireEvent.click(screen.getByRole('button', { name: 'Use it anyway' }))
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(onAsk).toHaveBeenCalledOnce()
      const [text, images, brand] = onAsk.mock.calls[0]!
      expect(text).toBe('match my brand')
      expect(images).toEqual([{ palette: ['#112233'], image: 'data:image/jpeg;base64,dimpng' }])
      expect(brand).toMatchObject({ name: 'Acme', icon: null })
      expect(brand.shots.map((shot: { id: string }) => shot.id)).toEqual(['dim.png'])
    })

    it('says a cookie banner covers a screenshot, from the read of them', async () => {
      shotsRead.banners = [{ image: 0 }]
      setup()
      paste(png('home.png'))
      await screen.findByText(
        'A cookie banner covers part of this one. A clean screenshot works better.'
      )
      expect(shotsRead.calls).toBe(1)
    })

    it('holds the message while the screenshots are checked', async () => {
      let open: () => void = () => {}
      shotsRead.gate = new Promise((resolve) => (open = resolve))
      const onAsk = setup()
      paste(png('home.png'))
      await screen.findByText('Checking your images…')
      fireEvent.change(box(), { target: { value: 'match my brand' } })
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        true
      )
      open()
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(onAsk).toHaveBeenCalledOnce()
    })

    it('sends screenshots with nothing else said', async () => {
      const onAsk = setup()
      paste(png('home.png'))
      await screen.findByAltText('home.png')
      // Not while the screenshots are checked.
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      expect(shotsRead.calls).toBe(1)
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(onAsk).toHaveBeenCalledOnce()
      expect(onAsk.mock.calls[0]![0]).toBe('')
    })

    const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

    it('clears the check and enables Send when an image is attached before any text', async () => {
      let open: () => void = () => {}
      shotsRead.gate = new Promise((resolve) => (open = resolve))
      setup()
      paste(png('home.png'))
      await screen.findByText('Checking your images…')
      expect(sendButton().disabled).toBe(true)
      open()
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      expect(sendButton().disabled).toBe(false)
    })

    it('clears the check when the text is typed first, then an image attached', async () => {
      let open: () => void = () => {}
      shotsRead.gate = new Promise((resolve) => (open = resolve))
      setup()
      fireEvent.change(box(), { target: { value: 'match my brand' } })
      paste(png('home.png'))
      await screen.findByText('Checking your images…')
      open()
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      expect(sendButton().disabled).toBe(false)
    })

    it('clears the check when one of two images is removed mid-check', async () => {
      let open: () => void = () => {}
      shotsRead.gate = new Promise((resolve) => (open = resolve))
      setup()
      paste(png('one.png'), png('two.png'))
      await screen.findByAltText('two.png')
      await screen.findByText('Checking your images…')
      fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
      open()
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      expect(sendButton().disabled).toBe(false)
      expect(shotsRead.calls).toBe(2)
    })

    it('does not show a stale check after the only image is removed mid-check, then another is attached', async () => {
      let open: () => void = () => {}
      shotsRead.gate = new Promise((resolve) => (open = resolve))
      setup()
      paste(png('one.png'))
      await screen.findByText('Checking your images…')
      fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
      expect(screen.queryByText('Checking your images…')).toBeNull()
      open()
      shotsRead.gate = Promise.resolve()
      paste(png('two.png'))
      await screen.findByAltText('two.png')
      await waitFor(() => expect(screen.queryByText('Checking your images…')).toBeNull())
      expect(sendButton().disabled).toBe(false)
    })
  })
})
