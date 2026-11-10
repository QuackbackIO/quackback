import { act, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

/** The words editor a field shows, once it has mounted. */
export async function wordsEditor(name: string | RegExp): Promise<Editor> {
  const box = await screen.findByRole('textbox', { name })
  const editor = (box as HTMLElement & { editor?: Editor }).editor
  if (!editor) throw new Error(`No words editor for ${String(name)}`)
  return editor
}

/** Selects the first place a phrase is in the editor's words, as a person dragging over it. */
export function selectWords(editor: Editor, phrase: string): void {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(phrase)) at = pos + node.text!.indexOf(phrase)
  })
  if (at < 0) throw new Error(`"${phrase}" is not in the words`)
  act(() => {
    editor.commands.focus()
    editor.commands.setTextSelection({ from: at, to: at + phrase.length })
  })
}

/** Types words where the cursor is. */
export function typeWords(editor: Editor, text: string): void {
  act(() => {
    editor.commands.insertContent(text)
  })
}

/** Replaces every word in the editor, as typing over a selected field does. */
export function retype(editor: Editor, text: string): void {
  act(() => {
    editor.commands.focus()
    editor.commands.selectAll()
    if (text) editor.commands.insertContent(text)
    else editor.commands.deleteSelection()
  })
}

/** Presses a key in the editor, as its keymap hears it. */
export function pressKey(editor: Editor, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    editor.view.someProp('handleKeyDown', (handle) =>
      handle(editor.view, new KeyboardEvent('keydown', { key, ...init }))
    )
  })
}
