/**
 * Precise payload schemas (WO-5), replacing the WO-2 skeleton. Derived from the
 * legacy `EventData` shapes in ../types.ts. Top-level objects are `.loose()` so
 * an extra field on a real event never rejects emission during the transition;
 * field types are still validated.
 *
 * PII note: email/author fields are typed nullable. Sanitisation to real
 * addresses (dropping synthetic anon placeholders via realEmail()) happens at
 * the emit call sites (WO-6) — the schema documents the shape, it does not
 * scrub. Payloads persist ~90 days in the outbox, so keep snapshots minimal.
 */
import { z } from 'zod'

const id = z.string()
const nullableStr = z.string().nullable().optional()

// --- shared sub-schemas ---
export const postRef = z.object({ id, title: z.string(), boardId: id, boardSlug: z.string() })
export const postData = z.object({
  id,
  title: z.string(),
  content: z.string(),
  boardId: id,
  boardSlug: z.string(),
  authorEmail: nullableStr,
  authorName: nullableStr,
  voteCount: z.number(),
})
export const commentData = z.object({
  id,
  content: z.string(),
  authorEmail: nullableStr,
  authorName: nullableStr,
  isPrivate: z.boolean().optional(),
})
export const conversationRef = z.object({
  id,
  status: z.string(),
  channel: z.string(),
  priority: z.string(),
  assignedTeamId: z.string().nullable().optional(),
})
export const messageData = z.object({
  id,
  conversationId: id,
  senderType: z.enum(['visitor', 'agent']),
  authorPrincipalId: nullableStr,
  authorName: nullableStr,
  authorEmail: nullableStr,
  content: z.string(),
  createdAt: z.string(),
})
export const ticketRef = z.object({
  id,
  number: z.number(),
  type: z.string(),
  priority: z.string(),
  assignedPrincipalId: z.string().nullable().optional(),
  assignedTeamId: z.string().nullable().optional(),
})
const attachment = z.object({
  name: z.string(),
  url: z.string(),
  contentType: z.string(),
  size: z.number(),
})

