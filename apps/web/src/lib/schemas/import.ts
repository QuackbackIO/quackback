import { z } from 'zod'

/**
 * CSV row validation schema (for preview/validation on the client)
 */
export const importRowSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(10000, 'Content must be 10000 characters or less'),
  status: z.string().optional(),
  tags: z.string().optional(),
  board: z.string().optional(),
  author_name: z.string().optional(),
  author_email: z.string().email('Invalid email format').optional().or(z.literal('')),
  vote_count: z.string().optional(),
  created_at: z.string().optional(),
})

export type ImportRow = z.infer<typeof importRowSchema>

/**
 * Import request validation schema
 */
export const importRequestSchema = z.object({
  boardId: z.string().uuid('Invalid board ID'),
})

export type ImportRequest = z.infer<typeof importRequestSchema>

/**
 * Expected CSV headers
 */
export const CSV_HEADERS = [
  'title',
  'content',
  'status',
  'tags',
  'board',
  'author_name',
  'author_email',
  'vote_count',
  'created_at',
] as const

/**
 * Required CSV headers
 */
export const REQUIRED_HEADERS = ['title', 'content'] as const

/**
 * CSV template for download
 */
export const CSV_TEMPLATE = `title,content,status,tags,board,author_name,author_email,vote_count,created_at
"Add dark mode support","It would be great to have a dark mode option for the app. Many users prefer working in low-light environments.","open","feature,ui","","John Doe","john@example.com","5","2024-01-15T10:30:00Z"
"Fix login timeout","Users are being logged out too quickly. The session timeout seems too aggressive.","under_review","bug","","","","2",""
`
