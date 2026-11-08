// @vitest-environment happy-dom
/**
 * The designer's frame: a click and the pointer say which block they are on
 * and the link there, nothing navigates, and stored words are edited where
 * they sit without touching the page's own elements. The builder draws the
 * outlines, not the frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import {
  DESIGNER_CSS,
  guardWrites,
  linkAt,
  previewHref,
  startDesigning,
  startTrying,
} from '../portal-preview-designer'

const posted: Array<Record<string, unknown>> = []
let stop = () => {}

beforeEach(() => {
  posted.length = 0
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as Record<string, unknown>)
  })
  document.body.innerHTML = `
    <section data-qb-section="band">
      <h1 data-qb-words="home.title">Hello <span>there</span></h1>
      <a href="/elsewhere" id="link">Go</a>
    </section>
    <div data-qb-section="block-ideas00001" data-qb-part="home-block">
      <button id="vote" data-qb-part="vote-button">Vote</button>
      <button id="cta" data-qb-label="">Share</button>
    </div>`
  stop = startDesigning()
  // Starting, it asks the builder what to show (see 'what the builder asks the page to show').
  posted.length = 0
})

afterEach(() => {
  stop()
  vi.restoreAllMocks()
})

const click = (el: Element, type = 'click') => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}
/** The words editor a double-click opened, once it has loaded. */
async function editorIn(): Promise<Editor> {
  await vi.waitFor(() => {
    if (!document.querySelector('[data-qb-words-editing] .ProseMirror')) throw new Error('not yet')
  })
  return (
    document.querySelector('[data-qb-words-editing] .ProseMirror') as HTMLElement & {
      editor: Editor
    }
  ).editor
}

const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

