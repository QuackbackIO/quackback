/**
 * Two-way inbox translation (P2-D.1).
 *
 * INCOMING (customer -> agent) is display-layer only: translating a customer
 * message NEVER mutates `conversation_messages.content`/`content_json`.
 * Translations are cached per (message, locale) in
 * `conversation_message_translations` -- keyed by locale (not just "the"
 * translation) because different teammates viewing the same message may have
 * different preferred languages. This mirrors the help-center auto-translate
 * precedent's (parentId, locale) -> content cache shape.
 *
 * OUTGOING (agent -> customer): when translation is active for the
 * conversation, a teammate's reply is translated into the customer's
 * language BEFORE it is sent -- the translation becomes the stored/sent
 * `content`, and the teammate's pre-translation original is preserved on
 * that same message's `metadata.translatedFrom` (see
 * packages/db/src/types.ts) rather than the cache table: unlike the incoming
 * direction, there's only ever one "original" per outgoing message, so a
 * per-viewer-language cache row doesn't apply. A translated send always
 * replaces `contentJson` with plain translated text, which cannot represent
 * an inline image or embed -- a reply carrying one is BLOCKED with
 * `TranslationRichContentError` before the model is ever called, rather than
 * silently dropping it.
 *
 * Both directions go through the same AI call shape as
 * help-center-auto-translate.service.ts: a TanStack AI `chat()` call with a
 * zod `outputSchema` and a usage-logging middleware, under the single
 * 'inbox_translation' pipeline step (metadata.stage distinguishes
 * detect/incoming/outgoing). Both prompt builders wrap the untrusted
 * (customer- or teammate-authored) text they embed with injection-guard.ts's
 * `wrapUntrustedText`.
 *
 * Customer-language detection is lazy, cached, and off the request path:
 * `maybeDetectCustomerLanguage` is fired fire-and-forget from
 * `getConversationFn` (it never blocks opening a thread) and runs at most
 * once per conversation, from the visitor's own recent messages. A conclusive
 * "no language identified" result persists the `'und'` (BCP-47 undetermined)
 * sentinel on `conversations.detected_customer_language` so it never
 * re-attempts on a later open; a thrown/transient failure (network,
 * unparseable response) leaves the column `null` and free to retry.
 */
import {
  db,
  eq,
  and,
  desc,
  isNull,
  sql,
  conversations,
  conversationMessages,
  conversationMessageTranslations,
  user,
  type Conversation,
  type ConversationMessage,
  type TranslatedFromMetadata,
} from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, UserId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { canActAsAgent } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import { richMessageFallbackLabel } from '@/lib/server/messages/message-core'
import { wrapUntrustedText } from '@/lib/server/domains/assistant/injection-guard'
import {
  TRANSLATION_UNAVAILABLE_MESSAGE,
  TRANSLATION_RICH_CONTENT_MESSAGE,
  UNDETERMINED_LANGUAGE,
} from '@/lib/shared/conversation/translation'
// translationStateFrom lives in conversation.query.ts (not here) so THIS module
// can import conversationToDTO from that same module without a circular
// import; re-exported here so callers have one place to import the P2-D.1
// translation API surface from.
import { conversationToDTO, translationStateFrom } from './conversation.query'
import { publishConversationUpdate } from '@/lib/server/realtime/conversation-channels'
import { logger } from '@/lib/server/logger'

export { translationStateFrom }

const log = logger.child({ component: 'conversation-translation' })

const PIPELINE_STEP = 'inbox_translation'
const RECENT_VISITOR_MESSAGES_FOR_DETECTION = 5
const DETECTION_TEXT_CHAR_LIMIT = 2000

const LanguageDetectionSchema = z.object({ language: z.string().nullable().optional() })
const InboxTranslationSchema = z.object({ content: z.string() })

/** Thrown when a translation call could not complete (AI unconfigured,
 *  network failure, or an unparseable/empty response). The outgoing send
 *  path uses this to BLOCK the send rather than silently deliver
 *  untranslated text the teammate never saw and didn't ask for. */
export class TranslationUnavailableError extends ValidationError {
  constructor(message = TRANSLATION_UNAVAILABLE_MESSAGE) {
    super('TRANSLATION_FAILED', message)
  }
}

