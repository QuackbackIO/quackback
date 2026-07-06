// @vitest-environment happy-dom
/**
 * useInboxTranslation: the activation-banner suggest/dismiss/toggle logic and
 * the per-message translation resolver AgentMessageBubble renders from. The
 * server fns are mocked; conversation-translation.service.test.ts covers the
 * actual translate/detect behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ConversationId } from '@quackback/ids'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'

const hoisted = vi.hoisted(() => ({
  translateConversationMessagesFn: vi.fn(),
  setInboxTranslationEnabledFn: vi.fn(),
  dismissInboxTranslationSuggestionFn: vi.fn(),
  getMyLanguagePreferenceFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  translateConversationMessagesFn: hoisted.translateConversationMessagesFn,
  setInboxTranslationEnabledFn: hoisted.setInboxTranslationEnabledFn,
  dismissInboxTranslationSuggestionFn: hoisted.dismissInboxTranslationSuggestionFn,
}))
vi.mock('@/lib/server/functions/teammate-preferences', () => ({
  getMyLanguagePreferenceFn: hoisted.getMyLanguagePreferenceFn,
}))

import { useInboxTranslation, languageDisplayName } from '../use-inbox-translation'

const conversationId = 'conversation_1' as ConversationId

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function visitorMessage(
  over: Partial<AgentConversationMessageDTO> = {}
): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId,
    ticketId: null,
    senderType: 'visitor',
    content: 'Bonjour',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: null,
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...over,
  }
}

function agentMessage(
  over: Partial<AgentConversationMessageDTO> = {}
): AgentConversationMessageDTO {
  return {
    ...visitorMessage(),
    id: 'conversation_msg_2' as AgentConversationMessageDTO['id'],
    senderType: 'agent',
    content: 'Bonjour, comment puis-je aider?',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getMyLanguagePreferenceFn.mockResolvedValue({ language: 'en' })
  hoisted.translateConversationMessagesFn.mockResolvedValue({})
  hoisted.setInboxTranslationEnabledFn.mockResolvedValue({ ok: true })
  hoisted.dismissInboxTranslationSuggestionFn.mockResolvedValue({ ok: true })
})

describe('languageDisplayName', () => {
  it('resolves a BCP-47 tag to a human language name', () => {
    expect(languageDisplayName('fr')).toBe('French')
  })

  it('falls back to the raw tag for something Intl cannot resolve', () => {
    expect(languageDisplayName('not-a-real-tag-!!')).toBe('not-a-real-tag-!!')
  })
})

describe('useInboxTranslation — suggestion banner', () => {
  it('is hidden when the flag is off, even with a differing detected language', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: false,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged,
        }),
      { wrapper }
    )
    // The teammate-language query is disabled, so there's nothing to await —
    // the banner should already read false synchronously.
    expect(result.current.showSuggestionBanner).toBe(false)
  })

  it('suggests translation when the detected language differs from the teammate preference', async () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.showSuggestionBanner).toBe(true))
    expect(result.current.detectedLanguageLabel).toBe('French')
  })

  it('does not suggest when the teammate already writes in the customer language', async () => {
    hoisted.getMyLanguagePreferenceFn.mockResolvedValue({ language: 'fr-CA' })
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.showSuggestionBanner).toBe(false))
  })

  it('does not suggest once translation is already enabled', () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    expect(result.current.showSuggestionBanner).toBe(false)
  })

  it('does not suggest once dismissed', () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: true,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    expect(result.current.showSuggestionBanner).toBe(false)
  })

  it('does not suggest when detection was inconclusive ("und")', async () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'und',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    // Give the teammate-language query a chance to settle — the banner should
    // still read false, not just "not yet true".
    await waitFor(() => expect(result.current.detectedLanguageLabel).toBe(''))
    expect(result.current.showSuggestionBanner).toBe(false)
  })
})

describe('useInboxTranslation — activation actions', () => {
  it('dismissSuggestion calls the dismiss fn and onChanged', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged,
        }),
      { wrapper }
    )
    act(() => result.current.dismissSuggestion())
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(hoisted.dismissInboxTranslationSuggestionFn).toHaveBeenCalledWith({
      data: { conversationId },
    })
  })

  it('activateFromSuggestion turns the toggle on', async () => {
    const onChanged = vi.fn()
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged,
        }),
      { wrapper }
    )
    act(() => result.current.activateFromSuggestion())
    await waitFor(() =>
      expect(hoisted.setInboxTranslationEnabledFn).toHaveBeenCalledWith({
        data: { conversationId, enabled: true },
      })
    )
  })

  it('toggleEnabled flips the current state', async () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    act(() => result.current.toggleEnabled())
    await waitFor(() =>
      expect(hoisted.setInboxTranslationEnabledFn).toHaveBeenCalledWith({
        data: { conversationId, enabled: false },
      })
    )
  })
})

describe('useInboxTranslation — translationFor (per-message display)', () => {
  it('returns undefined when translation is not enabled for the conversation', () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: false,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [visitorMessage()],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    expect(result.current.translationFor(visitorMessage())).toBeUndefined()
  })

  it('returns undefined for an internal note or a rich (contentJson) message', () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    expect(result.current.translationFor(visitorMessage({ isInternal: true }))).toBeUndefined()
    expect(
      result.current.translationFor(visitorMessage({ contentJson: { type: 'doc' } as never }))
    ).toBeUndefined()
  })

  it('resolves an incoming visitor message once the fetched translation lands', async () => {
    const message = visitorMessage()
    hoisted.translateConversationMessagesFn.mockResolvedValue({
      [message.id]: { content: 'Hello', sourceLocale: 'fr' },
    })
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [message],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.translationFor(message)).toBeDefined())
    const display = result.current.translationFor(message)!
    expect(display.label).toBe('Translated from French')
    expect(display.translatedContent).toBe('Hello')
    expect(display.originalContent).toBe(message.content)
    expect(display.showingOriginal).toBe(false)
  })

  it('toggling a message flips showingOriginal for just that message', async () => {
    const message = visitorMessage()
    hoisted.translateConversationMessagesFn.mockResolvedValue({
      [message.id]: { content: 'Hello', sourceLocale: 'fr' },
    })
    const { result, rerender } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [message],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.translationFor(message)).toBeDefined())

    act(() => result.current.translationFor(message)!.onToggleOriginal())
    rerender()

    expect(result.current.translationFor(message)!.showingOriginal).toBe(true)
  })

  it('resolves an outgoing translated reply from translatedFrom without a fetch', () => {
    const message = agentMessage({
      translatedFrom: { originalContent: 'Hi there', sourceLocale: 'en', targetLocale: 'fr' },
    })
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [message],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )

    const display = result.current.translationFor(message)!
    expect(display.label).toBe('Translated to French')
    expect(display.translatedContent).toBe(message.content)
    expect(display.originalContent).toBe('Hi there')
    expect(hoisted.translateConversationMessagesFn).not.toHaveBeenCalled()
  })

  it('returns undefined for an untranslated outgoing reply', () => {
    const { result } = renderHook(
      () =>
        useInboxTranslation({
          enabledFlag: true,
          conversationId,
          translationState: {
            enabled: true,
            detectedCustomerLanguage: 'fr',
            suggestionDismissed: false,
          },
          messages: [],
          onChanged: vi.fn(),
        }),
      { wrapper }
    )
    expect(result.current.translationFor(agentMessage())).toBeUndefined()
  })
})
