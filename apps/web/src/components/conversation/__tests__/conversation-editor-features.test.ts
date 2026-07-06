/**
 * Guards the conversation editor presets against accidental flag drift. Each
 * object is pinned to its exact shape; the reply/note/visitor deltas are
 * asserted explicitly so a future change to one preset can't silently change
 * another (or flip a chat-shaped flag back to document-shaped).
 */

import { describe, it, expect } from 'vitest'
import type { EditorFeatures } from '@/components/ui/rich-text-editor'
import {
  CONVERSATION_EDITOR_FEATURES,
  CONVERSATION_NOTE_FEATURES,
  VISITOR_CONVERSATION_FEATURES,
} from '../conversation-editor-features'

const REPLY: EditorFeatures = {
  headings: false,
  tables: false,
  taskLists: false,
  dividers: false,
  codeBlocks: true,
  images: true,
  blockquotes: true,
  embeds: true,
  quackbackEmbeds: true,
  emojiPicker: true,
  slashMenu: true,
  bubbleMenu: true,
  enterAsHardBreak: true,
  mentions: true,
}

describe('conversation editor presets', () => {
  it('CONVERSATION_EDITOR_FEATURES (agent reply) matches the pinned shape', () => {
    expect(CONVERSATION_EDITOR_FEATURES).toEqual(REPLY)
  })

  it('CONVERSATION_NOTE_FEATURES is identical to the reply preset today', () => {
    expect(CONVERSATION_NOTE_FEATURES).toEqual(REPLY)
  })

  it('VISITOR_CONVERSATION_FEATURES is the reply preset with mentions off', () => {
    expect(VISITOR_CONVERSATION_FEATURES).toEqual({ ...REPLY, mentions: false })
  })

  it('only the visitor preset disables mentions', () => {
    expect(CONVERSATION_EDITOR_FEATURES.mentions).toBe(true)
    expect(CONVERSATION_NOTE_FEATURES.mentions).toBe(true)
    expect(VISITOR_CONVERSATION_FEATURES.mentions).toBe(false)
  })
})
