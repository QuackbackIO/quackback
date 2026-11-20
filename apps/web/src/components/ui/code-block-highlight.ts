/**
 * Code blocks with syntax highlighting whose grammars load on demand.
 *
 * The grammars are most of the highlighter's weight, and most editors never
 * hold a code block: the widget's composers, for one, are downloaded by every
 * visitor who opens the widget. So the lowlight instance starts empty and
 * code-block-languages.ts loads the first time any editor's document holds a
 * code block, whether it came with the content, a ``` fence, the slash menu or
 * a paste. Until then a code block shows as plain monospaced text, as an
 * unknown language always has.
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { createLowlight } from 'lowlight'

export const lowlight = createLowlight()

let languages: Promise<void> | null = null
let languagesReady = false

/** Load and register the grammars once; a failed load is retried next time. */
export function loadCodeLanguages(): Promise<void> {
  languages ??= import('./code-block-languages').then(
    ({ registerCodeLanguages }) => {
      registerCodeLanguages(lowlight)
      languagesReady = true
    },
    (error: unknown) => {
      languages = null
      throw error
    }
  )
  return languages
}

/** Position of the first node of type `name`, or -1. */
function firstCodeBlock(doc: ProseMirrorNode, name: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === name) found = pos
    return found === -1
  })
  return found
}

/**
 * The lowlight plugin only re-highlights when a transaction changes a code
 * block, so once the grammars arrive, re-set one code block's own attributes.
 * Kept out of undo history and out of the editor's update event, so it never
 * reads as an edit (no dirty state, no typing indicator, no autosave).
 */
function rehighlight(view: EditorView, name: string): void {
  const pos = firstCodeBlock(view.state.doc, name)
  if (pos === -1) return
  const node = view.state.doc.nodeAt(pos)
  if (!node) return
  view.dispatch(
    view.state.tr
      .setNodeMarkup(pos, undefined, node.attrs)
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true)
  )
}

function languagesLoader(name: string) {
  return new Plugin({
    key: new PluginKey('codeBlockLanguages'),
    view(view) {
      let waiting = false
      let destroyed = false
      const check = (doc: ProseMirrorNode) => {
        if (languagesReady || waiting || firstCodeBlock(doc, name) === -1) return
        waiting = true
        loadCodeLanguages().then(
          () => {
            waiting = false
            if (!destroyed) rehighlight(view, name)
          },
          () => {
            waiting = false
          }
        )
      }
      check(view.state.doc)
      return {
        update(view, prevState) {
          if (view.state.doc !== prevState.doc) check(view.state.doc)
        },
        destroy() {
          destroyed = true
        },
      }
    },
  })
}

export const CodeBlockHighlight = CodeBlockLowlight.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), languagesLoader(this.name)]
  },
})
