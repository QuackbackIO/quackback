// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import {
  ConversationGalleryProvider,
  useConversationGallery,
  type GalleryMessage,
} from '../conversation-gallery'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

function att(name: string): ConversationAttachment {
  return { url: `/f/${name}`, name, contentType: 'application/pdf', size: 10, family: 'pdf' }
}

function msg(overrides: Partial<GalleryMessage>): GalleryMessage {
  return {
    id: 'm1',
    isInternal: false,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    senderType: 'visitor',
    isAssistant: false,
    author: null,
    ...overrides,
  }
}

describe('ConversationGalleryProvider', () => {
  it('flattens every message attachment in message order', () => {
    const messages: GalleryMessage[] = [
      msg({ id: 'm1', attachments: [att('a.pdf'), att('b.pdf')] }),
      msg({ id: 'm2', attachments: [] }),
      msg({ id: 'm3', attachments: [att('c.pdf')] }),
    ]
    const { result } = renderHook(() => useConversationGallery(), {
      wrapper: ({ children }) => (
        <IntlProvider locale="en-US" messages={{}}>
          <ConversationGalleryProvider messages={messages}>{children}</ConversationGalleryProvider>
        </IntlProvider>
      ),
    })
    expect(result.current.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
  })

  it('resolves a message/local-index pair to its position in the flat gallery', () => {
    const messages: GalleryMessage[] = [
      msg({ id: 'm1', attachments: [att('a.pdf'), att('b.pdf')] }),
      msg({ id: 'm3', attachments: [att('c.pdf')] }),
    ]
    const { result } = renderHook(() => useConversationGallery(), {
      wrapper: ({ children }) => (
        <IntlProvider locale="en-US" messages={{}}>
          <ConversationGalleryProvider messages={messages}>{children}</ConversationGalleryProvider>
        </IntlProvider>
      ),
    })
    expect(result.current.indexOf('m1', 0)).toBe(0)
    expect(result.current.indexOf('m1', 1)).toBe(1)
    expect(result.current.indexOf('m3', 0)).toBe(2)
    expect(result.current.indexOf('does-not-exist', 0)).toBe(-1)
  })

  it('excludes internal notes by default (the visitor views)', () => {
    const messages: GalleryMessage[] = [
      msg({ id: 'm1', isInternal: true, attachments: [att('secret.pdf')] }),
      msg({ id: 'm2', attachments: [att('public.pdf')] }),
    ]
    const { result } = renderHook(() => useConversationGallery(), {
      wrapper: ({ children }) => (
        <IntlProvider locale="en-US" messages={{}}>
          <ConversationGalleryProvider messages={messages}>{children}</ConversationGalleryProvider>
        </IntlProvider>
      ),
    })
    expect(result.current.files.map((f) => f.name)).toEqual(['public.pdf'])
    expect(result.current.indexOf('m1', 0)).toBe(-1)
  })

  it('includes internal notes when includeInternal is set (the agent view)', () => {
    const messages: GalleryMessage[] = [
      msg({ id: 'm1', isInternal: true, attachments: [att('secret.pdf')] }),
      msg({ id: 'm2', attachments: [att('public.pdf')] }),
    ]
    const { result } = renderHook(() => useConversationGallery(), {
      wrapper: ({ children }) => (
        <IntlProvider locale="en-US" messages={{}}>
          <ConversationGalleryProvider messages={messages} includeInternal>
            {children}
          </ConversationGalleryProvider>
        </IntlProvider>
      ),
    })
    expect(result.current.files.map((f) => f.name)).toEqual(['secret.pdf', 'public.pdf'])
  })

  it('without a provider, is an empty no-op gallery', () => {
    const { result } = renderHook(() => useConversationGallery())
    expect(result.current.files).toEqual([])
    expect(result.current.indexOf('m1', 0)).toBe(-1)
  })

  it('falls back to a localized sender label when the author has no display name', () => {
    const messages: GalleryMessage[] = [
      msg({ id: 'm1', senderType: 'agent', attachments: [att('a.pdf')] }),
    ]
    const { result } = renderHook(() => useConversationGallery(), {
      wrapper: ({ children }) => (
        <IntlProvider locale="de" messages={{ 'files.sender.agent': 'Mitarbeiter' }}>
          <ConversationGalleryProvider messages={messages}>{children}</ConversationGalleryProvider>
        </IntlProvider>
      ),
    })
    expect(result.current.files[0]!.senderName).toBe('Mitarbeiter')
  })
})
