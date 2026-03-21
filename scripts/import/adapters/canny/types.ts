/**
 * Canny API response types
 *
 * These types mirror the Canny REST API response shapes.
 * Reference: https://developers.canny.io/api-reference
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
  privateComments: boolean
  token: string
  url: string
}

export interface CannyCategory {
  id: string
  board: { id: string; name: string }
  created: string
  name: string
  parentID: string | null
  postCount: number
  url: string
}

export interface CannyTag {
  id: string
  board: { id: string; name: string }
  created: string
  name: string
  postCount: number
  url: string
}

export interface CannyPost {
  id: string
  author: CannyAuthor
  board: { id: string; name: string }
  by: CannyAuthor | null
  category: CannyCategory | null
  commentCount: number
  created: string
  customFields: unknown[]
  details: string
  eta: string | null
  imageURLs: string[]
  mergeHistory: Array<{ post: { id: string } }>
  owner: CannyAuthor | null
  score: number
  status: string
  statusChangedAt: string
  tags: Array<{ id: string; name: string }>
  title: string
  url: string
}

export interface CannyComment {
  id: string
  author: CannyAuthor | null
  board: { id: string; name: string }
  created: string
  imageURLs: string[]
  internal: boolean
  likeCount: number
  mentions: unknown[]
  parentID: string | null
  post: { id: string }
  private: boolean
  value: string
}

export interface CannyVote {
  id: string
  /** Canny API returns `voter` (not `author`) for votes */
  voter: CannyAuthor | null
  board: { id: string; name: string } | null
  created: string
  post: { id: string }
}

export interface CannyChangelogEntry {
  id: string
  created: string
  labels: unknown[]
  lastSaved: string
  markdownDetails: string
  plaintextDetails: string
  posts: Array<{ id: string }>
  publishedAt: string | null
  status: 'draft' | 'scheduled' | 'published'
  title: string
  types: string[]
  url: string
}
