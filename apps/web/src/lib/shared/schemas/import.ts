/**
 * Shared constants for the template-driven CSV import (admin hub): the
 * headers the route validates, and the downloadable template. The template
 * columns ARE the import contract — unknown status/board/tag values are
 * auto-created on import; a filled source_id makes re-imports idempotent.
 */

/**
 * Required CSV headers
 */
export const REQUIRED_HEADERS = ['title', 'content'] as const

/**
 * CSV template for download
 */
export const CSV_TEMPLATE = `title,content,status,tags,board,author_name,author_email,email_verified,vote_count,created_at,source_id
"Add dark mode support","It would be great to have a dark mode option for the app. Many users prefer working in low-light environments.","open","feature,ui","","John Doe","john@example.com","false","5","2024-01-15T10:30:00Z",""
"Fix login timeout","Users are being logged out too quickly. The session timeout seems too aggressive.","under_review","bug","","","","","2","",""
`
