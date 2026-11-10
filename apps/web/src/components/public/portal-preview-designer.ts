/**
 * The designer's side of the preview frame. The frame only draws the page
 * and says what is under the pointer and under a click: the block's key and
 * the link there, if any. The builder's editing layer, over the frame, draws
 * the outlines and the picked block's chip. Double-clicking words the design
 * stores edits them where they sit. Only the designer's frame loads it, and
 * it imports nothing from the app but the frame's request headers and what
 * the frame was first loaded as.
 */
import { PREVIEW_STATE_ASK, readPreviewState, setDesignerPreview } from './preview-draft-context'
import { thisDesignerFrame } from '@/lib/client/designer-frame'
import { designerFrameHeaders } from '@/lib/shared/design/designer-frame'

/** Words that can be retyped, and the copy being retyped. */
export const DESIGNER_CSS =
  '[data-qb-words]{cursor:text}' +
  '[data-qb-words-editing]{outline:2px solid #2563eb;outline-offset:2px;cursor:text}' +
  '[data-qb-words-editing] .ProseMirror{outline:none}' +
  '[data-qb-words-editing] .is-empty:first-child::before{content:attr(data-placeholder);float:left;height:0;pointer-events:none;opacity:.45}' +
  '[data-qb-words-placeholder]:empty::before{content:attr(data-qb-words-placeholder);opacity:.45;font-style:italic}'

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, window.location.origin)
}

/** The key of the block an element is in, if any. */
const sectionOf = (target: Element | null) =>
  target?.closest?.('[data-qb-section]')?.getAttribute('data-qb-section') ?? null

/** The menu item, logo or sign in an element is, or is in, if any. */
export const menuOf = (target: Element | null) =>
  target?.closest?.('[data-qb-menu]')?.getAttribute('data-qb-menu') ?? null

/**
 * The portal path of the link a click landed on, for the builder's Open; null
 * for none, or for a link off the portal.
 */
export function linkAt(target: Element, current: Location = window.location): string | null {
  const link = target.closest('a[href]')
  if (!link) return null
  try {
    const url = new URL(link.getAttribute('href') ?? '', current.href)
    if (url.origin !== current.origin || /^\/(admin|api)(\/|$)/.test(url.pathname)) return null
    return url.pathname
  } catch {
    return null
  }
}

/**
 * Edits stored words where they sit, with the words editor of their kind,
 * loaded the first time words are edited, from the words the builder stores.
 */
function editWords(element: HTMLElement): void {
  void import('./portal-words-editor').then(({ openWords }) => openWords(element, post))
}

/** How long, and how often, the frame looks for words the builder asked to edit that are yet to draw. */
const ASKED_TRIES = 20
const ASKED_EVERY_MS = 50

/**
 * Edits the words a field marks when the builder asks, as a double-click on
 * them does, from its panel's Edit. Words just added, such as a new heading,
 * may not have drawn yet, so the frame looks again for a moment.
 */
function editAsked(field: string, tries = ASKED_TRIES): void {
  // Words visitors meet only in another state are drawn in it first: the open composer's button.
  if (tries === ASKED_TRIES && field === 'feedback.submit') setDesignerPreview({ composer: true })
  const words = [...document.querySelectorAll<HTMLElement>('[data-qb-words]')].find(
    (each) => each.getAttribute('data-qb-words') === field
  )
  if (!words) {
    if (tries > 0) setTimeout(() => editAsked(field, tries - 1), ASKED_EVERY_MS)
    return
  }
  words.scrollIntoView?.({ block: 'center' })
  editWords(words)
}

/** Whether an event happens inside words being retyped, the one thing the page may take. */
const inWords = (event: Event) =>
  !!(event.target as Element | null)?.closest?.('[data-qb-words-editing]')

/** What the frame says when it keeps a request from being sent. */
const NOT_SENT = "The designer's preview sends nothing"
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Keeps the page's own requests to reads: a fetch, an upload or a beacon that
 * would change something is never sent, whatever the page does on a click.
 * A read of the portal's own origin says which view the frame draws, as its
 * server function calls do, so a signed-out frame is answered as nobody.
 */
function guardRequests(frame: ReturnType<typeof thisDesignerFrame>): () => void {
  const fetch = window.fetch
  const said = designerFrameHeaders(frame)
  window.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (!READS.has(method.toUpperCase())) return Promise.reject(new TypeError(NOT_SENT))
    if (!frame || !ownOrigin(input)) return fetch.call(window, input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
    for (const [name, value] of Object.entries(said)) headers.set(name, value)
    return fetch.call(window, input, { ...init, headers })
  }, fetch)
  const { open, send } = XMLHttpRequest.prototype
  const methods = new WeakMap<XMLHttpRequest, string>()
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    ...rest: never[]
  ) {
    methods.set(this, method.toUpperCase())
    return (open as (...args: unknown[]) => void).call(this, method, ...rest)
  } as typeof open
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body) {
    if (!READS.has(methods.get(this) ?? 'GET')) throw new DOMException(NOT_SENT, 'NotAllowedError')
    return send.call(this, body)
  }
  const beacon = 'sendBeacon' in navigator ? navigator.sendBeacon : null
  if (beacon) navigator.sendBeacon = () => false
  return () => {
    window.fetch = fetch
    XMLHttpRequest.prototype.open = open
    XMLHttpRequest.prototype.send = send
    if (beacon) navigator.sendBeacon = beacon
  }
}