describe('startDesigning', () => {
  it('says which block a click is in and the link under it, and does not follow it', () => {
    expect(click(document.getElementById('link')!).defaultPrevented).toBe(true)
    click(document.getElementById('vote')!)
    click(document.body)
    // Each says where it landed, so the builder can name the element there.
    expect(posted.every((m) => typeof m.x === 'number' && typeof m.y === 'number')).toBe(true)
    expect(posted.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual([
      { type: 'quackback:preview-section', section: 'band', link: '/elsewhere' },
      { type: 'quackback:preview-section', section: 'block-ideas00001', link: null },
      // Empty canvas: no block, so the builder lets go of what is picked.
      { type: 'quackback:preview-section', section: null, link: null },
    ])
  })

  it('asks the builder to follow a link clicked with Ctrl or Cmd held', () => {
    const link = document.getElementById('link')!
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    expect(posted.map((m) => [m.link, m.follow])).toEqual([
      ['/elsewhere', true],
      ['/elsewhere', true],
    ])
  })

  it('says which block the pointer is over, once per change', async () => {
    const move = (el: Element) =>
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    const settle = () => new Promise((done) => requestAnimationFrame(() => done(null)))
    move(document.getElementById('vote')!)
    await settle()
    move(document.getElementById('cta')!)
    await settle()
    move(document.getElementById('link')!)
    await settle()
    document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))
    // Once per element, so the builder can outline the one under the pointer.
    expect(posted.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual([
      { type: 'quackback:preview-pointer', section: 'block-ideas00001' },
      { type: 'quackback:preview-pointer', section: 'block-ideas00001' },
      { type: 'quackback:preview-pointer', section: 'band' },
      { type: 'quackback:preview-pointer', section: null },
    ])
  })

  it('says which menu item a click and the pointer are on, and asks to rename on a double-click', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<header data-qb-section="header"><nav data-qb-menu-row="">
        <a href="/roadmap" data-qb-menu="roadmap" id="roadmap">Roadmap</a></nav>
        <a href="/" data-qb-menu="logo" id="logo"><span id="name">Juniper</span></a></header>`
    )
    expect(click(document.getElementById('roadmap')!).defaultPrevented).toBe(true)
    click(document.getElementById('name')!)
    click(document.getElementById('roadmap')!, 'dblclick')
    document
      .getElementById('roadmap')!
      .dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    await new Promise((done) => requestAnimationFrame(() => done(null)))
    expect(posted.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual([
      { type: 'quackback:preview-section', section: 'header', link: '/roadmap', menu: 'roadmap' },
      { type: 'quackback:preview-section', section: 'header', link: '/', menu: 'logo' },
      { type: 'quackback:preview-rename', menu: 'roadmap' },
      { type: 'quackback:preview-pointer', section: 'header', menu: 'roadmap' },
    ])
  })

  it('draws no outline of its own: only words show they can be retyped', () => {
    expect(DESIGNER_CSS).not.toContain('data-qb-selected')
    expect(DESIGNER_CSS).toContain('[data-qb-words]')
  })

  it('says what empty words are for, where they wait to be written', () => {
    expect(DESIGNER_CSS).toContain(
      '[data-qb-words-placeholder]:empty::before{content:attr(data-qb-words-placeholder)'
    )
  })

  it('edits words in a copy with the words editor and sends them on Enter', async () => {
    const title = document.querySelector('h1')!
    click(title, 'dblclick')
    const editor = await editorIn()
    expect(title.style.display).toBe('none')
    editor.commands.selectAll()
    editor.commands.insertContent('Welcome in')
    key(editor.view.dom, 'Enter')
    expect(posted).toContainEqual({
      type: 'quackback:preview-words',
      field: 'home.title',
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Welcome in' }] }],
      },
    })
    expect(document.querySelector('[data-qb-words-editing]')).toBeNull()
    expect(title.style.display).toBe('')
    expect(title.innerHTML).toBe('Hello <span>there</span>')
  })

  it('edits words where they sit when the builder’s panel asks, by their field', async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:words-edit', field: 'home.title' },
        origin: window.location.origin,
        source: window.parent,
      })
    )
    await editorIn()
    expect(document.querySelector('h1')!.style.display).toBe('none')
  })

  it('waits for words the page has yet to draw, such as a heading just added', async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:words-edit', field: 'block-ideas00001.heading' },
        origin: window.location.origin,
        source: window.parent,
      })
    )
    const heading = document.createElement('h2')
    heading.setAttribute('data-qb-words', 'block-ideas00001.heading')
    heading.textContent = 'Top posts'
    document.querySelector('[data-qb-section="block-ideas00001"]')!.prepend(heading)
    await editorIn()
    expect(heading.style.display).toBe('none')
  })

  it('takes no edit asked by another window', async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:words-edit', field: 'home.title' },
        origin: 'https://elsewhere.example',
      })
    )
    await new Promise((done) => setTimeout(done, 50))
    expect(document.querySelector('[data-qb-words-editing]')).toBeNull()
  })

  it('puts the words back on Escape, and sends nothing', async () => {
    click(document.querySelector('h1')!, 'dblclick')
    const editor = await editorIn()
    editor.commands.insertContent('Changed')
    key(editor.view.dom, 'Escape')
    expect(
      posted.filter((m) => (m as { type: string }).type === 'quackback:preview-words')
    ).toEqual([])
    expect(document.querySelector('[data-qb-words-editing]')).toBeNull()
  })

  it('hands Escape to the designer, which lets go of what is picked', () => {
    key(document.body, 'Escape')
    expect(posted).toEqual([{ type: 'quackback:preview-key', key: 'escape' }])
  })

  it('hands undo and redo to the designer', () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    expect(posted).toEqual([
      { type: 'quackback:preview-key', key: 'undo' },
      { type: 'quackback:preview-key', key: 'redo' },
    ])
  })

  it('hands Ctrl+K to the designer, for quick find', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(posted).toEqual([{ type: 'quackback:preview-key', key: 'find' }])
  })
})

describe('linkAt', () => {
  const here = new URL('https://acme.example.com/?designer=1') as unknown as Location
  it('reads the portal path of the link under a click, and nothing off the portal', () => {
    document.body.innerHTML = `
      <a id="post" href="/b/ideas/posts/p1?x=1"><span id="inner">Post</span></a>
      <a id="off" href="https://elsewhere.example.com/a">Off</a>
      <a id="admin" href="/admin/feedback">Admin</a>
      <p id="none">Text</p>`
    expect(linkAt(document.getElementById('inner')!, here)).toBe('/b/ideas/posts/p1')
    expect(linkAt(document.getElementById('off')!, here)).toBeNull()
    expect(linkAt(document.getElementById('admin')!, here)).toBeNull()
    expect(linkAt(document.getElementById('none')!, here)).toBeNull()
  })
})

describe('guardWrites', () => {
  it('keeps the page from sending a form, taking typing or sending on Ctrl+Enter', () => {
    stop()
    const release = guardWrites()
    document.body.innerHTML =
      '<form><textarea id="t"></textarea></form><h1 contenteditable="true" data-qb-words-editing="">x</h1>'
    const fire = (target: Element, event: Event) => {
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const form = document.querySelector('form')!
    const field = document.getElementById('t')!
    expect(fire(form, new Event('submit', { bubbles: true, cancelable: true }))).toBe(true)
    expect(
      fire(
        field,
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    ).toBe(true)
    expect(
      fire(field, new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
    ).toBe(true)
    // Words being retyped still take their keys.
    const words = document.querySelector('h1')!
    expect(
      fire(words, new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
    ).toBe(false)
    release()
    expect(fire(form, new Event('submit', { bubbles: true, cancelable: true }))).toBe(false)
    stop = startDesigning()
  })
})

describe('previewHref', () => {
  const here = new URL(
    'https://acme.example.com/feedback?theme=dark&preview=true&lang=de&designer=1&sort=top'
  ) as unknown as Location
  it('keeps a portal link within the preview, in its theme and language', () => {
    expect(previewHref('/roadmap?x=1#now', here)).toBe(
      '/roadmap?x=1&theme=dark&preview=true&lang=de&designer=1#now'
    )
  })

  it('keeps the signed-out view as the frame moves', () => {
    const out = new URL(
      'https://acme.example.com/feedback?preview=true&designer=1&visitor=out'
    ) as unknown as Location
    expect(previewHref('/roadmap', out)).toBe('/roadmap?preview=true&designer=1&visitor=out')
    // A page that dropped them from its address does not drop them from the frame.
    const dropped = new URL('https://acme.example.com/roadmap?preview=true') as unknown as Location
    expect(previewHref('/changelog', dropped, { visitor: 'out' })).toBe(
      '/changelog?preview=true&designer=1&visitor=out'
    )
  })

  it('goes nowhere off the portal: another site, the admin or the API', () => {
    expect(previewHref('https://elsewhere.example.com/', here)).toBeNull()
    expect(previewHref('/admin/settings', here)).toBeNull()
    expect(previewHref('/api/auth/sign-out', here)).toBeNull()
  })
})

describe('what the builder asks the page to show', () => {
  it('asks once it listens, and draws the feed empty or the composer open as asked', async () => {
    stop()
    posted.length = 0
    stop = startDesigning()
    expect(posted).toEqual([{ type: 'quackback:preview-state-ask' }])
    const { designerPreview } = await import('../preview-draft-context')
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:preview-state', empty: true },
        origin: window.location.origin,
        source: window.parent,
      })
    )
    expect(designerPreview()).toEqual({ empty: true, composer: false })
    // Asked to edit the composer's button, the frame opens the composer, where its button is.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:words-edit', field: 'feedback.submit' },
        origin: window.location.origin,
        source: window.parent,
      })
    )
    expect(designerPreview()).toEqual({ empty: true, composer: true })
    // Designing stops: nothing is asked any more.
    stop()
    stop = () => {}
    expect(designerPreview()).toEqual({ empty: false, composer: false })
  })
})

describe('startTrying', () => {
  it('lets clicks act, keeps links in the preview, sends nothing, and hands Escape back', () => {
    stop()
    posted.length = 0
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'https://acme.example.com/feedback?preview=true&designer=1',
      origin: 'https://acme.example.com',
      search: '?preview=true&designer=1',
      pathname: '/feedback',
      assign,
    } as Location)
    document.body.innerHTML =
      '<a id="away" href="/roadmap">Roadmap</a><button id="menu">Menu</button><form><textarea id="t"></textarea></form>'
    stop = startTrying()
    // Where the page is goes to the designer first.
    expect(posted).toEqual([{ type: 'quackback:preview-location', path: '/feedback' }])
    posted.length = 0
    expect(click(document.getElementById('away')!).defaultPrevented).toBe(true)
    expect(assign).toHaveBeenCalledWith('/roadmap?preview=true&designer=1')
    expect(click(document.getElementById('menu')!).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    document.querySelector('form')!.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(posted).toEqual([{ type: 'quackback:preview-key', key: 'escape' }])
  })
})

describe('guardWrites, requests', () => {
  it('sends reads and refuses every request that would change something', async () => {
    stop()
    const real = vi.fn(async () => new Response('ok'))
    window.fetch = real as unknown as typeof fetch
    const release = guardWrites()
    await window.fetch('/_serverFn/read')
    await expect(window.fetch('/_serverFn/vote', { method: 'POST' })).rejects.toThrow(
      "The designer's preview sends nothing"
    )
    await expect(
      window.fetch(new Request('http://x.example.com/api/portal/upload', { method: 'PUT' }))
    ).rejects.toThrow()
    expect(real).toHaveBeenCalledTimes(1)
    const upload = new XMLHttpRequest()
    upload.open('POST', '/api/portal/upload')
    expect(() => upload.send('x')).toThrow("The designer's preview sends nothing")
    expect(navigator.sendBeacon('/api/plg-events', 'x')).toBe(false)
    release()
    await window.fetch('/_serverFn/vote', { method: 'POST' })
    expect(real).toHaveBeenCalledTimes(2)
    stop = startDesigning()
  })

  it('says which view it draws on every read of its own origin, so the server answers as that viewer', async () => {
    stop()
    const real = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    window.fetch = real as unknown as typeof fetch
    const release = guardWrites({ visitor: 'out' })
    await window.fetch('/api/v1/users/principal_x/card', { credentials: 'include' })
    await window.fetch(new Request(`${location.origin}/api/v1/mentions/suggest?q=a`))
    await window.fetch('https://elsewhere.example.com/data.json')
    const sent = real.mock.calls.map(
      ([input, init]) =>
        new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    )
    expect(sent[0]!.get('x-qb-preview-visitor')).toBe('out')
    expect(sent[0]!.get('x-qb-designer-frame')).toBe('1')
    expect(real.mock.calls[0]![1]?.credentials).toBe('include')
    expect(sent[1]!.get('x-qb-preview-visitor')).toBe('out')
    // Another site is told nothing.
    expect(sent[2]!.get('x-qb-designer-frame')).toBeNull()
    release()
    stop = startDesigning()
  })

  it('keeps a file from being picked', () => {
    stop()
    const release = guardWrites()
    document.body.innerHTML = '<input type="file" id="f" /><button id="b">x</button>'
    const picked = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('f')!.dispatchEvent(picked)
    expect(picked.defaultPrevented).toBe(true)
    const pressed = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('b')!.dispatchEvent(pressed)
    expect(pressed.defaultPrevented).toBe(false)
    release()
    stop = startDesigning()
  })
})

describe('startTrying, location', () => {
  it('says where the page moves without loading afresh', () => {
    stop()
    stop = startTrying()
    posted.length = 0
    window.history.pushState(null, '', '/changelog/entry_1?preview=true')
    expect(posted).toContainEqual({
      type: 'quackback:preview-location',
      path: '/changelog/entry_1',
    })
    stop()
    posted.length = 0
    window.history.pushState(null, '', '/roadmap')
    expect(posted).toEqual([])
    stop = startDesigning()
  })
})
