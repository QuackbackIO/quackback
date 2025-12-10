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
  memberService,
  type MemberService,
  organizationService,
  type OrganizationService,
  userService,
  type UserService,
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
 * Get the MemberService instance
 */
export function getMemberService(): MemberService {
  return memberService
}

/**
 * Get the OrganizationService instance
 */
export function getOrganizationService(): OrganizationService {
  return organizationService
}

/**
 * Get the UserService instance
 */
export function getUserService(): UserService {
  return userService
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
  get members(): MemberService {
    return getMemberService()
  },
  get organizations(): OrganizationService {
    return getOrganizationService()
  },
  get users(): UserService {
    return getUserService()
  },
}