/** Thrown BEFORE the model is ever called when a translated send would carry
 *  an inline image or embed: a translated send replaces `contentJson` with
 *  the plain-text translation (see resolveOutgoingReplyTranslation), which
 *  has no way to represent a non-text node, so sending would silently
 *  destroy it. Sibling of TranslationUnavailableError — same BLOCK-the-send
 *  contract, offering "Send untranslated" (or "remove the image and retry")
 *  instead of a silent content drop. */
export class TranslationRichContentError extends ValidationError {
  constructor(message = TRANSLATION_RICH_CONTENT_MESSAGE) {
    super('TRANSLATION_RICH_CONTENT', message)
  }
}

/** The bare BCP-47 primary subtag, lowercased (e.g. "pt-BR" -> "pt"), so
 *  "same language" comparisons treat region/script variants as equal. */
export function primaryLanguageSubtag(tag: string | null | undefined): string | null {
  if (!tag) return null
  const primary = tag.trim().split('-')[0]
  return primary ? primary.toLowerCase() : null
}

/** Whether two language tags share a primary subtag. Two unset/unknown tags
 *  are never "the same" — there's nothing to compare. */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = primaryLanguageSubtag(a)
  const pb = primaryLanguageSubtag(b)
  return pa !== null && pa === pb
}

export function buildLanguageDetectionPrompt(text: string): { system: string; user: string } {
  const system = `You identify the primary language of customer support messages.
Respond with strict JSON only: {"language": "<BCP-47 tag or null>"}.
Use a short tag (e.g. "en", "fr", "pt"). If you genuinely cannot tell, respond {"language": null}.
Example output:
{"language": "fr"}`
  // The customer's own message is untrusted input, not instructions — wrap it
  // the same way copilot-transform.ts quotes a teammate's text (injection-guard.ts).
  const user = wrapUntrustedText('Customer message', text.slice(0, DETECTION_TEXT_CHAR_LIMIT))
  return { system, user }
}

export function buildInboxTranslationPrompt(input: { text: string; targetLocale: string }): {
  system: string
  user: string
} {
  const system = `You are a professional translator for live customer-support conversations.
Translate the given text into the locale "${input.targetLocale}". Preserve tone and meaning;
do not add commentary, greetings, or explanations that are not present in the source text.
Return strict JSON only: {"content": "string"}
Example output:
{"content": "Merci de nous avoir signalé ce problème. Nous avons remboursé le double prélèvement."}`
  // Both directions feed genuinely untrusted text through this one builder
  // (a customer's message on the incoming path, a teammate's own text on the
  // outgoing one) — wrap it the same way copilot-transform.ts quotes text to
  // transform (injection-guard.ts), so neither can smuggle prompt instructions.
  const user = wrapUntrustedText('Text to translate', input.text)
  return { system, user }
}

/** Raw chat call shared by detection + both translate directions, so all
 *  three go through the identical AI-config/usage-logging path (matching the
 *  help-center-auto-translate precedent). Returns null when AI isn't
 *  configured for this feature — callers decide whether that's a silent skip
 *  (detection) or a blocking failure (translation). THROWS when the call
 *  itself fails or the response doesn't match `outputSchema` (a network
 *  failure or a malformed model response) — callers decide whether that's
 *  swallowed by an outer try/catch (detection) or converted into a typed,
 *  caller-facing error (translation). */
async function callInboxTranslationModel<T>(
  stage: 'detect' | 'incoming' | 'outgoing',
  system: string,
  user: string,
  metadata: Record<string, unknown>,
  outputSchema: z.ZodType<T>
): Promise<T | null> {
  const model = getChatModel('inboxTranslation')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return null

  // chat() can't infer the structured-output type through the generic
  // `z.ZodType<T>` (it resolves to `unknown`), so assert the validated result
  // back to T — the schema the caller passed IS the T contract.
  const result = await chat({
    adapter: openaiCompatibleText(model, {
      baseURL: config.openaiBaseUrl!,
      apiKey: config.openaiApiKey!,
    }),
    systemPrompts: [system],
    messages: [{ role: 'user', content: user }],
    outputSchema,
    stream: false,
    modelOptions: { ...structuredOutputProviderOptions() },
    middleware: [
      createUsageLoggingMiddleware({
        pipelineStep: PIPELINE_STEP,
        model,
        metadata: { stage, ...metadata },
      }),
    ],
  })
  return result as T
}

