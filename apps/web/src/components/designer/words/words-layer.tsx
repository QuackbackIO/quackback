import { useEffect, useRef, useState } from 'react'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { languageName } from '@/components/admin/settings/appearance/language-picker'
import { readWordsField, wordsDocOf, wordsElsewhere } from '@/lib/shared/design/headline-words'
import { docText, type WordsDoc } from '@/lib/shared/design/rich-words'
import { toLayerRect, type Rect } from '@/lib/shared/design/layer-geometry'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { wordsRoles } from '@/lib/shared/design/colour-roles'
import type { WordsCommand, WordsState } from '@/lib/shared/words-editor/extensions'
import type { CanvasFrame } from '../designer-canvas'
import { cn } from '@/lib/shared/utils'
import {
  PREVIEW_STATE_ASK,
  PREVIEW_STATE_MESSAGE,
  designerPreview,
  subscribeDesignerPreview,
} from '@/components/public/designer-preview-state'
import { EDIT_ON_CANVAS } from './edit-on-canvas'
import { WordsBubble } from './words-bubble'

/** What the frame says while words are edited where they sit. */
interface Editing {
  field: string
  state: WordsState
  /** The words' box, and the selected words' box, in the frame's viewport. */
  box: Rect
  selection: Rect | null
}

const BAR_HEIGHT = 36
const GAP = 8
/** The bar's widest, with More open, so it stays within the canvas. */
const BAR_WIDTH = 380

/**
 * The stored words the frame edits, or none when the design keeps no words
 * there and the page draws its usual ones, which the frame then reads.
 */
export const storedWords = (doc: WordsDoc | null | undefined): WordsDoc | null =>
  doc && docText(doc) ? doc : null

/**
 * The format bar for words edited on the canvas, drawn on the builder's
 * layer over the frame, where the selection is, at the canvas's scale. The
 * editor itself lives in the frame, on the words' own element; this hears
 * what is selected and sends back what to do. Beneath the words: a quiet
 * count near the limit, and the same words in the other languages.
 */