// --- post family ---
export const P = {
  'post.created': z.looseObject({ post: postData }),
  'post.status_changed': z.looseObject({
    post: postRef,
    previousStatus: z.string(),
    newStatus: z.string(),
  }),
  'post.updated': z.looseObject({ post: postRef, changedFields: z.array(z.string()) }),
  'post.deleted': z.looseObject({ post: postRef, deletedBy: nullableStr }),
  'post.restored': z.looseObject({ post: postRef }),
  'post.merged': z.looseObject({ duplicatePost: postRef, canonicalPost: postRef }),
  'post.unmerged': z.looseObject({ post: postRef, formerCanonicalPost: postRef }),
  'post.mentioned': z.looseObject({
    postId: id,
    postTitle: z.string(),
    postUrl: z.string(),
    mentionedPrincipalId: id,
    mentioningPrincipalId: id,
    excerpt: z.string(),
  }),
  // comment family
  'comment.created': z.looseObject({ comment: commentData, post: postRef }),
  'comment.updated': z.looseObject({ comment: commentData, post: postRef }),
  'comment.deleted': z.looseObject({
    comment: z.looseObject({ id, isPrivate: z.boolean().optional() }),
    post: postRef,
  }),
  // changelog
  'changelog.published': z.looseObject({
    changelog: z.looseObject({
      id,
      title: z.string(),
      contentPreview: z.string(),
      publishedAt: z.string(),
      linkedPostCount: z.number(),
    }),
  }),
  // status page
  'status.incident_created': z.looseObject({
    incident: z.looseObject({ id, componentIds: z.array(z.string()) }).loose(),
  }),
  'status.maintenance_scheduled': z.looseObject({
    incident: z.looseObject({ id, componentIds: z.array(z.string()) }).loose(),
  }),
  'status.incident_updated': z.looseObject({
    incidentId: id,
    kind: z.string(),
    status: z.string(),
    body: z.string(),
  }),
  'status.maintenance_started': z.looseObject({
    incidentId: id,
    title: z.string(),
    componentIds: z.array(z.string()),
  }),
  'status.maintenance_completed': z.looseObject({
    incidentId: id,
    title: z.string(),
    componentIds: z.array(z.string()),
  }),
  'status.component_changed': z.looseObject({
    componentId: id,
    componentName: z.string(),
    previousStatus: z.string(),
    status: z.string(),
    source: z.string(),
  }),
  // conversation
  'conversation.created': z.looseObject({ conversation: conversationRef.loose() }),
  'conversation.status_changed': z.looseObject({
    conversation: conversationRef,
    previousStatus: z.string(),
    newStatus: z.string(),
  }),
  'conversation.assigned': z.looseObject({
    conversation: conversationRef,
    assignedAgentPrincipalId: nullableStr,
    previousAgentPrincipalId: nullableStr,
  }),
  'conversation.priority_changed': z.looseObject({
    conversation: conversationRef,
    previousPriority: z.string(),
    newPriority: z.string(),
  }),
  'conversation.attribute_changed': z.looseObject({
    conversationId: id,
    conversation: conversationRef,
    key: z.string(),
    value: z.unknown(),
    source: z.string(),
  }),
  'conversation.csat_submitted': z.looseObject({
    conversation: conversationRef,
    rating: z.number(),
    comment: nullableStr,
    submittedAt: z.string(),
  }),
  'conversation.csat_comment_added': z.looseObject({
    conversation: conversationRef,
    rating: z.number(),
    comment: z.string(),
    submittedAt: z.string(),
  }),
  'conversation.note_mentioned': z.looseObject({ conversationId: id }).loose(),
  'conversation.customer_unresponsive': z.looseObject({
    conversationId: id,
    conversation: conversationRef,
    workflowId: id,
    silenceMinutes: z.number(),
    sinceAt: z.string(),
  }),
  'conversation.teammate_unresponsive': z.looseObject({
    conversationId: id,
    conversation: conversationRef,
    workflowId: id,
    silenceMinutes: z.number(),
    sinceAt: z.string(),
  }),
  // message
  'message.created': z.looseObject({ message: messageData, conversation: conversationRef }),
  'message.note_created': z.looseObject({ message: messageData, conversation: conversationRef }),
  'message.deleted': z.looseObject({
    message: z.looseObject({ id, conversationId: id }),
    conversation: conversationRef,
  }),
  // ticket
  'ticket.created': z.looseObject({ ticket: ticketRef.loose() }),
  'ticket.status_changed': z.looseObject({
    ticket: ticketRef,
    previousStatus: z.string(),
    newStatus: z.string(),
    stage: nullableStr,
  }),
  'ticket.assigned': z.looseObject({
    ticket: ticketRef,
    assignedPrincipalId: nullableStr,
    previousPrincipalId: nullableStr,
    assignedTeamId: nullableStr,
    previousTeamId: nullableStr,
  }),
  'ticket.replied': z.looseObject({
    ticket: ticketRef,
    messageId: id,
    content: z.string(),
    attachments: z.array(attachment).nullable(),
    senderType: z.enum(['agent', 'visitor']),
    title: z.string(),
    authorName: nullableStr,
    requesterPrincipalId: nullableStr,
  }),
  'ticket.note_added': z.looseObject({
    ticket: ticketRef,
    messageId: id,
    content: z.string(),
    attachments: z.array(attachment).nullable(),
    senderType: z.enum(['agent', 'visitor']),
    title: z.string(),
    authorName: nullableStr,
  }),
  // assistant + sla
  'assistant.handed_off': z.looseObject({ conversationId: id, reason: z.string() }),
  'sla.approaching_breach': z.looseObject({
    conversationId: id,
    conversation: conversationRef,
    clock: z.string(),
    dueAt: z.string(),
  }),
  'sla.breached': z.looseObject({
    conversationId: id,
    conversation: conversationRef,
    clock: z.string(),
    dueAt: z.string(),
  }),
  // --- WO-6a: identity/admin plane (new, catalogue-only) ---
  'apikey.created': z.looseObject({ apiKeyId: id, name: z.string(), scopes: z.array(z.string()) }),
  'apikey.deleted': z.looseObject({ apiKeyId: id }),
  'settings.updated': z.looseObject({ changedKeys: z.array(z.string()) }),
  // --- WO-6b: content / taxonomy plane (new, catalogue-only) ---
  'board.created': z.looseObject({ boardId: id, name: z.string(), slug: z.string() }),
  'board.updated': z.looseObject({ boardId: id, changedKeys: z.array(z.string()) }),
  'board.deleted': z.looseObject({ boardId: id }),
  'tag.created': z.looseObject({ tagId: id, name: z.string() }),
  'tag.deleted': z.looseObject({ tagId: id }),
  'article.published': z.looseObject({ articleId: id, title: z.string() }),
  'article.updated': z.looseObject({ articleId: id, changedKeys: z.array(z.string()) }),
  'article.deleted': z.looseObject({ articleId: id }),
  // --- WO-6c: crm / ops plane (new, catalogue-only) ---
  'company.created': z.looseObject({ companyId: id, name: z.string() }),
  'company.deleted': z.looseObject({ companyId: id }),
} as const

export type PayloadFor<T extends keyof typeof P> = z.infer<(typeof P)[T]>