/**
 * Best-effort customer-language detection from the visitor's own recent
 * messages, persisted once on the conversation row. Never throws: AI
 * misconfiguration, an empty thread, or an unparseable response all just
 * skip detection silently (mirrors queueAutoTranslateOnPublish's
 * error-swallow style) — this only powers a "nice to have" activation-
 * suggestion banner, never a blocking path. Callers must invoke this
 * fire-and-forget (see `getConversationFn`) — it is never on the critical
 * path of opening a thread.
 *
 * A completed call that could not identify a language (the model's own
 * prompt contract: `{"language": null}`) is a CONCLUSIVE "no signal" result,
 * not a transient failure — it persists the `UNDETERMINED_LANGUAGE` ('und')
 * sentinel so this never re-attempts the same unanswerable text on a later
 * thread open. A thrown error (network, unparseable response) or "nothing to
 * detect from yet" leaves the column `null`, so a genuinely transient failure
 * (or a conversation that later gets its first visitor message) still gets a
 * real retry.
 */
export async function maybeDetectCustomerLanguage(
  conversation: Conversation
): Promise<Conversation> {
  if (conversation.detectedCustomerLanguage) return conversation
  try {
    const rows = await db
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.senderType, 'visitor'),
          eq(conversationMessages.isInternal, false),
          isNull(conversationMessages.deletedAt)
        )
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(RECENT_VISITOR_MESSAGES_FOR_DETECTION)

    const text = rows
      .map((r) => r.content)
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!text) return conversation

    const { system, user: userMessage } = buildLanguageDetectionPrompt(text)
    const result = await callInboxTranslationModel(
      'detect',
      system,
      userMessage,
      { conversationId: conversation.id },
      LanguageDetectionSchema
    )
    if (!result) return conversation

    // A conclusive "I don't know" is persisted as UNDETERMINED_LANGUAGE, not
    // left null, so the guard above short-circuits forever after — see the
    // doc comment.
    const language = primaryLanguageSubtag(result.language) ?? UNDETERMINED_LANGUAGE

    const [updated] = await db
      .update(conversations)
      .set({ detectedCustomerLanguage: language })
      .where(eq(conversations.id, conversation.id))
      .returning()
    return updated ?? conversation
  } catch (err) {
    log.error({ err, conversation_id: conversation.id }, 'customer language detection failed')
    return conversation
  }
}

async function getCachedIncomingTranslation(messageId: ConversationMessageId, locale: string) {
  const [row] = await db
    .select()
    .from(conversationMessageTranslations)
    .where(
      and(
        eq(conversationMessageTranslations.conversationMessageId, messageId),
        eq(conversationMessageTranslations.locale, locale)
      )
    )
    .limit(1)
  return row ?? null
}

export interface MessageTranslationResult {
  content: string
  /** True when this came from the cache table (no AI call this time). */
  cached: boolean
}

/**
 * Translate ONE customer message for display, cache-hit or fresh. Never
 * mutates `conversation_messages` — the translation lives only in
 * `conversation_message_translations`, keyed by (messageId, locale).
 */
export async function translateIncomingMessage(
  message: Pick<ConversationMessage, 'id' | 'content'>,
  targetLocale: string
): Promise<MessageTranslationResult> {
  const locale = primaryLanguageSubtag(targetLocale) ?? targetLocale

  const cached = await getCachedIncomingTranslation(message.id, locale)
  if (cached) return { content: cached.content, cached: true }

  const { system, user: userMessage } = buildInboxTranslationPrompt({
    text: message.content,
    targetLocale: locale,
  })

  let result: { content: string } | null
  try {
    result = await callInboxTranslationModel(
      'incoming',
      system,
      userMessage,
      { conversationMessageId: message.id, targetLocale: locale },
      InboxTranslationSchema
    )
  } catch (err) {
    // With outputSchema, chat() throws on a malformed/non-conforming
    // response (as well as on a network/provider failure) where the old
    // hand-parse code had a separate JSON.parse catch branch — both collapse
    // to the same BLOCK-the-send outcome here.
    log.error({ err, message_id: message.id }, 'inbox translation: unparseable AI response')
    throw new TranslationUnavailableError()
  }
  if (!result) throw new TranslationUnavailableError()
  if (!result.content) throw new TranslationUnavailableError()

  await db
    .insert(conversationMessageTranslations)
    .values({ conversationMessageId: message.id, locale, content: result.content })
    .onConflictDoUpdate({
      target: [
        conversationMessageTranslations.conversationMessageId,
        conversationMessageTranslations.locale,
      ],
      set: { content: result.content, updatedAt: new Date() },
    })

  return { content: result.content, cached: false }
}

