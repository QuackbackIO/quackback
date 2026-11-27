// @vitest-environment happy-dom
/**
 * The launcher unread badge (Phase 7 unified unread): driven by the iframe's
 * quackback:unread messages, it shows a count only while the widget is CLOSED
 * (an alert on the close icon, or on an already-read open widget, is noise).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLauncher } from '../src/core/launcher'

const badgeOf = (el: HTMLButtonElement) => el.lastElementChild as HTMLElement

function make(locale?: string) {
  const l = createLauncher({ placement: 'right', onClick: () => {}, locale })
  // Cards above the button wait for it to be revealed.
  l.reveal()
  return l
}

describe('launcher unread badge', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('is hidden by default', () => {
    expect(badgeOf(make().el).style.display).toBe('none')
  })

  it('shows the count when unread while closed', () => {
    const l = make()
    l.setUnread(3)
    const badge = badgeOf(l.el)
    expect(badge.style.display).toBe('flex')
    expect(badge.textContent).toBe('3')
  })

  it('caps the display at 9+', () => {
    const l = make()
    l.setUnread(42)
    expect(badgeOf(l.el).textContent).toBe('9+')
  })

  it('hides again when unread returns to 0', () => {
    const l = make()
    l.setUnread(5)
    l.setUnread(0)
    expect(badgeOf(l.el).style.display).toBe('none')
  })

  it('hides while the widget is open, and returns on close', () => {
    const l = make()
    l.setUnread(4)
    l.setOpen(true)
    expect(badgeOf(l.el).style.display).toBe('none')
    l.setOpen(false)
    expect(badgeOf(l.el).style.display).toBe('flex')
  })

  it('coerces a negative/fractional count defensively', () => {
    const l = make()
    l.setUnread(-3)
    expect(badgeOf(l.el).style.display).toBe('none')
    l.setUnread(2.9)
    expect(badgeOf(l.el).textContent).toBe('2')
  })
})

const bubbleOf = () => document.querySelector('body > div') as HTMLElement

describe('launcher greeting bubble', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('is hidden until a greeting is set', () => {
    make()
    expect(bubbleOf().style.display).toBe('none')
  })

  it('shows the greeting text while closed', () => {
    const l = make()
    l.setGreeting('Need a hand?')
    const bubble = bubbleOf()
    expect(bubble.style.display).toBe('flex')
    expect(bubble.textContent).toContain('Need a hand?')
  })

  it('hides for an empty or whitespace greeting', () => {
    const l = make()
    l.setGreeting('   ')
    expect(bubbleOf().style.display).toBe('none')
    l.setGreeting('Hi')
    expect(bubbleOf().style.display).toBe('flex')
    l.setGreeting(null)
    expect(bubbleOf().style.display).toBe('none')
  })

  it('hides while the widget is open, returns on close', () => {
    const l = make()
    l.setGreeting('Hi there')
    l.setOpen(true)
    expect(bubbleOf().style.display).toBe('none')
    l.setOpen(false)
    expect(bubbleOf().style.display).toBe('flex')
  })

  it('clicking the text opens the widget', () => {
    let opened = 0
    const l = createLauncher({ placement: 'right', onClick: () => (opened += 1) })
    l.setGreeting('Hi')
    ;(bubbleOf().firstElementChild as HTMLElement).click() // the text span
    expect(opened).toBe(1)
  })

  it('dismiss hides it and persists for the session', () => {
    const l = make()
    l.setGreeting('Hi')
    const bubble = bubbleOf()
    ;(bubble.lastElementChild as HTMLElement).click() // the × button
    expect(bubble.style.display).toBe('none')
    // A fresh launcher in the same session stays dismissed.
    document.body.innerHTML = ''
    const l2 = make()
    l2.setGreeting('Hi again')
    expect(bubbleOf().style.display).toBe('none')
  })
})

describe('launcher label', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('is an icon-only circle with no label text by default', () => {
    const l = make()
    expect(l.el.textContent).toBe('')
    expect(l.el.style.width).toBe('48px')
    expect(l.el.style.borderRadius).toBe('50%')
  })

  it('setLabel renders the text beside the icon as a pill', () => {
    const l = make()
    l.setLabel('Chat with us')
    expect(l.el.textContent).toContain('Chat with us')
    expect(l.el.style.width).toBe('auto')
    expect(l.el.style.borderRadius).toBe('24px')
  })

  it('the visible label becomes the accessible name', () => {
    const l = make()
    l.setLabel('Chat with us')
    expect(l.el.getAttribute('aria-label')).toBe('Chat with us')
    l.setLabel(null)
    expect(l.el.getAttribute('aria-label')).toBe('Open help')
  })

  it('clearing the label returns to the icon-only circle', () => {
    const l = make()
    l.setLabel('Chat with us')
    l.setLabel('')
    expect(l.el.textContent).toBe('')
    expect(l.el.style.width).toBe('48px')
    expect(l.el.style.borderRadius).toBe('50%')
  })
})

describe('launcher setPlacement', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('moves the button between corners', () => {
    const l = make()
    expect(l.el.style.right).toBe('calc(24px + env(safe-area-inset-right, 0px))')
    l.setPlacement('left')
    expect(l.el.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
    expect(l.el.style.right).toBe('')
    l.setPlacement('right')
    expect(l.el.style.right).toBe('calc(24px + env(safe-area-inset-right, 0px))')
    expect(l.el.style.left).toBe('')
  })

  it('moves the greeting bubble to the same side', () => {
    const l = make()
    l.setGreeting('Hi')
    l.setPlacement('left')
    const bubble = bubbleOf()
    expect(bubble.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
    expect(bubble.style.right).toBe('')
  })
})

describe('launcher contained in a root', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('positions absolutely inside the root instead of the viewport', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const l = createLauncher({ placement: 'right', root, onClick: () => {} })
    expect(l.el.parentElement).toBe(root)
    expect(l.el.style.position).toBe('absolute')
    expect(l.el.style.right).toBe('0px')
    expect(l.el.style.bottom).toBe('0px')
  })

  it('does not write the host-page greeting dismiss key', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const l = createLauncher({ placement: 'right', root, onClick: () => {} })
    l.setGreeting('Hi')
    const bubble = root.querySelector('div') as HTMLElement
    ;(bubble.lastElementChild as HTMLElement).click()
    expect(bubble.style.display).toBe('none')
    expect(sessionStorage.getItem('quackback:launcher-greeting-dismissed')).toBeNull()
  })
})

describe('launcher on an edge-to-edge phone page', () => {
  it('keeps the button and its bubble above the home indicator and clear of a side notch', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    expect(l.el.style.bottom).toContain('safe-area-inset-bottom')
    expect(l.el.style.right).toContain('safe-area-inset-right')
    l.setPlacement('left')
    expect(l.el.style.left).toContain('safe-area-inset-left')
    l.remove()
  })
})

describe('launcher accessible name', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('names the button for what it opens and points at the panel it controls', () => {
    const l = make()
    expect(l.el.getAttribute('aria-label')).toBe('Open help')
    // The SDK points it at the panel once the panel exists.
    expect(l.el.hasAttribute('aria-controls')).toBe(false)
    expect(l.el.getAttribute('aria-expanded')).toBe('false')
    l.setOpen(true)
    expect(l.el.getAttribute('aria-label')).toBe('Close help')
    expect(l.el.getAttribute('aria-expanded')).toBe('true')
  })

  it('says the unread count the badge shows', () => {
    const l = make()
    l.setUnread(2)
    expect(l.el.getAttribute('aria-label')).toBe('Open help, 2 unread')
    l.setLabel('Chat with us')
    expect(l.el.getAttribute('aria-label')).toBe('Chat with us, 2 unread')
    l.setOpen(true)
    expect(l.el.getAttribute('aria-label')).toBe('Close help')
    l.setOpen(false)
    expect(l.el.getAttribute('aria-label')).toBe('Chat with us, 2 unread')
    l.setUnread(0)
    expect(l.el.getAttribute('aria-label')).toBe('Chat with us')
  })
})

describe('launcher hover', () => {
  it('returns to its resting shadow when the pointer leaves', () => {
    document.body.innerHTML = ''
    const l = make()
    const resting = l.el.style.boxShadow
    l.el.dispatchEvent(new Event('mouseenter'))
    expect(l.el.style.boxShadow).not.toBe(resting)
    l.el.dispatchEvent(new Event('mouseleave'))
    expect(l.el.style.boxShadow).toBe(resting)
  })
})

describe('launcher visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('hides the greeting bubble with the button, and keeps it hidden', () => {
    const l = make()
    l.setGreeting('Need a hand?')
    l.setVisible(false)
    expect(l.el.style.display).toBe('none')
    expect(bubbleOf().style.display).toBe('none')
    // A greeting that lands later, or an open and close, does not bring it back.
    l.setGreeting('Still here')
    l.setOpen(true)
    l.setOpen(false)
    expect(bubbleOf().style.display).toBe('none')
    l.setVisible(true)
    expect(l.el.style.display).toBe('flex')
    expect(bubbleOf().style.display).toBe('flex')
  })
})

describe('launcher accessible name in the visitor language', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('says open, close and the unread count in the init locale', () => {
    const l = make('de')
    expect(l.el.getAttribute('aria-label')).toBe('Hilfe öffnen')
    l.setUnread(2)
    expect(l.el.getAttribute('aria-label')).toBe('Hilfe öffnen, 2 ungelesen')
    l.setOpen(true)
    expect(l.el.getAttribute('aria-label')).toBe('Hilfe schließen')
  })

  it.each([
    ['pt-BR', 'Abrir ajuda'],
    ['zh-CN', '打开帮助'],
    ['zh-TW', '開啟說明'],
    ['nl', 'Help openen'],
    ['th', 'เปิดความช่วยเหลือ'],
    ['xx', 'Open help'],
    [undefined, 'Open help'],
  ])('names the button for %s', (locale, name) => {
    expect(make(locale).el.getAttribute('aria-label')).toBe(name)
  })
})

describe('launcher with reduced motion', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const icons = (l: ReturnType<typeof make>) =>
    Array.from((l.el.firstElementChild as HTMLElement).children) as HTMLElement[]

  it('drops its transitions and the hover lift', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    const l = make()
    expect(l.el.style.transition).toBe('none')
    expect(icons(l)).toHaveLength(2)
    for (const icon of icons(l)) expect(icon.style.transition).toBe('none')
    l.el.dispatchEvent(new Event('mouseenter'))
    expect(l.el.style.transform).not.toContain('translateY(-2px)')
  })

  it('follows the setting when it changes', () => {
    const query = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => query)
    )
    const l = make()
    expect(l.el.style.transition).toContain('transform')
    query.matches = true
    query.dispatchEvent(new Event('change'))
    expect(l.el.style.transition).toBe('none')
    for (const icon of icons(l)) expect(icon.style.transition).toBe('none')
    query.matches = false
    query.dispatchEvent(new Event('change'))
    expect(l.el.style.transition).toContain('transform')
    l.remove()
  })

  it('keeps them otherwise', () => {
    const l = make()
    expect(l.el.style.transition).toContain('transform')
    for (const icon of icons(l)) expect(icon.style.transition).toContain('transform')
  })
})
