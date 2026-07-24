/**
 * Serialized, viewer-safe previews for live Quackback link embeds.
 *
 * Produced by the embed resolver (`getEmbedPreviewFn`) and consumed by the
 * shared embed card. Only fields that are safe for any granted viewer to see
 * are projected here — gated data never reaches these shapes, and an embed the
 * viewer can't see degrades to {@link EmbedUnavailable} rather than leaking
 * existence.
 */

import type { ConversationPriority } from '@/lib/shared/conversation/types'

/** A tag chip on a post embed. */
export interface EmbedTag {
  id: string
  name: string
  color: string | null
}

/** A resolved feedback-post embed — a viewer-safe slice for a miniature post card. */
export interface EmbedPostPreview {
  kind: 'post'
  postId: string
  title: string
  /** Short plain-text preview of the body (already truncated server-side). */
  excerpt: string | null
  voteCount: number
  statusName: string | null
  statusColor: string | null
  boardName: string
  boardSlug: string
  tags: EmbedTag[]
  authorName: string | null
  authorAvatarUrl: string | null
  createdAt: string | null
  /** Absolute, viewer-shareable portal URL for the post — built server-side from
   *  the canonical base so an embed can open it in a new tab (e.g. in the widget,
   *  whose iframe origin may differ from the portal's). */
  url: string
}

/** A resolved (published) changelog-entry embed. */
export interface EmbedChangelogPreview {
  kind: 'changelog'
  entryId: string
  title: string
  publishedAt: string | null
  /** Absolute portal URL for the changelog entry — see {@link EmbedPostPreview.url}. */
  url: string
}

/** A resolved (published) help-center article embed. */
export interface EmbedArticlePreview {
  kind: 'article'
  /** Article slug — used as the embed identity and to build the relative navigation path. */
  articleId: string
  /** Category slug — needed for the two-segment help-center URL (`/hc/articles/{cat}/{slug}`). */
  categorySlug: string
  title: string
  /** Short plain-text preview of the article body (already truncated server-side). */
  excerpt: string | null
  /** Absolute portal URL for the article — see {@link EmbedPostPreview.url}. */
  url: string
}

/** A resolved support-ticket embed — a viewer-safe slice for a live ticket card. */
export interface EmbedTicketPreview {
  kind: 'ticket'
  ticketId: string
  /** The pair's conversation id — a customer ticket's destination on the
   *  converged Messages surface. Null for internal ticket types (never
   *  conversation-linked; their `url` targets the admin inbox). */
  conversationId: string | null
  /** Formatted sequential reference, e.g. "#142". */
  reference: string
  title: string
  /**
   * Customer-facing stage label (Received / In progress / Awaiting your reply /
   * Resolved) — the same public projection the portal ticket page shows, never
   * the internal status name. Null when the status maps to no public stage.
   */
  statusLabel: string | null
  /** Status color for the badge dot (the workspace-assigned status color). */
  statusColor: string
  /** Triage priority (reuses the conversation priority scale; 'none' = unset). */
  priority: ConversationPriority
  createdAt: string | null
  /** Absolute portal URL for the ticket — see {@link EmbedPostPreview.url}. */
  url: string
}

/** A broken, deleted, or unauthorized embed — renders as a muted placeholder. */
export interface EmbedUnavailable {
  unavailable: true
}

export type EmbedPreview =
  | EmbedPostPreview
  | EmbedChangelogPreview
  | EmbedArticlePreview
  | EmbedTicketPreview
  | EmbedUnavailable