/** Whether a request goes to the page's own origin. */
function ownOrigin(input: RequestInfo | URL): boolean {
  const href = input instanceof Request ? input.url : String(input)
  try {
    return new URL(href, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/** Whether an event reaches a file picker, which would upload what is picked. */
const onFilePicker = (event: Event) =>
  !!(event.target as Element | null)?.closest?.('input[type="file"]')

/**
 * Keeps the page from doing anything real while it is designed: no form is
 * sent, no typing reaches a field, no key sends a post or a comment, no file
 * is picked and no request that changes something leaves the page. Returns
 * what lets the page act again.
 */
export function guardWrites(
  frame: ReturnType<typeof thisDesignerFrame> = thisDesignerFrame()
): () => void {
  const stop = (event: Event) => {
    if (inWords(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  const keys = (event: KeyboardEvent) => {
    const field = (event.target as Element | null)?.closest?.('input, textarea, [contenteditable]')
    if (field && (event.key === 'Enter' || event.key.length === 1)) stop(event)
  }
  const files = (event: Event) => {
    if (onFilePicker(event)) stop(event)
  }
  const types = ['submit', 'beforeinput', 'paste', 'drop'] as const
  for (const type of types) document.addEventListener(type, stop, true)
  document.addEventListener('keydown', keys, true)
  for (const type of ['click', 'change'] as const) document.addEventListener(type, files, true)
  const stopRequests = guardRequests(frame)
  return () => {
    for (const type of types) document.removeEventListener(type, stop, true)
    document.removeEventListener('keydown', keys, true)
    for (const type of ['click', 'change'] as const) document.removeEventListener(type, files, true)
    stopRequests()
  }
}

/**
 * Every click says which block it landed in, the link there and the menu
 * item, and whether Ctrl or Cmd was held to follow the link; nothing navigates; the pointer says which block and menu item it
 * is over. A double-click on a menu item asks the builder to rename it; one
 * on stored words edits them. Returns what stops listening.
 */
export function startDesigning(): () => void {
  const pointer = startPointer()
  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target || target.closest('[data-qb-words-editing]')) return
    event.preventDefault()
    event.stopPropagation()
    const menu = menuOf(target)
    post({
      type: 'quackback:preview-section',
      section: sectionOf(target),
      link: linkAt(target),
      // Where, so the builder can name the element under the click.
      x: event.clientX,
      y: event.clientY,
      ...(menu ? { menu } : {}),
      // Ctrl or Cmd and a click follows the link there, in the builder.
      ...(event.ctrlKey || event.metaKey ? { follow: true } : {}),
    })
  }
  function onDoubleClick(event: MouseEvent) {
    const menu = menuOf(event.target as Element | null)
    if (menu) {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      post({ type: 'quackback:preview-rename', menu })
      return
    }
    const words = (event.target as Element | null)?.closest('[data-qb-words]')
    if (words instanceof HTMLElement) {
      event.preventDefault()
      editWords(words)
    }
  }
  // Shift+click and double-clicks pick; they select no text, but in words being edited.
  function onMouseDown(event: MouseEvent) {
    if (!event.shiftKey && event.detail < 2) return
    if (document.querySelector('[data-qb-words-editing]')) return
    event.preventDefault()
  }
  // A right-click picks what is under it and opens its actions in the builder, there.
  function onContextMenu(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target || target.closest('[data-qb-words-editing]')) return
    event.preventDefault()
    event.stopPropagation()
    const menu = menuOf(target)
    post({
      type: 'quackback:preview-context',
      section: sectionOf(target),
      x: event.clientX,
      y: event.clientY,
      ...(menu ? { menu } : {}),
    })
  }
  // Undo, redo, quick find and Escape belong to the designer, whichever document has focus.
  function onKey(event: KeyboardEvent) {
    if ((event.target as Element | null)?.closest?.('[data-qb-words-editing], input, textarea'))
      return
    if (event.key === 'Escape') post({ type: 'quackback:preview-key', key: 'escape' })
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      post({ type: 'quackback:preview-key', key: 'find' })
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && /^[zy]$/i.test(event.key)) {
      event.preventDefault()
      post({
        type: 'quackback:preview-key',
        key: event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo',
      })
    }
  }
  // The builder's panel asks for words to be edited where they sit.
  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    const message = event.data as { type?: unknown; field?: unknown } | null
    if (message?.type === 'quackback:words-edit' && typeof message.field === 'string')
      editAsked(message.field)
    // What the builder asks the page to show, such as the feed with no posts.
    const asked = readPreviewState(message)
    if (asked) setDesignerPreview(asked)
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('message', onMessage)
  // Listening now: what the builder asks the page to show, such as the feed empty.
  post({ type: PREVIEW_STATE_ASK })
  const stopWrites = guardWrites()
  return () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('message', onMessage)
    setDesignerPreview({ empty: false, composer: false })
    stopWrites()
    pointer()
  }
}

/** What a page keeps in its address to stay a preview: its theme, language, designer flag and visitor. */
const PREVIEW_PARAMS = ['theme', 'preview', 'lang', 'designer', 'visitor'] as const

/**
 * A link's address within the preview, keeping the preview's own parameters,
 * or null off the portal. The frame stays the designer's, and signed out if
 * it was, even when a page dropped them from its own address.
 */
export function previewHref(
  href: string,
  current: Location = window.location,
  frame: ReturnType<typeof thisDesignerFrame> = thisDesignerFrame()
): string | null {
  let url: URL
  try {
    url = new URL(href, current.href)
  } catch {
    return null
  }
  // The portal's own pages only: not another site, the admin or the API.
  if (url.origin !== current.origin || /^\/(admin|api)(\/|$)/.test(url.pathname)) return null
  const here = new URLSearchParams(current.search)
  for (const name of PREVIEW_PARAMS) {
    const value = here.get(name)
    if (value !== null) url.searchParams.set(name, value)
  }
  if (frame) url.searchParams.set('designer', '1')
  if (frame?.visitor === 'out') url.searchParams.set('visitor', 'out')
  return `${url.pathname}${url.search}${url.hash}`
}

/** Tells the designer where the page is, so leaving Preview stays there. */
function reportLocation(): void {
  post({ type: 'quackback:preview-location', path: window.location.pathname })
}

/**
 * Says where the page is now, and again whenever it moves without loading
 * afresh. Returns what stops it.
 */
function followLocation(): () => void {
  reportLocation()
  const { pushState, replaceState } = window.history
  window.history.pushState = function (this: History, ...args) {
    pushState.apply(this, args)
    reportLocation()
  }
  window.history.replaceState = function (this: History, ...args) {
    replaceState.apply(this, args)
    reportLocation()
  }
  window.addEventListener('popstate', reportLocation)
  return () => {
    window.history.pushState = pushState
    window.history.replaceState = replaceState
    window.removeEventListener('popstate', reportLocation)
  }
}

/**
 * Clicks act as a visitor's: menus open, and a link to another page of the
 * portal opens it within the preview, still drawn from the draft. Nothing is
 * sent or typed, and a link off the portal goes nowhere. Where the page is
 * goes back to the designer. Escape hands back to it. Returns what stops it.
 */
export function startTrying(): () => void {
  function onClick(event: MouseEvent) {
    const link = (event.target as Element | null)?.closest?.('a[href]')
    if (!(link instanceof HTMLAnchorElement)) return
    event.preventDefault()
    event.stopPropagation()
    const to = previewHref(link.getAttribute('href') ?? '')
    if (to) window.location.assign(to)
  }
  // Escape a menu did not take ends trying.
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented)
      post({ type: 'quackback:preview-key', key: 'escape' })
  }
  document.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey)
  const stopWrites = guardWrites()
  const stopFollowing = followLocation()
  return () => {
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey)
    stopWrites()
    stopFollowing()
  }
}

/**
 * Says which block the pointer is over whenever that changes, and that it is
 * over none once it leaves the page. Returns what stops it.
 */
function startPointer(): () => void {
  let over: string | null = null
  let overMenu: string | null = null
  let overNode: Element | null = null
  let frame = 0
  const say = (
    section: string | null,
    menu: string | null,
    node: Element | null,
    at?: { x: number; y: number }
  ) => {
    if (section === over && menu === overMenu && node === overNode) return
    over = section
    overMenu = menu
    overNode = node
    post({
      type: 'quackback:preview-pointer',
      section,
      ...(at ? { x: at.x, y: at.y } : {}),
      ...(menu ? { menu } : {}),
    })
  }
  function onMove(event: PointerEvent) {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const target = event.target as Element | null
      if (target?.closest?.('[data-qb-words-editing]')) return say(null, null, null)
      say(sectionOf(target), menuOf(target), target, { x: event.clientX, y: event.clientY })
    })
  }
  const leave = () => {
    cancelAnimationFrame(frame)
    say(null, null, null)
  }
  document.addEventListener('pointermove', onMove, true)
  document.documentElement.addEventListener('pointerleave', leave)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onMove, true)
    document.documentElement.removeEventListener('pointerleave', leave)
  }
}
