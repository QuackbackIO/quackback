/**
 * Zod validation schemas for intermediate format
 *
 * These validate CSV data after parsing to ensure it matches
 * the expected intermediate format before import.
 */

import { z } from 'zod'

// Accept valid email, empty string (convert to undefined), or undefined
const optionalEmail = z
  .string()
  .transform((val) => (val === '' ? undefined : val))
  .pipe(z.string().email().optional())

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === 'boolean') return val
    return val.toLowerCase() === 'true' || val === '1'
  })
  .optional()
  .default(false)

export const intermediatePostSchema = z.object({
  id: z.string().min(1, 'Post ID is required'),
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  authorEmail: optionalEmail,
  authorName: z.string().optional(),
  board: z.string().optional(),
  status: z.string().optional(),
  moderation: z.enum(['published', 'pending', 'spam', 'archived']).optional().default('published'),
  tags: z.string().optional(),
  roadmap: z.string().optional(),
  voteCount: z.coerce.number().int().min(0).optional(),
  createdAt: z.string().optional(),
  response: z.string().optional(),
  responseAt: z.string().optional(),
  responseBy: optionalEmail,
})

export const intermediateCommentSchema = z.object({
  postId: z.string().min(1, 'Post ID is required'),
  authorEmail: optionalEmail,
  authorName: z.string().optional(),
  body: z.string().min(1, 'Comment body is required'),
  isStaff: booleanFromString,
  createdAt: z.string().optional(),
})

export const intermediateVoteSchema = z.object({
  postId: z.string().min(1, 'Post ID is required'),
  voterEmail: z.string().email('Valid voter email is required'),
  createdAt: z.string().optional(),
})

export const intermediateNoteSchema = z.object({
  postId: z.string().min(1, 'Post ID is required'),
  authorEmail: optionalEmail,
  authorName: z.string().optional(),
  body: z.string().min(1, 'Note body is required'),
  createdAt: z.string().optional(),
})
