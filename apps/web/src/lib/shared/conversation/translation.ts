/**
 * P2-D.1 two-way inbox translation: the client-detectable shape of a blocked
 * outgoing send. Mirrors attribute-values.ts's
 * MISSING_REQUIRED_ATTRIBUTES_PREFIX / isMissingRequiredAttributesMessage
 * pattern — the server's TranslationUnavailableError message and this
 * predicate share one constant so they can never drift, letting the composer
 * distinguish "translation failed, offer Send untranslated" from any other
 * send error without a dedicated error-code channel.
 */

/** The server-side TranslationUnavailableError's message (verbatim). */
export const TRANSLATION_UNAVAILABLE_MESSAGE = 'Translation is unavailable right now.'

/** True when a send failed specifically because translation could not
 *  complete — the composer should offer "Send untranslated" rather than a
 *  generic failure toast. */
export function isTranslationUnavailableMessage(message: string | null | undefined): boolean {
  return !!message?.includes(TRANSLATION_UNAVAILABLE_MESSAGE)
}

/** The server-side TranslationRichContentError's message (verbatim). A
 *  translated send replaces `contentJson` with a plain-text translation (see
 *  resolveOutgoingReplyTranslation) — fine for formatting (bold/lists), which
 *  still has a full plain-text mirror, but an inline image or embed has none
 *  and would be silently destroyed. The send is BLOCKED before that happens. */
export const TRANSLATION_RICH_CONTENT_MESSAGE = 'Translation cannot carry images or embeds.'

/** True when a send failed specifically because the outgoing message carried
 *  an image/embed that a translated send cannot preserve — the composer
 *  should offer the same "Send untranslated" choice as
 *  isTranslationUnavailableMessage, with copy naming the actual cause. */
export function isTranslationRichContentMessage(message: string | null | undefined): boolean {
  return !!message?.includes(TRANSLATION_RICH_CONTENT_MESSAGE)
}

/** BCP-47 "undetermined" sentinel persisted on `detected_customer_language`
 *  when customer-language detection completed but could not identify a
 *  language (the model's own prompt contract: `{"language": null}`). Distinct
 *  from `null` (detection hasn't run / had nothing to detect from yet) so
 *  `maybeDetectCustomerLanguage`'s once-per-conversation guard never re-runs
 *  a detection that already gave a conclusive "no signal" answer, while a
 *  thrown/transient failure (network, unparseable response) leaves the
 *  column `null` and free to retry on the next thread open. */
export const UNDETERMINED_LANGUAGE = 'und'

/**
 * Per-message translation display, shared between the client hook that
 * resolves it (use-inbox-translation.ts) and the bubble that renders it
 * (message-bubble.tsx) — lives here rather than on the component so `lib/`
 * never has to import from `components/`.
 */
export interface MessageTranslationDisplay {
  /** Direction-aware toggle label, e.g. "Translated from French" (incoming)
   *  or "Translated to French" (outgoing) — built by the caller, which knows
   *  the direction; the bubble only appends the "Show original"/"Show
   *  translation" action. */
  label: string
  translatedContent: string
  originalContent: string
  showingOriginal: boolean
  onToggleOriginal: () => void
}
