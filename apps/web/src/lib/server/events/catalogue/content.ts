/**
 * Content / taxonomy plane event declarations (WO-6b). New catalogue-only events
 * for previously-silent content entities, emitted directly via emit() from their
 * services. Kept audit-only (not webhook/workflow surfaced): exposing them to
 * customer webhooks is a separate product decision that also needs
 * WEBHOOK_EVENT_CONFIG picker entries (guarded by the WO-9 anti-drift gate).
 */
import { decl } from './helpers'

const B = 'feedback'
const K = 'help_center'

export const boardCreated = decl('board.created', 'board', { audit: true }, B)
export const boardUpdated = decl('board.updated', 'board', { audit: true }, B)
export const boardDeleted = decl('board.deleted', 'board', { audit: true }, B)

export const tagCreated = decl('tag.created', 'post_tag', { audit: true }, B)
export const tagDeleted = decl('tag.deleted', 'post_tag', { audit: true }, B)

export const articlePublished = decl('article.published', 'kb_article', { audit: true }, K)
export const articleUpdated = decl('article.updated', 'kb_article', { audit: true }, K)
export const articleDeleted = decl('article.deleted', 'kb_article', { audit: true }, K)

/**
 * Help center translation events: one language of an article. Webhook events
 * (also audited), so an integration can follow each language the way a
 * person does in the editor.
 */
const translationExposure = { audit: true, webhook: true } as const
export const articleTranslationPublished = decl(
  'article.translation_published',
  'kb_article',
  translationExposure,
  K
)
export const articleTranslationUpdated = decl(
  'article.translation_updated',
  'kb_article',
  translationExposure,
  K
)
export const articleTranslationNeedsUpdate = decl(
  'article.translation_needs_update',
  'kb_article',
  translationExposure,
  K
)
export const articleTranslationUpdateReady = decl(
  'article.translation_update_ready',
  'kb_article',
  translationExposure,
  K
)
