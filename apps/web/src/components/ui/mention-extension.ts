import Mention from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { MentionPicker, type MentionItem, type MentionPickerHandle } from './mention-picker'

let pendingTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 200

async function fetchSuggestions(q: string): Promise<MentionItem[]> {
  if (q.length === 0) return []
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

export const MentionExtension = Mention.configure({
  HTMLAttributes: { class: 'mention' },
  suggestion: {
    char: '@',
    items: ({ query }) =>
      new Promise<MentionItem[]>((resolve) => {
        if (pendingTimer) clearTimeout(pendingTimer)
        pendingTimer = setTimeout(async () => {
          resolve(await fetchSuggestions(query.toLowerCase()))
        }, DEBOUNCE_MS)
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
