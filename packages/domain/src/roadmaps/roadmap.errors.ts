import type { DomainError } from '../shared/result'

/**
 * Error codes specific to Roadmap domain operations
 */
export type RoadmapErrorCode =
  | 'ROADMAP_NOT_FOUND'
  | 'POST_NOT_FOUND'
  | 'STATUS_NOT_FOUND'
  | 'DUPLICATE_SLUG'
  | 'POST_ALREADY_IN_ROADMAP'
  | 'POST_NOT_IN_ROADMAP'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

/**
 * Domain error type for Roadmap operations
 */
export interface RoadmapError extends DomainError {
  code: RoadmapErrorCode
}

/**
 * Factory functions for creating RoadmapError instances
 */
export const RoadmapError = {
  notFound: (id?: string): RoadmapError => ({
    code: 'ROADMAP_NOT_FOUND',
    message: id ? `Roadmap with ID ${id} not found` : 'Roadmap not found',
  }),

  postNotFound: (id?: string): RoadmapError => ({
    code: 'POST_NOT_FOUND',
    message: id ? `Post with ID ${id} not found` : 'Post not found',
  }),

  statusNotFound: (id?: string): RoadmapError => ({
    code: 'STATUS_NOT_FOUND',
    message: id ? `Status with ID ${id} not found` : 'Status not found',
  }),

  duplicateSlug: (slug: string): RoadmapError => ({
    code: 'DUPLICATE_SLUG',
    message: `A roadmap with slug "${slug}" already exists`,
  }),

  postAlreadyInRoadmap: (postId: string, roadmapId: string): RoadmapError => ({
    code: 'POST_ALREADY_IN_ROADMAP',
    message: `Post ${postId} is already in roadmap ${roadmapId}`,
  }),

  postNotInRoadmap: (postId: string, roadmapId: string): RoadmapError => ({
    code: 'POST_NOT_IN_ROADMAP',
    message: `Post ${postId} is not in roadmap ${roadmapId}`,
  }),

  unauthorized: (action?: string): RoadmapError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  validationError: (message: string): RoadmapError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
