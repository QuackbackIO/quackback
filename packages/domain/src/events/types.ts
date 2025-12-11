/**
 * Domain event types for integration dispatching.
 */

export type DomainEventType =
  | 'post.created'
  | 'post.updated'
  | 'post.status_changed'
  | 'post.deleted'
  | 'comment.created'
  | 'comment.deleted'
  | 'vote.created'
  | 'vote.deleted'
  | 'changelog.published'

export type EventActor =
  | { type: 'user'; userId: string; email?: string }
  | { type: 'system'; service: string }

export interface DomainEvent<T = unknown> {
  id: string
  type: DomainEventType
  organizationId: string
  timestamp: string
  actor: EventActor
  data: T
}

// Event payload types for type safety
export interface PostCreatedData {
  post: {
    id: string
    title: string
    content: string
    boardId: string
    boardSlug: string
    authorEmail?: string
    voteCount?: number
  }
}

export interface PostStatusChangedData {
  post: {
    id: string
    title: string
    boardSlug: string
  }
  previousStatus: string
  newStatus: string
}

export interface PostUpdatedData {
  post: {
    id: string
    title: string
    content: string
  }
  changes: {
    title?: { from: string; to: string }
    content?: { from: string; to: string }
  }
}

export interface PostDeletedData {
  post: {
    id: string
    title: string
  }
}

export interface CommentCreatedData {
  comment: {
    id: string
    content: string
    authorEmail?: string
  }
  post: {
    id: string
    title: string
  }
}

export interface CommentDeletedData {
  comment: {
    id: string
  }
  post: {
    id: string
    title: string
  }
}

export interface VoteCreatedData {
  post: {
    id: string
    title: string
    voteCount: number
  }
}

export interface VoteDeletedData {
  post: {
    id: string
    title: string
    voteCount: number
  }
}

export interface ChangelogPublishedData {
  changelog: {
    id: string
    title: string
    slug: string
    content: string
  }
}
