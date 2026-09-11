import { describe, it, expect } from 'vitest'
import { liftInlineImagesToAttachments } from '../lift-inline-images'
import { MAX_CONVERSATION_ATTACHMENTS } from '../types'
import type { ConversationAttachment } from '../types'

const png = (url: string, extra?: Partial<ConversationAttachment>): ConversationAttachment => ({
  url,
  name: extra?.name ?? 'shot.png',
  contentType: extra?.contentType ?? 'image/png',
  size: extra?.size ?? 10,
})

describe('liftInlineImagesToAttachments', () => {
  it('returns the same references when the doc has no images', () => {
    const attachments: ConversationAttachment[] = []
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    const result = liftInlineImagesToAttachments(doc, attachments)
    expect(result.contentJson).toBe(doc)
    expect(result.attachments).toBe(attachments)
  })

  it('lifts a square 500×500 resizableImage onto attachments and strips the node', () => {
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [
          {
            type: 'resizableImage',
            attrs: {
              src: 'https://cdn.example.com/shot.png',
              alt: 'Install page',
              width: 500,
              height: 500,
            },
          },
        ],
      },
      []
    )
    expect(result.attachments).toEqual([
      {
        url: 'https://cdn.example.com/shot.png',
        name: 'Install page',
        contentType: 'image/png',
        size: 0,
      },
    ])
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })

  it('lifts chatImage and image nodes, keeps surrounding text, and dedupes by URL', () => {
    const existing = [png('https://cdn.example.com/a.png')]
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
          { type: 'chatImage', attrs: { src: 'https://cdn.example.com/a.png', alt: 'dup' } },
          { type: 'image', attrs: { src: 'https://cdn.example.com/b.jpg' } },
        ],
      },
      existing
    )
    expect(result.attachments).toEqual([
      existing[0],
      {
        url: 'https://cdn.example.com/b.jpg',
        name: 'b.jpg',
        contentType: 'image/jpeg',
        size: 0,
      },
    ])
    expect(result.contentJson).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    })
  })

  it('strips a javascript: image without attaching it', () => {
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
      },
      []
    )
    expect(result.attachments).toEqual([])
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })

  it('does not exceed MAX_CONVERSATION_ATTACHMENTS', () => {
    const existing = Array.from({ length: MAX_CONVERSATION_ATTACHMENTS }, (_, i) =>
      png(`https://cdn.example.com/${i}.png`)
    )
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/overflow.png' } }],
      },
      existing
    )
    expect(result.attachments).toBe(existing)
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })
})
