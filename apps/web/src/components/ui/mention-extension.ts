import Mention from '@tiptap/extension-mention'
import type { Editor } from '@tiptap/core'
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { MentionPicker, type MentionItem, type MentionPickerHandle } from './mention-picker'
import { markSuggestionPopup } from './suggestion-popup-marker'

const DEBOUNCE_MS = 200

/** Restrict the typeahead to teammates only (admin/member) — no visitors. */
type MentionScope = 'team' | undefined

/**
 * The inbox item a note is written on. The server marks each teammate who
 * cannot see it (`noAccess`), and the picker shows them muted and unpickable.
 */
export interface MentionItemRef {
  kind: 'conversation' | 'ticket'
  id: string
}

async function fetchSuggestions(
  q: string,
  scope: MentionScope,
  item?: MentionItemRef
): Promise<MentionItem[]> {
  try {
    const params = new URLSearchParams({ q })
    if (scope) params.set('scope', scope)
    if (item) {
      params.set('itemKind', item.kind)
      params.set('itemId', item.id)
    }
    const res = await fetch(`/api/v1/mentions/suggest?${params.toString()}`, {
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

// The popup render lifecycle is identical regardless of scope.
const renderSuggestion: SuggestionOptions<MentionItem>['render'] = () => {
  let component: ReactRenderer<MentionPickerHandle> | null = null
  let popup: Instance | null = null

  return {
    onStart: (props: SuggestionProps<MentionItem>) => {
      component = new ReactRenderer(MentionPicker, {
        props: {
          items: props.items,
          command: props.command,
          query: props.query,
        },
        editor: props.editor,
      })
      if (!props.clientRect) return
      popup = tippy(document.body, {
        getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
        appendTo: () => document.body,
        content: markSuggestionPopup(component.element),
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'top-start',
        // Prefer above the caret, but flip below near the top of the
        // viewport — @ works in tall editors too, not just the composer.
        popperOptions: {
          modifiers: [{ name: 'preventOverflow', options: { mainAxis: true, altAxis: true } }],
        },
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
        query: props.query,
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
}

function buildMentionExtension(scope: MentionScope, item?: MentionItemRef) {
  return Mention.configure({
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
            resolve(await fetchSuggestions(query.toLowerCase(), scope, item))
          }, DEBOUNCE_MS)
          pendingTimers.set(editor, t)
        }),
      render: renderSuggestion,
    },
  })
}

/** Default: any mentionable user (admin/member/user). Used by comments. */
export const MentionExtension = buildMentionExtension(undefined)

/**
 * Team-only (admin/member) mentions for a note on one inbox item, with the
 * teammates who cannot see that item marked. Build one per item and keep it
 * stable while the item is open (the editor rebuilds on a new instance).
 */
export function teamMentionExtensionFor(item: MentionItemRef) {
  return buildMentionExtension('team', item)
}
