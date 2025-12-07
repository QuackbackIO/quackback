import {
  postService,
  type PostService,
  boardService,
  type BoardService,
  commentService,
  type CommentService,
  statusService,
  type StatusService,
  tagService,
  type TagService,
} from '@quackback/domain'

/**
 * Service container for domain services
 *
 * Provides singleton instances of domain services.
 * Services are stateless and safe to reuse across requests.
 *
 * Usage:
 *   import { services } from '@/lib/services'
 *   const postService = services.posts
 *
 * Or use individual getters:
 *   import { getPostService } from '@/lib/services'
 *   const postService = getPostService()
 */

/**
 * Get the PostService instance
 */
export function getPostService(): PostService {
  return postService
}

/**
 * Get the BoardService instance
 */
export function getBoardService(): BoardService {
  return boardService
}

/**
 * Get the CommentService instance
 */
export function getCommentService(): CommentService {
  return commentService
}

/**
 * Get the StatusService instance
 */
export function getStatusService(): StatusService {
  return statusService
}

/**
 * Get the TagService instance
 */
export function getTagService(): TagService {
  return tagService
}

/**
 * Service container with convenient property access
 */
export const services = {
  get posts(): PostService {
    return getPostService()
  },
  get boards(): BoardService {
    return getBoardService()
  },
  get comments(): CommentService {
    return getCommentService()
  },
  get statuses(): StatusService {
    return getStatusService()
  },
  get tags(): TagService {
    return getTagService()
  },
}