/**
 * Translate a teammate's outgoing reply into the customer's language before
 * it is sent. Throws `TranslationUnavailableError` on any failure — the
 * caller (sendAgentMessageFn) BLOCKS the send rather than deliver
 * untranslated text the teammate expected to be translated.
 */
export async function translateOutgoingContent(
  text: string,
  targetLocale: string
): Promise<string> {
  const locale = primaryLanguageSubtag(targetLocale) ?? targetLocale
  const { system, user: userMessage } = buildInboxTranslationPrompt({ text, targetLocale: locale })

  let result: { content: string } | null
  try {
    result = await callInboxTranslationModel(
      'outgoing',
      system,
      userMessage,
      { targetLocale: locale },
      InboxTranslationSchema
    )
  } catch (err) {
    log.error({ err }, 'inbox translation: unparseable AI response (outgoing)')
    throw new TranslationUnavailableError()
  }
  if (!result) throw new TranslationUnavailableError()
  if (!result.content) throw new TranslationUnavailableError()
  return result.content
}

export interface ResolveOutgoingReplyInput {
  conversationId: ConversationId
  content: string
  contentJson: TiptapContent | null
  /** The sending teammate — used to resolve their own language preference
   *  (P2-0.3) as the "source" locale recorded on `translatedFrom`. */
  teammateUserId: UserId
}

export interface ResolveOutgoingReplyResult {
  content: string
  contentJson: TiptapContent | null
  /** Set only when this reply was actually translated — the caller
   *  (sendAgentMessageFn) attaches this to the new message's metadata. */
  translatedFrom?: TranslatedFromMetadata
}

/**
 * Decide whether an outgoing agent reply should be translated before it is
 * sent, and if so, translate it. Called from sendAgentMessageFn BEFORE the
 * message is persisted — translation happens synchronously on the send path
 * so the stored/broadcast/emailed content is always what the customer should
 * see (never an untranslated draft the teammate expected to be translated).
 *
 * Passes the content through untouched (no AI call) when: translation isn't
 * active for the conversation, the customer's language hasn't been detected
 * yet, there's no text to translate, or the teammate is already writing in
 * the customer's language. Otherwise translates and throws
 * `TranslationUnavailableError` on failure — the caller must treat that as a
 * BLOCKING error, not fall back to sending untranslated silently.
 *
 * Also BLOCKS (throws `TranslationRichContentError`, before the model is ever
 * called) when the reply's `contentJson` carries an inline image or embed: a
 * translated send always replaces `contentJson` with plain translated text
 * (see below), which has no way to represent a non-text node — sending would
 * silently destroy it. Formatting alone (bold/lists/headings) does not block:
 * its plain-text mirror still carries every word, just unstyled.
 */