export function WordsLayer({
  canvas,
  design,
  locale,
  say,
}: {
  canvas: CanvasFrame
  design: PortalDesign
  locale: string
  /** Says something to the person, as the builder announces. */
  say: (words: string) => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  // Bumped when the editor asks for the bar (Alt+F10) or a link (Mod-K).
  const [toolbar, setToolbar] = useState(0)
  const [linkAsked, setLinkAsked] = useState(0)
  const bar = useRef<HTMLDivElement>(null)
  const frame = canvas.frame
  const latest = useRef({ say, design, locale })
  latest.current = { say, design, locale }

  useEffect(() => {
    if (!frame) return
    const send = (message: Record<string, unknown>) =>
      frame.contentWindow?.postMessage(message, window.location.origin)
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return
      const message = event.data as Record<string, unknown> | null
      switch (message?.type) {
        case 'quackback:words-ask': {
          // The frame edits the words as the design stores them, when it has them.
          const field = readWordsField(message.field)
          if (!field) return
          const { design: now, locale: at } = latest.current
          send({
            type: 'quackback:words-open',
            field: message.field,
            doc: storedWords(wordsDocOf(now, field, at)),
          })
          return
        }
        case 'quackback:words-state':
          setEditing({
            field: String(message.field),
            state: message.state as WordsState,
            box: message.box as Rect,
            selection: (message.selection as Rect | null) ?? null,
          })
          return
        case 'quackback:words-end':
          setEditing(null)
          setToolbar(0)
          return
        case 'quackback:words-toolbar':
          setToolbar((n) => n + 1)
          return
        case 'quackback:words-link':
          setLinkAsked((n) => n + 1)
          return
        case 'quackback:words-blocked':
          latest.current.say(
            'This message has images, tables or other headings, so it is edited in its panel'
          )
          return
        case 'quackback:words-blur':
          // Focus left the frame: the words stay open while it is on the format bar.
          setTimeout(() => {
            if (!bar.current?.contains(document.activeElement))
              send({ type: 'quackback:words-finish', keep: true })
          }, 0)
      }
    }
    // A panel's Edit: the frame opens the words where they sit.
    function onAsked(event: Event) {
      const field = (event as CustomEvent<unknown>).detail
      if (typeof field === 'string' && readWordsField(field))
        send({ type: 'quackback:words-edit', field })
    }
    window.addEventListener('message', onMessage)
    window.addEventListener(EDIT_ON_CANVAS, onAsked)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener(EDIT_ON_CANVAS, onAsked)
    }
  }, [frame])

  // What a panel asks the page to show, such as the feed empty, sent again whenever the page asks.
  useEffect(() => {
    if (!frame) return
    const send = () =>
      frame.contentWindow?.postMessage(
        { type: PREVIEW_STATE_MESSAGE, empty: designerPreview().empty },
        window.location.origin
      )
    function onReady(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return
      const type = (event.data as { type?: unknown } | null)?.type
      if (type === 'quackback:preview-ready' || type === PREVIEW_STATE_ASK) send()
    }
    send()
    const stop = subscribeDesignerPreview(send)
    window.addEventListener('message', onReady)
    return () => {
      stop()
      window.removeEventListener('message', onReady)
    }
  }, [frame])

  // While words are edited, the picked block's chip steps aside for the format bar.
  const on = !!editing
  useEffect(() => {
    if (!on) return
    document.documentElement.setAttribute('data-words-editing', '')
    return () => document.documentElement.removeAttribute('data-words-editing')
  }, [on])

  if (!editing || !frame) return null
  const send = (message: Record<string, unknown>) =>
    frame.contentWindow?.postMessage(message, window.location.origin)
  const backToWords = () => {
    setToolbar(0)
    frame.contentWindow?.focus()
    send({ type: 'quackback:words-focus' })
  }
  const box = toLayerRect(editing.box, canvas.scale)
  const selection = editing.selection ? toLayerRect(editing.selection, canvas.scale) : null
  const field = readWordsField(editing.field)
  const elsewhere = field ? wordsElsewhere(design, field, locale) : []
  const { state } = editing
  const near = !!state.limit && state.length >= state.limit * 0.8
  const showBar = state.kind !== 'plain' && (state.selected || toolbar > 0 || linkAsked > 0)
  const anchor = selection ?? box
  const above = anchor.top - BAR_HEIGHT - GAP >= 0
  // Above the words, the bar grows upwards as More opens, so it never covers them.
  const top = above ? anchor.top - GAP : anchor.top + anchor.height + GAP
  const left = Math.max(4, Math.min(anchor.left, canvas.room.width - BAR_WIDTH))

  return (
    <div data-words-layer="" className="pointer-events-none absolute inset-0 overflow-hidden">
      {showBar && (
        <div
          ref={bar}
          className={cn('pointer-events-auto absolute', above && '-translate-y-full')}
          style={{ left, top }}
          onBlur={() =>
            // Focus that leaves the bar for anywhere but the words ends the edit, keeping it.
            setTimeout(() => {
              const at = document.activeElement
              if (at !== frame && !bar.current?.contains(at))
                send({ type: 'quackback:words-finish', keep: true })
            }, 0)
          }
        >
          <WordsBubble
            key={toolbar}
            state={state}
            roles={wordsRoles(design)}
            focusOnMount={toolbar > 0}
            linkRequested={linkAsked}
            onCommand={(command: WordsCommand) =>
              send({ type: 'quackback:words-command', command })
            }
            onReturn={backToWords}
          />
        </div>
      )}
      {(near || elsewhere.length > 0) && (
        <p
          aria-live="polite"
          className="absolute flex max-w-[28rem] items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-muted-foreground shadow-sm"
          style={{
            left: Math.max(4, box.left),
            top: Math.min(box.top + box.height + GAP, canvas.room.height - 32),
          }}
        >
          {near && (
            <span data-words-count="" className="tabular-nums">
              {state.length}/{state.limit}
            </span>
          )}
          {elsewhere.length > 0 && (
            <span className="truncate">
              {elsewhere
                .map(
                  ({ locale: other, text }) =>
                    `${languageName(other as SupportedLocale)}: “${text}”`
                )
                .join(' · ')}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
