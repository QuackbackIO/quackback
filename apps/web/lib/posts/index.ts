/**
 * Post domain module exports
 */

// PostService functions
export {
  createPost,
  updatePost,
  voteOnPost,
  changeStatus,
  getPostById,
  getPostWithDetails,
  getCommentsWithReplies,
  listInboxPosts,
  listPostsForExport,
  canEditPost,
  canDeletePost,
  userEditPost,
  softDeletePost,
  restorePost,
  permanentDeletePost,
} from './post.service'

// PublicPostService functions (prefixed with "public" or descriptive names)
export {
  listPublicPosts,
  getPublicPostDetail,
  getPublicRoadmapPosts,
  getPublicRoadmapPostsPaginated,
  hasUserVoted,
  getUserVotedPostIds,
  getAllUserVotedPostIds,
  getBoardByPostId,
} from './post.public'

export { PostError } from './post.errors'
export type { PostErrorCode } from './post.errors'
export type {
  CreatePostInput,
  UpdatePostInput,
  VoteResult,
  ChangeStatusInput,
  PostWithDetails,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
  OfficialResponse,
  PublicPostListResult,
  PublicPostListItem,
  InboxPostListParams,
  InboxPostListResult,
  PostListItem,
  PostForExport,
  CreatePostResult,
  ChangeStatusResult,
} from './post.types'
