import Mention from '@tiptap/extension-mention'
import type { Editor } from '@tiptap/core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { MentionPicker, type MentionItem, type MentionPickerHandle } from './mention-picker'

const DEBOUNCE_MS = 200

async function fetchSuggestions(q: string): Promise<MentionItem[]> {
  try {
    const res = await fetch(`/api/v1/mentions/suggest?q=${encodeURIComponent(q)}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    return (await res.json()) as MentionItem[]
  } catch {
    return []
  }
}

// Keyed by editor instance so two editors mounted in parallel don't cancel
// each other's pending fetches.
const pendingTimers = new WeakMap<Editor, ReturnType<typeof setTimeout>>()

export const MentionExtension = Mention.configure({
  HTMLAttributes: { class: 'mention' },
  suggestion: {
    char: '@',
    // Display names often contain spaces — keep the suggestion open so a
    // second word can keep narrowing. Escape or a pick dismisses.
    allowSpaces: true,
    items: ({ editor, query }) =>
      new Promise<MentionItem[]>((resolve) => {
        const prev = pendingTimers.get(editor)
        if (prev) clearTimeout(prev)
        const t = setTimeout(async () => {
          resolve(await fetchSuggestions(query.toLowerCase()))
        }, DEBOUNCE_MS)
        pendingTimers.set(editor, t)
      }),
    render: () => {
      let component: ReactRenderer<MentionPickerHandle> | null = null
      let popup: Instance | null = null

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionPicker, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          })
          if (!props.clientRect) return
          popup = tippy(document.body, {
            getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
            arrow: false,
            // Custom theme so our CSS can strip tippy's default chrome and
            // let .mention-picker be the only visible surface.
            theme: 'mention-picker',
            duration: 0,
          })
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps({
            items: props.items,
            command: props.command,
          })
          popup?.setProps({
            getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
          })
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            popup?.hide()
            return true
          }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: () => {
          popup?.destroy()
          popup = null
          component?.destroy()
          component = null
        },
      }
    },
  },
})
