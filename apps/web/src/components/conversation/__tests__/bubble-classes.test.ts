/**
 * `bubbleClasses` / `bubbleContentTextClass` are the shared chat-bubble tokens
 * both `AgentMessageBubble` (admin thread) and `VisitorMessageBubble`
 * (widget + portal) render from, per UNIFIED-INBOX-SPEC.md §2.6 — a pure
 * function so the two idioms cannot silently drift apart.
 */
import { describe, it, expect } from 'vitest'
import { bubbleClasses, bubbleContentTextClass } from '../message-bubble'

describe('bubbleClasses', () => {
  it('gives the self side the brand-primary fill', () => {
    const classes = bubbleClasses('self')
    expect(classes).toContain('bg-primary')
    expect(classes).toContain('text-primary-foreground')
    expect(classes).toContain('rounded-2xl')
    expect(classes).toContain('max-w-[85%]')
    expect(classes).toContain('px-3.5')
    expect(classes).toContain('py-2.5')
  })

  it('gives the peer side the neutral muted fill', () => {
    const classes = bubbleClasses('peer')
    expect(classes).toContain('bg-muted')
    expect(classes).toContain('text-foreground')
    expect(classes).not.toContain('bg-primary')
  })

  it('shares identical geometry (radius/padding/max-width) across sides', () => {
    const self = bubbleClasses('self')
    const peer = bubbleClasses('peer')
    for (const token of ['rounded-2xl', 'px-3.5', 'py-2.5', 'max-w-[85%]']) {
      expect(self).toContain(token)
      expect(peer).toContain(token)
    }
  })

  it('overrides the fill with the amber internal-note tint regardless of side', () => {
    const asSelf = bubbleClasses('self', { note: true })
    const asPeer = bubbleClasses('peer', { note: true })
    expect(asSelf).toBe(asPeer)
    expect(asSelf).toContain('bg-amber-400/10')
    expect(asSelf).toContain('border-amber-400/25')
    expect(asSelf).toContain('text-foreground')
    expect(asSelf).not.toContain('bg-primary')
    expect(asSelf).not.toContain('bg-muted')
  })

  it('keeps note geometry identical to the non-note bubble', () => {
    const note = bubbleClasses('self', { note: true })
    for (const token of ['rounded-2xl', 'px-3.5', 'py-2.5', 'max-w-[85%]']) {
      expect(note).toContain(token)
    }
  })
})

describe('bubbleContentTextClass', () => {
  it('matches text-primary-foreground on the self side (rich content on a brand bubble)', () => {
    expect(bubbleContentTextClass('self')).toContain('text-primary-foreground')
  })

  it('matches the standard body tone on the peer side', () => {
    expect(bubbleContentTextClass('peer')).toContain('text-foreground/90')
  })

  it('uses the standard body tone for notes regardless of side', () => {
    expect(bubbleContentTextClass('self', { note: true })).toContain('text-foreground/90')
    expect(bubbleContentTextClass('self', { note: true })).not.toContain('text-primary-foreground')
  })
})
