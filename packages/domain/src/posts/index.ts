/**
 * Post domain module exports
 */

export { PostService, postService } from './post.service'
export { PostError } from './post.errors'
export type { PostErrorCode } from './post.errors'
export type {
  CreatePostInput,
  UpdatePostInput,
  VoteResult,
  ChangeStatusInput,
  PostWithDetails,
  CommentNode,
} from './post.types'
