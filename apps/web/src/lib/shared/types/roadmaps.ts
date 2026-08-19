/**
 * Roadmap-related types for client use.
 *
 * Re-exported from the server domain for architectural compliance — type-only
 * imports are erased at compile time and never affect the bundle.
 */

export type { RoadmapViewPost, RoadmapPostsListResult } from '@/lib/server/domains/roadmaps'

// RoadmapPost and RoadmapPostListResult live in the posts domain
export type { RoadmapPost, RoadmapPostListResult } from '@/lib/server/domains/posts'
