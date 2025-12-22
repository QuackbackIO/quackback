import { z } from 'zod'

export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.enum(['member', 'admin']),
})

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().min(3, 'URL slug must be at least 3 characters'),
})

/**
 * Schema for updating user profile
 */
export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
})

export type InviteInput = z.infer<typeof inviteSchema>
export type CreateOrgInput = z.infer<typeof createOrgSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
