// @vitest-environment happy-dom

/**
 * TipTap reads `extension.storage` through a getter that re-runs the
 * extension's `addStorage` on every access, and it reads it dozens of times
 * while mounting one editor. The stock emoji storage walks the whole emoji
 * dataset each time, which made opening an editor cost hundreds of thousands
 * of function calls. These tests pin the storage to one computation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { Emoji, emojis } from '@tiptap/extension-emoji'
import { buildExtensions, createEmojiExtension } from '../rich-text-editor'

const POST_EDITOR_FEATURES = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  images: true,
  videos: true,
  tables: true,
  embeds: true,
  quackbackEmbeds: true,
  bubbleMenu: true,
  slashMenu: true,
}

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  vi.restoreAllMocks()
})

function mountEditor() {
  const editor = new Editor({
    extensions: buildExtensions(POST_EDITOR_FEATURES, { placeholder: 'Write...' }),
    content: '<p>hello</p>',
  })
  editors.push(editor)
  return editor
}

describe('emoji extension storage', () => {
  it('builds the emoji support table at most once across editor mounts', () => {
    const upstream = vi.spyOn(Emoji.config as { addStorage: () => unknown }, 'addStorage')

    mountEditor()
    mountEditor()

    expect(upstream.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('answers the same as the stock emoji storage', () => {
    const stock = Emoji.storage as { isSupported: (item: unknown) => boolean }
    const ours = createEmojiExtension().storage as {
      emojis: unknown[]
      isSupported: (item: unknown) => boolean
    }

    expect(ours.emojis).toBe(emojis)
    for (const item of [emojis[0], emojis[100], emojis[emojis.length - 1]]) {
      expect(ours.isSupported(item)).toBe(stock.isSupported(item))
    }
  })

  it('gives every editor its own storage object', () => {
    const a = mountEditor()
    const b = mountEditor()

    expect(a.storage.emoji).not.toBe(b.storage.emoji)
    expect(a.storage.emoji.emojis).toBe(b.storage.emoji.emojis)
  })
})
