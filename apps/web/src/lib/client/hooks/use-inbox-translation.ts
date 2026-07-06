/**
 * Client-side glue for P2-D.1 two-way inbox translation, extracted out of
 * AgentConversationThread the same way typing/attachments/Copilot-insert
 * already are: activation state (banner suggest/dismiss/toggle) plus the
 * lazy, per-visible-message translation fetch for incoming customer
 * messages. Outgoing translated replies need no fetch — the teammate's
 * original already rides along on `message.translatedFrom` from the thread
 * load.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import {
  translateConversationMessagesFn,
  setInboxTranslationEnabledFn,
  dismissInboxTranslationSuggestionFn,
} from '@/lib/server/functions/conversation'
import { getMyLanguagePreferenceFn } from '@/lib/server/functions/teammate-preferences'
import type {
  AgentConversationMessageDTO,
  ConversationTranslationStateDTO,
} from '@/lib/shared/conversation/types'
import {
  UNDETERMINED_LANGUAGE,
  type MessageTranslationDisplay,
} from '@/lib/shared/conversation/translation'

/** Human language name from a BCP-47 tag, e.g. "fr" -> "French". Falls back
 *  to the raw tag when Intl can't resolve it (unrecognized/malformed tag). */
export function languageDisplayName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** Primary BCP-47 subtag, lowercased — mirrors the server's comparison so the
 *  banner's "differs from your language" check can never disagree with the
 *  server's own same-language skip. */
function primarySubtag(tag: string | null | undefined): string | null {
  if (!tag) return null
  const primary = tag.trim().split('-')[0]
  return primary ? primary.toLowerCase() : null
}

export interface UseInboxTranslationOptions {
  enabledFlag: boolean
  conversationId: ConversationId
  translationState: ConversationTranslationStateDTO | null | undefined
  messages: AgentConversationMessageDTO[]
  /** Called after a toggle/dismiss mutation succeeds, so the caller can
   *  refresh the thread + inbox the same way other triage controls do. */
  onChanged: () => void
}

export interface UseInboxTranslationResult {
  /** Whether the dismissible "This customer writes in X" banner should render. */
  showSuggestionBanner: boolean
  detectedLanguageLabel: string
  dismissSuggestion: () => void
  activateFromSuggestion: () => void
  /** Manual toggle (header / detail panel). */
  enabled: boolean
  toggleEnabled: () => void
  togglePending: boolean
  /** Resolve the translation display for one message, or undefined when
   *  translation doesn't apply (inactive, a note, a rich message, or —
   *  for an incoming message — not translated yet). */
  translationFor: (message: AgentConversationMessageDTO) => MessageTranslationDisplay | undefined
}

export function useInboxTranslation({
  enabledFlag,
  conversationId,
  translationState,
  messages,
  onChanged,
}: UseInboxTranslationOptions): UseInboxTranslationResult {
  // Per-message "Show original" toggle state; keyed by message id, shared
  // across both directions (an incoming translation vs an outgoing one).
  const [showOriginalIds, setShowOriginalIds] = useState<ReadonlySet<string>>(() => new Set())

  const { data: myLanguage } = useQuery({
    queryKey: ['teammate', 'language-preference'],
    queryFn: () => getMyLanguagePreferenceFn().then((r) => r.language),
    enabled: enabledFlag,
    staleTime: 5 * 60_000,
  })

  // Only plain-text, non-internal visitor messages are ever translated (see
  // the message-bubble guard) — no point asking the server to translate the
  // rest.
  const visitorMessageIds = useMemo(
    () =>
      messages
        .filter((m) => m.senderType === 'visitor' && !m.isInternal && !m.contentJson && !!m.content)
        .map((m) => m.id),
    [messages]
  )

  const translationsQuery = useQuery({
    queryKey: ['conversation', conversationId, 'inbox-translations', visitorMessageIds],
    queryFn: () =>
      translateConversationMessagesFn({ data: { conversationId, messageIds: visitorMessageIds } }),
    enabled: enabledFlag && !!translationState?.enabled && visitorMessageIds.length > 0,
    staleTime: 60_000,
  })

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      setInboxTranslationEnabledFn({ data: { conversationId, enabled: next } }),
    onSuccess: onChanged,
    onError: () => toast.error('Failed to update translation'),
  })

  const dismissMutation = useMutation({
    mutationFn: () => dismissInboxTranslationSuggestionFn({ data: { conversationId } }),
    onSuccess: onChanged,
    onError: () => toast.error('Failed to dismiss suggestion'),
  })

  const detected = translationState?.detectedCustomerLanguage ?? null
  // UNDETERMINED_LANGUAGE ('und') means detection ran but couldn't identify a
  // language — that's not a real language to suggest translating from or to
  // display a name for.
  const hasRealDetectedLanguage = !!detected && detected !== UNDETERMINED_LANGUAGE
  const detectedForDisplay = hasRealDetectedLanguage ? detected : null
  const showSuggestionBanner =
    enabledFlag &&
    !!translationState &&
    !translationState.enabled &&
    !translationState.suggestionDismissed &&
    hasRealDetectedLanguage &&
    // Wait for the teammate's own preference to actually load — showing the
    // banner while it's still `undefined` would flash on and then off again
    // for a teammate who turns out to share the customer's language.
    myLanguage !== undefined &&
    primarySubtag(detected) !== primarySubtag(myLanguage)

  const toggleOriginal = useCallback((messageId: string) => {
    setShowOriginalIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const translationFor = useCallback(
    (message: AgentConversationMessageDTO): MessageTranslationDisplay | undefined => {
      if (!enabledFlag || !translationState?.enabled) return undefined
      if (message.isInternal || message.contentJson) return undefined
      const showingOriginal = showOriginalIds.has(message.id)
      const onToggleOriginal = () => toggleOriginal(message.id)

      if (message.senderType === 'visitor') {
        const fetched = translationsQuery.data?.[message.id]
        if (!fetched) return undefined
        return {
          label: `Translated from ${languageDisplayName(fetched.sourceLocale ?? detectedForDisplay ?? '')}`,
          translatedContent: fetched.content,
          originalContent: message.content,
          showingOriginal,
          onToggleOriginal,
        }
      }
      if (message.senderType === 'agent' && message.translatedFrom) {
        return {
          label: `Translated to ${languageDisplayName(message.translatedFrom.targetLocale)}`,
          translatedContent: message.content,
          originalContent: message.translatedFrom.originalContent,
          showingOriginal,
          onToggleOriginal,
        }
      }
      return undefined
    },
    [
      enabledFlag,
      translationState?.enabled,
      showOriginalIds,
      translationsQuery.data,
      detectedForDisplay,
      toggleOriginal,
    ]
  )

  return {
    showSuggestionBanner,
    detectedLanguageLabel: detectedForDisplay ? languageDisplayName(detectedForDisplay) : '',
    dismissSuggestion: () => dismissMutation.mutate(),
    activateFromSuggestion: () => toggleMutation.mutate(true),
    enabled: translationState?.enabled ?? false,
    toggleEnabled: () => toggleMutation.mutate(!(translationState?.enabled ?? false)),
    togglePending: toggleMutation.isPending || dismissMutation.isPending,
    translationFor,
  }
}
