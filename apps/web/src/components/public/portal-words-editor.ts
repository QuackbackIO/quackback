/**
 * Words edited where they sit, in the designer's frame: a Tiptap editor on a
 * copy of the words' own element, so the portal's CSS draws them exactly as
 * visitors see them, with the schema of their kind (a headline's one phrase
 * set apart, plain words, or rich words). The page's own element is never
 * changed by hand. The builder draws the format bar over the frame from what
 * this says (the selection's box and the marks on it) and sends back what to
 * do; Enter or leaving keeps the words, Escape puts them back.
 *
 * The editor starts from the words as the design stores them, which the
 * builder sends when asked; the page's own HTML is read only when no stored
 * words came.
 */
import { Editor } from '@tiptap/core'
import {
  runWordsCommand,
  wordsExtensions,
  wordsState,
  type WordsCommand,
} from '@/lib/shared/words-editor/extensions'
import {
  readWordsField,
  wordsKindOf,
  wordsLimitOf,
  wordsName,
} from '@/lib/shared/design/headline-words'
import {
  isWordsDoc,
  plainDoc,
  sameWords,
  type WordsDoc,
  type WordsKind,
} from '@/lib/shared/design/rich-words'
import { checkedWords, holdsMoreThanWords } from '@/lib/shared/design/words-schema'

/** What rich words on the page cannot hold: a body with any of these is edited in the panel. */
const MORE_THAN_WORDS =
  'img,video,iframe,table,pre,blockquote,hr,h1,h4,h5,h6,[data-type="taskList"],[data-quackback-embed]'

type Post = (message: Record<string, unknown>) => void

/** The words being edited, if any: one at a time. */
let current: { finish: (keep: boolean) => void } | null = null

/** A box as the builder reads it. */
const boxOf = (rect: { left: number; top: number; width: number; height: number }) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
})

/**
 * What the canvas editor starts from: plain words as words (a "<" in them is
 * a character, not a tag), and a headline or rich words as the page draws them.
 */
export function wordsToEdit(element: HTMLElement, kind: WordsKind): WordsDoc | string {
  return kind === 'plain' ? plainDoc(element.textContent ?? '') : element.innerHTML
}

/** How long the frame waits for the builder's stored words before it reads the page's. */
export const STORED_WORDS_WAIT_MS = 400

/** The ask waiting for the builder's answer, if any: one at a time. */
let asking: { cancel: () => void } | null = null

/**
 * Asks the builder for the words an element marks as the design stores them,
 * then edits them where they sit. Without an answer in time, or with no
 * words in it, the page's own words are edited.
 */
export function openWords(element: HTMLElement, post: Post, wait = STORED_WORDS_WAIT_MS): void {
  const mark = element.getAttribute('data-qb-words')
  if (!mark || !readWordsField(mark)) return
  asking?.cancel()
  const done = (doc: WordsDoc | null) => {
    asking?.cancel()
    editWordsInPlace(element, post, doc)
  }
  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    const message = event.data as { type?: string; field?: unknown; doc?: unknown } | null
    if (message?.type !== 'quackback:words-open' || message.field !== mark) return
    done(isWordsDoc(message.doc) ? message.doc : null)
  }
  const timer = setTimeout(() => done(null), wait)
  window.addEventListener('message', onMessage)
  asking = {
    cancel: () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      asking = null
    },
  }
  post({ type: 'quackback:words-ask', field: mark })
}

/**
 * Edits the words an element marks, over a copy of it: the stored words when
 * the builder sent them, else the page's own. Says when rich words hold more
 * than the editor can, and leaves them to the panel.
 */
export function editWordsInPlace(
  element: HTMLElement,
  post: Post,
  stored: WordsDoc | null = null
): void {
  const mark = element.getAttribute('data-qb-words')
  const field = readWordsField(mark)
  if (!mark || !field || element.hasAttribute('data-qb-words-hidden')) return
  current?.finish(true)
  const kind = wordsKindOf(field)
  const limit = wordsLimitOf(field)
  const more = stored ? holdsMoreThanWords(stored) : !!element.querySelector(MORE_THAN_WORDS)
  if (kind === 'rich' && more) {
    post({ type: 'quackback:words-blocked', field: mark })
    return
  }
  const copy = element.cloneNode(false) as HTMLElement
  copy.removeAttribute('data-qb-words')
  copy.setAttribute('data-qb-words-editing', '')
  const content = stored ? checkedWords(stored, kind, limit) : wordsToEdit(element, kind)
  element.setAttribute('data-qb-words-hidden', '')
  element.style.display = 'none'
  element.after(copy)

  const name = wordsName(field)
  let done = false
  let ready = false
  const say = () => {
    if (done || !ready) return
    const { from, to, empty } = editor.state.selection
    let selection = null
    if (!empty) {
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const left = Math.min(start.left, end.left)
      const top = Math.min(start.top, end.top)
      selection = {
        left,
        top,
        width: Math.max(Math.max(start.right, end.right) - left, 1),
        height: Math.max(start.bottom, end.bottom) - top,
      }
    }
    post({
      type: 'quackback:words-state',
      field: mark,
      state: wordsState(editor, kind, limit),
      box: boxOf(copy.getBoundingClientRect()),
      selection,
    })
  }
  const editor = new Editor({
    element: copy,
    content,
    extensions: wordsExtensions({
      kind,
      limit,
      placeholder: name,
      onCommit: () => finish(true),
      onCancel: () => finish(false),
      onLinkRequest: () => post({ type: 'quackback:words-link', field: mark }),
      onToolbar: () => post({ type: 'quackback:words-toolbar', field: mark }),
    }),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': name,
        'aria-multiline': String(kind === 'rich'),
        'aria-description':
          kind === 'plain'
            ? 'Enter keeps, Escape cancels.'
            : 'Select words to format them; Alt+F10 opens the format bar. Enter keeps, Escape cancels.',
        // Rich words keep the page's own typography for their paragraphs and lists.
        class: 'outline-none',
      },
    },
    onTransaction: say,
    onFocus: say,
    onBlur: () => {
      // Focus may have gone to the builder's format bar, which keeps the words open.
      setTimeout(() => {
        if (done || editor.isFocused) return
        if (document.hasFocus()) finish(true)
        else post({ type: 'quackback:words-blur', field: mark })
      }, 0)
    },
  })
  ready = true
  const original = editor.getJSON()

  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    const message = event.data as { type?: string; command?: WordsCommand; keep?: unknown } | null
    if (message?.type === 'quackback:words-command' && message.command) {
      runWordsCommand(editor, message.command)
      say()
    } else if (message?.type === 'quackback:words-finish') finish(message.keep !== false)
    else if (message?.type === 'quackback:words-focus') editor.commands.focus()
  }
  const reflow = () => say()
  window.addEventListener('message', onMessage)
  window.addEventListener('scroll', reflow, true)
  window.addEventListener('resize', reflow)

  function finish(keep: boolean) {
    if (done) return
    done = true
    current = null
    const doc = editor.getJSON()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('scroll', reflow, true)
    window.removeEventListener('resize', reflow)
    editor.destroy()
    copy.remove()
    element.style.display = ''
    element.removeAttribute('data-qb-words-hidden')
    if (keep && !sameWords(doc, original))
      post({ type: 'quackback:preview-words', field: mark, doc })
    post({ type: 'quackback:words-end', field: mark })
  }
  current = { finish }

  editor.commands.focus()
  editor.commands.selectAll()
}

/** Ends any words being edited, keeping them, and any ask still waiting. */
export function finishWords(): void {
  asking?.cancel()
  current?.finish(true)
}