export async function resolveOutgoingReplyTranslation(
  input: ResolveOutgoingReplyInput
): Promise<ResolveOutgoingReplyResult> {
  const passthrough = (): ResolveOutgoingReplyResult => ({
    content: input.content,
    contentJson: input.contentJson,
  })

  if (!input.content.trim()) return passthrough()

  const context = await getInboxTranslationContext(input.conversationId)
  if (!context?.enabled || !context.customerLocale) return passthrough()

  const [teammateRow] = await db
    .select({ preferredLanguage: user.preferredLanguage })
    .from(user)
    .where(eq(user.id, input.teammateUserId))
    .limit(1)
  const teammateLocale = primaryLanguageSubtag(teammateRow?.preferredLanguage) ?? 'en'

  if (sameLanguage(teammateLocale, context.customerLocale)) return passthrough()

  // richMessageFallbackLabel recurses the whole doc looking for an image/embed
  // node — the same predicate message-core.ts uses to decide whether a
  // text-less doc still counts as "content" (validateContent). Reused here
  // for the inverse question: does this doc have anything a plain-text
  // translation cannot carry?
  if (richMessageFallbackLabel(input.contentJson)) {
    throw new TranslationRichContentError()
  }

  const translated = await translateOutgoingContent(input.content, context.customerLocale)
  const targetLocale = primaryLanguageSubtag(context.customerLocale) ?? context.customerLocale
  return {
    content: translated,
    // Rich formatting (bold/lists/embeds) is not preserved through a
    // translated send in this slice — the customer-facing content becomes
    // plain translated text. The teammate's original (with its formatting)
    // remains available via "Show original".
    contentJson: null,
    translatedFrom: { originalContent: input.content, sourceLocale: teammateLocale, targetLocale },
  }
}

export interface InboxTranslationContext {
  enabled: boolean
  /** The customer's detected language, or null when nothing has been
   *  detected yet (nothing to translate against) — also null when detection
   *  was conclusively inconclusive (UNDETERMINED_LANGUAGE): there's still
   *  nothing real to translate against. */
  customerLocale: string | null
}

/** Cheap read used by the send path to decide whether an outgoing reply
 *  should be translated, without loading (and re-validating) the full
 *  conversation row the way the service's other mutators do. */
export async function getInboxTranslationContext(
  conversationId: ConversationId
): Promise<InboxTranslationContext | null> {
  const [row] = await db
    .select({
      translationEnabled: conversations.translationEnabled,
      detectedCustomerLanguage: conversations.detectedCustomerLanguage,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) return null
  const customerLocale =
    row.detectedCustomerLanguage === UNDETERMINED_LANGUAGE ? null : row.detectedCustomerLanguage
  return { enabled: row.translationEnabled, customerLocale }
}

async function loadConversationOr404(conversationId: ConversationId): Promise<Conversation> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  return row
}

/** Manual per-conversation activation toggle (ACTIVATION). Turning
 *  translation ON clears any earlier dismissal, so a later manual turn-off
 *  can surface the suggestion banner again if the detected language still
 *  differs from the viewing teammate's. */
export async function setInboxTranslationEnabled(
  conversationId: ConversationId,
  enabled: boolean,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({
      translationEnabled: enabled,
      translationDismissedAt: enabled ? null : existing.translationDismissedAt,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  return updated
}

/** Dismiss the auto-suggest banner ("This customer writes in French...") for
 *  this conversation. Persisted on the row, not per-teammate — a shared
 *  workspace decision, like the toggle itself. */
export async function dismissInboxTranslationSuggestion(
  conversationId: ConversationId,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({ translationDismissedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  return updated
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

/** Mirrors tool-audit.ts's ASSISTANT_TOOL_CALLS_RETENTION_DAYS / usage-log.ts's
 *  AI_USAGE_RETENTION_DAYS cadence: a display translation is a re-derivable
 *  cache (translateIncomingMessage recomputes and re-caches it on the next
 *  view), not an audit trail, but 180 days keeps every 'retention-cleanup'
 *  sweep on the same window so operators reason about one retention policy
 *  across the feature. */
export const CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS = 180

/** Sweep conversation_message_translations rows past retention. Registered
 *  alongside tool-audit.ts's cleanupExpiredToolCalls on the daily maintenance
 *  sweep in startup.ts (the 'logs_retention' sweep lock). Deleting an old
 *  row is loss-free: the next time a teammate views that message translated,
 *  translateIncomingMessage just recomputes and re-caches it. */
export async function cleanupExpiredMessageTranslations(
  exec: Executor = db
): Promise<{ deleted: number }> {
  const result = await exec.execute(
    sql`DELETE FROM conversation_message_translations WHERE created_at < now() - interval '${sql.raw(String(CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS))} days'`
  )
  const deleted = (result as { count: number }).count ?? 0

  if (deleted > 0) {
    log.info(
      { deleted, retention_days: CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS },
      'conversation message translation retention cleanup completed'
    )
  }

  return { deleted }
}
