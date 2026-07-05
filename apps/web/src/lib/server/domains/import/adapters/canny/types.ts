/**
 * Canny API response types (v1 endpoints this adapter uses). Mirrors
 * `scripts/import/adapters/canny/types.ts`, trimmed to boards/posts/votes.
 */
export interface CannyAuthor {
  id: string
  created: string
  email: string | null
  isAdmin: boolean
  name: string
  url: string
  userID: string | null
}

export interface CannyBoard {
  id: string
  created: string
  isPrivate: boolean
  name: string
  postCount: number
}

export interface CannyPost {
  id: string
  author: CannyAuthor
  board: { id: string; name: string }
  category: { id: string; name: string } | null
  created: string
  details: string
  imageURLs: string[]
  score: number
  status: string
  tags: Array<{ id: string; name: string }>
  title: string
}

export interface CannyVote {
  id: string
  /** Canny API returns `voter` (not `author`) for votes */
  voter: CannyAuthor | null
  created: string
  post: { id: string }
}
