// @vitest-environment happy-dom
/**
 * The canvas marks each kind of content as the owner approved: static words
 * in dashed blue, a data item that styles every item of its kind in its
 * block, marked with a database glyph, and opens where it goes, and the
 * product's own interface in dotted slate. Tags name the element and where
 * it is, "Heading · Top posts", with no kind tag and no Live badge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { CanvasLayer } from '../canvas-layer'

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-page]')?.remove()
})

const design: PortalDesign = portalDesign.parse({
  ...defaultDesign(),
  pages: {
    ...defaultDesign().pages,
    home: {
      headline: null,
      blocks: [
        { type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
        { type: 'status', id: 'statusbk', grid: { x: 6, y: 0, w: 6, h: 2 } },
      ],
    },
  },
})

function page(): HTMLIFrameElement {
  const root = document.createElement('div')
  root.setAttribute('data-test-page', '')
  root.setAttribute('data-qb-page', 'home')
  root.innerHTML = `
    <section data-qb-section="block-abcdefgh" data-qb-part="home-block">
      <h2 data-qb-part="section-heading" data-qb-words="block-abcdefgh.heading">Top posts</h2>
      <ul>
        <li><button data-qb-part="vote-button">3</button><a data-qb-item="post-title" href="/b/ideas/posts/p1">Audit log</a></li>
        <li><button data-qb-part="vote-button">5</button><a data-qb-item="post-title" href="/b/ideas/posts/p2">File attachments</a></li>
        <li><button data-qb-part="vote-button">8</button><a data-qb-item="post-title" href="/b/ideas/posts/p3">User roles</a></li>
      </ul>
    </section>
    <section data-qb-section="block-statusbk" data-qb-part="home-block">
      <h2 data-qb-part="section-heading">Status</h2>
      <p data-qb-live="status">All systems operational</p>
      <a data-qb-link="" data-qb-words="block-statusbk.link" href="/status">View status</a>
    </section>`
  document.body.append(root)
  let y = 0
  for (const node of root.querySelectorAll('*')) {
    const top = (y += 30)
    node.getBoundingClientRect = () => new DOMRect(100, top, 200, 20)
  }
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

function show({
  picked,
  element = null,
  hovered = null,
}: {
  picked: string
  element?: string | null
  hovered?: string | null
}) {
  const onPage = vi.fn()
  const view = render(
    <CanvasLayer
      canvas={{ frame: page(), scale: 1, room: { width: 1200, height: 2000 } }}
      hovered={null}
      picked={picked as never}
      name="Top posts"
      homeOn
      pages={['home', 'post', 'status']}
      onPage={onPage}
      onDuplicate={vi.fn()}
      onRemove={vi.fn()}
      onDeselect={vi.fn()}
      elements={{
        design,
        page: 'home',
        hovered,
        picked: element,
        force: 'base',
        onPick: vi.fn(),
        say: vi.fn(),
      }}
    />
  )
  return { ...view, onPage }
}

const TITLE = 'el:block-abcdefgh|body|block.abcdefgh.post-title|1'

describe('the canvas’s kinds of content', () => {
  it('picks one post title as every post title in the block, and opens the post', async () => {
    const { container, onPage } = show({ picked: 'block-abcdefgh', element: TITLE })
    const tag = await screen.findByRole('button', {
      name: /^Post title · Top posts, your data, styling all 3, picked/,
    })
    expect(tag.textContent).toBe('Post title · Top posts')
    expect(tag.querySelector('[data-content-glyph]')).toBeTruthy()
    await waitFor(() => expect(container.querySelectorAll('[data-element-also]')).toHaveLength(2))
    expect(container.querySelector('[data-element-picked]')!.getAttribute('data-kind')).toBe(
      'dynamic'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open post' }))
    expect(onPage).toHaveBeenCalledWith('post', '/b/ideas/posts/p2')
    // Right arrow reaches Open from the tag; the block's chip has none.
    fireEvent.keyDown(tag, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open post' }))
    expect(screen.queryByRole('button', { name: /^Open the link/ })).toBeNull()
  })

  it('outlines static words in dashed blue, the tag saying only what and where', async () => {
    const { container } = show({
      picked: 'block-abcdefgh',
      hovered: 'el:block-abcdefgh|heading|block.abcdefgh.heading|0',
    })
    await waitFor(() => expect(container.querySelector('[data-element-hover]')).not.toBeNull())
    const outline = container.querySelector<HTMLElement>('[data-element-hover]')!
    expect(outline.dataset.kind).toBe('static')
    expect(outline.style.outline).toContain('dashed')
    expect(container.querySelector('[data-element-hover-tag]')!.textContent).toBe(
      'Heading · Top posts'
    )
    expect(container.querySelector('[data-content-glyph]')).toBeNull()
  })

  it('tags the product’s own interface with no kind words', async () => {
    show({
      picked: 'block-abcdefgh',
      element: 'el:block-abcdefgh|vote||0',
    })
    const tag = await screen.findByRole('button', { name: /, picked\. Tab moves/ })
    expect(tag.textContent).not.toMatch(/style only|System|Static|Dynamic/)
    expect(tag.style.background).not.toBe('')
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull()
  })

  it('opens a picked link where it goes, named for the page', async () => {
    show({
      picked: 'block-statusbk',
      element: 'el:block-statusbk|link|block.statusbk.link|0',
    })
    expect(await screen.findByRole('button', { name: 'Open status page' })).toBeDefined()
  })

  it('shows no Live badge on a live value', async () => {
    const { container } = show({ picked: 'block-statusbk' })
    // Once the picked block's chip is drawn, a badge would be too.
    await waitFor(() => expect(container.querySelector('[data-chip-name]')).not.toBeNull())
    expect(screen.queryByRole('button', { name: /^Live/ })).toBeNull()
    expect(container.querySelector('[data-live-badge]')).toBeNull()
  })
})
