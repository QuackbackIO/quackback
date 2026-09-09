/**
 * Guards the comment editor preset against accidental flag drift. enterAsHardBreak
 * was dropped once when comments reused the post composer feature set — pin it
 * so plain Enter stays a newline (Cmd/Ctrl+Enter submits on the wrapping form).
 */

import { describe, it, expect } from 'vitest'
import type { EditorFeatures } from '@/components/ui/rich-text-editor'
import { COMMENT_EDITOR_FEATURES } from '../comment-editor-features'

const COMMENT: EditorFeatures = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  images: true,
  tables: true,
  embeds: true,
  quackbackEmbeds: true,
  bubbleMenu: true,
  slashMenu: true,
  emojiPicker: true,
  enterAsHardBreak: true,
}

describe('comment editor preset', () => {
  it('COMMENT_EDITOR_FEATURES matches the pinned shape', () => {
    expect(COMMENT_EDITOR_FEATURES).toEqual(COMMENT)
  })

  it('keeps Enter as a line break (not a submit)', () => {
    expect(COMMENT_EDITOR_FEATURES.enterAsHardBreak).toBe(true)
  })
})
