import { describe, it, expect } from 'vitest'
import type { ConversationTagId } from '@quackback/ids'
import { normalizeConversationTagInput, hasNameConflict } from '../conversation-tag.service'

describe('normalizeConversationTagInput', () => {
  it('trims the name and defaults the color', () => {
    expect(normalizeConversationTagInput({ name: '  Lead ' })).toEqual({
      name: 'Lead',
      color: '#6b7280',
    })
  })

  it('keeps a valid custom hex color', () => {
    expect(normalizeConversationTagInput({ name: 'x', color: '#FF0000' })).toEqual({
      name: 'x',
      color: '#FF0000',
    })
  })

  it('rejects an empty / whitespace name', () => {
    expect(() => normalizeConversationTagInput({ name: '   ' })).toThrow()
  })

  it('rejects a name over 50 characters', () => {
    expect(() => normalizeConversationTagInput({ name: 'a'.repeat(51) })).toThrow()
  })

  it('rejects a non-hex color', () => {
    expect(() => normalizeConversationTagInput({ name: 'x', color: 'red' })).toThrow()
    expect(() => normalizeConversationTagInput({ name: 'x', color: '#FFF' })).toThrow()
  })
})

describe('hasNameConflict', () => {
  const id = (s: string) => s as ConversationTagId
  const live = [
    { id: id('chat_tag_a'), name: 'Lead' },
    { id: id('chat_tag_b'), name: 'VIP' },
  ]

  it('flags a rename onto another live tag (case-insensitive)', () => {
    expect(hasNameConflict(id('chat_tag_a'), 'vip', live)).toBe(true)
    expect(hasNameConflict(id('chat_tag_a'), '  VIP ', live)).toBe(true)
  })

  it('allows keeping the same tag at its own name', () => {
    // Renaming a tag to (a casing of) its own current name is not a conflict.
    expect(hasNameConflict(id('chat_tag_b'), 'VIP', live)).toBe(false)
    expect(hasNameConflict(id('chat_tag_b'), 'vip', live)).toBe(false)
  })

  it('allows a brand-new name', () => {
    expect(hasNameConflict(id('chat_tag_a'), 'Churned', live)).toBe(false)
  })
})
